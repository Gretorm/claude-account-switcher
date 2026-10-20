# Publishing

Releases are automated:

1. Commits on `main` follow Conventional Commits.
2. The **Release** workflow runs release-please, which keeps a release PR open with the next version and the changelog.
3. Merging that PR creates a GitHub Release. The workflow then builds and zips every target (with the Firefox sources zip), attaches the zips to the release, and submits to each store with `wxt submit`.

Each store step **skips with a notice** when its secrets are missing, so you can set up the stores one at a time.

## One-time repository setup

- **Settings → Actions → General → Workflow permissions**: enable **Allow GitHub Actions to create and approve pull requests** (release-please needs it).
- Optional, recommended: create a fine-grained personal access token with **Contents: read and write** and **Pull requests: read and write** on this repository, and save it as the secret `RELEASE_PLEASE_TOKEN`. Pull requests opened with the default `GITHUB_TOKEN` do not trigger CI, so without this token the release PR shows no checks.

Add secrets under **Settings → Secrets and variables → Actions → New repository secret**.

The very first version must be uploaded to each store **by hand** (Chrome and Edge need an existing item to get its ID; AMO accepts API uploads for new add-ons, but a manual first listing lets you fill in the store page). Upload the zips from the first GitHub Release, then add the secrets for automatic updates.

## Chrome Web Store

| Secret                                | Value                                                                                                       |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `CHROME_EXTENSION_ID`                 | The 32-letter item ID, shown in the developer dashboard after the first upload.                             |
| `CHROME_PUBLISHER_ID`                 | Your publisher ID, shown in the developer dashboard (Account section / URL).                                |
| `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | The service account's email address.                                                                        |
| `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY`  | The service account's private key (the `private_key` field of its JSON key, including the BEGIN/END lines). |

Steps:

1. Register as a Chrome Web Store developer at https://chrome.google.com/webstore/devconsole (one-time fee).
2. Upload `claude-account-switcher-<version>-chrome.zip` manually, fill in the listing (see [STORE_LISTING.md](STORE_LISTING.md)), the privacy tab (single purpose, permission justifications, "does not collect user data"), and submit it for review. Note the item ID.
3. In the Google Cloud console, create (or pick) a project and enable the **Chrome Web Store API**.
4. Create a **service account** in that project, then create a **JSON key** for it. Keep the `client_email` and `private_key` values.
5. In the Chrome Web Store developer dashboard, open **Account** and add the service account's email so it can manage your items.
6. Add the four secrets above.

## Firefox Add-ons (AMO)

| Secret               | Value                     |
| -------------------- | ------------------------- |
| `FIREFOX_JWT_ISSUER` | The "JWT issuer" API key. |
| `FIREFOX_JWT_SECRET` | The "JWT secret".         |

The add-on ID is fixed in `wxt.config.ts` and in the workflow (`{ac4f493d-6e67-4abe-9504-8fede717a9d3}`). It must never change after the first release.

Steps:

1. Create a Firefox account and sign in at https://addons.mozilla.org/developers/.
2. Submit the first version manually: upload `claude-account-switcher-<version>-firefox.zip`, and upload `claude-account-switcher-<version>-sources.zip` when asked for source code (the code is bundled, so reviewers need the sources). Build instructions for reviewers: "Node.js 24, `corepack enable`, `pnpm install`, `pnpm zip:firefox`".
3. Generate API credentials at https://addons.mozilla.org/developers/addon/api/key/.
4. Add the two secrets above.

## Microsoft Edge Add-ons

| Secret            | Value                                                     |
| ----------------- | --------------------------------------------------------- |
| `EDGE_PRODUCT_ID` | The product ID shown in Partner Center for the extension. |
| `EDGE_CLIENT_ID`  | The API client ID.                                        |
| `EDGE_API_KEY`    | The API key.                                              |

Steps:

1. Register for the Microsoft Edge program in Partner Center: https://partner.microsoft.com/dashboard/microsoftedge/ (free).
2. Submit the first version manually with `claude-account-switcher-<version>-edge.zip` and fill in the listing.
3. In Partner Center, open **Microsoft Edge → Publish API**, enable the API, and create credentials. This gives the client ID and the API key (keys expire; renew them before they do).
4. Copy the product ID from the extension's overview page.
5. Add the three secrets above.

## Safari

Not automated: it needs macOS, Xcode and a paid Apple Developer account. See [SAFARI.md](SAFARI.md).

## Checking credentials without publishing

With the secrets exported in your shell, `pnpm wxt submit --dry-run --chrome-zip … --firefox-zip … --firefox-sources-zip … --edge-zip …` checks authentication without uploading anything.
