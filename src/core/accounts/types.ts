import type { StoredCookie } from '../cookies/types';

export interface AccountIdentity {
  email?: string;
  name?: string;
}

/** `expired`: the saved session was rejected by the site and must be saved again. */
export type AccountStatus = 'ok' | 'expired';

export interface Account {
  id: string;
  /** User-given label. Always shown when the identity is unknown. */
  label: string;
  identity?: AccountIdentity;
  status: AccountStatus;
  cookies: StoredCookie[];
  createdAt: number;
  /** When the cookie snapshot was last captured. */
  savedAt: number;
}

export interface Settings {
  /** Clear the site's localStorage and sessionStorage when switching. */
  clearSiteStorageOnSwitch: boolean;
  /** Insert the switcher into the site's own account menu. */
  injectIntoMenu: boolean;
  /** Log diagnostics to the console. */
  debug: boolean;
}

/** A "log in with another account" flow waiting for the user to sign in. */
export interface PendingLogin {
  startedAt: number;
  /** When set, the next saved session replaces this account's snapshot. */
  resaveAccountId?: string;
}

/** A switch whose result (valid or expired session) is not confirmed yet. */
export interface PendingSwitch {
  accountId: string;
  startedAt: number;
}

/**
 * Cookie stores are keyed by their ID; the default store, which has no stable
 * cross-browser ID, uses DEFAULT_STORE_KEY.
 */
export const DEFAULT_STORE_KEY = 'default';

export interface StateV1 {
  schemaVersion: 1;
  /** Display order is array order. */
  accounts: Account[];
  /** Keyed by cookie store (see storeKey). */
  pendingLogins: Record<string, PendingLogin>;
  /** Keyed by cookie store (see storeKey). */
  pendingSwitches: Record<string, PendingSwitch>;
  /**
   * SHA-256 fingerprints of sessions whose account the user deleted while
   * signed in with it, so automatic saving does not bring the account back.
   */
  dismissedSessions: string[];
  settings: Settings;
}

/** The current schema. Bump together with CURRENT_SCHEMA_VERSION and a migration. */
export type State = StateV1;

export const DEFAULT_SETTINGS: Settings = {
  clearSiteStorageOnSwitch: false,
  injectIntoMenu: true,
  debug: false,
};

export function storeKey(storeId: string | undefined): string {
  return storeId ?? DEFAULT_STORE_KEY;
}
