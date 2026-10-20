import { browser } from 'wxt/browser';
import { AccountRepository, fromStorageArea } from '../core/accounts';
import {
  BrowserCookieJar,
  normalizeStoreId,
  resolveCookieStoreId,
  type BrowserCookie,
  type CookieCapabilities,
  type CookiesApi,
} from '../core/cookies';
import { siteConfig } from '../core/site-config';
import { AccountSwitcher } from '../core/switcher/switcher';
import type { PageReport } from '../core/switcher/types';
import { createLogger } from '../shared/logger';
import { createEnvelope, unwrapReply, type ContentCommands } from '../shared/messaging';
import { createMessageListener } from './router';
import { BrowserSiteTabs, type TabsApi } from './site-tabs';

const PROBE_TIMEOUT_MS = 1500;

function cookieCapabilities(): CookieCapabilities {
  return {
    // Chromium 119+ and Firefox 94+; Safari has no cookie partition support.
    partitionKey: !import.meta.env.SAFARI,
    firstPartyDomain: import.meta.env.FIREFOX,
  };
}

/** Wires the core services to the browser APIs. Called once per background start. */
export function startBackground(): void {
  let debug = false;
  const logger = createLogger('background', () => debug);

  // The generated typings follow Chromium and lack Firefox-only fields such as
  // firstPartyDomain; CookiesApi is the cross-browser subset actually used.
  const cookiesApi = browser.cookies as unknown as CookiesApi;
  const tabsApi = browser.tabs as unknown as TabsApi;

  const repository = new AccountRepository(fromStorageArea(browser.storage.local), {
    onUnreadableState: (error) => {
      logger.error('Stored state was unreadable and has been backed up', error);
    },
  });
  const siteTabs = new BrowserSiteTabs(tabsApi, cookiesApi, import.meta.env.FIREFOX);
  const switcher = new AccountSwitcher({
    jar: new BrowserCookieJar(cookiesApi, { capabilities: cookieCapabilities() }),
    repository,
    tabs: siteTabs,
    logger,
  });

  async function refreshBadge(): Promise<void> {
    const state = await repository.read();
    debug = state.settings.debug;
    const expired = await switcher.countExpired();
    await browser.action.setBadgeText({ text: expired > 0 ? '!' : '' });
    if (expired > 0) await browser.action.setBadgeBackgroundColor({ color: '#B42318' });
  }

  async function probeTab(tabId: number): Promise<PageReport | undefined> {
    const request = browser.tabs
      .sendMessage(tabId, createEnvelope<keyof ContentCommands>('probePage', {}))
      .then((reply) => unwrapReply<PageReport>(reply));
    const timeout = new Promise<undefined>((resolve) => setTimeout(resolve, PROBE_TIMEOUT_MS));
    try {
      return await Promise.race([request, timeout]);
    } catch (error) {
      logger.debug('Page probe failed', error);
      return undefined;
    }
  }

  browser.runtime.onMessage.addListener(
    createMessageListener({
      switcher,
      runtimeId: browser.runtime.id,
      extensionOrigin: browser.runtime.getURL('/'),
      getTab: (tabId) => browser.tabs.get(tabId),
      resolveStoreId: (tab) => resolveCookieStoreId(cookiesApi, tab),
      probeTab,
      afterRequest: refreshBadge,
    }),
  );

  browser.cookies.onChanged.addListener((changeInfo) => {
    const cookie = changeInfo.cookie as BrowserCookie;
    const storeId = cookie.storeId === undefined ? undefined : normalizeStoreId(cookie.storeId);
    switcher.handleCookieChange(storeId, changeInfo, cookie).catch((error: unknown) => {
      logger.error('Could not follow a session cookie change', error);
    });
    // claude.ai signs in without reloading the page, so the content script
    // would not notice a new session on its own: ask it to report again.
    if (!changeInfo.removed && siteConfig.sessionCookieNames.includes(cookie.name)) {
      siteTabs.syncSession(storeId).catch((error: unknown) => {
        logger.debug('Could not ask the site tabs to sync', error);
      });
    }
  });

  void refreshBadge().catch((error: unknown) => {
    logger.error('Could not initialize the badge', error);
  });
}
