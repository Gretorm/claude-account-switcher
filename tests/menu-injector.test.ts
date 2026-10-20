// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INJECTED_SELECTOR, nativeText } from '../src/content/markers';
import { MenuInjector, type MenuAction, type MenuModel } from '../src/content/menu-injector';

function fixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, 'fixtures', name), 'utf8');
}

const MODEL: MenuModel = {
  accounts: [
    { id: 'work', label: 'Work', detail: 'work@example.com', active: true, expired: false },
    { id: 'home', label: 'Home', active: false, expired: true },
  ],
};

function mount(html: string, model: MenuModel | null = MODEL) {
  document.body.innerHTML = html;
  const actions: MenuAction[] = [];
  const onMenuOpen = vi.fn();
  const injector = new MenuInjector({
    document,
    onAction: (action) => actions.push(action),
    onMenuOpen,
    schedule: (callback) => {
      callback();
    },
  });
  if (model !== null) injector.setModel(model);
  return { injector, actions, onMenuOpen };
}

const injectedItems = () => [
  ...document.querySelectorAll<HTMLElement>(`${INJECTED_SELECTOR}[role^="menuitem"]`),
];
const labels = () =>
  injectedItems().map(
    (item) =>
      item.querySelector('[data-menu-account-switcher-slot="text"]')?.firstChild?.textContent ??
      item.textContent,
  );

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('MenuInjector', () => {
  it('inserts the switcher directly above "Log out"', () => {
    mount(fixture('account-menu.html'));
    const logout = document.getElementById('logout-item');
    const separator = logout?.previousElementSibling;
    const group = separator?.previousElementSibling;
    expect(separator?.getAttribute('data-menu-account-switcher')).toBe('separator');
    expect(group?.getAttribute('role')).toBe('group');
    expect(labels()).toEqual(['Work', 'Home', 'Add account']);
  });

  it('copies the native styling but none of the native behavior', () => {
    mount(fixture('account-menu.html'));
    const [item] = injectedItems();
    expect(item?.tagName).toBe('A');
    expect(item?.className).toContain('data-[highlighted]:bg-hover');
    expect(item?.hasAttribute('data-cds-icon-row')).toBe(true);
    expect(item?.hasAttribute('href')).toBe(false);
    expect(item?.hasAttribute('data-testid')).toBe(false);
    expect(item?.hasAttribute('id')).toBe(false);
    // Same "icon slot + text slot" layout as the native items.
    expect(item?.children[0]?.className).toBe('icon-slot');
    expect(item?.children[1]?.className).toBe('text-slot');
  });

  it('marks the active and the expired accounts', () => {
    mount(fixture('account-menu.html'));
    const [work, home] = injectedItems();
    expect(work?.getAttribute('aria-checked')).toBe('true');
    expect(work?.querySelector('[data-menu-account-switcher-slot="icon"] svg')).not.toBeNull();
    expect(work?.textContent).toContain('work@example.com');
    expect(home?.getAttribute('aria-checked')).toBe('false');
    expect(home?.textContent).toContain('(expired)');
  });

  it('shows only "Add account" when nothing is saved', () => {
    mount(fixture('account-menu.html'), { accounts: [] });
    expect(labels()).toEqual(['Add account']);
    // No "Switch account" heading without accounts.
    expect(document.querySelector('[role="presentation"][data-menu-account-switcher]')).toBeNull();
  });

  it('puts a red trash button at the right of each account', () => {
    mount(fixture('account-menu.html'));
    const [work] = injectedItems();
    const trash = work?.lastElementChild as HTMLElement | null;
    expect(trash?.getAttribute('role')).toBe('button');
    expect(trash?.getAttribute('aria-label')).toBe('Delete Work');
    expect(trash?.style.color).toBe('#dc2626');
    expect(trash?.style.marginLeft).toBe('auto');
    expect(trash?.querySelector('svg')).not.toBeNull();
    // "Add account" has no trash.
    expect(injectedItems().at(-1)?.querySelector('[role="button"]')).toBeNull();
  });

  it('asks to delete, without switching, from the trash or the Delete key', () => {
    const { actions } = mount(fixture('account-menu.html'));
    const home = injectedItems()[1];
    (home?.lastElementChild as HTMLElement | null)?.click();
    home?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(actions).toEqual([
      { type: 'delete', accountId: 'home' },
      { type: 'delete', accountId: 'home' },
    ]);
  });

  it('reports actions and closes the menu', () => {
    const { actions } = mount(fixture('account-menu.html'));
    const escape = vi.fn();
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') escape();
    });
    injectedItems()[0]?.click();
    injectedItems()
      .at(-1)
      ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(actions).toEqual([{ type: 'switch', accountId: 'work' }, { type: 'add' }]);
    expect(escape).toHaveBeenCalledTimes(2);
  });

  it('mirrors the native highlight on hover', () => {
    mount(fixture('account-menu.html'));
    const [item] = injectedItems();
    item?.dispatchEvent(new Event('pointerenter'));
    expect(item?.hasAttribute('data-highlighted')).toBe(true);
    item?.dispatchEvent(new Event('pointerleave'));
    expect(item?.hasAttribute('data-highlighted')).toBe(false);
  });

  it('injects only once per menu', () => {
    const { injector } = mount(fixture('account-menu.html'));
    injector.scan();
    injector.scan();
    expect(document.querySelectorAll(`${INJECTED_SELECTOR}[role="group"]`)).toHaveLength(1);
  });

  it('re-renders open menus when the model changes', () => {
    const { injector } = mount(fixture('account-menu.html'));
    injector.setModel({ accounts: [] });
    expect(labels()).toEqual(['Add account']);
  });

  it('falls back to localized text matching', () => {
    mount(fixture('localized-menu-without-link.html'));
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    const logout = items.at(-1);
    if (logout === undefined) throw new Error('fixture has no items');
    expect(nativeText(logout).trim()).toBe('Se   déconnecter');
    expect(items.at(-2)?.getAttribute('data-menu-account-switcher')).toBe('item');
  });

  it('leaves menus without a "Log out" item alone', () => {
    const { onMenuOpen } = mount(fixture('unrelated-menu.html'));
    expect(document.querySelector(INJECTED_SELECTOR)).toBeNull();
    expect(onMenuOpen).not.toHaveBeenCalled();
  });

  it('notifies once per opened menu, even before a model exists', () => {
    const { injector, onMenuOpen } = mount(fixture('account-menu.html'), null);
    injector.scan();
    expect(document.querySelector(INJECTED_SELECTOR)).toBeNull();
    expect(onMenuOpen).toHaveBeenCalledTimes(1);
  });

  it('injects into menus that open later', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const injector = new MenuInjector({
      document,
      onAction: () => undefined,
      schedule: (callback) => {
        queueMicrotask(callback);
      },
    });
    injector.setModel(MODEL);
    injector.start();
    document.getElementById('root')?.insertAdjacentHTML('beforeend', fixture('account-menu.html'));
    await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    expect(labels()).toEqual(['Work', 'Home', 'Add account']);
    injector.stop();
    expect(document.querySelector(INJECTED_SELECTOR)).toBeNull();
  });

  it('never throws on invalid selectors', () => {
    document.body.innerHTML = fixture('account-menu.html');
    const injector = new MenuInjector({
      document,
      onAction: () => undefined,
      selectors: {
        menuContainers: ['[[invalid'],
        menuItems: ['[[invalid'],
        logoutItems: ['[[invalid'],
        logoutTextPatterns: [],
        separators: ['[[invalid'],
      },
    });
    expect(() => {
      injector.setModel(MODEL);
    }).not.toThrow();
  });
});
