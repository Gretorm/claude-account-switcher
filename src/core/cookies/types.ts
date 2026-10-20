/**
 * Cookie types shared by the snapshot model and the browser adapter.
 *
 * The browser shapes are the union of what Chromium and Firefox expose, kept
 * minimal and independent from any typings package so the core stays portable.
 */

export type SameSiteStatus = 'no_restriction' | 'lax' | 'strict' | 'unspecified';

/**
 * Partition key of a partitioned cookie: CHIPS in Chromium, dFPI / Total
 * Cookie Protection in Firefox.
 */
export interface CookiePartitionKey {
  topLevelSite?: string;
  /** Chromium 130+ only. */
  hasCrossSiteAncestor?: boolean;
}

/** A cookie as returned by `cookies.getAll()`. */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  session: boolean;
  expirationDate?: number;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  /** Firefox only (First-Party Isolation). */
  firstPartyDomain?: string;
}

export interface CookieQuery {
  domain?: string;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  /** Firefox only. `null` returns cookies of every first-party domain. */
  firstPartyDomain?: string | null;
}

export interface CookieSetDetails {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: Exclude<SameSiteStatus, 'unspecified'>;
  expirationDate?: number;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  firstPartyDomain?: string;
}

export interface CookieRemoveDetails {
  url: string;
  name: string;
  storeId?: string;
  partitionKey?: CookiePartitionKey;
  firstPartyDomain?: string;
}

export interface CookieStoreInfo {
  id: string;
  tabIds: number[];
}

/** The subset of `browser.cookies` the extension relies on. */
export interface CookiesApi {
  getAll(query: CookieQuery): Promise<BrowserCookie[]>;
  set(details: CookieSetDetails): Promise<BrowserCookie | null | undefined>;
  remove(details: CookieRemoveDetails): Promise<unknown>;
  getAllCookieStores?(): Promise<CookieStoreInfo[]>;
}

/** Optional cookie API features, which depend on the browser. */
export interface CookieCapabilities {
  /** `partitionKey` is accepted by getAll/set/remove (Chromium 119+, Firefox 94+). */
  partitionKey: boolean;
  /** `firstPartyDomain` is accepted by getAll/set/remove (Firefox). */
  firstPartyDomain: boolean;
}

/** A cookie as persisted in a snapshot. Store-independent and JSON-safe. */
export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSiteStatus;
  session: boolean;
  /** Seconds since the UNIX epoch. Absent for session cookies. */
  expirationDate?: number;
  partitionKey?: CookiePartitionKey;
  firstPartyDomain?: string;
}
