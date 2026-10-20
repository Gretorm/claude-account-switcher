# Plan — Menu Account Switcher for Claude

A cross-browser (Chrome, Edge, Firefox; Safari experimental) Manifest V3 extension
that saves claude.ai sessions as cookie snapshots and switches between them, from
the toolbar popup or from inside claude.ai's own account menu.

## Architecture

```
            ┌────────────────────┐   typed messages    ┌──────────────────────────┐
 popup  ───►│ shared/messaging   │◄───────────────────►│ background (service)     │
 content ──►│ request/response    │                     │  └─ core/switcher        │
            └────────────────────┘                     │      ├─ core/cookies     │
                    ▲                                  │      ├─ core/accounts    │
                    │ tabs.sendMessage                 │      └─ core/site-config │
            ┌───────┴───────────┐                      └──────────────────────────┘
            │ content script    │
            │  ├─ menu-injector │  (MutationObserver, resilient selectors)
            │  ├─ page-probe    │  (active account detection)
            │  └─ dialog/toast  │  (shadow-DOM UI)
            └───────────────────┘
```

- **Entrypoints are thin.** `background.ts`, `content.ts` and `popup/main.ts` only
  wire browser APIs to core services.
- **Core modules are framework-agnostic.** They never import `wxt` or touch the
  global `browser`. Browser APIs are injected behind small interfaces, so every
  module is unit-tested with fakes.
- **Everything claude.ai-specific lives in `src/core/site-config`.** Cookie names,
  endpoints, paths and menu selectors are listed there, each marked as needing
  manual verification.

## File tree

```
src/
  entrypoints/
    background.ts            wiring: message router, service instances
    content.ts               wiring: menu injector, page probe, storage clearing
    popup/                   index.html, main.ts, style.css
  core/
    site-config/             all claude.ai-specific values (single module)
    cookies/                 snapshot model, serialization, adapter, store resolver
    accounts/                schema, migrations, repository over storage.local
    switcher/                add / switch / refresh / rollback service, session matching
    identity/                defensive parsing of account identity (JSON, DOM text)
  content/
    menu-injector.ts         finds the account menu and inserts our items
    page-probe.ts            detects signed-in state and identity in the page
    ui.ts                    shadow-DOM dialog and toast
  shared/
    messaging.ts             typed message contracts and helpers
    errors.ts                typed error codes shared across contexts
    logger.ts                debug-only logging
  popup/                     popup view logic (rendering, actions)
tests/                       Vitest unit tests + HTML fixtures
scripts/                     icon generation
assets/                      icon SVG source, store graphics
docs/                        DECISIONS.md, PUBLISHING.md, SAFARI.md, STORE_LISTING.md
.github/                     CI, release, templates, Dependabot
```

## Milestones

1. **Scaffold**: WXT + TypeScript strict, pnpm, ESLint + Prettier, Vitest, Node pin,
   manifest for every browser.
2. **Core**: site config, cookie serialization and adapter, accounts repository with
   migrations, switcher service with rollback. Unit tests for all of them.
3. **Entrypoints**: background router, content script (menu injection, page probe,
   storage clearing, session-expired guidance), popup.
4. **Assets and docs**: original icon (SVG + PNG), README, LICENSE, CONTRIBUTING,
   SECURITY, PRIVACY, store listing, Safari notes, publishing guide, templates.
5. **CI/CD**: CI on PR/push (lint, typecheck, test, build and zip all targets,
   upload artifacts); release-please on main; release job that zips, attaches to the
   GitHub Release and submits to the stores, skipping cleanly when secrets are missing.
6. **Verification**: lint, typecheck, test, build every target; final report.

After each milestone: `pnpm lint && pnpm typecheck && pnpm test && pnpm build:all`.
