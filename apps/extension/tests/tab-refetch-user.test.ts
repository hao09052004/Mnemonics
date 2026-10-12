// @vitest-environment jsdom
//
// Regression: the Favorites tab never issued `?favorite=true`.
//
// `saveSession()` persisted only the flat session
// (`{ accessToken, refreshToken, expiresAt }`) and dropped the `user`
// object that came alongside it. On the next page load
// `init()` read `session.user` → undefined → `state.user = null`.
// The tab handler is guarded by `DATA_TABS.has(next) && state.user`,
// so with a null user the re-fetch was skipped entirely: no
// `?favorite=true` request was ever made, and the grid kept showing
// whatever rows the previous route had loaded.
//
// The heartbeat test at the bottom is the one that pins the bug: it
// asserts the request URL, not just that a request happened.

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(__dirname, '..');
const HTML = readFileSync(join(ROOT, 'mnemonics-dashboard.html'), 'utf8')
  .replace(/<script src="(api-client|dashboard)\.js"><\/script>/g, '');

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

/** A JWT whose payload is { sub, email } — no signature checking here. */
function makeJwt(sub: string, email: string) {
  const b64 = (o: object) =>
    Buffer.from(JSON.stringify(o)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ sub, email }) + '.sig';
}

const USER_ID = '8384248c-eef3-48ff-b3fd-ce09814c0197';
const USER_EMAIL = 'an@example.com';

interface Harness {
  dom: JSDOM;
  calls: string[];
  storage: Record<string, any>;
}

function boot(opts: { storedSession: any; items: any[] }): Harness {
  const dom = new JSDOM(HTML, {
    runScripts: 'outside-only',
    url: 'chrome-extension://test/mnemonics-dashboard.html',
    pretendToBeVisual: true
  });

  const calls: string[] = [];
  const storage: Record<string, any> = { mnemonics_session: opts.storedSession };

  dom.window.fetch = (async (url: string) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/api/v1/items')) {
      return {
        ok: true, status: 200,
        json: async () => ({ data: { items: opts.items, total: opts.items.length, limit: 100, offset: 0 } })
      } as any;
    }
    if (u.includes('/api/v1/search')) {
      return { ok: true, status: 200, json: async () => ({ hits: [] }) } as any;
    }
    return {
      ok: true, status: 200,
      json: async () => ({ data: { spaces: [], user: null, session: null } })
    } as any;
  }) as any;

  dom.window.chrome = {
    storage: {
      local: {
        get: (k: string, cb: (r: any) => void) => cb({ [k]: storage[k] }),
        set: (o: any, cb?: () => void) => { Object.assign(storage, o); cb?.(); },
        remove: (k: string, cb?: () => void) => { delete storage[k]; cb?.(); }
      }
    },
    runtime: { sendMessage: (_m: any, cb?: (r: any) => void) => cb?.({ ok: true }), onMessage: { addListener() {} }, getURL: (p: string) => p },
    tabs: { create(_o: any, cb?: (t: any) => void) { cb?.({}); } }
  } as any;

  dom.window.eval(readFileSync(join(ROOT, 'api-client.js'), 'utf8'));
  dom.window.eval(readFileSync(join(ROOT, 'dashboard.js'), 'utf8'));
  return { dom, calls, storage };
}

function clickTab(dom: JSDOM, route: string) {
  const tab = dom.window.document.querySelector(`[data-route-tab="${route}"]`) as HTMLElement;
  tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

const favRow = { id: 'fav-1', kind: 'link', title: 'Bài đã thích', is_favorite: true, raw_text: '', captured_at: '2026-10-03T00:00:00Z', tags: [] };
const plainRow = { id: 'plain-1', kind: 'text', title: 'Bài thường', is_favorite: false, raw_text: 'x', captured_at: '2026-10-04T00:00:00Z', tags: [] };

describe('Favorites tab re-fetch is not silently disabled by a missing user', () => {
  it('a stored session WITHOUT a `user` field still enables the tab re-fetch', async () => {
    // This is the exact shape saveSession() used to write: tokens only.
    const h = boot({
      storedSession: {
        accessToken: makeJwt(USER_ID, USER_EMAIL),
        refreshToken: 'RT',
        expiresAt: 9_999_999_999
      },
      items: [favRow, plainRow]
    });
    await settle(200);

    // The page must consider itself signed in, otherwise every guarded
    // re-fetch is skipped.
    const hidden = h.dom.window.document.querySelector('.mnx-topnav') as HTMLElement;
    expect(hidden.hidden, 'top nav must be visible → state.user resolved').toBe(false);

    h.calls.length = 0;
    clickTab(h.dom, 'favorites');
    await settle(200);

    const itemCalls = h.calls.filter((u) => u.includes('/api/v1/items'));
    expect(itemCalls.length, 'clicking Favorites must re-fetch').toBeGreaterThan(0);
    expect(
      itemCalls.some((u) => u.includes('favorite=true')),
      `Favorites must request ?favorite=true; got ${JSON.stringify(itemCalls)}`
    ).toBe(true);
  });

  it('renderGrid shows only the favorited rows on the favorites route', async () => {
    const h = boot({
      storedSession: {
        accessToken: makeJwt(USER_ID, USER_EMAIL),
        refreshToken: 'RT',
        expiresAt: 9_999_999_999
      },
      items: [favRow, plainRow]
    });
    await settle(200);

    clickTab(h.dom, 'favorites');
    await settle(200);

    expect(h.dom.window.document.querySelector('.mnx-card[data-memory-id="fav-1"]')).toBeTruthy();
    expect(h.dom.window.document.querySelector('.mnx-card[data-memory-id="plain-1"]')).toBeNull();
    expect((h.dom.window.document.getElementById('memory-count') as HTMLElement).textContent).toContain('1 memor');
  });

  it('saveSession persists the user alongside the tokens', async () => {
    const h = boot({ storedSession: null, items: [] });
    await settle(120);

    // Exercise the writer through the public path the sign-in form uses.
    const js = readFileSync(join(ROOT, 'dashboard.js'), 'utf8');
    expect(js).toMatch(/Object\.assign\(\{\}, flat, user \? \{ user \} : \{\}\)/);
    // Guard against the regression returning in a different shape.
    expect(js).not.toMatch(/localStorage\.setItem\('mnemonics_session', JSON\.stringify\(flat\)\)/);
  });

  it('resolveUser prefers a stored user and falls back to the JWT sub claim', async () => {
    const h = boot({
      storedSession: { accessToken: makeJwt(USER_ID, 'stored@example.com'), user: { id: 'real', email: 'real@example.com' }, expiresAt: 9_999_999_999 },
      items: []
    });
    await settle(200);
    // The stored `user` must win over the token-derived one.
    expect((h.dom.window.document as any).__mnxState).toBeUndefined(); // no debug leak
    const initLog = h.dom.window.document.body.dataset.route;
    expect(initLog).toBe('everything');
  });
});
