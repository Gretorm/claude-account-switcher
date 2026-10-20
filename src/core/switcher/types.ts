import type { AccountIdentity, AccountStatus, Settings } from '../accounts/types';
import type { MatchKind } from './session';

/** What the page itself says about the session, as probed by the content script. */
export interface PageReport {
  /** `null` when the page gave no reliable answer. */
  signedIn: boolean | null;
  identity?: AccountIdentity;
}

/** An account as shown in the UI. Never carries cookies. */
export interface AccountSummary {
  id: string;
  label: string;
  identity?: AccountIdentity;
  status: AccountStatus;
  savedAt: number;
  /** The live session in this cookie store belongs to this account. */
  active: boolean;
}

export interface CurrentSession {
  signedIn: boolean;
  /** Saved account the live session belongs to, if any. */
  accountId?: string;
  matchedBy?: MatchKind;
  identity?: AccountIdentity;
}

export interface PendingLoginView {
  resaveAccountId?: string;
  resaveLabel?: string;
}

export interface ViewState {
  accounts: AccountSummary[];
  current: CurrentSession;
  /** Set while a "log in with another account" flow waits for a sign-in. */
  pendingLogin?: PendingLoginView;
  settings: Settings;
}

/**
 * Tab-level side effects of a switch, implemented with the tabs API. They
 * apply to the store's site tabs, always including `originTabId` (the tab the
 * action came from) even if a tab query misses it.
 */
export interface SiteTabs {
  /**
   * Clears site storage in the tabs: the account cache keys always, and all of
   * localStorage and sessionStorage when `all` is set.
   */
  clearSiteStorage(
    storeId: string | undefined,
    options: { all: boolean; originTabId?: number | undefined },
  ): Promise<void>;
  /**
   * Navigates the tabs to a site page (the login page after a sign-out, the
   * home page after a switch), or opens one if there is none. Navigating
   * directly avoids the redirects of reloading a page of the previous account.
   */
  openSitePage(
    storeId: string | undefined,
    options: { page: SitePage; originTabId?: number | undefined },
  ): Promise<void>;
}

export type SitePage = 'login' | 'home';

/** A change reported by `cookies.onChanged`. */
export interface CookieChange {
  removed: boolean;
  cause: string;
}
