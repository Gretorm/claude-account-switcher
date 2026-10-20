/**
 * Every value that depends on claude.ai internals lives in this module.
 *
 * None of these values are documented by Anthropic and any of them can change
 * without notice. Values marked `VERIFY` are unconfirmed defaults; values
 * marked `OBSERVED` were checked against the live site (see
 * docs/MANUAL_VERIFICATION.md for the checklist). The rest of the extension
 * only reads them from here and degrades gracefully when they turn out to be
 * wrong.
 */

export interface MenuSelectors {
  /** Candidate containers for an open dropdown menu. Tried in order. */
  readonly menuContainers: readonly string[];
  /** Interactive items inside a menu container. */
  readonly menuItems: readonly string[];
  /** Direct selectors for the "Log out" item. Tried before text matching. */
  readonly logoutItems: readonly string[];
  /** Last-resort text match for the "Log out" item (normalized text content). */
  readonly logoutTextPatterns: readonly RegExp[];
  /** Separators inside a menu, cloned to visually group the injected items. */
  readonly separators: readonly string[];
}

export interface SiteConfig {
  /** Origin of the web app. */
  readonly origin: string;
  /** Match pattern used for host permissions, tab queries and content scripts. */
  readonly matchPattern: string;
  /** Registrable domain whose cookies make up a session snapshot. */
  readonly cookieDomain: string;
  /**
   * VERIFY: cookies that carry the authenticated session. Used to tell whether
   * the user is signed in, to match a live session to a saved account, and to
   * detect expired snapshots. When none is found the extension falls back to
   * what the page reports.
   */
  readonly sessionCookieNames: readonly string[];
  /**
   * Device-scoped cookies that are left untouched on switch: they are neither
   * cleared nor restored. These are Cloudflare bot-management cookies, which are
   * bound to the browser rather than to the account.
   */
  readonly preservedCookieNames: readonly string[];
  /**
   * OBSERVED: same-origin JSON endpoints the web app itself calls, which return
   * the signed-in account (`/api/account` has `email_address`, `full_name` and
   * `display_name`). Tried in order; any failure falls back to the DOM and then
   * to the user-given label.
   */
  readonly accountEndpoints: readonly string[];
  /** VERIFY: path prefixes of the sign-in pages (a signed-out user lands here). */
  readonly loginPaths: readonly string[];
  /**
   * OBSERVED: pages opened after a session change. Opening them directly avoids
   * the flashes of reloading the current page, which the app would redirect.
   */
  readonly pages: { readonly login: string; readonly home: string };
  /** OBSERVED: selectors of the account menu, see MenuSelectors. */
  readonly menu: MenuSelectors;
  /**
   * OBSERVED: elements whose text contains the signed-in email (the account
   * menu header), used as a DOM fallback when no endpoint answers.
   */
  readonly identityTextSelectors: readonly string[];
  /**
   * OBSERVED: localStorage keys that cache the signed-in account. They are
   * always removed on switch, so the app never starts with the previous
   * account's cached identity. Clearing all site storage is a separate,
   * opt-in setting.
   */
  readonly accountCacheStorageKeys: readonly RegExp[];
}

export const siteConfig: SiteConfig = {
  origin: 'https://claude.ai',
  matchPattern: 'https://claude.ai/*',
  cookieDomain: 'claude.ai',
  sessionCookieNames: ['sessionKey'],
  preservedCookieNames: ['cf_clearance', '__cf_bm', '_cfuvid'],
  accountEndpoints: ['/api/account'],
  loginPaths: ['/login', '/logout'],
  pages: { login: '/login', home: '/new' },
  menu: {
    menuContainers: ['[role="menu"]'],
    menuItems: ['[role="menuitem"]'],
    logoutItems: ['a[href="/logout"]', 'a[href$="/logout"]', '[data-testid*="logout" i]'],
    // The menu is localized; these cover the most common UI languages.
    logoutTextPatterns: [
      /^(log ?out|sign ?out)$/i,
      /^(se déconnecter|déconnexion)$/i,
      /^(abmelden|ausloggen)$/i,
      /^(cerrar sesión|sair|terminar sessão|esci|disconnetti|uitloggen|afmelden)$/i,
      /^(ログアウト|로그아웃|退出登录|登出|выйти)$/i,
    ],
    separators: ['[role="separator"]'],
  },
  identityTextSelectors: ['[data-testid="user-menu-header"]'],
  accountCacheStorageKeys: [/^rq-cache-confirmed-account/, /^__qk_hint_account/],
};

/** True when a cookie domain (with or without leading dot) belongs to the site. */
export function isSiteCookieDomain(domain: string, config: SiteConfig = siteConfig): boolean {
  const bare = domain.replace(/^\./, '').toLowerCase();
  const site = config.cookieDomain.toLowerCase();
  return bare === site || bare.endsWith(`.${site}`);
}

/** True when a URL points at the web app. */
export function isSiteUrl(url: string | undefined, config: SiteConfig = siteConfig): boolean {
  if (url === undefined) return false;
  try {
    return new URL(url).origin === config.origin;
  } catch {
    return false;
  }
}

/** True when a pathname is one of the sign-in pages. */
export function isLoginPath(pathname: string, config: SiteConfig = siteConfig): boolean {
  return config.loginPaths.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
