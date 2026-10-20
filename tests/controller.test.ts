import { describe, expect, it } from 'vitest';
import { ContentController, type BackgroundClient } from '../src/content/controller';
import type { MenuAction, MenuInjector, MenuModel } from '../src/content/menu-injector';
import type { PageUi } from '../src/content/ui';
import { DEFAULT_SETTINGS } from '../src/core/accounts';
import type { PageReport, ViewState } from '../src/core/switcher';

/** A page whose signed-in account can change without a reload, like claude.ai after a sign-in. */
function setup() {
  let signedInAs: string | null = 'a@example.com';
  const saved: string[] = [];
  const calls: string[] = [];
  const toasts: string[] = [];
  let model: MenuModel | undefined;
  let handlers: { onAction: (action: MenuAction) => void; onMenuOpen: () => void } | undefined;

  const view = (): ViewState => ({
    accounts: saved.map((email) => ({
      id: email,
      label: email,
      status: 'ok',
      savedAt: 0,
      active: email === signedInAs,
    })),
    current: { signedIn: signedInAs !== null },
    settings: DEFAULT_SETTINGS,
  });

  const client: BackgroundClient = {
    request: (type, payload) => {
      calls.push(type);
      if (type === 'reportPageState') {
        const email = (payload as PageReport).identity?.email;
        if (email !== undefined && !saved.includes(email)) {
          saved.push(email);
          return Promise.resolve({ savedAccount: { label: email, created: true } } as never);
        }
        return Promise.resolve({} as never);
      }
      if (type === 'getState') return Promise.resolve(view() as never);
      return Promise.resolve(null as never);
    },
  };

  // Only the members the controller uses are implemented by these fakes.
  const injector = {
    setModel: (next: MenuModel) => {
      model = next;
    },
    start: () => undefined,
    stop: () => undefined,
  } as unknown as MenuInjector;
  const ui = {
    toast: (message: string) => toasts.push(message),
    destroy: () => undefined,
  } as unknown as PageUi;

  const controller = new ContentController({
    client,
    ui,
    probe: () =>
      Promise.resolve(
        signedInAs === null
          ? { signedIn: false }
          : { signedIn: true, identity: { email: signedInAs } },
      ),
    createInjector: (next) => {
      handlers = next;
      return injector;
    },
  });

  return {
    controller,
    calls,
    toasts,
    model: () => model,
    openMenu: () => handlers?.onMenuOpen(),
    signInAs: (email: string | null) => {
      signedInAs = email;
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ContentController', () => {
  it('saves the signed-in account on load', async () => {
    const env = setup();
    await env.controller.start();
    expect(env.toasts).toEqual(['Account "a@example.com" saved.']);
    expect(env.model()?.accounts).toMatchObject([{ id: 'a@example.com', active: true }]);
  });

  it('notices a sign-in that happened without a page reload when the menu opens', async () => {
    const env = setup();
    await env.controller.start();
    // "Add account", then signing in to B: the site navigates without reloading.
    env.signInAs('b@example.com');
    env.openMenu();
    await flush();
    expect(env.toasts.at(-1)).toBe('Account "b@example.com" saved.');
    expect(env.model()?.accounts).toMatchObject([
      { id: 'a@example.com', active: false },
      { id: 'b@example.com', active: true },
    ]);
  });

  it('shares one run between concurrent syncs', async () => {
    const env = setup();
    await env.controller.start();
    env.calls.length = 0;
    await Promise.all([env.controller.sync(), env.controller.sync(), env.controller.sync()]);
    expect(env.calls).toEqual(['reportPageState', 'getState']);
  });
});
