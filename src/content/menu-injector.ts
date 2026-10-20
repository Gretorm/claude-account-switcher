import { siteConfig, type MenuSelectors } from '../core/site-config';
import { silentLogger, type Logger } from '../shared/logger';
import { INJECTED_ATTRIBUTE, INJECTED_SELECTOR, nativeText } from './markers';

const SLOT_ATTRIBUTE = `${INJECTED_ATTRIBUTE}-slot`;
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHECK_ICON = 'M5 12l5 5 9-10';
const PLUS_ICON = 'M12 5v14M5 12h14';
const TRASH_ICON = 'M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 13h10l1-13';
const DANGER_COLOR = '#dc2626';

export interface MenuAccount {
  id: string;
  label: string;
  /** Secondary line, usually the email. */
  detail?: string;
  active: boolean;
  expired: boolean;
}

export interface MenuModel {
  accounts: MenuAccount[];
}

export type MenuAction =
  { type: 'switch'; accountId: string } | { type: 'delete'; accountId: string } | { type: 'add' };

export interface MenuInjectorOptions {
  document: Document;
  onAction: (action: MenuAction) => void;
  /** Called once per newly opened account menu, e.g. to refresh the model. */
  onMenuOpen?: () => void;
  selectors?: MenuSelectors;
  logger?: Logger;
  /** Batches DOM scans; defaults to requestAnimationFrame. */
  schedule?: (callback: () => void) => void;
}

/** Styling attributes copied from the native item; behavior attributes are dropped. */
function isStylingAttribute(name: string): boolean {
  return name === 'class' || name === 'style' || name.startsWith('data-cds-');
}

/**
 * Inserts the account switcher into the site's own account menu, directly
 * above "Log out". It never throws: when the menu cannot be recognized it does
 * nothing, and the toolbar popup remains available.
 */
export class MenuInjector {
  private readonly document: Document;
  private readonly selectors: MenuSelectors;
  private readonly logger: Logger;
  private readonly schedule: (callback: () => void) => void;
  private readonly seenMenus = new WeakSet<Element>();
  private observer: MutationObserver | undefined;
  private scanScheduled = false;
  private model: MenuModel | undefined;

  constructor(private readonly options: MenuInjectorOptions) {
    this.document = options.document;
    this.selectors = options.selectors ?? siteConfig.menu;
    this.logger = options.logger ?? silentLogger;
    this.schedule =
      options.schedule ??
      ((callback) => {
        requestAnimationFrame(callback);
      });
  }

  start(): void {
    if (this.observer !== undefined) return;
    const view = this.document.defaultView;
    if (view === null) return;
    this.observer = new view.MutationObserver(() => {
      this.requestScan();
    });
    this.observer.observe(this.document.documentElement, { childList: true, subtree: true });
    this.scan();
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    for (const node of this.document.querySelectorAll(INJECTED_SELECTOR)) node.remove();
  }

  /** Replaces the menu content, re-rendering any open menu. */
  setModel(model: MenuModel): void {
    this.model = model;
    for (const node of this.document.querySelectorAll(INJECTED_SELECTOR)) node.remove();
    this.scan();
  }

  /** Finds open account menus and injects into those not handled yet. */
  scan(): void {
    try {
      for (const menu of this.findMenus()) {
        if (menu.querySelector(INJECTED_SELECTOR) !== null) continue;
        const logout = this.findLogoutItem(menu);
        if (logout === undefined) continue;
        if (!this.seenMenus.has(menu)) {
          this.seenMenus.add(menu);
          this.options.onMenuOpen?.();
        }
        if (this.model !== undefined) this.inject(menu, logout, this.model);
      }
    } catch (error) {
      this.logger.debug('Menu injection skipped', error);
    }
  }

  private requestScan(): void {
    if (this.scanScheduled) return;
    this.scanScheduled = true;
    this.schedule(() => {
      this.scanScheduled = false;
      this.scan();
    });
  }

  private findMenus(): Element[] {
    const menus = new Set<Element>();
    for (const selector of this.selectors.menuContainers) {
      for (const menu of safeQueryAll(this.document, selector)) menus.add(menu);
    }
    return [...menus];
  }

  /** Direct selectors first, then the text of the menu items as a last resort. */
  findLogoutItem(menu: Element): HTMLElement | undefined {
    for (const selector of this.selectors.logoutItems) {
      const match = safeQueryAll(menu, selector).find((element) => !isInjected(element));
      if (match instanceof HTMLElement) return match;
    }
    for (const item of this.menuItems(menu)) {
      const text = normalizeText(nativeText(item));
      if (this.selectors.logoutTextPatterns.some((pattern) => pattern.test(text))) return item;
    }
    return undefined;
  }

  private menuItems(menu: Element): HTMLElement[] {
    return this.selectors.menuItems
      .flatMap((selector) => safeQueryAll(menu, selector))
      .filter((item): item is HTMLElement => item instanceof HTMLElement && !isInjected(item));
  }

  /** The native item right before "Log out" gives the most neutral styling. */
  private findTemplate(menu: Element, logout: HTMLElement): HTMLElement {
    let template: HTMLElement | undefined;
    for (const item of this.menuItems(menu)) {
      if (item === logout || item.contains(logout)) continue;
      if (item.compareDocumentPosition(logout) & Node.DOCUMENT_POSITION_FOLLOWING) template = item;
    }
    return template ?? logout;
  }

  private inject(menu: Element, logout: HTMLElement, model: MenuModel): void {
    const parent = logout.parentElement;
    if (parent === null) return;
    const template = this.findTemplate(menu, logout);
    const group = this.document.createElement('div');
    group.setAttribute(INJECTED_ATTRIBUTE, 'group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Switch account');
    group.style.display = 'contents';

    if (model.accounts.length > 0) {
      const heading = this.createItem(template, 'Switch account');
      heading.setAttribute('role', 'presentation');
      heading.removeAttribute('tabindex');
      heading.style.opacity = '0.6';
      heading.style.fontSize = '0.85em';
      heading.style.pointerEvents = 'none';
      group.append(heading);
    }
    for (const account of model.accounts) {
      group.append(this.createAccountItem(template, account));
    }
    const add = this.createActionItem(template, 'Add account', { type: 'add' });
    this.setSlotIcon(add, PLUS_ICON);
    group.append(add);

    parent.insertBefore(group, logout);
    const separator = this.selectors.separators
      .flatMap((selector) => safeQueryAll(menu, selector))
      .find((element) => !isInjected(element));
    if (separator !== undefined) {
      const clone = separator.cloneNode(false) as Element;
      clone.setAttribute(INJECTED_ATTRIBUTE, 'separator');
      parent.insertBefore(clone, logout);
    }
    this.logger.debug('Injected the account switcher into the menu');
  }

  private createAccountItem(template: HTMLElement, account: MenuAccount): HTMLElement {
    const item = this.createItem(template, account.label, account.detail);
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(account.active));
    item.dataset.accountId = account.id;
    if (account.active) {
      const icon = item.querySelector(`[${SLOT_ATTRIBUTE}="icon"]`);
      if (icon === null) item.prepend(this.decoration('✓ '));
      else this.setSlotIcon(item, CHECK_ICON);
    }
    if (account.expired) {
      item.querySelector(`[${SLOT_ATTRIBUTE}="text"]`)?.append(this.decoration(' (expired)'));
      item.title = 'Session expired: select to log in again';
    }
    const remove: MenuAction = { type: 'delete', accountId: account.id };
    item.append(this.createDeleteButton(account.label, remove));
    this.bindActivation(item, { type: 'switch', accountId: account.id });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Delete') this.trigger(event, remove);
    });
    return item;
  }

  /** A small red trash button at the right end of an account item. */
  private createDeleteButton(label: string, action: MenuAction): HTMLElement {
    const button = this.document.createElement('span');
    button.setAttribute(SLOT_ATTRIBUTE, 'delete');
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', `Delete ${label}`);
    button.title = 'Delete';
    Object.assign(button.style, {
      display: 'inline-flex',
      flex: 'none',
      marginLeft: 'auto',
      padding: '2px',
      borderRadius: '4px',
      color: DANGER_COLOR,
      opacity: '0.75',
      cursor: 'pointer',
    });
    button.append(this.createIcon(TRASH_ICON, 14));
    button.addEventListener('pointerenter', () => {
      button.style.opacity = '1';
    });
    button.addEventListener('pointerleave', () => {
      button.style.opacity = '0.75';
    });
    // Handled before the item's own click, which would switch accounts.
    button.addEventListener('click', (event) => {
      this.trigger(event, action);
    });
    return button;
  }

  private createActionItem(template: HTMLElement, text: string, action: MenuAction): HTMLElement {
    const item = this.createItem(template, text);
    this.bindActivation(item, action);
    return item;
  }

  /** A shallow clone of a native item: same tag and classes, none of its behavior. */
  private createItem(template: HTMLElement, text: string, detail?: string): HTMLElement {
    const item = template.cloneNode(false) as HTMLElement;
    for (const attribute of [...item.attributes]) {
      if (!isStylingAttribute(attribute.name)) item.removeAttribute(attribute.name);
    }
    item.setAttribute(INJECTED_ATTRIBUTE, 'item');
    item.setAttribute('role', 'menuitem');
    item.tabIndex = -1;
    if (item instanceof HTMLButtonElement) item.type = 'button';

    // Native items are "icon slot + text slot"; mirror that layout when present.
    const [iconSlot, textSlot] = [...template.children];
    if (iconSlot !== undefined && textSlot !== undefined) {
      const icon = iconSlot.cloneNode(false) as HTMLElement;
      icon.setAttribute(SLOT_ATTRIBUTE, 'icon');
      icon.setAttribute('aria-hidden', 'true');
      item.append(icon);
    }
    const label =
      textSlot === undefined
        ? this.document.createElement('span')
        : (textSlot.cloneNode(false) as HTMLElement);
    label.setAttribute(SLOT_ATTRIBUTE, 'text');
    label.textContent = text;
    if (detail !== undefined && detail !== text) {
      const secondary = this.document.createElement('span');
      secondary.textContent = ` ${detail}`;
      secondary.style.opacity = '0.65';
      secondary.style.fontSize = '0.85em';
      label.append(secondary);
    }
    item.append(label);
    return item;
  }

  /** Draws a stroke icon in the item's icon slot, when the native layout has one. */
  private setSlotIcon(item: HTMLElement, path: string): void {
    const slot = item.querySelector(`[${SLOT_ATTRIBUTE}="icon"]`);
    slot?.replaceChildren(this.createIcon(path, 16));
  }

  private createIcon(path: string, size: number): SVGSVGElement {
    const svg = this.document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const shape = this.document.createElementNS(SVG_NS, 'path');
    shape.setAttribute('d', path);
    svg.append(shape);
    return svg;
  }

  private decoration(text: string): HTMLElement {
    const span = this.document.createElement('span');
    span.setAttribute('aria-hidden', 'true');
    span.textContent = text;
    return span;
  }

  private trigger(event: Event, action: MenuAction): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeMenu();
    this.options.onAction(action);
  }

  private bindActivation(item: HTMLElement, action: MenuAction): void {
    item.addEventListener('click', (event) => {
      this.trigger(event, action);
    });
    item.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') this.trigger(event, action);
    });
    // Mirror the hover/focus highlight that the site applies to its own items.
    const highlight = (on: boolean) => () => {
      if (on) item.setAttribute('data-highlighted', '');
      else item.removeAttribute('data-highlighted');
    };
    item.addEventListener('pointerenter', highlight(true));
    item.addEventListener('pointerleave', highlight(false));
    item.addEventListener('focus', highlight(true));
    item.addEventListener('blur', highlight(false));
  }

  /** Menus built on common UI libraries close on Escape. */
  private closeMenu(): void {
    this.document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
    );
  }
}

function isInjected(element: Element): boolean {
  return element.closest(INJECTED_SELECTOR) !== null;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function safeQueryAll(root: ParentNode, selector: string): Element[] {
  try {
    return [...root.querySelectorAll(selector)];
  } catch {
    return [];
  }
}
