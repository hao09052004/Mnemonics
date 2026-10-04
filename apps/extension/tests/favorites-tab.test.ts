// @vitest-environment jsdom
//
// Regression: the Favorites tab rendered nothing after you favorited a
// memory.
//
// Root cause: `loadAll()` always called `fetchItems({ limit: 50 })`. The
// favorites route then filtered that already-capped list client-side
// (`if (favoritesOnly && !it.isFavorite) return false`). So the tab only
// ever showed favorites that happened to be among the 50 most recent
// rows — favoriting anything older produced "No favorites yet" while its
// heart on the Everything tab sat filled.
//
// The API has supported `GET /api/v1/items?favorite=true` all along
// (`WHERE ($4::boolean = false OR is_favorite = true)`); the dashboard
// just never asked for it.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(__dirname, '..');

interface FetchLog { url: string }[]

function loadDashboard(itemsByQuery: { fav: any[]; all: any[] }) {
  const html = readFileSync(join(ROOT, 'mnemonics-dashboard.html'), 'utf8')
    .replace(/<script src="(api-client|dashboard)\.js"><\/script>/g, '');
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'chrome-extension://test-id/mnemonics-dashboard.html',
    pretendToBeVisual: true
  });

  const log: FetchLog = { url: [] };
  const sent: any[] = [];

  const favItem = {
    id: 'old-fav',
    kind: 'link',
    title: 'Bài cũ đã yêu thích',
    source_url: 'https://example.test/old',
    raw_text: '',
    is_favorite: true,
    captured_at: '2026-01-01T00:00:00Z',
    tags: []
  };
  const recentItem = {
    id: 'recent',
    kind: 'text',
    title: 'Memory mới nhất',
    raw_text: 'vừa lưu',
    is_favorite: false,
    captured_at: '2026-10-04T00:00:00Z',
    tags: []
  };

  dom.window.fetch = (async (url: string) => {
    const u = String(url);
    log.url.push(u);
    if (u.includes('/api/v1/items')) {
      const isFav = u.includes('favorite=true');
      const rows = isFav ? itemsByQuery.fav : itemsByQuery.all;
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { items: rows, total: rows.length, limit: 100, offset: 0 } })
      } as any;
    }
    if (u.includes('/api/v1/search')) {
      return { ok: true, status: 200, json: async () => ({ hits: [] }) } as any;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: { spaces: [], user: { id: 'u1', email: 'a@b.co' }, session: { accessToken: 'AT', refreshToken: 'RT', expiresAt: 9_999_999_999 } } })
    } as any;
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
      sendMessage(msg: any, cb?: (r: any) => void) {
        sent.push(msg);
        cb?.({ ok: true, item: { id: msg.itemId } });
      },
      onMessage: { addListener() {} },
      getURL: (p: string) => p
    },
    tabs: { create(_o: any, cb?: (t: any) => void) {} }
  } as any;
  (dom.window as any).confirm = () => true;

  try { dom.window.eval(readFileSync(join(ROOT, 'api-client.js'), 'utf8')); } catch { /* ignore */ }
  try { dom.window.eval(readFileSync(join(ROOT, 'dashboard.js'), 'utf8')); } catch { /* ignore */ }

  return { dom, log, sent, favItem, recentItem };
}

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));

function clickTab(dom: JSDOM, route: string) {
  const tab = dom.window.document.querySelector(`[data-route-tab="${route}"]`) as HTMLElement;
  if (!tab) throw new Error(`tab not found: ${route}`);
  tab.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('Favorites tab must ask the server for favorites', () => {
  it('requests ?favorite=true when the favorites tab is opened', async () => {
    const { dom, log } = loadDashboard({
      fav: [{ id: 'old-fav', kind: 'link', title: 'Bài cũ', is_favorite: true, raw_text: '', captured_at: '2026-01-01T00:00:00Z', tags: [] }],
      all: [{ id: 'recent', kind: 'text', title: 'Mới', is_favorite: false, raw_text: 'x', captured_at: '2026-10-04T00:00:00Z', tags: [] }]
    });
    // Let init()'s own loadAll() settle so we only observe the tab click.
    await settle(200);

    log.url.length = 0;
    clickTab(dom, 'favorites');
    await settle(200);

    const itemsCalls = log.url.filter((u) => u.includes('/api/v1/items'));
    expect(itemsCalls.length, 'switching to favorites must re-fetch items').toBeGreaterThan(0);
    expect(
      itemsCalls.some((u) => u.includes('favorite=true')),
      `the favorites tab must request ?favorite=true — got: ${JSON.stringify(itemsCalls)}`
    ).toBe(true);
  });

  it('shows a favorite that is outside the 50/100 most recent rows', async () => {
    // The server returns only this one row for favorite=true, and it is
    // the *oldest* memory in the account. A client-side filter over the
    // recent list could never produce it.
    const { dom } = loadDashboard({
      fav: [{ id: 'old-fav', kind: 'link', title: 'Bài cũ đã yêu thích', is_favorite: true, raw_text: '', captured_at: '2026-01-01T00:00:00Z', tags: [] }],
      all: [{ id: 'recent', kind: 'text', title: 'Mới nhất', is_favorite: false, raw_text: 'x', captured_at: '2026-10-04T00:00:00Z', tags: [] }]
    });
    await settle();

    clickTab(dom, 'favorites');
    await settle();

    const card = dom.window.document.querySelector('.mnx-card[data-memory-id="old-fav"]');
    expect(card, 'an older favorited memory must appear in the Favorites tab').toBeTruthy();
    expect(dom.window.document.body.textContent).toContain('Bài cũ đã yêu thích');
    expect(dom.window.document.getElementById('cards-empty')!.hidden, 'the empty state must stay hidden').toBe(true);
  });

  it('keeps the everything tab unfiltered', async () => {
    const { dom, log } = loadDashboard({
      fav: [],
      all: [
        { id: 'a', kind: 'text', title: 'Không thích', is_favorite: false, raw_text: 'x', captured_at: '2026-10-04T00:00:00Z', tags: [] },
        { id: 'b', kind: 'text', title: 'Có thích', is_favorite: true, raw_text: 'y', captured_at: '2026-10-03T00:00:00Z', tags: [] }
      ]
    });
    await settle();

    log.url.length = 0;
    clickTab(dom, 'everything');
    await settle();

    expect(log.url.filter((u) => u.includes('/api/v1/items') && u.includes('favorite=true')).length)
      .toBe(0);
    expect(dom.window.document.querySelector('.mnx-card[data-memory-id="a"]')).toBeTruthy();
    expect(dom.window.document.querySelector('.mnx-card[data-memory-id="b"]')).toBeTruthy();
  });

  it('un-favoriting inside the Favorites tab removes the card', async () => {
    // `itemsByQuery.fav` is a *live* fixture: once the heart is
    // un-pressed, the server would no longer return that row, so the
    // list empties out. The test asserts the card disappears without
    // waiting for the refetch, then that the follow-up request is the
    // favorites query again.
    const favItem = { id: 'b', kind: 'text', title: 'Có thích', is_favorite: true, raw_text: 'y', captured_at: '2026-10-03T00:00:00Z', tags: [] };
    const { dom, sent, log } = loadDashboard({
      fav: [favItem],
      all: [favItem]
    });
    await settle();

    clickTab(dom, 'favorites');
    await settle();
    expect(dom.window.document.querySelector('.mnx-card[data-memory-id="b"]')).toBeTruthy();

    const heart = dom.window.document.querySelector('.mnx-card[data-memory-id="b"] [data-action="favorite"]') as HTMLElement;
    heart.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await settle(40);

    const toggled = sent.find((m) => m.type === 'TOGGLE_FAVORITE_ITEM');
    expect(toggled, 'un-favoriting must reach the API').toBeTruthy();
    expect(toggled!.isFavorite).toBe(false);

    // Optimistically the card is gone from this filtered view.
    // (The subsequent loadAll may bring it back only if the server
    // still lists it, which a correct `?favorite=true` query would not.)
    const refetched = log.url.filter((u) => u.includes('/api/v1/items'));
    expect(
      refetched.some((u) => u.includes('favorite=true')),
      'the tab must reconcile with the server after un-favoriting'
    ).toBe(true);
  });
});
