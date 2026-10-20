import { extractIdentity, findEmailInText } from '../core/identity';
import { isLoginPath, siteConfig, type SiteConfig } from '../core/site-config';
import type { PageReport } from '../core/switcher/types';
import { nativeText } from './markers';

export interface ProbeEnvironment {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  location: Pick<Location, 'pathname'>;
  document: Pick<Document, 'querySelectorAll'>;
  config?: SiteConfig;
}

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Asks the page who is signed in, without ever throwing:
 * 1. a sign-in page means signed out;
 * 2. the account endpoints the web app itself calls (401/403 means signed out);
 * 3. an email shown in the account menu area;
 * 4. otherwise "unknown" (`signedIn: null`), and the UI falls back to labels.
 */
export async function probePage(env: ProbeEnvironment): Promise<PageReport> {
  const config = env.config ?? siteConfig;
  if (isLoginPath(env.location.pathname, config)) return { signedIn: false };

  let signedIn: boolean | null = null;
  for (const endpoint of config.accountEndpoints) {
    const result = await queryEndpoint(env, `${config.origin}${endpoint}`);
    if (result === 'signed-out') return { signedIn: false };
    if (result === 'unavailable') continue;
    signedIn = true;
    if (result.identity !== undefined) return { signedIn: true, identity: result.identity };
  }

  const email = findEmailInDom(env.document, config);
  if (email !== undefined) return { signedIn: true, identity: { email } };
  return { signedIn };
}

type EndpointResult = 'signed-out' | 'unavailable' | { identity: PageReport['identity'] };

async function queryEndpoint(env: ProbeEnvironment, url: string): Promise<EndpointResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await env.fetch(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return 'signed-out';
    if (!response.ok) return 'unavailable';
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('json')) return 'unavailable';
    return { identity: extractIdentity(await response.json()) };
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

function findEmailInDom(
  document: Pick<Document, 'querySelectorAll'>,
  config: SiteConfig,
): string | undefined {
  for (const selector of config.identityTextSelectors) {
    try {
      for (const element of document.querySelectorAll(selector)) {
        const email = findEmailInText(nativeText(element));
        if (email !== undefined) return email;
      }
    } catch {
      // An invalid selector in the config must not break the probe.
    }
  }
  return undefined;
}
