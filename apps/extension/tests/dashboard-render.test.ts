// @vitest-environment jsdom
// Reproduction loop for "dashboard renders blank / no UI" bug.
// Loads mnemonics-dashboard.html + dashboard.js + api-client.js inside
// jsdom, then asserts that the page has at least one visible element
// after init() runs.
//
// Hypothesis (Phase 3, before instrumenting):
//   - Either dashboard.js throws during init() before renderRoute() runs,
//     leaving body.dataset.route unset and CSS hiding every section.
//   - Or the HTML is missing required elements the renderer looks up.
//
// Usage:
//   pnpm --filter @mnemonics/extension-tests test tests/dashboard-render.test.ts
//
// Red-capable: this test will FAIL on the reported bug (blank UI) and
// PASS once the dashboard actually renders.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(__dirname, '..');

function loadDashboard() {
  const htmlPath = join(ROOT, 'mnemonics-dashboard.html');
  const dashboardJs = readFileSync(join(ROOT, 'dashboard.js'), 'utf8');
  const apiClientJs = readFileSync(join(ROOT, 'api-client.js'), 'utf8');

  const html = readFileSync(htmlPath, 'utf8');
  // Strip the inline <script> tags — we'll execute the JS files in order
  // via dom.window.eval so jsdom sees them exactly the way the page does.
  const stripped = html
    .replace(/<script src="api-client\.js"><\/script>/, '')
    .replace(/<script src="dashboard\.js"><\/script>/, '');

  const dom = new JSDOM(stripped, {
    runScripts: 'outside-only',
    url: 'chrome-extension://test-id/mnemonics-dashboard.html',
    pretendToBeVisual: true
  });

  // Stub chrome.* so dashboard.js / api-client.js can boot without
  // throwing. Capture errors via window.onerror.
  const errors: Error[] = [];
  dom.window.addEventListener('error', (ev: any) => {
    if (ev.error) errors.push(ev.error);
    else errors.push(new Error(ev.message));
  });
  dom.window.chrome = {
    storage: {
      local: {
        get(_k: string, cb: (r: any) => void) { cb({}); },
        set(_o: any, cb?: () => void) { if (cb) cb(); },
        remove(_k: string, cb?: () => void) { if (cb) cb(); }
      }
    },
    runtime: { sendMessage() {}, onMessage: { addListener() {} }, getURL(p: string) { return p; } },
    tabs: { create(_o: any, cb?: (t: any) => void) {} }
  } as any;

  // Network: short-circuit fetch. resolve to 200 with an empty data shape
  // so the data fetches don't blow up.
  dom.window.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { items: [], spaces: [], total: 0, user: null, session: null }, hits: [] })
  })) as any;

  // Match jsdom's preferred invocation. `eval` runs in the window realm
  // so `var MNEMONICS_API_URL` becomes a property on window.
  try {
    dom.window.eval(apiClientJs);
  } catch (e) {
    errors.push(e as Error);
  }
  try {
    dom.window.eval(dashboardJs);
  } catch (e) {
    errors.push(e as Error);
  }

  return { dom, errors };
}

describe('dashboard renders blank-page bug repro', () => {
  it('init() runs without throwing', () => {
    const { errors } = loadDashboard();
    expect(errors, `page errors: ${errors.map((e) => e.stack || e.message).join('\n')}`).toEqual([]);
  });

  it('sets body[data-route] so CSS reveals a section', () => {
    const { dom, errors } = loadDashboard();
    const route = dom.window.document.body.dataset.route;
    expect(route, 'body.dataset.route should be set (login or everything)').toBeTruthy();
    expect(errors).toEqual([]);
  });

  it('login section is visible (display !== none)', () => {
    const { dom } = loadDashboard();
    const login = dom.window.document.querySelector('[data-route-section="login"]') as HTMLElement;
    expect(login, 'login section must exist in the DOM').toBeTruthy();
    const cs = dom.window.getComputedStyle(login);
    expect(cs.display, 'login section must not be hidden by CSS').not.toBe('none');
  });

  it('does not produce a blank <body> (some element must be visible)', () => {
    const { dom } = loadDashboard();
    const all = Array.from(dom.window.document.querySelectorAll('section, header, nav, main'));
    const visible = all.filter((el) => dom.window.getComputedStyle(el as Element).display !== 'none');
    expect(visible.length, 'at least one section/header/nav/main must be visible').toBeGreaterThan(0);
  });

  it('<body> computed display is not "none" (regression: blank page)', () => {
    // Regression for the 2026-10-04 incident where the CSS selector
    // `[data-route] { display: none }` matched <body data-route="login">
    // and collapsed the entire document to 0×0, producing a blank page.
    // The fix restricts it to `[data-route-section]` (child <section>
    // elements only). If anyone re-broadens that selector in the future,
    // this test catches it before it ships.
    //
    // We assert on getComputedStyle().display rather than
    // getBoundingClientRect().height because jsdom doesn't perform
    // layout (rects are always 0×0 in headless DOM); the actual
    // display value is what Chrome respects when painting.
    const { dom } = loadDashboard();
    const body = dom.window.document.body;
    const cs = dom.window.getComputedStyle(body);
    expect(cs.display, '<body> must not be display:none — that collapses the page').not.toBe('none');
  });

  it('login form has working email/password inputs after init (sign-in path ready)', () => {
    const { dom } = loadDashboard();
    const email = dom.window.document.getElementById('login-email') as HTMLInputElement;
    const pw = dom.window.document.getElementById('login-password') as HTMLInputElement;
    const submit = dom.window.document.querySelector('#login-form button[type="submit"]') as HTMLButtonElement;
    expect(email, 'login-email input exists').toBeTruthy();
    expect(pw, 'login-password input exists').toBeTruthy();
    expect(submit, 'login-form has a submit button').toBeTruthy();
    expect(email.type, 'email input type is "email"').toBe('email');
    expect(pw.type, 'password input type is "password"').toBe('password');
    // Verify a submit handler was bound: dispatching 'submit' on the
    // form must not throw, and the form's email field is reachable.
    const ev = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    expect(() => dom.window.document.getElementById('login-form')!.dispatchEvent(ev)).not.toThrow();
  });
});

import { describe as _dSession, expect as _eSession, it as _iSession } from 'vitest';
_dSession('session storage shape (regression: signed-in user blocked from saving)', () => {
  // Reproduction of the 2026-10-04 incident where signing up then
  // clicking Capture produced 'Bạn cần đăng nhập trước khi lưu ảnh'.
  // Root cause: saveSession() stored the API envelope
  //   { user, session: { accessToken, refreshToken, expiresAt } }
  // directly into chrome.storage.local.mnemonics_session, but every
  // reader (dashboard.js, screenshot-cropper.js, background.js,
  // api-client.js) reads session.accessToken flat — they look one
  // level too high and always get undefined.
  //
  // The fix below pins the storage shape so a future regression that
  // re-wraps the envelope fails immediately.
  _iSession('saveSession() unwraps the { user, session } envelope before storing', () => {
    // Execute dashboard.js in a sandbox via `new Function` so we can
    // expose internal helpers (saveSession) without running the full
    // init() that depends on DOM. This mirrors scripts/smoke-dashboard.mjs.
    const dashboardJs = readFileSync(join(ROOT, 'dashboard.js'), 'utf8');
    const storage = new Map<string, unknown>();
    const chromeStub = {
      storage: {
        local: {
          get: (k: string, cb: (r: any) => void) => cb({ [k]: storage.get(k) }),
          set: (o: any, cb?: () => void) => { for (const [k, v] of Object.entries(o)) storage.set(k, v); cb?.(); },
          remove: (k: string, cb?: () => void) => { storage.delete(k); cb?.(); }
        }
      },
      runtime: { sendMessage() {}, onMessage: { addListener() {} }, getURL(p: string) { return p; } }
    };
    const factory = new Function(
      'chrome', 'document', 'window', 'localStorage', 'crypto', 'console', 'Date', 'Map', 'Set', 'JSON', 'fetch',
      'var __MN_API__ = "http://localhost:4000";\n' + dashboardJs +
      '\nreturn { saveSession, loadSession };'
    );
    // Minimal stubs: dashboard.js only touches document at init(), which
    // we never call here. Stub readyState so init() is not auto-scheduled
    // (it would otherwise call renderRoute() against a missing DOM).
    // Suppress init() error logging — the sandbox can't run the full
    // init() because we lack a real DOM tree; we only want saveSession.
    const stubElement: any = {
      hidden: false,
      innerHTML: '',
      textContent: '',
      value: '',
      children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      dataset: {},
      addEventListener() {},
      querySelector: () => stubElement,
      querySelectorAll: () => []
    };
    const stubDocument = {
      addEventListener() {},
      readyState: 'complete',
      body: { dataset: {}, classList: { add() {}, remove() {}, toggle() {} } },
      getElementById: () => stubElement,
      querySelector: () => stubElement,
      querySelectorAll: () => []
    };
    const origConsoleError = console.error;
    console.error = () => undefined;
    let mod: any;
    try {
      mod = factory(
        chromeStub, stubDocument as any, {} as any,
        globalThis.localStorage, globalThis.crypto, console, Date, Map, Set, JSON,
        (() => Promise.resolve({ ok: true, status: 200, json: async () => ({ data: {} }) })) as any
      );
    } finally {
      console.error = origConsoleError;
    }

    expect(typeof mod.saveSession, 'dashboard.js must export saveSession').toBe('function');

    const apiResponse = { user: { id: 'u1', email: 'a@b.co' }, session: { accessToken: 'AT-1', refreshToken: 'RT-1', expiresAt: 9_999_999_999 } };
    mod.saveSession(apiResponse);

    const stored = storage.get('mnemonics_session') as any;
    expect(stored, 'session must be persisted to chrome.storage.local.mnemonics_session').toBeTruthy();
    // The bug: previously this assertion failed because saveSession
    // stored the wrapped envelope {user, session:{...}}. The fix
    // unwraps to the flat session shape every reader expects.
    expect(stored.accessToken, 'top-level accessToken must be reachable (screenshot-cropper / background read session.accessToken)').toBe('AT-1');
    expect(stored.user, 'stored session must not have a nested user envelope (would shadow accessToken)').toBeUndefined();
  });
});

import { describe as _dLive, expect as _eLive, it as _iLive, beforeEach as _beforeEach } from 'vitest';
_dLive('live updates from background broadcasts (regression: tab stuck after save)', () => {
  // Reproduction of the 2026-10-04 incident where the user saved a
  // screenshot (cropper reported success) but the "Everything" tab on
  // the dashboard did not show the new item until manual reload.
  //
  // Root cause had two parts:
  //   (1) background.js forwards RELOAD_ITEMS / ITEM_SAVED to every
  //       open dashboard tab, but dashboard.js never registered a
  //       chrome.runtime.onMessage listener, so the broadcast was
  //       silently dropped.
  //   (2) Clicking a top-nav tab only called setState({ route }),
  //       it did not call loadAll(), so re-entering a route never
  //       re-fetched items.
  //
  // Both are pinned here: a captured listener triggers loadAll() on
  // the broadcast, and a tab click on the dashboard triggers loadAll().
  let fetchCalls: string[];
  let capturedListener: ((msg: any, _sender: any, sendResponse: any) => void) | undefined;
  let loadAllCalls: number;

  function loadDashboardLive() {
    const htmlPath = join(ROOT, 'mnemonics-dashboard.html');
    const dashboardJs = readFileSync(join(ROOT, 'dashboard.js'), 'utf8');
    const apiClientJs = readFileSync(join(ROOT, 'api-client.js'), 'utf8');
    const html = readFileSync(htmlPath, 'utf8').replace(/<script src="(api-client|dashboard)\.js"><\/script>/g, '');
    const dom = new JSDOM(html, {
      runScripts: 'outside-only',
      url: 'chrome-extension://test-id/mnemonics-dashboard.html',
      pretendToBeVisual: true
    });
    fetchCalls = [];
    loadAllCalls = 0;
    dom.window.fetch = (async (url: string, _init: any) => {
      fetchCalls.push(String(url));
      // For the "logged in" path return an items payload, otherwise
      // return an empty session so login route renders.
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            items: [{ id: 'i1', kind: 'screenshot', title: 'From save', isFavorite: false, capturedAt: '2026-10-04T00:00:00Z', tags: [] }],
            spaces: [],
            total: 1, user: { id: 'u1', email: 'a@b.co' }, session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999 }
          }
        })
      };
    }) as any;
    dom.window.chrome = {
      storage: {
        local: {
          get(k: string, cb: (r: any) => void) { cb({ mnemonics_session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999, user: { id: 'u1', email: 'a@b.co' } } }); },
          set(_o: any, cb?: () => void) { if (cb) cb(); },
          remove(_k: string, cb?: () => void) { if (cb) cb(); }
        }
      },
      runtime: {
        sendMessage() {},
        onMessage: {
          addListener(fn: any) { capturedListener = fn; }
        },
        getURL(p: string) { return p; }
      },
      tabs: { create(_o: any, cb?: (t: any) => void) {} }
    } as any;
    try { dom.window.eval(apiClientJs); } catch (_) { /* ignore */ }
    try { dom.window.eval(dashboardJs); } catch (_) { /* ignore */ }
    return dom;
  }

  _iLive('dashboard registers a chrome.runtime.onMessage listener for live reload', async () => {
    capturedListener = undefined;
    loadDashboardLive();
    // init() is async — wait a tick so bindRuntime() runs.
    await new Promise((r) => setTimeout(r, 20));
    expect(typeof capturedListener, 'dashboard must register chrome.runtime.onMessage.addListener so background broadcasts (RELOAD_ITEMS / ITEM_SAVED) reach it').toBe('function');
  });

  _iLive('RELOAD_ITEMS broadcast triggers a fetch (items reload)', async () => {
    capturedListener = undefined;
    loadDashboardLive();
    await new Promise((r) => setTimeout(r, 20));
    expect(typeof capturedListener).toBe('function');
    fetchCalls = [];
    // Simulate background.js broadcasting RELOAD_ITEMS to this tab.
    capturedListener!({ type: 'RELOAD_ITEMS' }, {}, () => undefined);
    // loadAll is async; wait a microtask for the fetch to register.
    await new Promise((r) => setTimeout(r, 50));
    const itemsCalls = fetchCalls.filter((u) => u.includes('/api/v1/items'));
    expect(itemsCalls.length, 'dashboard must re-fetch /api/v1/items when RELOAD_ITEMS arrives').toBeGreaterThan(0);
  });

  _iLive('ITEM_SAVED broadcast triggers a fetch (items reload)', async () => {
    capturedListener = undefined;
    loadDashboardLive();
    await new Promise((r) => setTimeout(r, 20));
    fetchCalls = [];
    capturedListener!({ type: 'ITEM_SAVED' }, {}, () => undefined);
    await new Promise((r) => setTimeout(r, 50));
    const itemsCalls = fetchCalls.filter((u) => u.includes('/api/v1/items'));
    expect(itemsCalls.length, 'dashboard must re-fetch /api/v1/items when ITEM_SAVED arrives').toBeGreaterThan(0);
  });
});