import { browser } from 'wxt/browser';
import { siteConfig } from '../core/site-config';
import { createLogger } from '../shared/logger';
import {
  asObject,
  createEnvelope,
  dispatch,
  isEnvelope,
  unwrapReply,
  type ContentCommands,
  type Handlers,
  type Validators,
} from '../shared/messaging';
import { AppError } from '../shared/errors';
import { ContentController, type BackgroundClient } from './controller';
import { MenuInjector } from './menu-injector';
import { probePage } from './page-probe';
import { clearSiteStorage } from './site-storage';
import { PageUi } from './ui';

/**
 * In Firefox, a content script's own `fetch` is not treated as a request from
 * the page; `content.fetch` is. Chromium's content-script fetch already is.
 */
function pageFetch(): (input: string, init: RequestInit) => Promise<Response> {
  const firefoxContent = (globalThis as { content?: { fetch?: typeof fetch } }).content;
  const fetchFn = firefoxContent?.fetch ?? globalThis.fetch;
  return (input, init) => fetchFn(input, init);
}

const client: BackgroundClient = {
  request: async (type, payload) =>
    unwrapReply(await browser.runtime.sendMessage(createEnvelope(type, payload))),
};

const commandValidators: Validators<ContentCommands> = {
  clearSiteStorage: (payload) => {
    const { all } = asObject(payload);
    if (typeof all !== 'boolean') throw new AppError('INVALID_REQUEST');
    return { all };
  },
  probePage: () => ({}),
  syncSession: () => ({}),
};

/** Wires the content script to the page and the extension. Returns a teardown. */
export function startContentScript(): () => void {
  let debug = false;
  const logger = createLogger('content', () => debug);
  const probe = () =>
    probePage({ fetch: pageFetch(), location: window.location, document, config: siteConfig });

  const controller = new ContentController({
    client,
    ui: new PageUi(document),
    probe,
    createInjector: (handlers) => new MenuInjector({ document, logger, ...handlers }),
    logger,
  });

  const handlers: Handlers<ContentCommands, undefined> = {
    clearSiteStorage: ({ all }) => {
      clearSiteStorage({ local: localStorage, session: sessionStorage }, { all });
      return Promise.resolve(null);
    },
    probePage: () => probe(),
    syncSession: async () => {
      await controller.sync();
      return null;
    },
  };

  const listener = (
    message: unknown,
    sender: { id?: string | undefined },
    sendResponse: (response: unknown) => void,
  ): true | undefined => {
    if (!isEnvelope(message) || sender.id !== browser.runtime.id) return undefined;
    void dispatch(message, handlers, commandValidators, undefined).then(sendResponse);
    return true;
  };
  browser.runtime.onMessage.addListener(listener);

  void controller
    .refresh()
    .then((state) => {
      debug = state.settings.debug;
      return controller.start();
    })
    .catch((error: unknown) => {
      logger.debug('Content script could not start', error);
    });

  return () => {
    browser.runtime.onMessage.removeListener(listener);
    controller.stop();
  };
}
