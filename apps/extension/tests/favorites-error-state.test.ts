// @vitest-environment jsdom
//
// When the /api/v1/items?favorite=true request fails (expired token,
// network down, 5xx), the Favorites tab used to surface a dedicated
// "Could not load favorites" + Retry panel. We now swallow the error
// silently: the user sees the normal empty state ("No favorites yet.")
// and the dashboard stays usable. The failure is logged to the console
// so devs can still diagnose without leaking internals to end users.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(__dirname, '..');

function loadDashboardWithFailingItems(opts: { status: number; body?: string; alwaysFail?: boolean }): { dom: JSDOM; refetch: ReturnType<typeof vi.fn> } {
  const html = readFileSync(join(ROOT, 'mnemonics-dashboard.html'), 'utf8')
    .replace(/<script src="(api-client|dashboard)\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'chrome-extension://test-id/mnemonics-dashboard.html',
    pretendToBeVisual: true
  });

  let callCount = 0;
  const refetch = vi.fn();
  dom.window.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/v1/items')) {
      callCount++;
      refetch(u);
      // When alwaysFail is set, the error never goes away and the
      // user must click Retry to recover.
      if (opts.alwaysFail) {
        return {
          ok: false,
          status: opts.status,
          statusText: 'Server Error',
          json: async () => ({ error: { code: 'E', message: opts.body || 'boom' } })
        } as any;
      }
      // Otherwise: first call fails, second call (retry) succeeds empty.
      if (callCount === 1) {
        if (opts.status === 401) {
          // /api/v1/items: 401 with permanent auth failure must
          // resolve to `null` (the dashboard's "sign in again" path).
          // /api/v1/spaces: 401 too, otherwise refresh token path
          // would re-fire and corrupt the test.
          return { ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({ error: { code: 'UNAUTHORIZED' } }) } as any;
        }
        return {
          ok: false,
          status: opts.status,
          statusText: 'Server Error',
          json: async () => ({ error: { code: 'E', message: opts.body || 'boom' } })
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { items: [], total: 0, limit: 100, offset: 0 } })
      } as any;
    }
    if (u.includes('/api/v1/spaces')) {
      return { ok: true, status: 200, json: async () => ({ data: { spaces: [] } }) } as any;
    }
    if (u.includes('/api/v1/search')) {
      return { ok: true, status: 200, json: async () => ({ hits: [] }) } as any;
    }
    return { ok: true, status: 200, json: async () => ({}) } as any;
  }) as any;

  dom.window.chrome = {
    storage: {
      local: {
        get(_k: string, cb: (r: any) => void) {
          cb({ mnemonics_session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999, user: { id: 'u1', email: 'a@b.co' } } });
        },
        set(_o: any, cb?: () => void) { if (cb) cb(); },
        remove(_k: string, cb?: () => void) { if (cb) cb(); }
      }
    },
    runtime: {
      sendMessage(_msg: any, cb?: (r: any) => void) { if (cb) cb({ ok: true }); },
      onMessage: { addListener() {} },
      getURL: (p: string) => p
    },
    tabs: { create(_o: any, cb?: (t: any) => void) {} }
  } as any;
  (dom.window as any).confirm = () => true;

  try { dom.window.eval(readFileSync(join(ROOT, 'api-client.js'), 'utf8')); } catch { /* ignore */ }
  try { dom.window.eval(readFileSync(join(ROOT, 'dashboard.js'), 'utf8')); } catch { /* ignore */ }

  return { dom, refetch };
}

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

function clickTab(dom: JSDOM, route: string) {
  const tab = dom.window.document.querySelector(`[data-route-tab="${route}"]`) as HTMLElement;
  if (!tab) throw new Error(`tab not found: ${route}`);
  tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('Favorites tab error state', () => {
  it('falls back to the normal empty state when the API request fails (no error panel)', async () => {
    // A 500 used to show "Could not load favorites" + Retry. We now
    // swallow the error and let the user see the same "No favorites
    // yet." copy they get when the server returns zero rows.
    const { dom } = loadDashboardWithFailingItems({ status: 500, body: 'database down', alwaysFail: true });
    await settle(300);

    clickTab(dom, 'favorites');
    await settle(500);

    const doc = dom.window.document;
    const errorEl = doc.getElementById('cards-error');
    const emptyEl = doc.getElementById('cards-empty');
    const text = (doc.body.textContent || '').toLowerCase();
    expect(!errorEl || errorEl.hidden, 'cards-error must be absent or hidden on failure').toBe(true);
    expect(emptyEl && emptyEl.hidden, 'cards-empty must be visible (empty state) on failure').toBe(false);
    // The error H1 must NOT leak into the DOM.
    expect(text).not.toContain('could not load favorites');
    // The empty-state copy must be the favorites-specific one.
    expect(doc.body.textContent || '').toContain('No favorites yet.');
  });

  it('falls back to the normal empty state on permanent auth failure (401) too', async () => {
    // A 401 that survives refresh used to show a "sign in again"
    // panel. Now it's silent: the user sees the empty state just
    // like for any other failure.
    const { dom } = loadDashboardWithFailingItems({ status: 401, alwaysFail: true });
    await settle(300);

    clickTab(dom, 'favorites');
    await settle(500);

    const doc = dom.window.document;
    const errorEl = doc.getElementById('cards-error');
    const emptyEl = doc.getElementById('cards-empty');
    expect(!errorEl || errorEl.hidden, 'auth-failed /items must NOT surface the error panel').toBe(true);
    expect(emptyEl && emptyEl.hidden, 'empty panel must be visible (empty state) on auth failure').toBe(false);
  });

  it('hides the diagnostic debug line so the empty state stays clean for users', async () => {
    // The diagnostic element is kept in the DOM (so future debug
    // toggles can surface it) but it must never be visible to end
    // users — its content was leaking internal state ("route=…,
    // server rows=…, user=…") into the Favorites tab UI.
    const { dom } = loadDashboardWithFailingItems({ status: 500, alwaysFail: true });
    await settle(300);
    clickTab(dom, 'favorites');
    await settle(500);

    const diag = dom.window.document.getElementById('cards-diagnostic');
    expect(diag, 'diagnostic element must still exist').toBeTruthy();
    expect(diag && diag.hidden, 'diagnostic must stay hidden from users').toBe(true);
    expect((diag && diag.textContent) || '').toBe('');
  });
});