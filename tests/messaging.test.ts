import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageListener, type MessageSender } from '../src/background/router';
import { AccountRepository, fromStorageArea } from '../src/core/accounts';
import { BrowserCookieJar } from '../src/core/cookies';
import { AccountSwitcher } from '../src/core/switcher';
import { AppError } from '../src/shared/errors';
import { createEnvelope, isEnvelope, unwrapReply } from '../src/shared/messaging';
import { backgroundValidators } from '../src/shared/request-validators';
import { FakeCookies } from './helpers/fake-cookies';

const RUNTIME_ID = 'extension-id';
const ORIGIN = 'chrome-extension://extension-id/';
const POPUP: MessageSender = { id: RUNTIME_ID, url: `${ORIGIN}popup.html` };
const CONTENT: MessageSender = {
  id: RUNTIME_ID,
  url: 'https://claude.ai/new',
  tab: { id: 7, url: 'https://claude.ai/new' },
};

function router() {
  const cookies = new FakeCookies();
  cookies.seed({ name: 'sessionKey', domain: '.claude.ai', value: 'A' });
  const switcher = new AccountSwitcher({
    jar: new BrowserCookieJar(cookies, {
      capabilities: { partitionKey: true, firstPartyDomain: false },
    }),
    repository: new AccountRepository(fromStorageArea(fakeBrowser.storage.local)),
    tabs: { clearSiteStorage: () => Promise.resolve(), openSitePage: () => Promise.resolve() },
  });
  const afterRequest = vi.fn(() => Promise.resolve());
  const listener = createMessageListener({
    switcher,
    runtimeId: RUNTIME_ID,
    extensionOrigin: ORIGIN,
    getTab: (tabId) => Promise.resolve({ id: tabId, url: 'https://example.com/' }),
    resolveStoreId: () => Promise.resolve(undefined),
    probeTab: () => Promise.resolve(undefined),
    afterRequest,
  });
  const send = (message: unknown, sender: MessageSender) =>
    new Promise<unknown>((resolve) => {
      const handled = listener(message, sender, resolve);
      if (handled !== true) setTimeout(resolve, 10, 'ignored');
    });
  return { send, afterRequest };
}

beforeEach(() => {
  fakeBrowser.reset();
});

describe('envelopes', () => {
  it('recognizes only messages on the extension channel', () => {
    expect(isEnvelope(createEnvelope('getState', {}))).toBe(true);
    expect(isEnvelope({ type: 'getState' })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
  });

  it('turns error replies back into AppErrors', () => {
    expect(unwrapReply({ ok: true, data: 1 })).toBe(1);
    expect(() => unwrapReply({ ok: false, error: { code: 'NOT_FOUND', message: 'gone' } })).toThrow(
      AppError,
    );
    expect(() => unwrapReply(undefined)).toThrow('No response');
  });
});

describe('request validation', () => {
  it('accepts well-formed payloads and strips nothing it needs', () => {
    expect(backgroundValidators.switchAccount({ accountId: 'a', tabId: 3 })).toEqual({
      accountId: 'a',
      tabId: 3,
    });
    expect(backgroundValidators.updateSettings({ debug: true })).toEqual({ debug: true });
    expect(
      backgroundValidators.reportPageState({ signedIn: true, identity: { email: 'a@b.co' } }),
    ).toEqual({ signedIn: true, identity: { email: 'a@b.co' } });
  });

  it('rejects malformed payloads', () => {
    expect(() => backgroundValidators.switchAccount({})).toThrow(AppError);
    expect(() => backgroundValidators.switchAccount({ accountId: 'a', tabId: 1.5 })).toThrow(
      AppError,
    );
    expect(() => backgroundValidators.updateSettings({ debug: 'yes' })).toThrow(AppError);
    expect(() => backgroundValidators.updateSettings({ unknown: true })).toThrow(AppError);
    expect(() => backgroundValidators.reportPageState({ signedIn: 'maybe' })).toThrow(AppError);
    expect(() =>
      backgroundValidators.renameAccount({ accountId: 'a', label: 'x'.repeat(501) }),
    ).toThrow(AppError);
  });
});

describe('background router', () => {
  it('answers the popup', async () => {
    const { send, afterRequest } = router();
    const reply = (await send(createEnvelope('getState', {}), POPUP)) as { ok: boolean };
    expect(reply.ok).toBe(true);
    expect(afterRequest).toHaveBeenCalled();
  });

  it('ignores senders that are not this extension', async () => {
    const { send } = router();
    await expect(send(createEnvelope('getState', {}), { ...POPUP, id: 'other' })).resolves.toBe(
      'ignored',
    );
    await expect(
      send(createEnvelope('getState', {}), {
        id: RUNTIME_ID,
        url: 'https://evil.example/',
        tab: { id: 1, url: 'https://evil.example/' },
      }),
    ).resolves.toBe('ignored');
    await expect(send({ type: 'getState' }, POPUP)).resolves.toBe('ignored');
  });

  it('keeps settings and renaming away from content scripts', async () => {
    const { send } = router();
    await expect(
      send(createEnvelope('updateSettings', { debug: true }), CONTENT),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    await expect(
      send(createEnvelope('renameAccount', { accountId: 'a', label: 'x' }), CONTENT),
    ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('lets the in-page menu delete accounts', async () => {
    const { send } = router();
    // The request reaches the switcher, which reports the unknown account.
    await expect(
      send(createEnvelope('deleteAccount', { accountId: 'missing' }), CONTENT),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });

  it('accepts page reports from content scripts only', async () => {
    const { send } = router();
    const fromContent = (await send(
      createEnvelope('reportPageState', { signedIn: true }),
      CONTENT,
    )) as {
      ok: boolean;
    };
    expect(fromContent.ok).toBe(true);
    const fromPopup = (await send(
      createEnvelope('reportPageState', { signedIn: true }),
      POPUP,
    )) as {
      ok: boolean;
    };
    expect(fromPopup.ok).toBe(false);
  });

  it('rejects unknown request types and invalid payloads', async () => {
    const { send } = router();
    await expect(send(createEnvelope('explode', {}), POPUP)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    await expect(
      send(createEnvelope('renameAccount', { accountId: 'a', label: 42 }), POPUP),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
  });

  it('never leaks internal error details', async () => {
    const { send } = router();
    await expect(
      send(createEnvelope('switchAccount', { accountId: 'missing' }), POPUP),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'This account no longer exists.' },
    });
  });
});
