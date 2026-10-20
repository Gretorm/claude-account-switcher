# Decision log

Short ADR-style entries. Each records a choice made while building the extension, the alternatives, and why.

## 001. WXT, TypeScript strict, Manifest V3 everywhere

WXT builds Chrome, Edge, Firefox and Safari from one codebase. `manifestVersion: 3` is forced for every target, Firefox included (WXT defaults to MV2 there). Firefox's minimum version is 140, the first desktop release that supports `data_collection_permissions`, which AMO now requires. Chromium's minimum is 120, so cookie `partitionKey` (Chrome 119+) is always available.

Auto-imports are disabled (`imports: false`). Every import is explicit, so the core modules read as plain TypeScript and never depend on WXT conventions.

## 002. TypeScript 6.0, not 7.0

TypeScript 7.0 is the latest release, but `typescript-eslint` 8.x supports TypeScript up to 6.0 only. Type-aware linting (`no-floating-promises` and similar rules) matters more for asynchronous extension code than the newer compiler. Dependabot will offer 7.x once typescript-eslint supports it.

## 003. ESLint + Prettier rather than Biome

Biome is faster, but its type-aware rules are limited. `typescript-eslint`'s `strictTypeChecked` catches unhandled promises, unsafe `any` and unnecessary conditions, which are the bugs that matter most here. Prettier handles formatting, and `eslint-config-prettier` keeps the two from conflicting.

## 004. Vanilla TypeScript UI

The popup has one screen and the in-page UI is two dialogs and a toast. A framework would add weight and a build-time dependency for no real gain. A tiny `h()` DOM builder keeps the code readable and rules out `innerHTML`.

## 005. pnpm 10

pnpm 10 is pinned through `packageManager`. Newer majors (11, 12) exist, but pnpm 10 is mature, still maintained, and well supported by `pnpm/action-setup`. Dependabot proposes upgrades.

## 006. No `tabs` permission

Host access to `https://claude.ai/*` is enough to query claude.ai tabs by URL and read their URLs. `tabs.update`, `tabs.create` and `tabs.sendMessage` need no permission. A smaller permission list means a clearer install prompt and a faster store review.

## 007. Host permission limited to `https://claude.ai/*`

The session cookie lives on `.claude.ai`, which this permission covers. Subdomain host-only cookies (if any) are therefore out of reach. That is acceptable: they would not be part of the claude.ai session. Firefox users who did not grant host access at install get a one-click prompt in the popup.

## 008. What is in a snapshot

A snapshot holds every cookie whose domain is `claude.ai` or a subdomain, except:

- Cloudflare bot-management cookies (`cf_clearance`, `__cf_bm`, `_cfuvid`). They are bound to the device, not to the account. Restoring an old one could trigger a bot challenge, so they are left untouched.
- Cookies partitioned under another top-level site. They belong to pages that embed claude.ai, not to the claude.ai session.

## 009. Faithful cookie restoration

Host-only cookies are written without `domain`. Session cookies are written without `expirationDate`. An `unspecified` SameSite is written by omitting the field. `partitionKey` and `firstPartyDomain` are sent only on browsers that accept them: Chromium rejects unknown properties, and Safari has no partition support. Expired cookies are skipped. A write that Chromium answers with `null` counts as a failure.

## 010. Cookie store per tab

Switching applies to the cookie store of the tab the action comes from. That is the tab's `cookieStoreId` in Firefox (containers, private browsing), and the store whose `tabIds` contain the tab in Chromium (incognito). The default store is normalized to `undefined`, so `"0"` and `"firefox-default"` share one key.

## 011. Never overwrite a saved account without certainty

Before switching away, the live session is saved into the account it belongs to. That only happens when the match is certain: the same session cookie value, or an email reported by the site that exactly one saved account has. "The last account the extension switched to" is deliberately **not** a match, because the user may have signed in to another account directly on claude.ai since then. When the live session matches nothing and is signed in, it is saved as a new account (see 024).

## 012. Following session rotation

If the site replaces the session cookie, a saved snapshot would keep a value the server may have invalidated. The background listens to `cookies.onChanged`. A session cookie removed with cause `overwrite`, whose old value belongs to a saved account, has its replacement written into that account. A plain removal (logout) followed by a new cookie is not treated as rotation.

## 013. Atomic switch with rollback

A switch snapshots the live cookies first. If clearing or restoring fails, it clears again and restores the backup. If the rollback fails too, the user is told to log in again (`ROLLBACK_FAILED`). Background operations run through one serial queue, so two switches never interleave.

## 014. Detecting expired sessions

There are two signals:

1. Before switching: if every session cookie in the snapshot is past its expiration date, the switch is refused and the account is marked expired.
2. After switching: the content script probes the page. A 401/403 from the account endpoint, or landing on a login page, within two minutes of a switch marks the target expired, and the page shows a toast.

An expired account offers "Log in again". That flow clears cookies, and the next sign-in is saved automatically into the same account, after checking it is the same account. A sign-in with a different account is saved as a new account instead.

## 015. Identity detection

The content script calls `GET /api/account`, the endpoint the web app itself uses, observed to return `email_address`, `full_name` and `display_name`. The parser does not depend on the exact shape: it looks for the shallowest object with an email-like field. The fallback reads the email from the account menu header. If both fail, the user-given label is used. In Firefox the request goes through `content.fetch`, so it is made as the page.

## 016. Site storage on switch

claude.ai keeps account caches in localStorage (`rq-cache-confirmed-account*`, `__qk_hint_account*`). These keys are always removed before the page is reopened, so the app never starts with the previous account's cached identity. Clearing all localStorage and sessionStorage would also remove drafts and preferences. That is an opt-in setting (`clearSiteStorageOnSwitch`, default off).

## 017. Menu injection strategy

The account menu is recognized by its "Log out" item, which no other menu has: first `a[href="/logout"]`, then a localized text match. Injected items are shallow clones of a native item: same tag, classes and `data-cds-*` styling attributes, same icon/text slot layout. Behavior attributes (ids, `href`, test ids, ARIA state) are dropped. The highlight is mirrored with `data-highlighted`, which the native CSS styles. After an action, an Escape keydown closes the menu. A MutationObserver re-scans at most once per animation frame. Any failure is swallowed and logged in debug mode only.

The items are not part of the menu library's keyboard collection, so arrow keys skip them. Enter and Space work once they have focus. A submenu was not used, to avoid depending on the menu library's internals.

## 018. One versioned state key with migrations

All state lives in `storage.local` under `state`, with a `schemaVersion`. `migrations[n]` upgrades version n to n+1, and each step is checked. Parsing is defensive and drops malformed entries. If the stored state cannot be read at all (corrupt, or written by a newer version), it is copied to `state.unreadable.<timestamp>` before starting fresh, so nothing is silently lost.

## 019. Messaging and trust

Messages carry a channel marker and a type. Every payload is validated by the receiver. The background accepts messages only from its own extension pages and from content scripts on `https://claude.ai`. Content scripts can read state, switch, start a login, delete an account (the in-page menu offers it, after a confirmation) and report page state; renaming, reordering and settings are popup-only. Deleting is reversible by signing in again, and a compromised claude.ai page could already act on the account directly. The view state sent to the UI never includes cookies. Replies use `sendResponse` with `return true`, the one async style every target browser supports.

## 020. Firefox add-on ID

A random GUID (`{ac4f493d-6e67-4abe-9504-8fede717a9d3}`) rather than an email-style ID, so the ID carries no personal data. It must never change after the first AMO release.

## 021. Chrome Web Store API v2 with a service account

`wxt submit` (publish-browser-extension 6) supports Chrome Web Store API v1.1 (OAuth refresh token, deprecated) and v2 (service account). The release workflow uses v2. Each store step checks its secrets and skips with a notice when they are missing, so CI stays green before the store accounts exist.

## 022. GitHub Actions pinned to major tags

Actions are referenced by major version tag (`actions/checkout@v7`), and Dependabot keeps them current. Pinning to commit SHAs would be stricter. It can be adopted later if the project's supply-chain policy requires it.

## 023. Release versioning

release-please manages versions from Conventional Commits, with `bump-minor-pre-major`. The manifest starts at `0.0.0`, so the first release PR proposes `0.1.0`, matching `package.json`. WXT copies the `package.json` version into every manifest.

## 024. Automatic saving

Asking for a label and a confirmation on every new sign-in proved tedious, so signed-in sessions are saved automatically. The background does it when the page reports a signed-in state (on every claude.ai page load), and before any switch or sign-in clears the cookies. The label is the account email, or "Account N" when the site gives none; it can be renamed in the popup. An already saved session is refreshed silently; the user only sees a toast when an account is created or re-saved.

## 025. Deleting the active account

With automatic saving, deleting the account of the live session would bring it back on the next page load. The extension stores SHA-256 fingerprints of that session's cookies (never the values; at most 20) and skips automatic saving for them. A new sign-in produces a new session, which is saved again.

## 026. Page reports are tied to their session

The page report (signed-in state and email) is kept in memory per cookie store, together with the fingerprints of the session it describes. It is ignored as soon as the session changes. Otherwise a stale email could match a new session to the wrong saved account and overwrite it.

## 027. Sign-ins without a page reload

claude.ai moves from the login page to the app without reloading, so the content script's load-time report misses a fresh sign-in. Two triggers cover it: the background asks the claude.ai tabs of the store to report again whenever a session cookie appears (`cookies.onChanged`), and the in-page menu reports again each time it opens. Concurrent reports share one run.

## 028. Only session cookies can fail a switch

Firefox was seen refusing an auxiliary cookie of a Teams session, which made every switch away from that account fail and roll back. Browsers can list a cookie and then refuse to remove or write it, for reasons outside the extension's control. The cookie jar now treats only the session cookies as critical: a refused auxiliary cookie is logged (name, domain, path and the browser's reason, never the value) and the switch goes on. An operation still fails when a session cookie is refused, or when every cookie is refused.

Root cause of that case: `__ssid` has no Secure flag, so its URL was built with `http://`, which the `https://claude.ai/*` host permission does not cover; Firefox refused it. Cookie URLs now always use `https://` (the site is https-only, and a non-secure cookie can be written from an https URL). Browser error messages are also redacted, because Firefox echoes the cookie, value included, in them.

## 029. Open the target page instead of reloading

Reloading the current page after a session change made the app flash through several screens: the old page reacting to the missing session, the reloaded chat page, then a redirect. The extension now navigates the tabs directly to the page the app would end on: the login page after "Add account", the home page (`/new`) after a switch. A conversation of the previous account would not exist for the new one anyway. Both paths are in the site config.
