# Menu Account Switcher for Claude

A Claude account switcher built into the claude.ai menu. Save several Claude accounts and switch between them in one click, right from claude.ai's own account menu or from the toolbar button.

> **Unofficial.** This project is not affiliated with, endorsed by, or sponsored by Anthropic. "Claude" is a trademark of Anthropic, PBC, used here only to describe what the extension works with.

## Why this one

- **Inside the claude.ai account menu.** "Switch account" and "Add account" appear directly above "Log out", styled like the native menu items. No extra window to open.
- **One codebase for Chrome, Edge and Firefox**, built in CI for all three. Safari is available as an experimental build.
- **Open source** under the MIT license.
- **Local only.** Sessions stay in your browser's local extension storage. No server, no analytics, no remote code.

## Features

- **Automatic saving**: when you are signed in on claude.ai, the account is saved automatically under its email. No prompt, no form.
- **Add account**: signs you out (the current account stays saved) so you can sign in with another account, which is then saved automatically too.
- **Switch account**: restores a saved session and reopens your claude.ai tabs on the home page. The session you leave is saved first, so it stays current.
- **Manage accounts**: delete accounts with the red trash icon (in the menu and the popup, with a confirmation), rename and reorder them in the popup. The active account is marked.
- **Active account detection**: shows the email of the signed-in account when claude.ai provides it, and falls back to your labels otherwise.
- **Expired sessions**: when a saved session is no longer valid, the extension says so and offers to log in again; the account is then updated automatically.
- **Containers and private windows**: switching applies to the current tab's cookie store (Firefox containers, private browsing, Chromium incognito when allowed).
- **Toolbar popup**: every action is also available from the toolbar button, which keeps working if claude.ai changes its menu.

## Install

The store listings are not published yet. Until then, build the extension (see below) or download a zip from a [GitHub Release](https://github.com/Gretorm/claude-account-switcher/releases) and load it unpacked:

| Browser | Steps                                                                                                                                                                            |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chrome  | Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, select `.output/chrome-mv3`.                                                                    |
| Edge    | Open `edge://extensions`, turn on **Developer mode**, click **Load unpacked**, select `.output/edge-mv3`.                                                                        |
| Firefox | Open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on…**, select `.output/firefox-mv3/manifest.json`. Temporary add-ons are removed when Firefox restarts. |
| Safari  | Experimental, see [docs/SAFARI.md](docs/SAFARI.md).                                                                                                                              |

On Firefox, if the popup asks for access to claude.ai, click **Allow access to claude.ai**.

## Usage

1. Sign in to claude.ai with your first account: it is saved automatically.
2. Open the claude.ai account menu (or the toolbar button) and choose **Add account**: you are signed out.
3. Sign in with your second account: it is saved automatically too.
4. From now on, pick an account under **Switch account** to switch, or click the red trash icon to delete one.

## Development

Requirements: Node.js 24 (see `.nvmrc`) and pnpm (the version is pinned in `package.json`; `corepack enable` installs it).

```bash
pnpm install
```

| Command                                           | What it does                                                |
| ------------------------------------------------- | ----------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:firefox` / `pnpm dev:edge` | Starts a browser with the extension and live reload.        |
| `pnpm build:all`                                  | Builds every target into `.output/`.                        |
| `pnpm zip:all`                                    | Builds and zips every target, plus the Firefox sources zip. |
| `pnpm check`                                      | Lint, format check, typecheck and unit tests.               |
| `pnpm icons`                                      | Regenerates the PNG icons from `assets/*.svg`.              |

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions.

## Architecture

```
src/
  entrypoints/      thin WXT entrypoints: background, content script, popup
  background/       wiring: message router, tab side effects, badge
  content/          menu injector, page probe, in-page dialogs, storage clearing
  popup/            popup UI (vanilla TypeScript)
  core/
    site-config/    every claude.ai-specific value, in one module
    cookies/        snapshot model, serialization, cookie jar, cookie stores
    accounts/       versioned state, migrations, repository over storage.local
    switcher/       add / switch / refresh / rollback service, session matching
    identity/       defensive parsing of the signed-in identity
  shared/           typed messaging contracts, validation, errors, logging
```

- The **background** is the only context that touches cookies and storage. The content script and the popup send it typed, validated messages. Content scripts never receive cookie values.
- A **switch** works like this: save the live session (into its account when the extension is certain which one it is, as a new account otherwise), clear the claude.ai cookies, restore the target snapshot, clear the account caches in the page, then open the claude.ai home page in its tabs (the login page after "Add account"). Opening the page directly avoids the flashes of reloading a page the app would redirect. If any cookie write fails, the previous cookies are restored.
- **Core modules are framework-agnostic.** Browser APIs are injected behind small interfaces, which keeps them unit-tested with fakes (`tests/`).
- **All claude.ai internals** (cookie names, endpoint, menu selectors) live in [`src/core/site-config`](src/core/site-config/index.ts). When claude.ai changes, that is the only file to update.

Design decisions are recorded in [docs/DECISIONS.md](docs/DECISIONS.md).

## Limitations

- claude.ai is not a public API. A change on the site can break the menu integration (the popup keeps working) or, more rarely, session detection. See [docs/MANUAL_VERIFICATION.md](docs/MANUAL_VERIFICATION.md).
- The menu items work with the mouse and with Enter/Space once focused, but the menu's arrow-key navigation skips them.
- A saved session is a copy of your login cookies. Anyone with access to your browser profile can use it, like the original session. See [SECURITY.md](SECURITY.md).
- If you sign in to another account directly on claude.ai (without the extension), that session is saved as a new account. The extension never overwrites a saved account it cannot match with certainty.
- If you delete the account you are signed in with, that session is not saved again automatically. Sign in again to add the account back.
- Safari support is experimental and untested.

## Privacy

The extension stores your saved sessions only in your browser's local extension storage, and only talks to claude.ai. See [PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE)
