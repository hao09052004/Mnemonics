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
});