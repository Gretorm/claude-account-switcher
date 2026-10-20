import { describe, expect, it } from 'vitest';
import {
  BrowserCookieJar,
  CookieOperationError,
  cookieUrl,
  isDefaultStoreId,
  isTabInStore,
  resolveCookieStoreId,
  toRemoveDetails,
  toSetDetails,
  toStoredCookie,
  type CookieCapabilities,
  type StoredCookie,
} from '../src/core/cookies';
import { FakeCookies } from './helpers/fake-cookies';

const NOW = Date.UTC(2026, 0, 1);
const IN_A_MONTH = NOW / 1000 + 30 * 24 * 3600;
const CHROMIUM: CookieCapabilities = { partitionKey: true, firstPartyDomain: false };
const FIREFOX: CookieCapabilities = { partitionKey: true, firstPartyDomain: true };
const SAFARI: CookieCapabilities = { partitionKey: false, firstPartyDomain: false };

function stored(overrides: Partial<StoredCookie> = {}): StoredCookie {
  return {
    name: 'sessionKey',
    value: 'secret',
    domain: '.claude.ai',
    hostOnly: false,
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'lax',
    session: false,
    expirationDate: IN_A_MONTH,
    ...overrides,
  };
}

const target = (capabilities: CookieCapabilities, storeId?: string) => ({
  storeId,
  capabilities,
  nowMs: NOW,
});

describe('toStoredCookie', () => {
  it('drops the store, keeps attributes, and normalizes unknown SameSite values', () => {
    const result = toStoredCookie({
      name: 'a',
      value: '1',
      domain: 'claude.ai',
      hostOnly: true,
      path: '/x',
      secure: true,
      httpOnly: false,
      sameSite: 'something-new',
      session: true,
      storeId: '0',
    });
    expect(result).toEqual({
      name: 'a',
      value: '1',
      domain: 'claude.ai',
      hostOnly: true,
      path: '/x',
      secure: true,
      httpOnly: false,
      sameSite: 'unspecified',
      session: true,
    });
  });

  it('never stores an expiration date for session cookies', () => {
    const result = toStoredCookie({ ...stored(), session: true, expirationDate: IN_A_MONTH });
    expect(result.expirationDate).toBeUndefined();
  });

  it('keeps a partition key only when it names a top-level site', () => {
    expect(toStoredCookie({ ...stored(), partitionKey: {} }).partitionKey).toBeUndefined();
    expect(
      toStoredCookie({
        ...stored(),
        partitionKey: { topLevelSite: 'https://claude.ai', hasCrossSiteAncestor: false },
      }).partitionKey,
    ).toEqual({ topLevelSite: 'https://claude.ai', hasCrossSiteAncestor: false });
  });
});

describe('toSetDetails', () => {
  it('writes host-only cookies without a domain', () => {
    const details = toSetDetails(stored({ domain: 'claude.ai', hostOnly: true }), target(CHROMIUM));
    expect(details).not.toBeNull();
    expect(details).not.toHaveProperty('domain');
    expect(details?.url).toBe('https://claude.ai/');
  });

  it('writes domain cookies with their domain', () => {
    expect(toSetDetails(stored(), target(CHROMIUM))?.domain).toBe('.claude.ai');
  });

  it('preserves secure, httpOnly, sameSite, path and expiration', () => {
    const details = toSetDetails(
      stored({ path: '/api', sameSite: 'strict', httpOnly: false }),
      target(CHROMIUM),
    );
    expect(details).toMatchObject({
      url: 'https://claude.ai/api',
      path: '/api',
      secure: true,
      httpOnly: false,
      sameSite: 'strict',
      expirationDate: IN_A_MONTH,
    });
  });

  it('keeps session cookies as session cookies', () => {
    const details = toSetDetails(stored({ session: true }), target(CHROMIUM));
    expect(details).not.toHaveProperty('expirationDate');
  });

  it('omits an unspecified SameSite instead of sending an invalid value', () => {
    expect(toSetDetails(stored({ sameSite: 'unspecified' }), target(CHROMIUM))).not.toHaveProperty(
      'sameSite',
    );
  });

  it('skips cookies that are already expired', () => {
    expect(toSetDetails(stored({ expirationDate: NOW / 1000 - 1 }), target(CHROMIUM))).toBeNull();
  });

  it('targets the requested cookie store', () => {
    expect(toSetDetails(stored(), target(FIREFOX, 'firefox-container-2'))?.storeId).toBe(
      'firefox-container-2',
    );
  });

  it('passes the partition key only when the browser supports it', () => {
    const partitioned = stored({ partitionKey: { topLevelSite: 'https://claude.ai' } });
    expect(toSetDetails(partitioned, target(CHROMIUM))?.partitionKey).toEqual({
      topLevelSite: 'https://claude.ai',
    });
    expect(toSetDetails(partitioned, target(SAFARI))).toBeNull();
  });

  it('passes firstPartyDomain only on browsers that know it', () => {
    const cookie = stored({ firstPartyDomain: 'claude.ai' });
    expect(toSetDetails(cookie, target(FIREFOX))?.firstPartyDomain).toBe('claude.ai');
    expect(toSetDetails(cookie, target(CHROMIUM))).not.toHaveProperty('firstPartyDomain');
  });
});

describe('cookieUrl and toRemoveDetails', () => {
  it('builds a URL matching the cookie host, scheme and path', () => {
    expect(cookieUrl({ domain: '.claude.ai', path: '/a' })).toBe('https://claude.ai/a');
    // Non-secure cookies too: the host permission covers https only.
    expect(cookieUrl({ domain: 'claude.ai', path: '' })).toBe('https://claude.ai/');
  });

  it('targets the exact cookie, partition and store', () => {
    expect(
      toRemoveDetails(stored({ partitionKey: { topLevelSite: 'https://claude.ai' } }), {
        storeId: '1',
        capabilities: CHROMIUM,
      }),
    ).toEqual({
      url: 'https://claude.ai/',
      name: 'sessionKey',
      storeId: '1',
      partitionKey: { topLevelSite: 'https://claude.ai' },
    });
  });
});

describe('BrowserCookieJar', () => {
  function seededJar(capabilities: CookieCapabilities = CHROMIUM) {
    const api = new FakeCookies({
      rejectFirstPartyDomain: !capabilities.firstPartyDomain,
      now: () => NOW,
    });
    api.seed({
      name: 'sessionKey',
      domain: '.claude.ai',
      httpOnly: true,
      expirationDate: IN_A_MONTH,
    });
    api.seed({ name: 'hostOnly', domain: 'claude.ai', sameSite: 'strict' });
    api.seed({ name: 'pathScoped', domain: 'claude.ai', path: '/api', sameSite: 'unspecified' });
    api.seed({
      name: 'chips',
      domain: 'claude.ai',
      partitionKey: { topLevelSite: 'https://claude.ai' },
    });
    api.seed({
      name: 'embedded',
      domain: 'claude.ai',
      partitionKey: { topLevelSite: 'https://example.com' },
    });
    api.seed({ name: 'cf_clearance', domain: '.claude.ai' });
    api.seed({ name: 'other', domain: 'example.com' });
    const jar = new BrowserCookieJar(api, { capabilities, now: () => NOW });
    return { api, jar };
  }

  it('snapshots account cookies only', async () => {
    const { jar } = seededJar();
    const names = (await jar.snapshot(undefined)).map((cookie) => cookie.name).sort();
    // No device-scoped Cloudflare cookie, no cookie partitioned under another site, no other site.
    expect(names).toEqual(['chips', 'hostOnly', 'pathScoped', 'sessionKey']);
  });

  it('restores a snapshot exactly after a clear', async () => {
    const { api, jar } = seededJar();
    const before = await jar.snapshot(undefined);
    await jar.clear(undefined);
    expect(await jar.snapshot(undefined)).toEqual([]);
    await jar.restore(undefined, before);
    const after = await jar.snapshot(undefined);
    const byName = (cookies: StoredCookie[]) =>
      [...cookies].sort((a, b) => a.name.localeCompare(b.name));
    expect(byName(after)).toEqual(byName(before));
    // Preserved and foreign cookies were never touched.
    expect(api.all().map((cookie) => cookie.name)).toEqual(
      expect.arrayContaining(['cf_clearance', 'embedded', 'other']),
    );
  });

  it('works with Firefox-only fields without sending them to Chromium', async () => {
    const firefox = seededJar(FIREFOX);
    await expect(firefox.jar.snapshot(undefined)).resolves.toHaveLength(4);
    const chromium = seededJar(CHROMIUM);
    await expect(chromium.jar.snapshot(undefined)).resolves.toHaveLength(4);
  });

  it('applies operations to the given container only', async () => {
    const api = new FakeCookies({ now: () => NOW });
    api.seed({ name: 'sessionKey', domain: '.claude.ai', storeId: 'firefox-container-1' });
    api.seed({ name: 'sessionKey', domain: '.claude.ai', value: 'default' });
    const jar = new BrowserCookieJar(api, { capabilities: FIREFOX, now: () => NOW });
    await jar.clear('firefox-container-1');
    expect(api.all('firefox-container-1')).toEqual([]);
    expect(api.all()).toHaveLength(1);
  });

  it('returns refused auxiliary writes, including writes refused with null', async () => {
    const { api, jar } = seededJar();
    const snapshot = await jar.snapshot(undefined);
    api.refuseSet.add('hostOnly');
    api.failSet.add('pathScoped');
    const failures = await jar.restore(undefined, snapshot);
    expect(failures.map((failure) => failure.name).sort()).toEqual(['hostOnly', 'pathScoped']);
    expect(failures[0]?.reason).not.toBe('');
    // The session cookie itself was written.
    expect(api.all().some((cookie) => cookie.name === 'sessionKey')).toBe(true);
  });

  it('never reports a cookie value, even when the browser echoes it in its error', async () => {
    const { api, jar } = seededJar();
    const snapshot = await jar.snapshot(undefined);
    const realSet = api.set.bind(api);
    // Firefox includes the whole cookie, value included, in "Permission denied" errors.
    api.set = (details) =>
      details.name === 'hostOnly'
        ? Promise.reject(new Error(`Permission denied to set cookie ${JSON.stringify(details)}`))
        : realSet(details);
    const [failure] = await jar.restore(
      undefined,
      snapshot.map((cookie) => ({ ...cookie, value: `value-of-${cookie.name}` })),
    );
    expect(failure?.reason).toContain('Permission denied');
    expect(failure?.reason).not.toContain('value-of-hostOnly');
    expect(failure?.reason).toContain('[redacted]');
  });

  it('writes non-secure cookies through an https URL', () => {
    expect(toSetDetails(stored({ name: '__ssid', secure: false }), target(FIREFOX))?.url).toBe(
      'https://claude.ai/',
    );
  });

  it('fails when the session cookie cannot be written', async () => {
    const { api, jar } = seededJar();
    const snapshot = await jar.snapshot(undefined);
    api.failSet.add('sessionKey');
    const error = await jar.restore(undefined, snapshot).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CookieOperationError);
    expect((error as CookieOperationError).message).toContain('sessionKey');
    expect((error as CookieOperationError).message).not.toContain('secret');
  });

  it('removes what it can and returns refused auxiliary removals', async () => {
    const { api, jar } = seededJar();
    api.failRemove.add('hostOnly');
    const failures = await jar.clear(undefined);
    expect(failures.map((failure) => failure.name)).toEqual(['hostOnly']);
    expect((await jar.snapshot(undefined)).map((cookie) => cookie.name)).toEqual(['hostOnly']);
  });

  it('fails when the session cookie cannot be removed', async () => {
    const { api, jar } = seededJar();
    api.failRemove.add('sessionKey');
    await expect(jar.clear(undefined)).rejects.toBeInstanceOf(CookieOperationError);
  });
});

describe('cookie stores', () => {
  it('uses the Firefox container of the tab', async () => {
    const api = new FakeCookies();
    await expect(
      resolveCookieStoreId(api, { id: 1, cookieStoreId: 'firefox-container-3' }),
    ).resolves.toBe('firefox-container-3');
  });

  it('maps the default store of every browser to undefined', async () => {
    const api = new FakeCookies();
    api.storeTabs.set('0', [1]);
    api.storeTabs.set('1', [2]);
    await expect(resolveCookieStoreId(api, { id: 1 })).resolves.toBeUndefined();
    await expect(resolveCookieStoreId(api, { id: 2 })).resolves.toBe('1');
    await expect(
      resolveCookieStoreId(api, { cookieStoreId: 'firefox-default' }),
    ).resolves.toBeUndefined();
    expect(isDefaultStoreId('0')).toBe(true);
    expect(isDefaultStoreId('firefox-private')).toBe(false);
  });

  it('tells whether a tab belongs to a store', () => {
    const stores = [
      { id: '0', tabIds: [1] },
      { id: '1', tabIds: [2] },
    ];
    expect(isTabInStore({ id: 1 }, undefined, stores)).toBe(true);
    expect(isTabInStore({ id: 2 }, undefined, stores)).toBe(false);
    expect(isTabInStore({ id: 2 }, '1', stores)).toBe(true);
    expect(
      isTabInStore({ id: 5, cookieStoreId: 'firefox-container-1' }, 'firefox-container-1', []),
    ).toBe(true);
    expect(isTabInStore({ id: 5, cookieStoreId: 'firefox-default' }, undefined, [])).toBe(true);
  });
});
