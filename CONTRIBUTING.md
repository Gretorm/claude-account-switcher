# Contributing

Thanks for helping! Bug reports, fixes for claude.ai changes and improvements are all welcome.

## Setup

```bash
corepack enable   # installs the pinned pnpm version
pnpm install
pnpm dev          # Chrome; or pnpm dev:firefox / pnpm dev:edge
```

Node.js 24 is required (`.nvmrc`).

## Before opening a pull request

```bash
pnpm check        # lint, format check, typecheck, unit tests
pnpm build:all    # every browser target builds
```

CI runs the same commands and must be green.

## Conventions

- **Conventional Commits** for commit messages and PR titles (`feat:`, `fix:`, `docs:`, `chore:`, …). They drive the changelog and version bumps through release-please.
- **TypeScript strict mode.** No `any`; justify any type assertion in a comment.
- **Keep entrypoints thin.** Logic goes into `src/core` (framework-agnostic, no `wxt` import, no global `browser`) and gets unit tests in `tests/`.
- **claude.ai internals go in `src/core/site-config` only.** Mark each value `VERIFY` or `OBSERVED`, and update [docs/MANUAL_VERIFICATION.md](docs/MANUAL_VERIFICATION.md).
- **No new permission, network destination or remote code** without discussing it first in an issue. Data stays in `storage.local`.
- Record significant design choices in [docs/DECISIONS.md](docs/DECISIONS.md).

## Upgrading Node.js

The project runs on the current Node.js LTS (`.nvmrc`). Node.js only builds and tests the extension; it is not part of what ships to browsers. Dependabot ignores major `@types/node` updates, because the typings must describe the Node version actually used, not the latest one.

When a new even-numbered Node.js release becomes LTS, upgrade everything in one commit:

1. `.nvmrc`: the new major version.
2. `package.json`: `engines.node`, and `@types/node` to the same major (`pnpm add -D @types/node@<major>`).
3. `.github/dependabot.yml`: keep the `@types/node` ignore rule (it applies to the next major).
4. Run `pnpm check` and `pnpm build:all` on the new version.

## Fixing a broken menu integration

1. Open claude.ai with the extension loaded and turn on **Debug logging** in the popup settings.
2. Open the account menu and check the console for `[Menu Account Switcher:content]` lines.
3. Update the selectors in `src/core/site-config/index.ts` and the fixture in `tests/fixtures/account-menu.html`, then run `pnpm test`.

Never paste cookie values or session data in issues, pull requests or test fixtures.
