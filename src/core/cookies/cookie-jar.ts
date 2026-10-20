import { isSiteCookieDomain, siteConfig, type SiteConfig } from '../site-config';
import { toRemoveDetails, toSetDetails, toStoredCookie } from './serialization';
import type {
  BrowserCookie,
  CookieCapabilities,
  CookieQuery,
  CookiesApi,
  StoredCookie,
} from './types';

/** A cookie the browser refused to remove or write. Never carries the value. */
export interface CookieFailure {
  name: string;
  domain: string;
  path: string;
  reason: string;
}

/** Reads and writes the site's account cookies in one cookie store. */
export interface CookieJar {
  /** Account-scoped site cookies currently in the store. */
  snapshot(storeId: string | undefined): Promise<StoredCookie[]>;
  /**
   * Removes every account-scoped site cookie from the store.
   *
   * @returns the auxiliary cookies that could not be removed
   * @throws CookieOperationError when a session cookie could not be removed
   */
  clear(storeId: string | undefined): Promise<CookieFailure[]>;
  /**
   * Writes the given cookies into the store.
   *
   * @returns the auxiliary cookies that could not be written
   * @throws CookieOperationError when a session cookie could not be written
   */
  restore(storeId: string | undefined, cookies: readonly StoredCookie[]): Promise<CookieFailure[]>;
}

export class CookieOperationError extends Error {
  readonly failures: readonly CookieFailure[];

  constructor(operation: 'clear' | 'restore', failures: readonly CookieFailure[]) {
    super(`Cookie ${operation} failed: ${failures.map(describeFailure).join('; ')}`);
    this.name = 'CookieOperationError';
    this.failures = failures;
  }
}

export function describeFailure(failure: CookieFailure): string {
  return `${failure.name} (${failure.domain}${failure.path}): ${failure.reason}`;
}

export interface BrowserCookieJarOptions {
  capabilities: CookieCapabilities;
  config?: SiteConfig;
  now?: () => number;
}

/**
 * Browsers can refuse individual cookies (Firefox, for example, may list a
 * cookie it then refuses to remove). Only the session cookies decide whether
 * an operation failed: a refused auxiliary cookie is reported, not fatal.
 */
export class BrowserCookieJar implements CookieJar {
  private readonly capabilities: CookieCapabilities;
  private readonly config: SiteConfig;
  private readonly now: () => number;

  constructor(
    private readonly api: CookiesApi,
    options: BrowserCookieJarOptions,
  ) {
    this.capabilities = options.capabilities;
    this.config = options.config ?? siteConfig;
    this.now = options.now ?? Date.now;
  }

  async snapshot(storeId: string | undefined): Promise<StoredCookie[]> {
    const cookies = await this.api.getAll(this.query(storeId));
    return cookies.filter((cookie) => this.isAccountCookie(cookie)).map(toStoredCookie);
  }

  async clear(storeId: string | undefined): Promise<CookieFailure[]> {
    const cookies = await this.snapshot(storeId);
    const results = await Promise.allSettled(
      cookies.map((cookie) =>
        this.api.remove(toRemoveDetails(cookie, { storeId, capabilities: this.capabilities })),
      ),
    );
    return this.settle('clear', cookies, results);
  }

  async restore(
    storeId: string | undefined,
    cookies: readonly StoredCookie[],
  ): Promise<CookieFailure[]> {
    const nowMs = this.now();
    const writes = cookies.flatMap((cookie) => {
      if (!this.isAccountCookie(cookie)) return [];
      const details = toSetDetails(cookie, { storeId, capabilities: this.capabilities, nowMs });
      return details === null ? [] : [{ cookie, details }];
    });
    const results = await Promise.allSettled(
      writes.map(async ({ details }) => {
        const written = await this.api.set(details);
        // Chromium resolves with null instead of rejecting when a write is refused.
        if (written === null) throw new Error('The browser refused the cookie');
      }),
    );
    return this.settle(
      'restore',
      writes.map(({ cookie }) => cookie),
      results,
    );
  }

  /** Throws when a session cookie failed, or when every operation failed. */
  private settle(
    operation: 'clear' | 'restore',
    cookies: readonly StoredCookie[],
    results: readonly PromiseSettledResult<unknown>[],
  ): CookieFailure[] {
    const failures: CookieFailure[] = [];
    results.forEach((result, index) => {
      const cookie = cookies[index];
      if (result.status === 'fulfilled' || cookie === undefined) return;
      failures.push({
        name: cookie.name,
        domain: cookie.domain,
        path: cookie.path,
        reason: redact(errorReason(result.reason), cookie.value),
      });
    });
    const criticalFailure = failures.some((failure) =>
      this.config.sessionCookieNames.includes(failure.name),
    );
    const allFailed = failures.length > 0 && failures.length === results.length;
    if (criticalFailure || allFailed) throw new CookieOperationError(operation, failures);
    return failures;
  }

  private query(storeId: string | undefined): CookieQuery {
    const query: CookieQuery = { domain: this.config.cookieDomain };
    if (storeId !== undefined) query.storeId = storeId;
    // An empty partition key returns partitioned and unpartitioned cookies alike.
    if (this.capabilities.partitionKey) query.partitionKey = {};
    // null returns cookies of every first-party domain when FPI is enabled.
    if (this.capabilities.firstPartyDomain) query.firstPartyDomain = null;
    return query;
  }

  /**
   * Account cookies are the site's cookies, minus device-scoped ones, minus
   * cookies partitioned under another top-level site (those belong to pages
   * that embed the site, not to the user's session on it).
   */
  private isAccountCookie(
    cookie: Pick<BrowserCookie, 'name' | 'domain' | 'partitionKey'>,
  ): boolean {
    if (!isSiteCookieDomain(cookie.domain, this.config)) return false;
    if (this.config.preservedCookieNames.includes(cookie.name)) return false;
    const topLevelSite = cookie.partitionKey?.topLevelSite;
    if (topLevelSite !== undefined && topLevelSite !== '') {
      return isSameSite(topLevelSite, this.config);
    }
    return true;
  }
}

function isSameSite(topLevelSite: string, config: SiteConfig): boolean {
  try {
    return isSiteCookieDomain(new URL(topLevelSite).hostname, config);
  } catch {
    return false;
  }
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Some browsers echo the cookie, value included, in their error messages. */
function redact(reason: string, value: string): string {
  return value === '' ? reason : reason.split(value).join('[redacted]');
}
