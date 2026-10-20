import { siteConfig, type SiteConfig } from '../core/site-config';

/**
 * Removes the site's cached account state before the page is reopened. The account cache
 * keys are always removed; everything else only when `all` is set, because it
 * also holds drafts and preferences the user may want to keep.
 */
export function clearSiteStorage(
  storage: { local: Storage; session: Storage },
  options: { all: boolean },
  config: SiteConfig = siteConfig,
): void {
  if (options.all) {
    storage.local.clear();
    storage.session.clear();
    return;
  }
  for (const area of [storage.local, storage.session]) {
    const keys = Array.from({ length: area.length }, (_, index) => area.key(index));
    for (const key of keys) {
      if (key !== null && config.accountCacheStorageKeys.some((pattern) => pattern.test(key))) {
        area.removeItem(key);
      }
    }
  }
}
