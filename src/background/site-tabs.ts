import { isTabInStore, type CookiesApi } from '../core/cookies';
import { siteConfig } from '../core/site-config';
import type { SitePage, SiteTabs } from '../core/switcher/types';
import { createEnvelope, type ContentCommands } from '../shared/messaging';

/** The tab fields and tabs API calls the background relies on. */
export interface TabLike {
  id?: number | undefined;
  url?: string | undefined;
  cookieStoreId?: string | undefined;
}

export interface TabsApi {
  query(query: { url: string }): Promise<TabLike[]>;
  update(tabId: number, properties: { url: string }): Promise<unknown>;
  create(properties: { url: string; cookieStoreId?: string; active?: boolean }): Promise<unknown>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

/**
 * Tab side effects of a switch. Works without the `tabs` permission: the host
 * permission is enough to query the site's tabs by URL.
 */
export class BrowserSiteTabs implements SiteTabs {
  constructor(
    private readonly tabs: TabsApi,
    private readonly cookies: Pick<CookiesApi, 'getAllCookieStores'>,
    private readonly supportsContainers: boolean,
  ) {}

  async clearSiteStorage(
    storeId: string | undefined,
    options: { all: boolean; originTabId?: number | undefined },
  ): Promise<void> {
    const message = createEnvelope<keyof ContentCommands>('clearSiteStorage', { all: options.all });
    const ids = await this.targetTabIds(storeId, options.originTabId);
    await Promise.allSettled(ids.map((tabId) => this.tabs.sendMessage(tabId, message)));
  }

  /** Asks the content scripts of the store's site tabs to report their session again. */
  async syncSession(storeId: string | undefined): Promise<void> {
    const message = createEnvelope<keyof ContentCommands>('syncSession', {});
    const tabs = await this.siteTabs(storeId);
    await Promise.allSettled(tabIds(tabs).map((tabId) => this.tabs.sendMessage(tabId, message)));
  }

  async openSitePage(
    storeId: string | undefined,
    options: { page: SitePage; originTabId?: number | undefined },
  ): Promise<void> {
    const url = `${siteConfig.origin}${siteConfig.pages[options.page]}`;
    const ids = await this.targetTabIds(storeId, options.originTabId);
    if (ids.length === 0) {
      const properties: { url: string; cookieStoreId?: string; active: boolean } = {
        url,
        active: true,
      };
      if (this.supportsContainers && storeId !== undefined) properties.cookieStoreId = storeId;
      await this.tabs.create(properties);
      return;
    }
    await Promise.allSettled(ids.map((tabId) => this.tabs.update(tabId, { url })));
  }

  /** The store's site tabs, plus the tab the action came from even if the query missed it. */
  private async targetTabIds(
    storeId: string | undefined,
    originTabId: number | undefined,
  ): Promise<number[]> {
    const ids = tabIds(await this.siteTabs(storeId));
    if (originTabId !== undefined && !ids.includes(originTabId)) ids.push(originTabId);
    return ids;
  }

  private async siteTabs(storeId: string | undefined): Promise<TabLike[]> {
    const [tabs, stores] = await Promise.all([
      this.tabs.query({ url: siteConfig.matchPattern }),
      this.cookies.getAllCookieStores?.() ?? Promise.resolve([]),
    ]);
    return tabs.filter((tab) => isTabInStore(tab, storeId, stores));
  }
}

function tabIds(tabs: readonly TabLike[]): number[] {
  return tabs.map((tab) => tab.id).filter((id) => id !== undefined);
}
