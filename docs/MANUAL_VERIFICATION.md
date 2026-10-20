# Manual verification

claude.ai has no public API for any of this. Every site-specific value is in [`src/core/site-config/index.ts`](../src/core/site-config/index.ts), marked `OBSERVED` (checked on the live site) or `VERIFY` (an unconfirmed default). Re-run this checklist before each release and whenever users report breakage.

## Observed on the live site (2026-10-19, French UI)

- [x] `GET /api/account` returns 200 when signed in, with top-level `email_address`, `full_name` and `display_name`.
- [x] The account menu is `[role="menu"]`, with items `[role="menuitem"]` and separators `[role="separator"]`.
- [x] "Log out" is `a[role="menuitem"][href="/logout"]`, the last item; its label is localized ("Se déconnecter").
- [x] Items are "icon slot + text slot" and are highlighted through `data-highlighted`.
- [x] The menu header `[data-testid="user-menu-header"]` shows the account email.
- [x] Escape (keydown on `document`) closes the menu.
- [x] localStorage holds account caches: `rq-cache-confirmed-account`, `rq-cache-confirmed-account-session`, `__qk_hint_account_uuid`.

## To verify (could not be tested without two accounts and a loaded build)

Use two test accounts, with **Debug logging** turned on in the popup settings.

### Cookies

- [ ] The session cookie is named `sessionKey`, on domain `.claude.ai`, `httpOnly`. (DevTools → Application → Cookies.) If not, update `sessionCookieNames`.
- [ ] No other cookie is required for a session to work after a restore (for example an org or device cookie that must match).
- [ ] Leaving Cloudflare cookies (`cf_clearance`, `__cf_bm`, `_cfuvid`) untouched does not trigger a challenge after a switch.
- [ ] Whether the site rotates `sessionKey` during normal use (watch its value over a day). Rotation is handled, but confirming it validates the approach.

### End-to-end flows (Chrome, Edge and Firefox)

- [ ] On first load of claude.ai, the signed-in account is saved automatically (toast "Account … saved").
- [ ] "Add account" from the menu: you are signed out and land on the login page.
- [ ] Sign in with the second account: it is saved automatically (toast).
- [ ] Red trash in the menu and in the popup: the confirmation appears and deleting removes the account. Deleting the active account does not re-save it when the page is reloaded; signing in again does.
- [ ] "Add account" goes straight to the login page, without flashes of the chat page.
- [ ] Switch from the menu: the tab opens the home page signed in as the other account, the menu header shows the right email, and recent chats belong to that account.
- [ ] Switch back and forth several times; both sessions keep working.
- [ ] Switch from the popup while the active tab is not claude.ai: claude.ai tabs open the home page (or one opens).
- [ ] With two claude.ai tabs open, both switch to the new account.
- [ ] Rename, reorder and delete in the popup; the menu reflects the changes when reopened.
- [ ] Failure path: in DevTools, block `claude.ai` cookies or edit a saved snapshot to an invalid value, then switch. The page should report an expired session, and after "Log in again" the account should be updated automatically.
- [ ] Log out of one account from claude.ai's settings ("log out of all sessions"), then switch to it: it is marked expired and the guidance appears.
- [ ] Firefox containers: in a container tab, switch accounts. Only that container changes.
- [ ] Firefox: on install, check whether access to claude.ai was granted; if not, the popup's "Allow access" button grants it.
- [ ] The injected items look native (spacing, hover, dark mode) in the menu, in English and in at least one other language.
- [ ] After a switch, the app shows no stale data from the previous account (name, plan, organization). If it does, find the localStorage key and add it to `accountCacheStorageKeys`, or consider turning `clearSiteStorageOnSwitch` on by default.

### Safari (optional, experimental)

- [ ] Follow [SAFARI.md](SAFARI.md) and check whether the session cookie can be read and restored.
