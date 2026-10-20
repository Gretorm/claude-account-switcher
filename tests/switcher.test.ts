import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { AccountRepository, fromStorageArea } from '../src/core/accounts';
import { BrowserCookieJar } from '../src/core/cookies';
import {
  AccountSwitcher,
  PENDING_SWITCH_TTL_MS,
  hasSessionCookie,
  isSnapshotExpired,
  matchAccount,
} from '../src/core/switcher';
import type { SitePage, SiteTabs } from '../src/core/switcher';
import type { Account } from '../src/core/accounts';
import type { StoredCookie } from '../src/core/cookies';
import { AppError, type ErrorCode } from '../src/shared/errors';
import { FakeCookies } from './helpers/fake-cookies';

const NOW = Date.UTC(2026, 0, 1);
const LATER = NOW / 1000 + 30 * 24 * 3600;

class RecordingTabs implements SiteTabs {
  readonly calls: string[] = [];

  clearSiteStorage(storeId: string | undefined, options: { all: boolean }): Promise<void> {
    this.calls.push(`clear:${storeId ?? 'default'}:${String(options.all)}`);
    return Promise.resolve();
  }

  openSitePage(storeId: string | undefined, options: { page: SitePage }): Promise<void> {
    this.calls.push(`open:${options.page}:${storeId ?? 'default'}`);
    return Promise.resolve();
  }
}

function setup() {
  let now = NOW;
  const cookies = new FakeCookies({ now: () => now });
  const repository = new AccountRepository(fromStorageArea(fakeBrowser.storage.local));
  const tabs = new RecordingTabs();
  const switcher = new AccountSwitcher({
    jar: new BrowserCookieJar(cookies, {
      capabilities: { partitionKey: true, firstPartyDomain: false },
      now: () => now,
    }),
    repository,
    tabs,
    now: () => now,
  });
  const signIn = (value: string, storeId?: string) => {
    for (const cookie of cookies.all(storeId))
      void cookies.remove({
        url: 'https://claude.ai/',
        name: cookie.name,
        ...(storeId ? { storeId } : {}),
      });
    cookies.seed({
      name: 'sessionKey',
      domain: '.claude.ai',
      value,
      httpOnly: true,
      expirationDate: LATER,
      ...(storeId ? { storeId } : {}),
    });
    cookies.seed({
      name: 'prefs',
      domain: 'claude.ai',
      value: `prefs-${value}`,
      ...(storeId ? { storeId } : {}),
    });
  };
  const sessionValue = (storeId?: string) =>
    cookies.all(storeId).find((cookie) => cookie.name === 'sessionKey')?.value;
  return {
    cookies,
    repository,
    tabs,
    switcher,
    signIn,
    sessionValue,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function expectCode(promise: Promise<unknown>, code: ErrorCode): Promise<void> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

/** Signs in and lets the page report it, which saves the session automatically. */
async function signInAndReport(
  env: ReturnType<typeof setup>,
  value: string,
  email?: string,
  storeId?: string,
) {
  env.signIn(value, storeId);
  return env.switcher.reportPageState(storeId, {
    signedIn: true,
    ...(email === undefined ? {} : { identity: { email } }),
  });
}

async function accountById(env: ReturnType<typeof setup>, id: string): Promise<Account> {
  const account = (await env.repository.read()).accounts.find((entry) => entry.id === id);
  if (account === undefined) throw new Error(`no account ${id}`);
  return account;
}

/** Saves two accounts, "work" (session A) and "home" (session B); B is live. */
async function twoAccounts(env: ReturnType<typeof setup>) {
  const work = await signInAndReport(env, 'A', 'work@example.com');
  const home = await signInAndReport(env, 'B', 'home@example.com');
  const workId = work.savedAccount?.id;
  const homeId = home.savedAccount?.id;
  if (workId === undefined || homeId === undefined) throw new Error('accounts not saved');
  return { workId, homeId };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('automatic saving', () => {
  it('saves a signed-in session under its email', async () => {
    const env = setup();
    const result = await signInAndReport(env, 'A', 'me@example.com');
    expect(result.savedAccount).toMatchObject({ label: 'me@example.com', created: true });
    const state = await env.switcher.getState(undefined);
    expect(state.accounts).toMatchObject([{ label: 'me@example.com', active: true, status: 'ok' }]);
    expect(state.current).toMatchObject({ signedIn: true, matchedBy: 'session' });
  });

  it('falls back to a numbered label when the email is unknown', async () => {
    const env = setup();
    const result = await signInAndReport(env, 'A');
    expect(result.savedAccount?.label).toBe('Account 1');
  });

  it('refreshes a known session silently instead of duplicating it', async () => {
    const env = setup();
    await signInAndReport(env, 'A', 'me@example.com');
    env.cookies.seed({ name: 'prefs', domain: 'claude.ai', value: 'prefs-A-updated' });
    const again = await env.switcher.reportPageState(undefined, { signedIn: true });
    expect(again).toEqual({});
    const [account] = (await env.repository.read()).accounts;
    expect((await env.repository.read()).accounts).toHaveLength(1);
    expect(account?.cookies.find((cookie) => cookie.name === 'prefs')?.value).toBe(
      'prefs-A-updated',
    );
  });

  it('saves nothing when signed out or when the site rejects the session', async () => {
    const env = setup();
    await expect(env.switcher.reportPageState(undefined, { signedIn: false })).resolves.toEqual({});
    env.signIn('A');
    await expect(env.switcher.reportPageState(undefined, { signedIn: false })).resolves.toEqual({});
    expect((await env.repository.read()).accounts).toEqual([]);
  });

  it('trusts the session cookie when the page gives no answer', async () => {
    const env = setup();
    env.signIn('A');
    const result = await env.switcher.reportPageState(undefined, { signedIn: null });
    expect(result.savedAccount?.created).toBe(true);
  });
});

describe('switchTo', () => {
  it('restores the target session and reloads the tabs', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    await expect(env.switcher.switchTo(undefined, workId)).resolves.toEqual({ switched: true });
    expect(env.sessionValue()).toBe('A');
    expect(env.cookies.all().find((cookie) => cookie.name === 'prefs')?.value).toBe('prefs-A');
    expect(env.tabs.calls).toEqual(['clear:default:false', 'open:home:default']);
    expect((await env.switcher.getState(undefined)).current.accountId).toBe(workId);
  });

  it('is a no-op when the target is already active', async () => {
    const env = setup();
    const { homeId } = await twoAccounts(env);
    await expect(env.switcher.switchTo(undefined, homeId)).resolves.toEqual({ switched: false });
    expect(env.tabs.calls).toEqual([]);
  });

  it('refreshes the snapshot of the account being left', async () => {
    const env = setup();
    const { workId, homeId } = await twoAccounts(env);
    env.cookies.seed({ name: 'prefs', domain: 'claude.ai', value: 'prefs-B-updated' });
    await env.switcher.switchTo(undefined, workId);
    const home = await accountById(env, homeId);
    expect(home.cookies.find((cookie) => cookie.name === 'prefs')?.value).toBe('prefs-B-updated');
  });

  it('saves an unknown live session before switching away from it', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    env.signIn('C');
    await env.switcher.switchTo(undefined, workId);
    expect(env.sessionValue()).toBe('A');
    const accounts = (await env.repository.read()).accounts;
    expect(accounts).toHaveLength(3);
    expect(accounts[2]?.cookies.find((cookie) => cookie.name === 'sessionKey')?.value).toBe('C');
  });

  it('rolls back to the previous cookies when a write fails', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    // Only the target's session cookie fails, so the rollback itself can succeed.
    const realSet = env.cookies.set.bind(env.cookies);
    env.cookies.set = (details) =>
      details.value === 'A' ? Promise.reject(new Error('write failed')) : realSet(details);
    await expectCode(env.switcher.switchTo(undefined, workId), 'SWITCH_FAILED');
    expect(env.sessionValue()).toBe('B');
    expect(env.cookies.all().find((cookie) => cookie.name === 'prefs')?.value).toBe('prefs-B');
    expect(env.tabs.calls).toEqual([]);
  });

  it('switches even when the browser refuses an auxiliary cookie of the session left', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    // A cookie only the current account has, which the browser refuses to remove.
    env.cookies.seed({ name: 'orgSso', domain: 'claude.ai', value: 'x' });
    env.cookies.failRemove.add('orgSso');
    await expect(env.switcher.switchTo(undefined, workId)).resolves.toEqual({ switched: true });
    expect(env.sessionValue()).toBe('A');
    expect(env.tabs.calls).toContain('open:home:default');
  });

  it('reports a failed rollback', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    env.cookies.failSet.add('sessionKey');
    await expectCode(env.switcher.switchTo(undefined, workId), 'ROLLBACK_FAILED');
  });

  it('does not touch cookies when the saved session has expired', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    env.advance(31 * 24 * 3600 * 1000);
    await expectCode(env.switcher.switchTo(undefined, workId), 'SESSION_EXPIRED');
    expect(env.sessionValue()).toBe('B');
    expect((await accountById(env, workId)).status).toBe('expired');
  });

  it('switches only the given container', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    env.signIn('B', 'firefox-container-1');
    await env.switcher.switchTo('firefox-container-1', workId);
    expect(env.sessionValue('firefox-container-1')).toBe('A');
    expect(env.sessionValue()).toBe('B');
    expect(env.tabs.calls).toContain('open:home:firefox-container-1');
  });

  it('clears all site storage when the setting is on', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    await env.switcher.updateSettings({ clearSiteStorageOnSwitch: true });
    await env.switcher.switchTo(undefined, workId);
    expect(env.tabs.calls[0]).toBe('clear:default:true');
  });
});

describe('session expiry detection', () => {
  it('marks the target expired when the page rejects the restored session', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    await env.switcher.switchTo(undefined, workId);
    const result = await env.switcher.reportPageState(undefined, { signedIn: false });
    expect(result.expiredAccount).toMatchObject({ id: workId, status: 'expired' });
    // Reported once only.
    await expect(env.switcher.reportPageState(undefined, { signedIn: false })).resolves.toEqual({});
  });

  it('confirms the target when the page accepts it', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    await env.switcher.switchTo(undefined, workId);
    await expect(
      env.switcher.reportPageState(undefined, {
        signedIn: true,
        identity: { email: 'work@example.com' },
      }),
    ).resolves.toEqual({});
    expect((await accountById(env, workId)).status).toBe('ok');
    expect((await env.repository.read()).pendingSwitches).toEqual({});
  });

  it('keeps waiting while the page has no answer, until the window closes', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    await env.switcher.switchTo(undefined, workId);
    await env.switcher.reportPageState(undefined, { signedIn: null });
    expect((await env.repository.read()).pendingSwitches.default?.accountId).toBe(workId);
    env.advance(PENDING_SWITCH_TTL_MS + 1);
    await env.switcher.reportPageState(undefined, { signedIn: null });
    expect((await env.repository.read()).pendingSwitches).toEqual({});
  });
});

describe('beginLogin', () => {
  it('keeps the live session saved, clears cookies and waits for a sign-in', async () => {
    const env = setup();
    const { homeId } = await twoAccounts(env);
    env.cookies.seed({ name: 'prefs', domain: 'claude.ai', value: 'prefs-B-updated' });
    await env.switcher.beginLogin(undefined);
    expect(env.sessionValue()).toBeUndefined();
    const state = await env.switcher.getState(undefined);
    expect(state.current.signedIn).toBe(false);
    expect(state.pendingLogin).toEqual({});
    const home = await accountById(env, homeId);
    expect(home.cookies.find((cookie) => cookie.name === 'prefs')?.value).toBe('prefs-B-updated');
    expect(env.tabs.calls).toEqual(['clear:default:false', 'open:login:default']);
  });

  it('saves an unknown live session before signing out', async () => {
    const env = setup();
    env.signIn('A');
    await env.switcher.beginLogin(undefined);
    expect((await env.repository.read()).accounts).toMatchObject([{ label: 'Account 1' }]);
  });

  it('saves the next sign-in automatically', async () => {
    const env = setup();
    await twoAccounts(env);
    await env.switcher.beginLogin(undefined);
    const result = await signInAndReport(env, 'C', 'third@example.com');
    expect(result.savedAccount).toMatchObject({ label: 'third@example.com', created: true });
    expect((await env.switcher.getState(undefined)).pendingLogin).toBeUndefined();
  });

  it('re-saves an expired account after the user logs in again', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    await env.switcher.beginLogin(undefined, { resaveAccountId: workId });
    expect((await env.switcher.getState(undefined)).pendingLogin).toEqual({
      resaveAccountId: workId,
      resaveLabel: 'work@example.com',
    });
    const result = await signInAndReport(env, 'A2', 'work@example.com');
    expect(result.savedAccount).toMatchObject({ id: workId, created: false });
    const work = await accountById(env, workId);
    expect(work.cookies.find((cookie) => cookie.name === 'sessionKey')?.value).toBe('A2');
    expect((await env.repository.read()).accounts).toHaveLength(2);
  });

  it('saves a different account as new instead of overwriting the one being re-saved', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    await env.switcher.beginLogin(undefined, { resaveAccountId: workId });
    const result = await signInAndReport(env, 'Z', 'someone-else@example.com');
    expect(result.savedAccount).toMatchObject({ created: true });
    const work = await accountById(env, workId);
    expect(work.cookies.find((cookie) => cookie.name === 'sessionKey')?.value).toBe('A');
  });
});

describe('session cookie rotation', () => {
  it('refreshes the owner snapshot when the site replaces its session cookie', async () => {
    const env = setup();
    const { homeId } = await twoAccounts(env);
    const old = env.cookies.all().find((cookie) => cookie.name === 'sessionKey');
    if (old === undefined) throw new Error('missing cookie');
    await env.switcher.handleCookieChange(undefined, { removed: true, cause: 'overwrite' }, old);
    env.cookies.seed({
      name: 'sessionKey',
      domain: '.claude.ai',
      value: 'B-rotated',
      expirationDate: LATER,
    });
    const fresh = env.cookies.all().find((cookie) => cookie.name === 'sessionKey');
    if (fresh === undefined) throw new Error('missing cookie');
    await env.switcher.handleCookieChange(undefined, { removed: false, cause: 'explicit' }, fresh);
    const home = await accountById(env, homeId);
    expect(home.cookies.find((cookie) => cookie.name === 'sessionKey')?.value).toBe('B-rotated');
    expect((await env.switcher.getState(undefined)).current.accountId).toBe(homeId);
  });

  it('ignores a new sign-in that follows a logout', async () => {
    const env = setup();
    const { homeId } = await twoAccounts(env);
    const old = env.cookies.all().find((cookie) => cookie.name === 'sessionKey');
    if (old === undefined) throw new Error('missing cookie');
    await env.switcher.handleCookieChange(undefined, { removed: true, cause: 'explicit' }, old);
    env.signIn('C');
    const fresh = env.cookies.all().find((cookie) => cookie.name === 'sessionKey');
    if (fresh === undefined) throw new Error('missing cookie');
    await env.switcher.handleCookieChange(undefined, { removed: false, cause: 'explicit' }, fresh);
    const home = await accountById(env, homeId);
    expect(home.cookies.find((cookie) => cookie.name === 'sessionKey')?.value).toBe('B');
  });
});

describe('account management', () => {
  it('renames, reorders and deletes accounts', async () => {
    const env = setup();
    const { workId, homeId } = await twoAccounts(env);
    await env.switcher.renameAccount(workId, 'Office');
    await env.switcher.moveAccount(homeId, 0);
    let state = await env.switcher.getState(undefined);
    expect(state.accounts.map((entry) => entry.label)).toEqual(['home@example.com', 'Office']);
    await env.switcher.deleteAccount(undefined, workId);
    state = await env.switcher.getState(undefined);
    expect(state.accounts.map((entry) => entry.label)).toEqual(['home@example.com']);
    await expectCode(env.switcher.deleteAccount(undefined, workId), 'NOT_FOUND');
  });

  it('does not save the session of a deleted active account again', async () => {
    const env = setup();
    const { homeId } = await twoAccounts(env);
    await env.switcher.deleteAccount(undefined, homeId);
    expect((await env.repository.read()).dismissedSessions).toHaveLength(1);
    await expect(
      env.switcher.reportPageState(undefined, {
        signedIn: true,
        identity: { email: 'home@example.com' },
      }),
    ).resolves.toEqual({});
    // Not even when switching away from it.
    const [work] = (await env.repository.read()).accounts;
    await env.switcher.switchTo(undefined, work?.id ?? '');
    expect((await env.repository.read()).accounts).toHaveLength(1);
    // A new sign-in (new session) is saved again.
    const result = await signInAndReport(env, 'B2', 'home@example.com');
    expect(result.savedAccount?.created).toBe(true);
  });

  it('keeps the live session saveable when another account is deleted', async () => {
    const env = setup();
    const { workId } = await twoAccounts(env);
    await env.switcher.deleteAccount(undefined, workId);
    expect((await env.repository.read()).dismissedSessions).toEqual([]);
  });

  it('never exposes cookies in the view state', async () => {
    const env = setup();
    await twoAccounts(env);
    const state = await env.switcher.getState(undefined);
    expect(JSON.stringify(state)).not.toContain('prefs-');
  });

  it('counts expired accounts', async () => {
    const env = setup();
    await twoAccounts(env);
    expect(await env.switcher.countExpired()).toBe(0);
    env.advance(31 * 24 * 3600 * 1000);
    expect(await env.switcher.countExpired()).toBe(2);
  });
});

describe('session helpers', () => {
  const session = (value: string, expirationDate = LATER): StoredCookie => ({
    name: 'sessionKey',
    value,
    domain: '.claude.ai',
    hostOnly: false,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    session: false,
    expirationDate,
  });
  const saved = (id: string, cookies: StoredCookie[], email?: string): Account => ({
    id,
    label: id,
    status: 'ok',
    cookies,
    createdAt: 0,
    savedAt: 0,
    ...(email === undefined ? {} : { identity: { email } }),
  });

  it('matches by session cookie first, then by a unique email', () => {
    const accounts = [saved('a', [session('A')], 'a@x.io'), saved('b', [session('B')], 'b@x.io')];
    expect(matchAccount([session('B')], undefined, accounts)?.account.id).toBe('b');
    expect(matchAccount([session('Z')], { email: 'A@X.io' }, accounts)).toMatchObject({
      account: { id: 'a' },
      by: 'identity',
    });
    expect(matchAccount([session('Z')], undefined, accounts)).toBeUndefined();
  });

  it('does not guess when an email is ambiguous', () => {
    const accounts = [saved('a', [], 'same@x.io'), saved('b', [], 'same@x.io')];
    expect(matchAccount([], { email: 'same@x.io' }, accounts)).toBeUndefined();
  });

  it('judges expiry only from known session cookies', () => {
    expect(isSnapshotExpired([session('A', NOW / 1000 - 1)], NOW)).toBe(true);
    expect(isSnapshotExpired([session('A')], NOW)).toBe(false);
    expect(isSnapshotExpired([], NOW)).toBe(false);
    expect(hasSessionCookie([session('A')], NOW)).toBe(true);
  });
});
