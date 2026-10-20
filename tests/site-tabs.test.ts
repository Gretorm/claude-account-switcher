import { describe, expect, it } from 'vitest';
import { BrowserSiteTabs, type TabLike, type TabsApi } from '../src/background/site-tabs';
import { FakeCookies } from './helpers/fake-cookies';

function setup(found: TabLike[]) {
  const calls: string[] = [];
  const tabs: TabsApi = {
    query: () => Promise.resolve(found),
    update: (tabId, properties) => {
      calls.push(`open:${tabId}:${properties.url}`);
      return Promise.resolve();
    },
    create: (properties) => {
      calls.push(`create:${properties.url}:${properties.cookieStoreId ?? 'default'}`);
      return Promise.resolve();
    },
    sendMessage: (tabId) => {
      calls.push(`message:${tabId}`);
      return Promise.resolve();
    },
  };
  return { calls, siteTabs: new BrowserSiteTabs(tabs, new FakeCookies(), true) };
}

describe('BrowserSiteTabs', () => {
  it('opens the page directly in every site tab of the store', async () => {
    const { calls, siteTabs } = setup([
      { id: 1, cookieStoreId: 'firefox-default' },
      { id: 2, cookieStoreId: 'firefox-container-1' },
    ]);
    await siteTabs.openSitePage(undefined, { page: 'home' });
    expect(calls).toEqual(['open:1:https://claude.ai/new']);
  });

  it('goes straight to the login page after a sign-out', async () => {
    const { calls, siteTabs } = setup([{ id: 1, cookieStoreId: 'firefox-default' }]);
    await siteTabs.openSitePage(undefined, { page: 'login' });
    expect(calls).toEqual(['open:1:https://claude.ai/login']);
  });

  it('always includes the tab the action came from, even if the query missed it', async () => {
    const { calls, siteTabs } = setup([]);
    await siteTabs.clearSiteStorage(undefined, { all: false, originTabId: 7 });
    await siteTabs.openSitePage(undefined, { page: 'home', originTabId: 7 });
    expect(calls).toEqual(['message:7', 'open:7:https://claude.ai/new']);
  });

  it('does not open the page twice in the origin tab', async () => {
    const { calls, siteTabs } = setup([{ id: 7, cookieStoreId: 'firefox-default' }]);
    await siteTabs.openSitePage(undefined, { page: 'home', originTabId: 7 });
    expect(calls).toEqual(['open:7:https://claude.ai/new']);
  });

  it('opens the site in the right container when no tab is open', async () => {
    const { calls, siteTabs } = setup([]);
    await siteTabs.openSitePage('firefox-container-1', { page: 'home' });
    expect(calls).toEqual(['create:https://claude.ai/new:firefox-container-1']);
  });
});
