import type { AccountRepository } from '../accounts/repository';
import {
  defaultLabel,
  dismissSessions,
  moveAccount,
  normalizeLabel,
  removeAccount,
  requireAccount,
} from '../accounts/state-ops';
import {
  storeKey,
  type Account,
  type AccountIdentity,
  type PendingLogin,
  type Settings,
  type State,
} from '../accounts/types';
import { describeFailure, type CookieFailure, type CookieJar } from '../cookies/cookie-jar';
import { toStoredCookie } from '../cookies/serialization';
import type { BrowserCookie, StoredCookie } from '../cookies/types';
import { sameEmail } from '../identity';
import { siteConfig, type SiteConfig } from '../site-config';
import { AppError } from '../../shared/errors';
import { silentLogger, type Logger } from '../../shared/logger';
import { withoutKey } from '../../shared/records';
import { SerialQueue } from '../../shared/serial-queue';
import {
  hasSessionCookie,
  isSnapshotExpired,
  matchAccount,
  sessionFingerprints,
  type AccountMatch,
} from './session';
import type {
  AccountSummary,
  CookieChange,
  PageReport,
  SitePage,
  SiteTabs,
  ViewState,
} from './types';

/** How long a switch waits for the page to confirm the restored session. */
export const PENDING_SWITCH_TTL_MS = 2 * 60_000;
/** How long a "log in with another account" flow stays open. */
export const PENDING_LOGIN_TTL_MS = 30 * 60_000;

export interface SwitcherDeps {
  jar: CookieJar;
  repository: AccountRepository;
  tabs: SiteTabs;
  config?: SiteConfig;
  now?: () => number;
  logger?: Logger;
}

/** Outcome of a page report. */
export interface PageReportResult {
  /** The account whose session the site has just rejected. */
  expiredAccount?: AccountSummary;
  /** The account the live session has just been saved into. */
  savedAccount?: AccountSummary & { created: boolean };
}

interface LiveSession {
  cookies: StoredCookie[];
  identity: AccountIdentity | undefined;
  signedIn: boolean;
  fingerprints: string[];
}

/**
 * The account switching service. Every operation that touches cookies runs
 * through one queue, so two switches can never interleave.
 *
 * A signed-in session is always kept: it is saved automatically when the page
 * reports it, and before any switch or sign-in clears the cookies. The only
 * exception is a session whose account the user deleted while using it.
 */
export class AccountSwitcher {
  private readonly jar: CookieJar;
  private readonly repository: AccountRepository;
  private readonly tabs: SiteTabs;
  private readonly config: SiteConfig;
  private readonly now: () => number;
  private readonly logger: Logger;
  private readonly queue = new SerialQueue();
  /**
   * Latest page report per store, with the fingerprints of the session it was
   * made for. In memory only: the page re-reports on load.
   */
  private readonly observations = new Map<string, { report: PageReport; fingerprints: string[] }>();
  /** Session cookies just replaced by the site, awaiting their replacement. */
  private readonly overwritten = new Map<string, StoredCookie>();

  constructor(deps: SwitcherDeps) {
    this.jar = deps.jar;
    this.repository = deps.repository;
    this.tabs = deps.tabs;
    this.config = deps.config ?? siteConfig;
    this.now = deps.now ?? Date.now;
    this.logger = deps.logger ?? silentLogger;
  }

  getState(storeId: string | undefined): Promise<ViewState> {
    return this.queue.run(async () => {
      const state = await this.repository.read();
      const live = await this.readLiveSession(storeId);
      return this.buildView(state, live, storeId);
    });
  }

  /**
   * Starts a sign-in with another account: saves the live session, clears the
   * site cookies and opens the login page in the site's tabs.
   *
   * @param resaveAccountId account whose snapshot the next sign-in replaces
   */
  beginLogin(
    storeId: string | undefined,
    options: { resaveAccountId?: string; originTabId?: number } = {},
  ): Promise<void> {
    return this.queue.run(async () => {
      const live = await this.readLiveSession(storeId);
      await this.repository.update((state) => {
        if (options.resaveAccountId !== undefined) requireAccount(state, options.resaveAccountId);
        this.keepLiveSession(state, live);
      });

      try {
        this.reportRefused(await this.jar.clear(storeId));
      } catch (error) {
        await this.rollback(storeId, live.cookies, error);
      }

      await this.repository.update((state) => {
        const key = storeKey(storeId);
        const pending: PendingLogin = { startedAt: this.now() };
        if (options.resaveAccountId !== undefined) {
          pending.resaveAccountId = options.resaveAccountId;
        }
        state.pendingLogins[key] = pending;
        state.pendingSwitches = withoutKey(state.pendingSwitches, key);
      });
      this.observations.delete(storeKey(storeId));
      await this.afterSessionChange(storeId, 'login', options.originTabId);
    });
  }

  /**
   * Switches the store to a saved account. The live session is saved first so
   * it stays current. On any cookie error the previous cookies are restored.
   */
  switchTo(
    storeId: string | undefined,
    accountId: string,
    options: { originTabId?: number } = {},
  ): Promise<{ switched: boolean }> {
    return this.queue.run(async () => {
      const state = await this.repository.read();
      const target = requireAccount(state, accountId);
      if (isSnapshotExpired(target.cookies, this.now(), this.config)) {
        await this.markExpired(target.id);
        throw new AppError('SESSION_EXPIRED');
      }

      const live = await this.readLiveSession(storeId);
      const match = matchAccount(live.cookies, live.identity, state.accounts, this.config);
      if (match?.account.id === target.id) return { switched: false };
      await this.repository.update((draft) => {
        this.keepLiveSession(draft, live);
      });

      try {
        this.reportRefused(await this.jar.clear(storeId));
        this.reportRefused(await this.jar.restore(storeId, target.cookies));
      } catch (error) {
        await this.rollback(storeId, live.cookies, error);
      }

      await this.repository.update((draft) => {
        const key = storeKey(storeId);
        draft.pendingSwitches[key] = { accountId: target.id, startedAt: this.now() };
        draft.pendingLogins = withoutKey(draft.pendingLogins, key);
      });
      this.observations.delete(storeKey(storeId));
      await this.afterSessionChange(storeId, 'home', options.originTabId);
      return { switched: true };
    });
  }

  /**
   * Records what the page reports, then:
   * - confirms or invalidates a pending switch, and marks the account of a
   *   rejected session as expired;
   * - saves a signed-in session automatically (into the account being
   *   re-saved, the account it belongs to, or a new account).
   */
  reportPageState(storeId: string | undefined, report: PageReport): Promise<PageReportResult> {
    return this.queue.run(async () => {
      const key = storeKey(storeId);
      const cookies = await this.jar.snapshot(storeId);
      const fingerprints = await sessionFingerprints(cookies, this.config);
      this.observations.set(key, { report, fingerprints });
      const live = await this.readLiveSession(storeId);
      return this.repository.update((state) => {
        const expiredAccount = this.checkPendingSwitch(state, key, live, report);
        if (expiredAccount !== undefined) return { expiredAccount };
        const savedAccount = live.signedIn ? this.autoSave(state, key, live) : undefined;
        return savedAccount === undefined ? {} : { savedAccount };
      });
    });
  }

  /**
   * Follows session cookie rotation by the site. When the site replaces a
   * session cookie that a saved account holds, the account's snapshot is
   * refreshed, so it never keeps a value the server has invalidated.
   */
  handleCookieChange(
    storeId: string | undefined,
    change: CookieChange,
    cookie: BrowserCookie,
  ): Promise<void> {
    if (!this.config.sessionCookieNames.includes(cookie.name)) return Promise.resolve();
    const key = `${storeKey(storeId)}\n${cookie.name}\n${cookie.domain}\n${cookie.path}`;
    if (change.removed) {
      if (change.cause === 'overwrite') {
        this.overwritten.set(key, toStoredCookie(cookie));
      } else {
        this.overwritten.delete(key);
        this.observations.delete(storeKey(storeId));
      }
      return Promise.resolve();
    }
    const previous = this.overwritten.get(key);
    this.overwritten.delete(key);
    if (previous === undefined) return Promise.resolve();

    return this.queue.run(async () => {
      const live = await this.readLiveSession(storeId);
      await this.repository.update((state) => {
        const owner = matchAccount([previous], undefined, state.accounts, this.config)?.account;
        if (owner === undefined) return;
        if (this.contradicts(owner, live.identity)) {
          this.logger.debug('Ignoring session rotation: page identity differs from', owner.id);
          return;
        }
        this.refreshAccount(owner, live);
        this.logger.debug('Refreshed snapshot after session rotation for', owner.id);
      });
    });
  }

  renameAccount(accountId: string, label: string): Promise<void> {
    const normalized = normalizeLabel(label);
    return this.queue.run(() =>
      this.repository.update((state) => {
        requireAccount(state, accountId).label = normalized;
      }),
    );
  }

  moveAccount(accountId: string, toIndex: number): Promise<void> {
    return this.queue.run(() =>
      this.repository.update((state) => {
        moveAccount(state, accountId, toIndex);
      }),
    );
  }

  /**
   * Deletes an account. When it is the account of the live session in this
   * store, that session is dismissed so it is not saved again automatically.
   */
  deleteAccount(storeId: string | undefined, accountId: string): Promise<void> {
    return this.queue.run(async () => {
      const live = await this.readLiveSession(storeId);
      await this.repository.update((state) => {
        const match = matchAccount(live.cookies, live.identity, state.accounts, this.config);
        removeAccount(state, accountId);
        if (match?.account.id === accountId) dismissSessions(state, live.fingerprints);
      });
    });
  }

  updateSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.queue.run(() =>
      this.repository.update((state) => {
        state.settings = { ...state.settings, ...patch };
        return { ...state.settings };
      }),
    );
  }

  /** Number of accounts that need to be saved again. */
  async countExpired(): Promise<number> {
    const state = await this.repository.read();
    const nowMs = this.now();
    return state.accounts.filter((account) => this.statusOf(account, nowMs) === 'expired').length;
  }

  private async readLiveSession(storeId: string | undefined): Promise<LiveSession> {
    const cookies = await this.jar.snapshot(storeId);
    const fingerprints = await sessionFingerprints(cookies, this.config);
    // A report describes the session it was made for: ignore it once the session changed.
    const observation = this.observations.get(storeKey(storeId));
    const report =
      observation !== undefined && sameFingerprints(observation.fingerprints, fingerprints)
        ? observation.report
        : undefined;
    const signedIn = report?.signedIn ?? hasSessionCookie(cookies, this.now(), this.config);
    return { cookies, identity: report?.identity, signedIn, fingerprints };
  }

  /**
   * Resolves a pending switch from a definite page answer.
   *
   * @returns the account found expired, when the site rejected its session
   */
  private checkPendingSwitch(
    state: State,
    key: string,
    live: LiveSession,
    report: PageReport,
  ): AccountSummary | undefined {
    const pending = state.pendingSwitches[key];
    const pendingAccount =
      pending !== undefined && this.now() - pending.startedAt < PENDING_SWITCH_TTL_MS
        ? state.accounts.find((account) => account.id === pending.accountId)
        : undefined;
    // Keep a fresh pending switch until the page gives a definite answer.
    if (report.signedIn !== null || pendingAccount === undefined) {
      state.pendingSwitches = withoutKey(state.pendingSwitches, key);
    }
    if (report.signedIn !== false) return undefined;
    const account =
      pendingAccount ?? matchAccount(live.cookies, undefined, state.accounts, this.config)?.account;
    if (account === undefined || account.status === 'expired') return undefined;
    account.status = 'expired';
    return this.summarize(account, false);
  }

  /** Saves a signed-in session. Returns the account it went into, if it changed. */
  private autoSave(
    state: State,
    key: string,
    live: LiveSession,
  ): (AccountSummary & { created: boolean }) | undefined {
    const pending = this.validPendingLogin(state, key);
    state.pendingLogins = withoutKey(state.pendingLogins, key);
    const match = matchAccount(live.cookies, live.identity, state.accounts, this.config);

    const resave =
      pending?.resaveAccountId === undefined
        ? undefined
        : state.accounts.find((account) => account.id === pending.resaveAccountId);
    if (resave !== undefined && this.isSameAccount(resave, match, live.identity)) {
      this.refreshAccount(resave, live);
      return { ...this.summarize(resave, true), created: false };
    }
    if (match !== undefined) {
      // Keep the snapshot current, but this is not news for the user.
      this.refreshAccount(match.account, live);
      return undefined;
    }
    if (this.isDismissed(state, live)) return undefined;
    const account = this.createAccount(state, live);
    state.accounts.push(account);
    return { ...this.summarize(account, true), created: true };
  }

  /**
   * Makes sure the live session survives the coming cookie wipe: it refreshes
   * the account it belongs to, or saves it as a new account.
   */
  private keepLiveSession(state: State, live: LiveSession): void {
    if (!live.signedIn) return;
    const match = matchAccount(live.cookies, live.identity, state.accounts, this.config);
    if (match !== undefined) {
      this.refreshAccount(match.account, live);
    } else if (!this.isDismissed(state, live)) {
      state.accounts.push(this.createAccount(state, live));
    }
  }

  private isDismissed(state: State, live: LiveSession): boolean {
    return live.fingerprints.some((fingerprint) => state.dismissedSessions.includes(fingerprint));
  }

  private async rollback(
    storeId: string | undefined,
    previous: readonly StoredCookie[],
    cause: unknown,
  ): Promise<never> {
    this.logger.error('Cookie operation failed, restoring the previous session', cause);
    try {
      this.reportRefused(await this.jar.clear(storeId));
      this.reportRefused(await this.jar.restore(storeId, previous));
    } catch (rollbackError) {
      this.logger.error('Rollback failed', rollbackError);
      throw new AppError('ROLLBACK_FAILED', undefined, { cause: rollbackError });
    }
    throw new AppError('SWITCH_FAILED', undefined, { cause });
  }

  /** Auxiliary cookies the browser refused do not fail a switch, but are worth knowing. */
  private reportRefused(failures: readonly CookieFailure[]): void {
    if (failures.length === 0) return;
    this.logger.error(
      'The browser refused some auxiliary cookies:',
      failures.map(describeFailure).join('; '),
    );
  }

  /** Best-effort tab side effects: the session change itself already succeeded. */
  private async afterSessionChange(
    storeId: string | undefined,
    page: SitePage,
    originTabId: number | undefined,
  ): Promise<void> {
    const { settings } = await this.repository.read();
    await this.tabs
      .clearSiteStorage(storeId, { all: settings.clearSiteStorageOnSwitch, originTabId })
      .catch((error: unknown) => {
        this.logger.debug('Could not clear site storage', error);
      });
    await this.tabs.openSitePage(storeId, { page, originTabId }).catch((error: unknown) => {
      this.logger.error('Could not open the site page', error);
    });
  }

  private async markExpired(accountId: string): Promise<void> {
    await this.repository.update((state) => {
      requireAccount(state, accountId).status = 'expired';
    });
  }

  /** The live session may replace the account's snapshot: nothing says it is someone else. */
  private isSameAccount(
    account: Account,
    match: AccountMatch | undefined,
    identity: AccountIdentity | undefined,
  ): boolean {
    if (match !== undefined && match.account.id !== account.id) return false;
    return !this.contradicts(account, identity);
  }

  /** True when the page reports an email different from the account's. */
  private contradicts(account: Account, identity: AccountIdentity | undefined): boolean {
    const email = identity?.email;
    const savedEmail = account.identity?.email;
    return email !== undefined && savedEmail !== undefined && !sameEmail(email, savedEmail);
  }

  private refreshAccount(account: Account, live: LiveSession): void {
    account.cookies = live.cookies;
    account.savedAt = this.now();
    account.status = 'ok';
    if (live.identity !== undefined) account.identity = { ...account.identity, ...live.identity };
  }

  private createAccount(state: State, live: LiveSession): Account {
    const nowMs = this.now();
    const account: Account = {
      id: crypto.randomUUID(),
      label: defaultLabel(state, live.identity?.email),
      status: 'ok',
      cookies: live.cookies,
      createdAt: nowMs,
      savedAt: nowMs,
    };
    if (live.identity !== undefined) account.identity = { ...live.identity };
    return account;
  }

  private validPendingLogin(state: State, key: string): PendingLogin | undefined {
    const pending = state.pendingLogins[key];
    if (pending === undefined || this.now() - pending.startedAt >= PENDING_LOGIN_TTL_MS) {
      return undefined;
    }
    return pending;
  }

  private statusOf(account: Account, nowMs: number): Account['status'] {
    return account.status === 'expired' || isSnapshotExpired(account.cookies, nowMs, this.config)
      ? 'expired'
      : 'ok';
  }

  private summarize(account: Account, active: boolean): AccountSummary {
    const summary: AccountSummary = {
      id: account.id,
      label: account.label,
      status: this.statusOf(account, this.now()),
      savedAt: account.savedAt,
      active,
    };
    if (account.identity !== undefined) summary.identity = { ...account.identity };
    return summary;
  }

  private buildView(state: State, live: LiveSession, storeId: string | undefined): ViewState {
    const match = live.signedIn
      ? matchAccount(live.cookies, live.identity, state.accounts, this.config)
      : undefined;
    const view: ViewState = {
      accounts: state.accounts.map((account) =>
        this.summarize(account, account.id === match?.account.id),
      ),
      current: { signedIn: live.signedIn },
      settings: { ...state.settings },
    };
    if (match !== undefined) {
      view.current.accountId = match.account.id;
      view.current.matchedBy = match.by;
    }
    if (live.identity !== undefined) view.current.identity = { ...live.identity };
    const pending = this.validPendingLogin(state, storeKey(storeId));
    if (pending !== undefined) {
      view.pendingLogin = {};
      const resave = state.accounts.find((account) => account.id === pending.resaveAccountId);
      if (resave !== undefined) {
        view.pendingLogin.resaveAccountId = resave.id;
        view.pendingLogin.resaveLabel = resave.label;
      }
    }
    return view;
  }
}

function sameFingerprints(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((fingerprint) => b.includes(fingerprint));
}
