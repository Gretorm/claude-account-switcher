# Privacy Policy

_Last updated: 2026-10-19_

Menu Account Switcher for Claude ("the extension") is an open-source browser extension that lets you save several claude.ai sessions and switch between them. It is not affiliated with Anthropic.

## Data the extension handles

| Data                                                                        | Purpose                                          | Where it is kept                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| claude.ai cookies, including session cookies, for each account you save     | Restore that account when you switch to it       | Your browser's local extension storage, on your device |
| The labels you give to accounts                                             | Show your accounts                               | Same                                                   |
| The email address and name of each saved account, when claude.ai shows them | Tell accounts apart and show which one is active | Same                                                   |
| Your settings                                                               | Remember your preferences                        | Same                                                   |

The extension also keeps one-way fingerprints (SHA-256) of sessions whose account you deleted while using it, so that session is not saved again automatically. A fingerprint cannot be turned back into a session.

## What the extension does not do

- It does not send any data to the developers or to any third party. It has no server.
- It does not use analytics, tracking, advertising or remote code.
- It does not sync data across devices (`storage.sync` is never used).
- It does not read or modify any website other than claude.ai.
- It does not sell, share or transfer data, and does not use it for any purpose other than switching accounts.

The only network requests made because of the extension are requests from the claude.ai page to claude.ai itself, to read which account is signed in. They are the same kind of requests the claude.ai web app already makes.

## Your control

- Accounts are saved automatically while you use claude.ai. Delete a saved account (red trash icon in the claude.ai menu or the popup) to erase its stored session.
- Uninstalling the extension erases all stored data.

## Changes

Changes to this policy are published in this file, in the project's public repository.

## Contact

Open an issue at https://github.com/Gretorm/claude-account-switcher/issues.
