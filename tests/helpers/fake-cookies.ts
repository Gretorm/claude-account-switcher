import type {
  BrowserCookie,
  CookieQuery,
  CookieRemoveDetails,
  CookieSetDetails,
  CookiesApi,
  CookieStoreInfo,
} from '../../src/core/cookies/types';

const DEFAULT_STORE = '0';

interface FakeCookiesOptions {
  /** Reject `firstPartyDomain`, like Chromium's schema validation does. */
  rejectFirstPartyDomain?: boolean;
  now?: () => number;
}

/**
 * An in-memory cookie jar following the browser semantics the extension
 * depends on: host-only vs domain cookies, session cookies, partitions and
 * stores. Failures can be injected per cookie name.
 */
export class FakeCookies implements CookiesApi {
  readonly stores = new Map<string, BrowserCookie[]>();
  readonly storeTabs = new Map<string, number[]>();
  readonly failSet = new Set<string>();
  readonly refuseSet = new Set<string>();
  readonly failRemove = new Set<string>();
  setCalls: CookieSetDetails[] = [];

  constructor(private readonly options: FakeCookiesOptions = {}) {}

  /** Seeds a cookie as the browser would hold it. */
  seed(cookie: Partial<BrowserCookie> & Pick<BrowserCookie, 'name' | 'domain'>): void {
    const full: BrowserCookie = {
      value: 'v',
      hostOnly: !cookie.domain.startsWith('.'),
      path: '/',
      secure: true,
      httpOnly: false,
      sameSite: 'lax',
      session: cookie.expirationDate === undefined,
      storeId: DEFAULT_STORE,
      ...cookie,
    };
    this.upsert(full);
  }

  all(storeId = DEFAULT_STORE): BrowserCookie[] {
    return [...(this.stores.get(storeId) ?? [])];
  }

  getAll(query: CookieQuery): Promise<BrowserCookie[]> {
    this.checkKeys(query);
    const domain = query.domain?.replace(/^\./, '');
    const cookies = this.all(query.storeId ?? DEFAULT_STORE).filter((cookie) => {
      if (domain !== undefined) {
        const bare = cookie.domain.replace(/^\./, '');
        if (bare !== domain && !bare.endsWith(`.${domain}`)) return false;
      }
      // Without a partition key, browsers only return unpartitioned cookies.
      if (query.partitionKey === undefined && cookie.partitionKey !== undefined) return false;
      return true;
    });
    return Promise.resolve(cookies.map((cookie) => ({ ...cookie })));
  }

  set(details: CookieSetDetails): Promise<BrowserCookie | null> {
    this.checkKeys(details);
    this.setCalls.push(details);
    if (this.failSet.has(details.name))
      return Promise.reject(new Error(`set failed: ${details.name}`));
    if (this.refuseSet.has(details.name)) return Promise.resolve(null);
    const url = new URL(details.url);
    const cookie: BrowserCookie = {
      name: details.name,
      value: details.value,
      domain: details.domain === undefined ? url.hostname : `.${details.domain.replace(/^\./, '')}`,
      hostOnly: details.domain === undefined,
      path: details.path,
      secure: details.secure,
      httpOnly: details.httpOnly,
      sameSite: details.sameSite ?? 'unspecified',
      session: details.expirationDate === undefined,
      storeId: details.storeId ?? DEFAULT_STORE,
    };
    if (details.expirationDate !== undefined) cookie.expirationDate = details.expirationDate;
    if (details.partitionKey !== undefined) cookie.partitionKey = { ...details.partitionKey };
    if (details.firstPartyDomain !== undefined) cookie.firstPartyDomain = details.firstPartyDomain;
    const nowMs = (this.options.now ?? Date.now)();
    if (cookie.expirationDate !== undefined && cookie.expirationDate * 1000 <= nowMs) {
      this.delete(cookie);
      return Promise.resolve(null);
    }
    this.upsert(cookie);
    return Promise.resolve({ ...cookie });
  }

  remove(details: CookieRemoveDetails): Promise<unknown> {
    this.checkKeys(details);
    if (this.failRemove.has(details.name)) {
      return Promise.reject(new Error(`remove failed: ${details.name}`));
    }
    const url = new URL(details.url);
    const storeId = details.storeId ?? DEFAULT_STORE;
    const kept = this.all(storeId).filter((cookie) => {
      const bare = cookie.domain.replace(/^\./, '');
      const hostMatches = cookie.hostOnly
        ? url.hostname === bare
        : url.hostname === bare || url.hostname.endsWith(`.${bare}`);
      const samePartition =
        (cookie.partitionKey?.topLevelSite ?? '') === (details.partitionKey?.topLevelSite ?? '');
      return !(
        cookie.name === details.name &&
        hostMatches &&
        url.pathname.startsWith(cookie.path) &&
        samePartition
      );
    });
    this.stores.set(storeId, kept);
    return Promise.resolve({ name: details.name });
  }

  getAllCookieStores(): Promise<CookieStoreInfo[]> {
    return Promise.resolve(
      [...this.storeTabs.entries()].map(([id, tabIds]) => ({ id, tabIds: [...tabIds] })),
    );
  }

  private checkKeys(details: object): void {
    if (this.options.rejectFirstPartyDomain === true && 'firstPartyDomain' in details) {
      throw new Error('Unexpected property: firstPartyDomain');
    }
  }

  private keyOf(cookie: BrowserCookie): string {
    return [cookie.name, cookie.domain, cookie.path, cookie.partitionKey?.topLevelSite ?? ''].join(
      '|',
    );
  }

  private delete(cookie: BrowserCookie): void {
    const storeId = cookie.storeId ?? DEFAULT_STORE;
    this.stores.set(
      storeId,
      this.all(storeId).filter((existing) => this.keyOf(existing) !== this.keyOf(cookie)),
    );
  }

  private upsert(cookie: BrowserCookie): void {
    this.delete(cookie);
    const storeId = cookie.storeId ?? DEFAULT_STORE;
    this.stores.set(storeId, [...this.all(storeId), cookie]);
  }
}
