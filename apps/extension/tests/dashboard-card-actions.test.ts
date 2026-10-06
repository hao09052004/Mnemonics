// @vitest-environment jsdom
//
// Card actions are the only controls that mutate server state from the
// grid (favorite + delete). Before this file they were pure decoration:
// `data-action="more"` returned early and did nothing, the heart only
// mutated `state.items` in memory, and `deleteItem()` was never called
// at all — so a user could favourite something and reload to find it
// unchanged, and had no way to delete from the grid.
//
// These tests pin the bridge contract: both actions must round-trip
// through `chrome.runtime.sendMessage` with the message types the
// service worker actually handles (`TOGGLE_FAVORITE_ITEM`,
// `DELETE_ITEM`).

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(__dirname, '..');

interface Harness {
  dom: JSDOM;
  sent: Array<{ type: string; [k: string]: unknown }>;
  confirmResult: boolean;
  document: Document;
}

function loadDashboardWithItems(
  items: Array<Record<string, unknown>> = [
    { id: 'i1', kind: 'text', title: 'Facebook post', raw_text: 'Xin lỗi cả nhà', is_favorite: false, captured_at: '2026-10-04T00:00:00Z', tags: [] }
  ]
): Harness {
  const html = readFileSync(join(ROOT, 'mnemonics-dashboard.html'), 'utf8')
    .replace(/<script src="(api-client|dashboard)\.js"><\/script>/g, '');
  const dashboardJs = readFileSync(join(ROOT, 'dashboard.js'), 'utf8');
  const apiClientJs = readFileSync(join(ROOT, 'api-client.js'), 'utf8');

  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'chrome-extension://test-id/mnemonics-dashboard.html',
    pretendToBeVisual: true
  });

  const harness: Harness = { dom, sent: [], confirmResult: true, document: dom.window.document };

  // Every response the dashboard can receive. `items` are returned by
  // the list endpoint; the auth envelope keeps us on the grid route.
  dom.window.fetch = (async (url: string) => {
    const u = String(url);
    if (u.includes('/api/v1/items')) {
      return { ok: true, status: 200, json: async () => ({ data: { items, total: items.length, limit: 50, offset: 0 } }) } as any;
    }
    if (u.includes('/api/v1/search')) {
      return { ok: true, status: 200, json: async () => ({ hits: [] }) } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { spaces: [], user: { id: 'u1', email: 'a@b.co' }, session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999 } } })
    } as any;
  });

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
      // Record every bridge call and answer as a success, mirroring the
      // service worker's `sendResponse({ ok: true })` shape.
      sendMessage(msg: any, cb?: (r: any) => void) {
        harness.sent.push(msg);
        if (cb) cb({ ok: true, item: { id: msg.itemId, isFavorite: !!msg.isFavorite } });
      },
      onMessage: { addListener() {} },
      getURL(p: string) { return p; }
    },
    tabs: { create(_o: any, cb?: (t: any) => void) {} }
  } as any;

  // `confirm()` gates the destructive delete. Default to "yes" and let
  // individual tests flip it.
  (dom.window as any).confirm = () => harness.confirmResult;

  try { dom.window.eval(apiClientJs); } catch { /* ignore */ }
  try { dom.window.eval(dashboardJs); } catch { /* ignore */ }

  return harness;
}

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function click(dom: JSDOM, selector: string) {
  const el = dom.window.document.querySelector(selector) as HTMLElement;
  if (!el) throw new Error(`selector not found: ${selector}`);
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('card actions reach the API through the background bridge', () => {
  it('renders a card for a server item and normalises is_favorite', async () => {
    const h = loadDashboardWithItems();
    await settle();
    const card = h.document.querySelector('.mnx-card[data-memory-id="i1"]');
    expect(card, 'the grid must render the fetched item').toBeTruthy();
    // Body text comes from raw_text, not a non-existent `excerpt`.
    expect(card!.textContent).toContain('Xin lỗi cả nhà');
  });

  it('favouriting sends TOGGLE_FAVORITE_ITEM and fills the heart', async () => {
    const h = loadDashboardWithItems();
    await settle();
    h.sent.length = 0;

    click(h.dom, '.mnx-card[data-memory-id="i1"] [data-action="favorite"]');
    await settle();

    const fav = h.sent.find((m) => m.type === 'TOGGLE_FAVORITE_ITEM');
    expect(fav, 'clicking the heart must call the background bridge').toBeTruthy();
    expect(fav!.itemId).toBe('i1');
    expect(fav!.isFavorite, 'the dashboard must send the intended next value').toBe(true);

    const heart = h.document.querySelector('.mnx-card[data-memory-id="i1"] [data-action="favorite"]');
    expect(heart!.getAttribute('aria-pressed'), 'the heart must reflect the new state').toBe('true');
  });

  it('reverts the heart when the bridge rejects the write', async () => {
    const h = loadDashboardWithItems();
    await settle();
    // Make the next bridge call fail.
    (h.dom.window.chrome.runtime as any).sendMessage = (_m: any, cb?: (r: any) => void) => {
      if (cb) cb({ ok: false, error: 'nope' });
    };

    click(h.dom, '.mnx-card[data-memory-id="i1"] [data-action="favorite"]');
    await settle();

    const heart = h.document.querySelector('.mnx-card[data-memory-id="i1"] [data-action="favorite"]');
    expect(heart!.getAttribute('aria-pressed'), 'a rejected write must not leave the heart filled').toBe('false');
  });

  it('the "..." button opens a menu with a delete entry', async () => {
    const h = loadDashboardWithItems();
    await settle();
    expect(h.document.querySelector('.mnx-cardmenu'), 'menu must start closed').toBeNull();

    click(h.dom, '.mnx-card[data-memory-id="i1"] [data-action="more"]');
    await settle();

    const menu = h.document.querySelector('.mnx-cardmenu');
    expect(menu, 'clicking "..." must open the overflow menu').toBeTruthy();
    expect(menu!.querySelector('[data-action="menu-delete"]'), 'the menu must offer delete').toBeTruthy();
    expect(menu!.querySelector('[data-action="menu-favorite"]'), 'the menu must offer favorite').toBeTruthy();
  });

  it('delete sends DELETE_ITEM and removes the card', async () => {
    const h = loadDashboardWithItems();
    await settle();
    h.sent.length = 0;

    click(h.dom, '.mnx-card[data-memory-id="i1"] [data-action="more"]');
    await settle(20);
    click(h.dom, '.mnx-card[data-memory-id="i1"] [data-action="menu-delete"]');
    await settle();

    const del = h.sent.find((m) => m.type === 'DELETE_ITEM');
    expect(del, 'choosing Delete must call the background bridge').toBeTruthy();
    expect(del!.itemId).toBe('i1');
    expect(h.document.querySelector('.mnx-card[data-memory-id="i1"]'), 'the deleted card must leave the grid').toBeNull();
  });

  it('does not delete when the confirmation is dismissed', async () => {
    const h = loadDashboardWithItems();
    await settle();
    h.confirmResult = false;
    h.sent.length = 0;

    click(h.dom, '.mnx-card[data-memory-id="i1"] [data-action="more"]');
    await settle(20);
    click(h.dom, '.mnx-card[data-memory-id="i1"] [data-action="menu-delete"]');
    await settle();

    expect(h.sent.find((m) => m.type === 'DELETE_ITEM'), 'a cancelled delete must never reach the API').toBeUndefined();
    expect(h.document.querySelector('.mnx-card[data-memory-id="i1"]'), 'the card must survive a cancelled delete').toBeTruthy();
  });

  it('Escape closes an open menu without deleting', async () => {
    const h = loadDashboardWithItems();
    await settle();
    h.sent.length = 0;

    click(h.dom, '.mnx-card[data-memory-id="i1"] [data-action="more"]');
    await settle(20);
    expect(h.document.querySelector('.mnx-cardmenu')).toBeTruthy();

    h.document.dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle(20);

    expect(h.document.querySelector('.mnx-cardmenu'), 'Escape must dismiss the menu').toBeNull();
    expect(h.sent.find((m) => m.type === 'DELETE_ITEM')).toBeUndefined();
  });
});
