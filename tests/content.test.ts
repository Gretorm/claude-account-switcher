// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { toMenuModel } from '../src/content/controller';
import { probePage, type ProbeEnvironment } from '../src/content/page-probe';
import { clearSiteStorage } from '../src/content/site-storage';
import { extractIdentity, findEmailInText } from '../src/core/identity';
import { DEFAULT_SETTINGS } from '../src/core/accounts';

function environment(
  respond: (url: string) => Response | Promise<Response>,
  pathname = '/new',
  html = '',
): ProbeEnvironment & { requested: string[] } {
  document.body.innerHTML = html;
  const requested: string[] = [];
  return {
    requested,
    fetch: (url) => {
      requested.push(url);
      return Promise.resolve(respond(url));
    },
    location: { pathname },
    document,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('probePage', () => {
  it('reads the account from the endpoint the web app uses', async () => {
    const env = environment(() =>
      json({ uuid: 'x', email_address: 'jane@example.com', full_name: 'Jane Doe' }),
    );
    await expect(probePage(env)).resolves.toEqual({
      signedIn: true,
      identity: { email: 'jane@example.com', name: 'Jane Doe' },
    });
    expect(env.requested).toEqual(['https://claude.ai/api/account']);
  });

  it('treats 401 and 403 as signed out', async () => {
    await expect(probePage(environment(() => json({}, 401)))).resolves.toEqual({ signedIn: false });
    await expect(probePage(environment(() => json({}, 403)))).resolves.toEqual({ signedIn: false });
  });

  it('treats the sign-in page as signed out without any request', async () => {
    const env = environment(() => json({}), '/login');
    await expect(probePage(env)).resolves.toEqual({ signedIn: false });
    expect(env.requested).toEqual([]);
  });

  it('falls back to the email shown in the account menu', async () => {
    const env = environment(
      () => new Response('not found', { status: 404 }),
      '/new',
      '<span data-testid="user-menu-header">Jane (jane@example.com)</span>',
    );
    await expect(probePage(env)).resolves.toEqual({
      signedIn: true,
      identity: { email: 'jane@example.com' },
    });
  });

  it('ignores text the extension inserted itself', async () => {
    const env = environment(
      () => new Response('', { status: 500 }),
      '/new',
      '<span data-testid="user-menu-header"><span data-menu-account-switcher="item">saved@example.com</span></span>',
    );
    await expect(probePage(env)).resolves.toEqual({ signedIn: null });
  });

  it('answers "unknown" when nothing works, without throwing', async () => {
    const env = environment(() => Promise.reject(new Error('offline')));
    await expect(probePage(env)).resolves.toEqual({ signedIn: null });
  });

  it('reports a signed-in session even when the payload has no identity', async () => {
    await expect(probePage(environment(() => json({ something: 'else' })))).resolves.toEqual({
      signedIn: true,
    });
  });
});

describe('identity parsing', () => {
  it('finds the shallowest email-bearing object', () => {
    expect(
      extractIdentity({
        account: { email_address: 'me@example.com', display_name: 'Me' },
        memberships: [{ organization: { email: 'org@example.com' } }],
      }),
    ).toEqual({ email: 'me@example.com', name: 'Me' });
  });

  it('ignores values that are not emails', () => {
    expect(extractIdentity({ email: 'not-an-email' })).toBeUndefined();
    expect(extractIdentity(null)).toBeUndefined();
    expect(findEmailInText('Signed in as a.b+c@example.co.uk today')).toBe('a.b+c@example.co.uk');
  });
});

describe('clearSiteStorage', () => {
  function storages() {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('rq-cache-confirmed-account', '1');
    localStorage.setItem('rq-cache-confirmed-account-session', '1');
    localStorage.setItem('__qk_hint_account_uuid', '1');
    localStorage.setItem('default-model', 'keep');
    sessionStorage.setItem('draft', 'keep');
    return { local: localStorage, session: sessionStorage };
  }

  it('removes only the account cache keys by default', () => {
    clearSiteStorage(storages(), { all: false });
    expect(Object.keys(localStorage)).toEqual(['default-model']);
    expect(sessionStorage.getItem('draft')).toBe('keep');
  });

  it('removes everything when asked to', () => {
    clearSiteStorage(storages(), { all: true });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('toMenuModel', () => {
  it('maps the view state to menu entries', () => {
    expect(
      toMenuModel({
        accounts: [
          {
            id: 'a',
            label: 'Work',
            identity: { email: 'w@example.com' },
            status: 'expired',
            savedAt: 0,
            active: false,
          },
        ],
        current: { signedIn: true },
        settings: DEFAULT_SETTINGS,
      }),
    ).toEqual({
      accounts: [{ id: 'a', label: 'Work', detail: 'w@example.com', active: false, expired: true }],
    });
  });
});
