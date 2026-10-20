import { defineConfig } from 'wxt';

const EXTENSION_NAME = 'Menu Account Switcher for Claude';
const HOST_PERMISSION = 'https://claude.ai/*';

/**
 * Stable add-on ID for Firefox (AMO). It must never change after the first
 * public release, otherwise existing installs stop receiving updates.
 */
const FIREFOX_ADDON_ID = '{ac4f493d-6e67-4abe-9504-8fede717a9d3}';

export default defineConfig({
  srcDir: 'src',
  // Explicit imports everywhere: core modules stay framework-agnostic and
  // readable without knowing WXT's auto-import conventions.
  imports: false,
  manifestVersion: 3,
  targetBrowsers: ['chrome', 'edge', 'firefox', 'safari'],
  manifest: ({ browser }) => ({
    name: EXTENSION_NAME,
    short_name: 'Account Switcher',
    permissions: ['cookies', 'storage'],
    host_permissions: [HOST_PERMISSION],
    action: {
      default_title: EXTENSION_NAME,
    },
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: FIREFOX_ADDON_ID,
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
    ...(browser === 'chrome' || browser === 'edge' ? { minimum_chrome_version: '120' } : {}),
  }),
});
