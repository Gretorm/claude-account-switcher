import type { CookiesApi, CookieStoreInfo } from './types';

/** The tab fields used to locate a tab's cookie store. */
export interface TabRef {
  id?: number | undefined;
  /** Firefox only: the container (contextual identity) or private store. */
  cookieStoreId?: string | undefined;
}

/**
 * Resolves the cookie store a tab uses, so that switching applies to that tab's
 * Firefox container or Chromium incognito session. Returns `undefined` for the
 * default store, which every cookie API call targets when no store is given.
 */
export async function resolveCookieStoreId(
  api: Pick<CookiesApi, 'getAllCookieStores'>,
  tab: TabRef | undefined,
): Promise<string | undefined> {
  if (tab === undefined) return undefined;
  if (tab.cookieStoreId !== undefined && tab.cookieStoreId !== '') {
    return normalizeStoreId(tab.cookieStoreId);
  }
  const tabId = tab.id;
  if (tabId === undefined || api.getAllCookieStores === undefined) return undefined;
  const stores = await api.getAllCookieStores();
  const owner = stores.find((store) => store.tabIds.includes(tabId));
  return owner === undefined ? undefined : normalizeStoreId(owner.id);
}

/** Maps the default store to `undefined`, so it has a single representation. */
export function normalizeStoreId(storeId: string): string | undefined {
  return isDefaultStoreId(storeId) ? undefined : storeId;
}

/** True when a tab belongs to the given cookie store. */
export function isTabInStore(
  tab: TabRef,
  storeId: string | undefined,
  stores: readonly CookieStoreInfo[],
): boolean {
  if (tab.cookieStoreId !== undefined && tab.cookieStoreId !== '') {
    return storeId === undefined
      ? isDefaultStoreId(tab.cookieStoreId)
      : tab.cookieStoreId === storeId;
  }
  const tabId = tab.id;
  if (tabId === undefined) return false;
  const owner = stores.find((store) => store.tabIds.includes(tabId));
  if (owner === undefined) return storeId === undefined;
  return storeId === undefined ? isDefaultStoreId(owner.id) : owner.id === storeId;
}

/** Default store IDs: "0" in Chromium, "firefox-default" in Firefox. */
export function isDefaultStoreId(storeId: string): boolean {
  return storeId === '0' || storeId === 'firefox-default';
}
