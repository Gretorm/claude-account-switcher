import { browser } from 'wxt/browser';
import { describeIdentity } from '../core/identity';
import { siteConfig } from '../core/site-config';
import type { AccountSummary, ViewState } from '../core/switcher/types';
import type { Settings } from '../core/accounts/types';
import { AppError, ERROR_MESSAGES } from '../shared/errors';
import {
  createEnvelope,
  unwrapReply,
  type BackgroundRequests,
  type RequestOf,
  type ResponseOf,
} from '../shared/messaging';
import { h, icon } from './dom';

type Mode = { kind: 'idle' } | { kind: 'renaming'; accountId: string };

interface Notice {
  text: string;
  kind: 'info' | 'error';
}

const SETTING_LABELS: Record<keyof Settings, { title: string; hint: string }> = {
  injectIntoMenu: {
    title: 'Show in the claude.ai account menu',
    hint: 'Adds “Switch account” and “Add account” above “Log out”.',
  },
  clearSiteStorageOnSwitch: {
    title: 'Clear all claude.ai site data on switch',
    hint: 'Also removes drafts and preferences. Account caches are always cleared.',
  },
  debug: {
    title: 'Debug logging',
    hint: 'Prints diagnostics to the browser console.',
  },
};

function request<K extends keyof BackgroundRequests>(
  type: K,
  payload: RequestOf<BackgroundRequests, K>,
): Promise<ResponseOf<BackgroundRequests, K>> {
  return browser.runtime
    .sendMessage(createEnvelope(type, payload))
    .then((reply) => unwrapReply<ResponseOf<BackgroundRequests, K>>(reply));
}

function errorText(error: unknown): string {
  return error instanceof AppError ? error.message : ERROR_MESSAGES.UNKNOWN;
}

export async function startPopup(root: HTMLElement): Promise<void> {
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  const tabId = activeTab?.id;
  const withTab = <T extends object>(payload: T): T & { tabId?: number } =>
    tabId === undefined ? payload : { ...payload, tabId };
  const origins = [siteConfig.matchPattern];

  let state: ViewState | undefined;
  let mode: Mode = { kind: 'idle' };
  let notice: Notice | undefined;
  let hasPermission = true;
  let busy = false;

  async function load(): Promise<void> {
    hasPermission = await browser.permissions.contains({ origins });
    if (hasPermission) state = await request('getState', withTab({}));
    render();
  }

  /** Runs an action, shows its error, then reloads the state. */
  async function run(action: () => Promise<unknown>, success?: string): Promise<void> {
    if (busy) return;
    busy = true;
    notice = undefined;
    render();
    try {
      await action();
      mode = { kind: 'idle' };
      if (success !== undefined) notice = { text: success, kind: 'info' };
    } catch (error) {
      notice = { text: errorText(error), kind: 'error' };
    } finally {
      busy = false;
    }
    await load().catch((error: unknown) => {
      notice = { text: errorText(error), kind: 'error' };
      render();
    });
  }

  function switchTo(account: AccountSummary): void {
    if (account.status === 'expired') {
      void run(
        () => request('beginLogin', withTab({ resaveAccountId: account.id })),
        `Log in to “${account.label}” on claude.ai: it will be updated automatically.`,
      );
      return;
    }
    void run(() => request('switchAccount', withTab({ accountId: account.id })));
  }

  function addAccount(): void {
    void run(
      () => request('beginLogin', withTab({})),
      'Sign in with another account on claude.ai: it will be saved automatically.',
    );
  }

  async function deleteAccount(account: AccountSummary): Promise<void> {
    const confirmed = await confirmDialog(
      `Delete “${account.label}”?`,
      account.active
        ? 'Its saved session will be erased from this browser. You stay signed in, but this session will not be saved again; sign in again to add the account back.'
        : 'Its saved session will be erased from this browser. You can add the account again later by signing in to it.',
      'Delete',
    );
    if (!confirmed) return;
    await run(
      () => request('deleteAccount', withTab({ accountId: account.id })),
      `Account “${account.label}” deleted.`,
    );
  }

  function render(): void {
    const nodes: (Node | null)[] = [
      h(
        'header',
        { className: 'header' },
        h('img', { attrs: { src: '/icon/32.png', alt: '', width: '20', height: '20' } }),
        h('h1', { text: 'Account Switcher' }),
      ),
      ...body(),
      notice === undefined
        ? null
        : h('p', {
            className: `notice notice-${notice.kind}`,
            text: notice.text,
            attrs: { role: notice.kind === 'error' ? 'alert' : 'status' },
          }),
    ];
    root.replaceChildren(...nodes.filter((node) => node !== null));
    root.toggleAttribute('aria-busy', busy);
  }

  function body(): (Node | null)[] {
    if (!hasPermission) {
      return [
        h('p', { text: 'This extension needs access to claude.ai to save and switch sessions.' }),
        h('button', {
          className: 'primary block',
          text: 'Allow access to claude.ai',
          on: {
            click: () => {
              void browser.permissions.request({ origins }).then(load);
            },
          },
        }),
      ];
    }
    if (state === undefined) return [h('p', { className: 'muted', text: 'Loading…' })];
    return [
      currentSession(state),
      pendingLogin(state),
      accountList(state),
      footer(),
      settings(state),
    ];
  }

  function currentSession(view: ViewState): HTMLElement {
    const { current } = view;
    if (!current.signedIn) {
      return h('section', { className: 'card muted' }, 'Not signed in to claude.ai in this tab.');
    }
    const saved = view.accounts.find((account) => account.id === current.accountId);
    const who = describeIdentity(current.identity) ?? 'Signed in';
    if (saved !== undefined) {
      return h(
        'section',
        { className: 'card' },
        h('div', { className: 'card-title', text: who }),
        h('div', { className: 'muted', text: `Saved as “${saved.label}”` }),
      );
    }
    return h(
      'section',
      { className: 'card' },
      h('div', { className: 'card-title', text: who }),
      h('div', {
        className: 'muted',
        text: 'Not saved yet: it is saved automatically when claude.ai is open in this tab.',
      }),
    );
  }

  function cancel(): void {
    mode = { kind: 'idle' };
    render();
  }

  function pendingLogin(view: ViewState): HTMLElement | null {
    if (view.pendingLogin === undefined || view.current.accountId !== undefined) return null;
    const label = view.pendingLogin.resaveLabel;
    const text =
      label === undefined
        ? 'Waiting for you to sign in with another account on claude.ai.'
        : `Waiting for you to log in to “${label}” on claude.ai.`;
    return h('section', { className: 'card info' }, h('div', { text }));
  }

  function accountList(view: ViewState): HTMLElement {
    if (view.accounts.length === 0) {
      return h('p', { className: 'muted', text: 'No saved accounts yet.' });
    }
    return h(
      'ul',
      { className: 'accounts', attrs: { 'aria-label': 'Saved accounts' } },
      ...view.accounts.map((account, index) => accountRow(account, index, view.accounts.length)),
    );
  }

  function accountRow(account: AccountSummary, index: number, count: number): HTMLElement {
    if (mode.kind === 'renaming' && mode.accountId === account.id) return renameRow(account);
    const detail = describeIdentity(account.identity);
    const main = h(
      'button',
      {
        className: 'account-main',
        attrs: {
          type: 'button',
          title: account.active ? 'Active account' : `Switch to ${account.label}`,
          ...(account.active ? { 'aria-current': 'true' } : {}),
        },
        on: {
          click: () => {
            if (!account.active) switchTo(account);
          },
        },
      },
      h('span', { className: 'marker' }, account.active ? icon('check') : null),
      h(
        'span',
        { className: 'account-text' },
        h('span', { className: 'account-label', text: account.label }),
        detail !== undefined && detail !== account.label
          ? h('span', { className: 'muted small', text: detail })
          : null,
      ),
      account.status === 'expired' ? h('span', { className: 'badge', text: 'Expired' }) : null,
    );
    const iconButton = (
      name: Parameters<typeof icon>[0],
      label: string,
      onClick: () => void,
      disabled = false,
      danger = false,
    ) =>
      h(
        'button',
        {
          className: danger ? 'icon-button icon-danger' : 'icon-button',
          attrs: {
            type: 'button',
            'aria-label': `${label} ${account.label}`,
            title: label,
            ...(disabled ? { disabled: '' } : {}),
          },
          on: { click: onClick },
        },
        icon(name),
      );
    const tools = h(
      'span',
      { className: 'tools' },
      iconButton(
        'up',
        'Move up',
        () => {
          void run(() => request('moveAccount', { accountId: account.id, toIndex: index - 1 }));
        },
        index === 0,
      ),
      iconButton(
        'down',
        'Move down',
        () => {
          void run(() => request('moveAccount', { accountId: account.id, toIndex: index + 1 }));
        },
        index === count - 1,
      ),
      iconButton('edit', 'Rename', () => {
        mode = { kind: 'renaming', accountId: account.id };
        render();
      }),
      iconButton(
        'trash',
        'Delete',
        () => {
          void deleteAccount(account);
        },
        false,
        true,
      ),
    );
    return h('li', { className: 'account' }, h('div', { className: 'account-line' }, main, tools));
  }

  /** A modal confirmation. Resolves to true when confirmed. */
  function confirmDialog(title: string, message: string, confirmText: string): Promise<boolean> {
    const dialog = h(
      'dialog',
      { className: 'dialog' },
      h(
        'form',
        { attrs: { method: 'dialog' } },
        h('h2', { text: title }),
        h('p', { className: 'muted', text: message }),
        h(
          'div',
          { className: 'row-actions' },
          h('button', { text: 'Cancel', attrs: { value: 'cancel' } }),
          h('button', { className: 'danger-fill', text: confirmText, attrs: { value: 'confirm' } }),
        ),
      ),
    );
    document.body.append(dialog);
    return new Promise((resolve) => {
      dialog.addEventListener(
        'close',
        () => {
          dialog.remove();
          resolve(dialog.returnValue === 'confirm');
        },
        { once: true },
      );
      dialog.showModal();
    });
  }

  function renameRow(account: AccountSummary): HTMLElement {
    const input = h('input', {
      attrs: {
        type: 'text',
        required: '',
        maxlength: '80',
        value: account.label,
        'aria-label': 'New name',
      },
      on: {
        keydown: (event) => {
          if ((event as KeyboardEvent).key === 'Escape') {
            event.preventDefault();
            cancel();
          }
        },
      },
    });
    queueMicrotask(() => {
      input.select();
    });
    return h(
      'li',
      { className: 'account' },
      h(
        'form',
        {
          className: 'rename',
          on: {
            submit: (event) => {
              event.preventDefault();
              const label = input.value.trim();
              if (label === '') return;
              void run(() => request('renameAccount', { accountId: account.id, label }));
            },
          },
        },
        input,
        h('button', { className: 'primary', text: 'Save', attrs: { type: 'submit' } }),
      ),
    );
  }

  function footer(): HTMLElement {
    return h(
      'div',
      { className: 'footer' },
      h(
        'button',
        { className: 'primary block', attrs: { type: 'button' }, on: { click: addAccount } },
        icon('plus'),
        'Add account',
      ),
    );
  }

  function settings(view: ViewState): HTMLElement {
    const keys = Object.keys(SETTING_LABELS) as (keyof Settings)[];
    return h(
      'details',
      { className: 'settings' },
      h('summary', { text: 'Settings' }),
      ...keys.map((key) => {
        const id = `setting-${key}`;
        const checkbox = h('input', {
          attrs: { type: 'checkbox', id, ...(view.settings[key] ? { checked: '' } : {}) },
          on: {
            change: (event) => {
              const checked = (event.target as HTMLInputElement).checked;
              void run(() => request('updateSettings', { [key]: checked }));
            },
          },
        });
        return h(
          'div',
          { className: 'setting' },
          checkbox,
          h(
            'label',
            { attrs: { for: id } },
            h('span', { text: SETTING_LABELS[key].title }),
            h('span', { className: 'muted small', text: SETTING_LABELS[key].hint }),
          ),
        );
      }),
    );
  }

  try {
    await load();
  } catch (error) {
    notice = { text: errorText(error), kind: 'error' };
    render();
  }
}
