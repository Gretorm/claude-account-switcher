# Security

## Reporting a vulnerability

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/Gretorm/claude-account-switcher/security/advisories/new), not in public issues. Include the browser, the extension version and steps to reproduce. You should get an answer within a week.

## Threat model

### What the extension stores

To switch accounts, the extension saves a copy of the claude.ai cookies of each account, including the session cookie. **A saved session gives the same access to the account as being logged in.** It is stored unencrypted in the browser's local extension storage (`storage.local`) on your device, like the browser's own cookie jar.

### What it protects against

- **Network exposure.** Sessions never leave the browser. The extension makes no network request except same-origin requests to claude.ai from the claude.ai page itself (to read the signed-in account), and sends no data to any third party. There is no analytics and no remote code.
- **Sync exposure.** Nothing is written to `storage.sync`, so sessions are not copied to other devices or to a browser vendor's sync service.
- **Web pages.** Web pages cannot message the extension (no `externally_connectable`). The background accepts messages only from its own popup and from its content script on `https://claude.ai`, and validates every payload.
- **A compromised claude.ai page.** Content scripts never receive cookie values: they only get labels, emails and status. They can switch, start a sign-in and delete an account (the in-page menu offers these, deletion after a confirmation), but renaming, reordering and settings are refused when they come from a content script.
- **Silent data loss.** The extension never overwrites a saved account unless it is certain the live session belongs to it (same session cookie, or the same unique email reported by the site for that same session). An unmatched session is saved as a new account rather than lost. A failed switch restores the previous cookies.
- **Injection.** UI is built with DOM APIs and `textContent`; no `innerHTML` with user data. In-page dialogs live in a closed shadow root.

### What it does not protect against

- **Anyone with access to your browser profile or device** (another person on an unlocked computer, malware, a backup of the profile folder) can read the stored sessions, exactly as they could read the browser's cookies.
- **Other extensions with broad permissions** (for example `cookies` and `<all_urls>`) can read claude.ai cookies directly, with or without this extension.
- **Server-side session invalidation.** If you log out of an account from claude.ai's settings ("log out of all devices") or change its password, the saved session stops working. The extension detects this and asks you to log in again.
- **Shared computers.** Do not use the extension on a computer you do not trust. Deleting an account in the extension erases its saved session; uninstalling the extension erases all of them.

### Permissions

| Permission                           | Why                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `cookies`                            | Read, clear and restore the claude.ai cookies.                                                                 |
| `storage`                            | Keep saved accounts and settings in local extension storage.                                                   |
| Host access to `https://claude.ai/*` | Required by the cookies API for claude.ai, to run the menu integration, and to find and reopen claude.ai tabs. |

The `tabs` permission is not requested: host access is enough to find claude.ai tabs.
