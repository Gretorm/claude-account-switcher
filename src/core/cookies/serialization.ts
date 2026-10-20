import type {
  BrowserCookie,
  CookieCapabilities,
  CookiePartitionKey,
  CookieRemoveDetails,
  CookieSetDetails,
  SameSiteStatus,
  StoredCookie,
} from './types';

const SAME_SITE_VALUES: readonly SameSiteStatus[] = [
  'no_restriction',
  'lax',
  'strict',
  'unspecified',
];

export function normalizeSameSite(value: string | undefined): SameSiteStatus {
  return SAME_SITE_VALUES.find((candidate) => candidate === value) ?? 'unspecified';
}

function normalizePartitionKey(
  key: CookiePartitionKey | undefined,
): CookiePartitionKey | undefined {
  if (key?.topLevelSite === undefined || key.topLevelSite === '') return undefined;
  const normalized: CookiePartitionKey = { topLevelSite: key.topLevelSite };
  if (key.hasCrossSiteAncestor !== undefined) {
    normalized.hasCrossSiteAncestor = key.hasCrossSiteAncestor;
  }
  return normalized;
}

/** Converts a browser cookie to its persisted, store-independent form. */
export function toStoredCookie(cookie: BrowserCookie): StoredCookie {
  const stored: StoredCookie = {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    hostOnly: cookie.hostOnly,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: normalizeSameSite(cookie.sameSite),
    session: cookie.session,
  };
  if (!cookie.session && cookie.expirationDate !== undefined) {
    stored.expirationDate = cookie.expirationDate;
  }
  const partitionKey = normalizePartitionKey(cookie.partitionKey);
  if (partitionKey !== undefined) stored.partitionKey = partitionKey;
  if (cookie.firstPartyDomain !== undefined) stored.firstPartyDomain = cookie.firstPartyDomain;
  return stored;
}

/**
 * The URL a cookie is associated with, as required by `cookies.set()` and
 * `cookies.remove()`. Its host and path must match the cookie.
 *
 * Always https, even for cookies without the Secure flag: the site is served
 * over https only, a non-secure cookie can be written from an https URL, and
 * the host permission covers https only (Firefox refuses an http URL).
 */
export function cookieUrl(cookie: Pick<StoredCookie, 'domain' | 'path'>): string {
  const host = cookie.domain.replace(/^\./, '');
  const path = cookie.path.startsWith('/') ? cookie.path : `/${cookie.path}`;
  return `https://${host}${path}`;
}

/** Expired cookies are dropped by the browser on write, so they are never restored. */
export function isCookieExpired(cookie: StoredCookie, nowMs: number): boolean {
  return (
    !cookie.session && cookie.expirationDate !== undefined && cookie.expirationDate * 1000 <= nowMs
  );
}

/** Stable identity of a cookie inside one cookie store. */
export function cookieKey(cookie: StoredCookie): string {
  return JSON.stringify([
    cookie.name,
    cookie.domain,
    cookie.path,
    cookie.partitionKey?.topLevelSite ?? '',
    cookie.firstPartyDomain ?? '',
  ]);
}

interface TargetOptions {
  storeId: string | undefined;
  capabilities: CookieCapabilities;
}

function applyTarget(
  details: CookieSetDetails | CookieRemoveDetails,
  cookie: StoredCookie,
  { storeId, capabilities }: TargetOptions,
): void {
  if (storeId !== undefined) details.storeId = storeId;
  if (capabilities.partitionKey && cookie.partitionKey !== undefined) {
    details.partitionKey = { ...cookie.partitionKey };
  }
  if (capabilities.firstPartyDomain && cookie.firstPartyDomain !== undefined) {
    details.firstPartyDomain = cookie.firstPartyDomain;
  }
}

/**
 * Builds `cookies.set()` details that recreate the cookie exactly:
 * - host-only cookies are written without `domain`, otherwise the browser
 *   would turn them into domain cookies;
 * - session cookies are written without `expirationDate`, so they stay
 *   session cookies;
 * - `unspecified` SameSite is written by omitting the field, which is the only
 *   portable way to express it.
 *
 * Returns `null` for cookies that cannot be restored faithfully (already
 * expired, or partitioned on a browser without partition support).
 */
export function toSetDetails(
  cookie: StoredCookie,
  options: TargetOptions & { nowMs: number },
): CookieSetDetails | null {
  if (isCookieExpired(cookie, options.nowMs)) return null;
  if (cookie.partitionKey !== undefined && !options.capabilities.partitionKey) return null;

  const details: CookieSetDetails = {
    url: cookieUrl(cookie),
    name: cookie.name,
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
  };
  if (!cookie.hostOnly) details.domain = cookie.domain;
  if (cookie.sameSite !== 'unspecified') details.sameSite = cookie.sameSite;
  if (!cookie.session && cookie.expirationDate !== undefined) {
    details.expirationDate = cookie.expirationDate;
  }
  applyTarget(details, cookie, options);
  return details;
}

/** Builds `cookies.remove()` details that target exactly this cookie. */
export function toRemoveDetails(cookie: StoredCookie, options: TargetOptions): CookieRemoveDetails {
  const details: CookieRemoveDetails = { url: cookieUrl(cookie), name: cookie.name };
  applyTarget(details, cookie, options);
  return details;
}
