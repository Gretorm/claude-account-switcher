import { isSiteUrl } from '../core/site-config';
import type { AccountSwitcher } from '../core/switcher/switcher';
import type { PageReport } from '../core/switcher/types';
import { AppError } from '../shared/errors';
import {
  definedFields,
  dispatch,
  isEnvelope,
  type BackgroundRequests,
  type Handlers,
} from '../shared/messaging';
import { backgroundValidators } from '../shared/request-validators';
import type { TabLike } from './site-tabs';

export interface MessageSender {
  id?: string | undefined;
  url?: string | undefined;
  tab?: TabLike | undefined;
}

interface RequestContext {
  /** Tab the request is about: the sender tab, or the popup's active tab. */
  tab: TabLike | undefined;
  fromContentScript: boolean;
}

/**
 * Requests a content script may send (the in-page menu needs them). Renaming,
 * reordering and settings stay popup-only.
 */
const CONTENT_SCRIPT_REQUESTS = new Set<keyof BackgroundRequests>([
  'getState',
  'beginLogin',
  'switchAccount',
  'deleteAccount',
  'reportPageState',
]);

export interface RouterDeps {
  switcher: AccountSwitcher;
  runtimeId: string;
  /** `chrome-extension://<id>/` or `moz-extension://<uuid>/`. */
  extensionOrigin: string;
  getTab(tabId: number): Promise<TabLike>;
  resolveStoreId(tab: TabLike | undefined): Promise<string | undefined>;
  /** Asks a site tab's content script for a fresh page report. */
  probeTab(tabId: number): Promise<PageReport | undefined>;
  /** Runs after every handled request, e.g. to refresh the badge. */
  afterRequest(): Promise<void>;
}

/** Builds the `runtime.onMessage` listener of the background. */
export function createMessageListener(deps: RouterDeps) {
  const { switcher } = deps;

  async function storeOf(context: RequestContext): Promise<string | undefined> {
    return deps.resolveStoreId(context.tab);
  }

  /** The tab to update with the session change: the requesting site tab, if any. */
  function originTabId(context: RequestContext): number | undefined {
    return context.tab !== undefined && isSiteUrl(context.tab.url) ? context.tab.id : undefined;
  }

  async function targetTab(
    payload: { tabId?: number },
    context: RequestContext,
  ): Promise<RequestContext> {
    if (context.fromContentScript || payload.tabId === undefined) return context;
    return { ...context, tab: await deps.getTab(payload.tabId) };
  }

  const handlers: Handlers<BackgroundRequests, RequestContext> = {
    getState: async (payload, context) => {
      const ctx = await targetTab(payload, context);
      const storeId = await storeOf(ctx);
      // The popup has no page of its own: ask the site tab for a fresh report.
      if (!ctx.fromContentScript && ctx.tab?.id !== undefined && isSiteUrl(ctx.tab.url)) {
        const report = await deps.probeTab(ctx.tab.id);
        if (report !== undefined) await switcher.reportPageState(storeId, report);
      }
      return switcher.getState(storeId);
    },
    beginLogin: async (payload, context) => {
      const ctx = await targetTab(payload, context);
      await switcher.beginLogin(
        await storeOf(ctx),
        definedFields({ resaveAccountId: payload.resaveAccountId, originTabId: originTabId(ctx) }),
      );
      return null;
    },
    switchAccount: async (payload, context) => {
      const ctx = await targetTab(payload, context);
      return switcher.switchTo(
        await storeOf(ctx),
        payload.accountId,
        definedFields({ originTabId: originTabId(ctx) }),
      );
    },
    renameAccount: async ({ accountId, label }) => {
      await switcher.renameAccount(accountId, label);
      return null;
    },
    moveAccount: async ({ accountId, toIndex }) => {
      await switcher.moveAccount(accountId, toIndex);
      return null;
    },
    deleteAccount: async (payload, context) => {
      const storeId = await storeOf(await targetTab(payload, context));
      await switcher.deleteAccount(storeId, payload.accountId);
      return null;
    },
    updateSettings: (patch) => switcher.updateSettings(patch),
    reportPageState: async (report, context) => {
      if (!context.fromContentScript) throw new AppError('INVALID_REQUEST');
      const { expiredAccount, savedAccount } = await switcher.reportPageState(
        await storeOf(context),
        report,
      );
      if (expiredAccount !== undefined) return { expiredAccountLabel: expiredAccount.label };
      if (savedAccount !== undefined) {
        return { savedAccount: { label: savedAccount.label, created: savedAccount.created } };
      }
      return {};
    },
  };

  function contextOf(sender: MessageSender): RequestContext | undefined {
    if (sender.id !== deps.runtimeId) return undefined;
    if (sender.tab !== undefined) {
      return isSiteUrl(sender.url ?? sender.tab.url)
        ? { tab: sender.tab, fromContentScript: true }
        : undefined;
    }
    return sender.url?.startsWith(deps.extensionOrigin) === true
      ? { tab: undefined, fromContentScript: false }
      : undefined;
  }

  return (
    message: unknown,
    sender: MessageSender,
    sendResponse: (response: unknown) => void,
  ): true | undefined => {
    if (!isEnvelope(message)) return undefined;
    const context = contextOf(sender);
    if (context === undefined) return undefined;
    if (
      context.fromContentScript &&
      !CONTENT_SCRIPT_REQUESTS.has(message.type as keyof BackgroundRequests)
    ) {
      sendResponse({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Not allowed.' } });
      return undefined;
    }
    // sendResponse + `return true` is the one async reply style every browser supports.
    void dispatch(message, handlers, backgroundValidators, context)
      .then(async (reply) => {
        await deps.afterRequest().catch(() => undefined);
        return reply;
      })
      .then(sendResponse);
    return true;
  };
}
