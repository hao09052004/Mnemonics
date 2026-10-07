// @vitest-environment jsdom
//
// Regression: when the /api/v1/items?favorite=true request failed (e.g.
// expired token, network down), the Favorites tab showed "No favorites
// yet" — exactly the same copy the user sees when the server genuinely
// returned zero rows. That ambiguity is what made "I added a favorite
// but the tab is empty" impossible to diagnose.
//
// The fix: a failed request must surface an error state with the API
// message and a Retry button, distinct from the empty-result copy.
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
  it('shows an error message (not "No favorites yet") when the API request fails', async () => {
    const { dom } = loadDashboardWithFailingItems({ status: 500, body: 'database down', alwaysFail: true });
    await settle(300);

    clickTab(dom, 'favorites');
    await settle(500);

    const doc = dom.window.document;
    const errorEl = doc.getElementById('cards-error');
    const emptyEl = doc.getElementById('cards-empty');
    const text = doc.body.textContent || '';
    expect(errorEl && errorEl.hidden, 'cards-error must be visible after a failed request').toBe(false);
    expect(emptyEl && emptyEl.hidden, 'cards-empty must stay hidden when the error panel is up').toBe(true);
    // The "No favorites yet" copy belongs to the empty-result case.
    // A 500 must not be silenced into that same text.
    expect(text).not.toContain('No favorites yet.');
    // The dedicated error state must be visible. We assert the H1
    // title directly (case-insensitive match) so the test is not at
    // the mercy of toast auto-dismiss timing.
    expect(text.toLowerCase()).toContain('could not load favorites');
  });

  it('offers a retry button that re-issues ?favorite=true', async () => {
    const { dom, refetch } = loadDashboardWithFailingItems({ status: 500, alwaysFail: false });
    await settle(300);
    clickTab(dom, 'favorites');
    // The first call fails; the test asserts the retry button exists
    // and that clicking it produces a fresh /items?favorite=true
    // request. The mock returns success on the second call, so by
    // the time the test asserts the error panel is gone (the
    // successful retry reconciled state.error = null).
    await settle(500);

    const retry = dom.window.document.querySelector('[data-action="retry-favorites"]') as HTMLElement;
    expect(retry, 'a retry button must exist when the favorites request fails').toBeTruthy();

    // Reset the counter so we only see calls fired by the retry click.
    refetch.mockClear();
    retry.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await settle(300);

    const favCalls = refetch.mock.calls.filter((u) => String(u[0]).includes('favorite=true'));
    expect(favCalls.length, 'clicking retry must call /items?favorite=true again').toBeGreaterThan(0);
  });

  it('surfaces a permanent auth failure (401 on /items) as a sign-in error, not "No favorites yet"', async () => {
    // A 401 that survives refresh resolves to `null` from fetchItems.
    // The dashboard used to silently treat that as "no rows" and
    // showed "No favorites yet", which is what users in the wild
    // were seeing when their access token had expired.
    const { dom } = loadDashboardWithFailingItems({ status: 401, alwaysFail: true });
    await settle(300);

    clickTab(dom, 'favorites');
    await settle(500);

    const doc = dom.window.document;
    const errorEl = doc.getElementById('cards-error');
    const emptyEl = doc.getElementById('cards-empty');
    const text = doc.body.textContent || '';
    expect(errorEl && errorEl.hidden, 'auth-failed /items must surface the error panel').toBe(false);
    expect(emptyEl && emptyEl.hidden, 'empty panel must stay hidden on auth failure').toBe(true);
    expect(text).not.toContain('No favourites yet.');
    // The error copy must point the user at signing in again, not
    // a generic "could not load".
    expect(text.toLowerCase()).toMatch(/sign in|session|expired|token/);
  });

  it('always shows a visible diagnostic line on the favorites route so silent failures are diagnosable', async () => {
    // Even when the request succeeds with rows, the diagnostic line
    // must be present (and hidden via CSS) so a user with a render
    // bug can still see "route=…, server rows=…, user=…". Without
    // this, a render throw leaves the grid completely blank with
    // no signal that anything is wrong.
    const { dom } = loadDashboardWithFailingItems({ status: 500, alwaysFail: true });
    await settle(300);
    clickTab(dom, 'favorites');
    await settle(500);

    const diag = dom.window.document.getElementById('cards-diagnostic');
    expect(diag, 'diagnostic element must exist').toBeTruthy();
    expect(diag && diag.hidden, 'diagnostic must be visible on the favorites route').toBe(false);
    const text = (diag && diag.textContent) || '';
    expect(text).toMatch(/route=favorites/);
    expect(text).toMatch(/server rows=/);
  });
});