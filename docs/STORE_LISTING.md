# Store listing (draft)

Use the same text on the Chrome Web Store, Firefox Add-ons and Edge Add-ons.

## Name

Menu Account Switcher for Claude

## Summary (max 132 characters)

Claude account switcher built into the claude.ai menu. Switch accounts in one click. Open source, Chrome, Edge & Firefox.

## Category

Productivity (Chrome, Edge) · Tabs / Productivity (Firefox: "Other" if neither fits)

## Description

Menu Account Switcher for Claude adds account switching to the claude.ai account menu itself. Save your work and personal accounts once, then switch between them in one click, without logging out and back in.

**How it works**

- Open the claude.ai account menu: "Switch account" and "Add account" appear right above "Log out", styled like the rest of the menu.
- Accounts are saved automatically while you use claude.ai. "Add account" signs you out so you can sign in with another one, which is saved too.
- Pick an account to switch. Your claude.ai tabs reopen with that account. The account you leave is saved first, so it stays up to date.
- Everything is also available from the toolbar button.

**Features**

- Switch from inside claude.ai's own account menu, or from the toolbar.
- Delete accounts with the red trash icon, rename and reorder them from the toolbar. The active account is marked.
- Shows the email of each account when claude.ai provides it.
- Detects expired sessions and guides you through logging in again.
- Works per container in Firefox and per incognito session in Chromium browsers.

**Private by design**

- Your sessions stay in your browser's local storage. Nothing is sent to any server.
- No analytics, no tracking, no remote code.
- Open source (MIT): https://github.com/Gretorm/claude-account-switcher

**Good to know**

A saved session gives the same access as being logged in. Only use the extension on a computer you trust.

Unofficial extension, not affiliated with, endorsed by, or sponsored by Anthropic. Claude is a trademark of Anthropic, PBC.

## Permission justifications (Chrome / Edge privacy tab)

- **Single purpose**: save several claude.ai sessions and switch between them.
- **cookies**: read, clear and restore claude.ai cookies to switch accounts.
- **storage**: keep saved accounts and settings locally.
- **Host permission (claude.ai)**: required to access claude.ai cookies, add the switcher to the claude.ai account menu, and reopen claude.ai tabs after a switch.
- **Remote code**: none.
- **Data usage**: the extension stores authentication information (session cookies) locally only, to provide its single purpose. It does not sell, transfer or use data for unrelated purposes.

## Graphics

| Asset                           | File                                  |
| ------------------------------- | ------------------------------------- |
| Store icon 128×128              | `assets/store/icon-128.png`           |
| Edge logo 300×300               | `assets/store/edge-logo-300.png`      |
| Chrome small promo tile 440×280 | `assets/store/promo-tile-440x280.png` |

## Screenshots to capture (1280×800, no real email or chat content)

Use a test account and blur or replace any personal data.

1. The claude.ai account menu, open, with "Switch account" listing two accounts and "Add account" above "Log out".
2. The toolbar popup with two saved accounts, one marked active.
3. The "Account saved" notice after signing in with a second account.
4. The popup with an account marked "Expired" and the guidance shown.
5. The popup settings section expanded.
