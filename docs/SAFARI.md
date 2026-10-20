# Safari (experimental)

Safari support is **experimental and untested**. The Safari build is produced in CI, but no release depends on it and nothing is published to the App Store automatically.

## Build and convert

Requirements: a Mac with Xcode, and an Apple Developer account to distribute (not needed for local testing).

```bash
pnpm install
pnpm build:safari
xcrun safari-web-extension-converter .output/safari-mv3 \
  --project-location ./safari-xcode \
  --app-name "Menu Account Switcher for Claude" \
  --bundle-identifier <your.reverse.domain>.menu-account-switcher \
  --macos-only
```

Then, in Xcode:

1. Open the generated project and pick your team under **Signing & Capabilities** for both targets (app and extension).
2. Run the app once. In Safari, open **Settings → Advanced** and enable **Show features for web developers**, then **Develop → Allow Unsigned Extensions** for local testing.
3. Enable the extension in **Safari → Settings → Extensions**, and grant it access to `claude.ai`.

## Known limitations

These come from Safari's implementation of the WebExtension APIs. Verify them on the Safari version you target:

- **Cookie partitioning is not supported**: the build disables `partitionKey`, so partitioned cookies are neither saved nor restored.
- **The cookies API has historically been incomplete in Safari** (for example around `httpOnly` cookies, `cookies.onChanged`, and `getAllCookieStores`). If the session cookie cannot be read or written, switching will not work.
- **Website access is granted per site by the user**, and Safari may ask again later.
- Safari's privacy features (Intelligent Tracking Prevention) may expire or limit cookies set by extensions.

## Publishing

App Store distribution is manual: archive the app in Xcode, upload it with Xcode or Transporter, and submit it in App Store Connect. It needs a paid Apple Developer Program membership.
