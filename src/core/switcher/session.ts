import type { Account, AccountIdentity } from '../accounts/types';
import { isCookieExpired } from '../cookies/serialization';
import type { StoredCookie } from '../cookies/types';
import { sameEmail } from '../identity';
import { siteConfig, type SiteConfig } from '../site-config';

function sessionCookies(cookies: readonly StoredCookie[], config: SiteConfig): StoredCookie[] {
  return cookies.filter((cookie) => config.sessionCookieNames.includes(cookie.name));
}

/** True when the cookies contain a live (non-expired) session cookie. */
export function hasSessionCookie(
  cookies: readonly StoredCookie[],
  nowMs: number,
  config: SiteConfig = siteConfig,
): boolean {
  return sessionCookies(cookies, config).some((cookie) => !isCookieExpired(cookie, nowMs));
}

/**
 * True when a snapshot is known to be unusable: it has session cookies and all
 * of them are past their expiration date. A snapshot without any known session
 * cookie is not judged here; the site decides after the switch.
 */
export function isSnapshotExpired(
  cookies: readonly StoredCookie[],
  nowMs: number,
  config: SiteConfig = siteConfig,
): boolean {
  const candidates = sessionCookies(cookies, config);
  return candidates.length > 0 && candidates.every((cookie) => isCookieExpired(cookie, nowMs));
}

/**
 * One-way fingerprints of the live session cookies. They identify a session
 * without storing its value.
 */
export async function sessionFingerprints(
  cookies: readonly StoredCookie[],
  config: SiteConfig = siteConfig,
): Promise<string[]> {
  const encoder = new TextEncoder();
  return Promise.all(
    sessionCookies(cookies, config).map(async (cookie) => {
      const input = encoder.encode(`${cookie.name}
${cookie.domain}
${cookie.value}`);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
      return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }),
  );
}

export type MatchKind = 'session' | 'identity';

export interface AccountMatch {
  account: Account;
  by: MatchKind;
}

function sharesSessionCookie(
  current: readonly StoredCookie[],
  saved: readonly StoredCookie[],
  config: SiteConfig,
): boolean {
  const savedSessions = sessionCookies(saved, config);
  return sessionCookies(current, config).some((live) =>
    savedSessions.some(
      (cookie) =>
        cookie.name === live.name &&
        cookie.domain === live.domain &&
        cookie.path === live.path &&
        cookie.value === live.value,
    ),
  );
}

/**
 * Finds the saved account the live session belongs to.
 *
 * A match is required before a saved snapshot is overwritten, so it must be
 * certain: either the session cookie value is identical, or the page reports
 * an email that exactly one saved account has. The last-switched account is
 * deliberately not used, since the user may have signed in to another account
 * directly on the site since then.
 */
export function matchAccount(
  current: readonly StoredCookie[],
  identity: AccountIdentity | undefined,
  accounts: readonly Account[],
  config: SiteConfig = siteConfig,
): AccountMatch | undefined {
  const bySession = accounts.find((account) =>
    sharesSessionCookie(current, account.cookies, config),
  );
  if (bySession !== undefined) return { account: bySession, by: 'session' };

  const email = identity?.email;
  if (email === undefined) return undefined;
  const byIdentity = accounts.filter((account) => sameEmail(account.identity?.email, email));
  const [only] = byIdentity;
  return byIdentity.length === 1 && only !== undefined
    ? { account: only, by: 'identity' }
    : undefined;
}
