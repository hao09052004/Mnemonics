/**
 * Tests for the extension dashboard data layer.
 *
 * We re-evaluate `apps/extension/dashboard.js` inside a sandbox that
 * stubs `chrome.storage.local` and `localStorage`, then drive the
 * `loadFromExtension` and `mergeServerItems` functions to verify the
 * cache-per-user contract and the server-vs-local reconciliation rules.
 *
 * The functions under test are intentionally exposed via a small
 * `module.exports` shim added at the bottom of dashboard.js so we can
 * reach them without DOM globals.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadDashboardModule() {
  const src = readFileSync(
    join(__dirname, '..', 'dashboard.js'),
    'utf8'
  );
  // The sandbox exposes just enough globals for the helpers we test to
  // run. Everything else (DOM event listeners, toasts, ...) is a stub.
  const store = new Map<string, unknown>();
  const chromeShim: any = {
    storage: {
      local: {
        get(keys: string | string[], cb: (r: Record<string, unknown>) => void) {
          if (typeof keys === 'string') cb({ [keys]: store.get(keys) });
          else {
            const out: Record<string, unknown> = {};
            for (const k of keys) out[k] = store.get(k);
            cb(out);
          }
        },
        set(values: Record<string, unknown>, cb?: () => void) {
          for (const [k, v] of Object.entries(values)) store.set(k, v);
          if (cb) cb();
        },
        remove(keys: string | string[], cb?: () => void) {
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) store.delete(k);
          if (cb) cb();
        }
      }
    },
    runtime: { sendMessage: vi.fn(), lastError: null, onMessage: { addListener: vi.fn() } },
    tabs: { query: vi.fn() }
  };
  const docStub: any = {
    addEventListener: vi.fn(),
    getElementById: vi.fn(() => null),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    body: { classList: { toggle: vi.fn() } }
  };
  // Strip the DOMContentLoaded bootstrap so we don't try to mount UI.
  const idx = src.indexOf('document.addEventListener');
  const stripped = idx >= 0 ? src.slice(0, idx) : src;
  const sandboxFn = new Function(
    'chrome', 'document', 'window', 'localStorage', 'crypto', 'console', 'Date', 'Map', 'Set', 'JSON', 'fetch',
    stripped + '\nreturn { userCacheKey, userApiCacheKey, fetchItemsFromApi, apiItemToLocalShape, mergeServerItems, isPendingItem, reconcileServerItems };'
  );
  return {
    exports: sandboxFn(
      chromeShim,
      docStub,
      { matchMedia: () => ({ addEventListener: vi.fn() }) },
      globalThis.localStorage,
      globalThis.crypto,
      console,
      Date,
      Map,
      Set,
      JSON,
      globalThis.fetch
    ),
    store,
    chromeShim
  };
}

describe('extension dashboard helpers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('userCacheKey and userApiCacheKey are namespaced by user id', () => {
    const { exports } = loadDashboardModule();
    expect(exports.userCacheKey('u1')).toBe('mnemonics_items_u1');
    expect(exports.userCacheKey('guest')).toBe('mnemonics_items_guest');
    expect(exports.userApiCacheKey('u1')).toBe('mnemonics_api_items_u1');
  });

  it('apiItemToLocalShape normalises server rows into the local card shape', () => {
    const { exports } = loadDashboardModule();
    const local = exports.apiItemToLocalShape({
      id: 'i1', kind: 'link', title: 'Hello',
      captured_at: '2026-09-18T09:00:00.000Z', tags: ['a', 'b'],
      source_url: 'https://example.com', image_url: 'https://cdn/x.jpg'
    });
    expect(local.id).toBe('i1');
    expect(local.kind).toBe('link');
    expect(local.type).toBe('link');
    expect(local.tags).toEqual(['a', 'b']);
    expect(local.imageUrl).toBe('https://cdn/x.jpg');
    expect(local.sourceUrl).toBe('https://example.com');
    expect(local.serverSynced).toBe(true);
    expect(local.pendingUpload).toBe(false);
  });

  it('isPendingItem only flags rows with explicit pendingUpload=true', () => {
    const { exports } = loadDashboardModule();
    expect(Boolean(exports.isPendingItem({ id: 'x' }))).toBe(false);
    expect(Boolean(exports.isPendingItem({ id: 'x', pendingUpload: true }))).toBe(true);
    expect(Boolean(exports.isPendingItem(null))).toBe(false);
  });

  it('reconcileServerItems clears pendingUpload when the server already has the row', () => {
    const { exports } = loadDashboardModule();
    const merged = exports.reconcileServerItems(
      [{ id: 'i1', pendingUpload: true, title: 'local copy', tags: [] }],
      [{ id: 'i1', kind: 'link', title: 'server copy', captured_at: '2026-01-01', tags: ['design'] }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].pendingUpload).toBe(false);
    expect(merged[0].serverSynced).toBe(true);
    expect(merged[0].title).toBe('server copy');
  });

  it('reconcileServerItems keeps offline-only pending rows when server has no match', () => {
    const { exports } = loadDashboardModule();
    const merged = exports.reconcileServerItems(
      [
        { id: 'pending-1', pendingUpload: true, title: 'offline', tags: [] },
        { id: 'synced-1', pendingUpload: false, title: 'synced', tags: [] }
      ],
      [{ id: 'other', kind: 'text', title: 'fresh', captured_at: '2026-01-01', tags: [] }]
    );
    const ids = merged.map((m) => m.id).sort();
    expect(ids).toContain('pending-1');
    expect(ids).not.toContain('synced-1');
    expect(ids).toContain('other');
  });

  it('reconcileServerItems drops stale synced rows that disappeared from the server', () => {
    const { exports } = loadDashboardModule();
    const merged = exports.reconcileServerItems(
      [{ id: 'gone', pendingUpload: false, title: 'gone', tags: [] }],
      []
    );
    expect(merged.find((m) => m.id === 'gone')).toBeUndefined();
  });
});
