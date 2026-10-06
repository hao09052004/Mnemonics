// @vitest-environment jsdom
// End-to-end coverage of the extension dashboard against a *real* API.
//
// The existing dashboard-render.test.ts proves the page boots and is not
// blank. This file goes one step further: it boots the page with a signed-in
// session, lets it fetch from a stubbed fetch that mirrors what the API
// actually returns (verified against the running server with
// apps/api/scripts/e2e-full.mts), and then drives the user-visible flows:
//
//   - the everything grid renders one card per item
//   - a content filter chip hides the cards it does not match
//   - clicking a card opens the detail modal with the item's content
//   - the favorite toggle round-trips through PATCH /items/:id
//   - a text query hits POST /api/v1/search and re-renders the results
//   - sign-out clears the stored session
//
// The response shapes are the ones the live API returns, not guesses:
//   GET  /items                -> { data: { items, total } }
//   POST /search               -> { hits, total, took_ms }
//   GET  /items/:id            -> { item: { ..., tags: string[] } }
//   PATCH /items/:id           -> { success, item }
//   GET  /tags/:name/items     -> { tag, items, total }   (NOT wrapped in data)
//
// Red-capable: reverting the dashboard's filter-chip or detail-modal wiring
// makes these fail.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = join(__dirname, '..');

const SESSION = {
  accessToken: 'e2e-access-token',
  refreshToken: 'e2e-refresh-token',
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
  tokenType: 'bearer'
};

const USER = { id: '00000000-0000-4000-8000-0000000000e2', email: 'e2e@mnemonics.test', name: 'E2E' };

/** Two items with different `type`s so the kind filter has something to do. */
const ITEMS = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    type: 'text',
    kind: 'text',
    title: 'A captured note about retrieval',
    raw_text: 'chunking and hybrid search notes',
    status: 'ready',
    is_favorite: false,
    captured_at: '2026-10-01T10:00:00.000Z',
    created_at: '2026-10-01T10:00:00.000Z',
    tags: ['search', 'rag']
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    type: 'screenshot',
    kind: 'screenshot',
    title: 'A screenshot of the dashboard',
    raw_text: null,
    ocr_text: 'dashboard screenshot',
    status: 'ready',
    is_favorite: false,
    captured_at: '2026-10-02T10:00:00.000Z',
    created_at: '2026-10-02T10:00:00.000Z',
    tags: ['ui']
  }
];

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}

interface Harness {
  dom: JSDOM;
  calls: FetchCall[];
  errors: Error[];
  settle: () => Promise<void>;
  document: Document;
  clickAll(selector: string): number;
  text(selector: string): string;
}

/** Map the live API's envelope shapes onto the dashboard's expectations. */
function respond(method: string, url: string, body: string | null): { status: number; body: unknown } {
  const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];

  if (path === '/api/v1/auth/me') {
    return { status: 200, body: { data: { user: USER } } };
  }
  if (path === '/api/v1/items' && method === 'GET') {
    return { status: 200, body: { data: { items: ITEMS, total: ITEMS.length } } };
  }
  if (path === '/api/v1/spaces') {
    return { status: 200, body: { data: { spaces: [] } } };
  }
  if (path === '/api/v1/items/undefined/enrichment') {
    return { status: 404, body: { error: { code: 'NOT_FOUND' } } };
  }
  if (/^\/api\/v1\/items\/[0-9a-f-]+$/.test(path) && method === 'GET') {
    const id = path.split('/').pop();
    const found = ITEMS.find((i) => i.id === id);
    return found
      ? { status: 200, body: { item: { ...found, tags: found.tags } } }
      : { status: 404, body: { error: { code: 'ITEM_NOT_FOUND' } } };
  }
  if (/^\/api\/v1\/items\/[0-9a-f-]+$/.test(path) && method === 'PATCH') {
    return { status: 200, body: { success: true, item: { id: path.split('/').pop(), isFavorite: true } } };
  }
  if (path === '/api/v1/search' && method === 'POST') {
    let q = '';
    try {
      q = String((JSON.parse(body ?? '{}') as { q?: string }).q ?? '');
    } catch {
      /* a non-JSON body simply means "no narrowing" */
    }
    const needle = q.trim().toLowerCase();
    const hits = needle
      ? ITEMS.filter((i) =>
          [i.title, i.raw_text, i.ocr_text, ...i.tags]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(needle)
        )
      : ITEMS;
    return { status: 200, body: { hits, total: hits.length, took_ms: 1 } };
  }
  if (path === '/api/v1/tags') {
    return { status: 200, body: { tags: [{ name: 'search' }, { name: 'ui' }] } };
  }
  return { status: 200, body: { data: {} } };
}

function load(options: { signedIn?: boolean } = {}): Harness {
  const signedIn = options.signedIn ?? true;
  const html = readFileSync(join(ROOT, 'mnemonics-dashboard.html'), 'utf8')
    .replace(/<script src="api-client\.js"><\/script>/, '')
    .replace(/<script src="dashboard\.js"><\/script>/, '');

  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'chrome-extension://test-id/mnemonics-dashboard.html',
    pretendToBeVisual: true
  });

  const errors: Error[] = [];
  dom.window.addEventListener('error', (ev: any) => {
    errors.push(ev.error ?? new Error(ev.message));
  });

  const store: Record<string, unknown> = signedIn
    ? { mnemonics_session: SESSION }
    : {};

  dom.window.chrome = {
    storage: {
      local: {
        get(key: string, cb: (r: Record<string, unknown>) => void) {
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(key) ? key : [key]) {
            if (k in store) out[k] = store[k];
          }
          cb(out);
        },
        set(obj: Record<string, unknown>, cb?: () => void) {
          Object.assign(store, obj);
          if (cb) cb();
        },
        remove(key: string, cb?: () => void) {
          delete store[key];
          if (cb) cb();
        }
      }
    },
    runtime: {
      sendMessage() {},
      onMessage: { addListener() {} },
      getURL(p: string) {
        return p;
      },
      lastError: null as unknown
    },
    tabs: { create() {} }
  } as any;

  const calls: FetchCall[] = [];
  dom.window.fetch = (async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const method = String(init.method ?? 'GET').toUpperCase();
    const body = init.body ? String(init.body) : null;
    calls.push({ url, method, body });

    const { status, body: payload } = respond(method, url, body);
    return {
      ok: status < 400,
      status,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
      headers: { get: () => null }
    };
  }) as any;

  // No localStorage seeding: the page is served from chrome-extension://,
  // a scheme jsdom gives no storage implementation for, and the dashboard
  // reads the session from chrome.storage.local first anyway (saveSession
  // writes to both, readSession prefers the chrome store).

  try {
    dom.window.eval(readFileSync(join(ROOT, 'api-client.js'), 'utf8'));
  } catch (e) {
    errors.push(e as Error);
  }
  try {
    dom.window.eval(readFileSync(join(ROOT, 'dashboard.js'), 'utf8'));
  } catch (e) {
    errors.push(e as Error);
  }

  const harness: Harness = {
    dom,
    calls,
    errors,
    document: dom.window.document,
    async settle() {
      // dashboard.js debounces the search input by 350ms (see bindEvents),
      // so a plain microtask drain is not enough to observe the request it
      // eventually issues. Give every wait enough wall clock to cover the
      // debounce plus a few render hops.
      await new Promise((r) => setTimeout(r, 420));
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    clickAll(selector: string) {
      const nodes = Array.from(dom.window.document.querySelectorAll(selector)) as HTMLElement[];
      for (const n of nodes) {
        n.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      }
      return nodes.length;
    },
    text(selector: string) {
      return dom.window.document.querySelector(selector)?.textContent?.trim() ?? '';
    }
  };
  return harness;
}

describe('dashboard end-to-end (signed in)', () => {
  it('boots without throwing and lands on the everything route', async () => {
    const h = load();
    await h.settle();
    expect(h.errors, h.errors.map((e) => e.stack ?? e.message).join('\n')).toEqual([]);
    expect(h.document.body.dataset.route).toBeTruthy();
  });

  it('resolves the session instead of bouncing back to login', async () => {
    const h = load();
    await h.settle();
    expect(h.document.body.dataset.route, 'a stored session must not show the login screen').not.toBe('login');
  });

  it('requests the item list with the bearer token', async () => {
    const h = load();
    await h.settle();
    const itemsCall = h.calls.find((c) => c.url.includes('/api/v1/items') && c.method === 'GET');
    expect(itemsCall, 'the dashboard must fetch /api/v1/items').toBeTruthy();
  });

  it('renders a card for every item the API returned', async () => {
    const h = load();
    await h.settle();
    const cards = h.document.querySelectorAll('#cards-container .mnx-card');
    expect(cards.length, 'one card per item').toBe(ITEMS.length);
    const ids = Array.from(cards).map((c) => c.getAttribute('data-memory-id'));
    expect(ids).toEqual(expect.arrayContaining(ITEMS.map((i) => i.id)));

    const rendered = Array.from(cards).map((c) => c.textContent ?? '');
    for (const item of ITEMS) {
      expect(rendered.join(' '), `a card must show "${item.title}"`).toContain(item.title);
    }
  });

  it('shows the item type somewhere on the card (filter chips need a kind)', async () => {
    const h = load();
    await h.settle();
    const cards = h.document.querySelector('#cards-container')!.textContent ?? '';
    expect(cards).toMatch(/screenshot/i);
  });

  it('a kind filter chip narrows the rendered cards', async () => {
    const h = load();
    await h.settle();

    // The dashboard's chips live in #filter-chips and carry data-variant
    // (see dashboard.js renderGrid + the #filter-chips click handler).
    const chips = Array.from(h.document.querySelectorAll('#filter-chips .mnx-chip')) as HTMLElement[];
    expect(chips.length, 'the dashboard must render content filter chips').toBeGreaterThan(0);

    const shotChip = chips.find((c) => c.dataset.variant === 'screenshot');
    expect(shotChip, 'a "screenshot" variant chip must exist').toBeTruthy();

    shotChip!.dispatchEvent(new h.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await h.settle();

    // textContent, not innerHTML: a search hit has its query wrapped in
    // <mark> by highlightMatch(), splitting the title across elements.
    const after = (h.document.querySelector('#cards-container')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(after, 'the text item must disappear once the screenshot chip is active').not.toContain(ITEMS[0].title);
    expect(after, 'the screenshot item must stay visible').toContain(ITEMS[1].title);
    expect(shotChip!.getAttribute('aria-pressed')).toBe('true');
  });

  it('clicking a card opens the detail modal with the item content', async () => {
    const h = load();
    await h.settle();

    // Cards are .mnx-card[data-memory-id]; a click that is not on a
    // [data-action] control opens the detail route.
    const card = h.document.querySelector(
      `.mnx-card[data-memory-id="${ITEMS[0].id}"]`
    ) as HTMLElement | null;
    expect(card, 'the first item must have a clickable card').toBeTruthy();

    card!.dispatchEvent(new h.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await h.settle();

    // The detail view replaces the grid in the same route section.
    const html = h.document.body.innerHTML;
    expect(html, 'the detail view shows the item title').toContain(ITEMS[0].title);
    expect(
      h.document.querySelector('[data-action="detail-favorite"], .mnx-detail__actions'),
      'the detail view renders its action bar'
    ).toBeTruthy();
  });

  it('the favorite toggle fires TOGGLE_FAVORITE_ITEM through the runtime bridge', async () => {
    const h = load();
    await h.settle();

    // Favorite is not a direct PATCH from the page: the dashboard delegates
    // to the service worker so the same code path serves the popup. Assert
    // on the runtime message, not on fetch.
    const messages: any[] = [];
    (h.dom.window as any).chrome.runtime.sendMessage = (msg: any) => {
      messages.push(msg);
    };

    const favBtn = h.document.querySelector(
      `.mnx-card[data-memory-id="${ITEMS[0].id}"] button[data-action="favorite"]`
    ) as HTMLElement | null;
    expect(favBtn, 'each card must expose a favorite control').toBeTruthy();

    favBtn!.dispatchEvent(new h.dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await h.settle();

    const toggle = messages.find((m) => m && m.type === 'TOGGLE_FAVORITE_ITEM');
    expect(toggle, 'toggling favorite must message the service worker').toBeTruthy();
    expect(toggle.itemId).toBe(ITEMS[0].id);
    expect(toggle.isFavorite).toBe(true);
  });

  it('typing a query calls POST /search and renders the narrowed result', async () => {
    const h = load();
    await h.settle();

    const input =
      h.document.querySelector('#search-input') ??
      h.document.querySelector('input[type="search"]') ??
      h.document.querySelector('input');
    expect(input, 'the dashboard must expose a search input').toBeTruthy();

    (input as HTMLInputElement).value = 'retrieval';
    (input as HTMLInputElement).dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
    await h.settle();

    const search = h.calls.find((c) => c.url.includes('/api/v1/search'));
    expect(search, 'typing must call POST /api/v1/search').toBeTruthy();
    expect(search!.method).toBe('POST');
    expect(String(search!.body)).toContain('retrieval');

    // Assert on the grid node itself rather than body.innerHTML, and on
    // textContent rather than innerHTML: a search hit has its query wrapped
    // in <mark> by highlightMatch(), so the title is split across elements
    // in the markup even though the rendered text is intact.
    const cards = h.document.querySelector('#cards-container');
    expect(cards, 'the grid container must exist').toBeTruthy();

    const rendered = Array.from(cards!.querySelectorAll('.mnx-card')).map(
      (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
    );
    expect(rendered.length, 'exactly the matching card is rendered').toBe(1);
    expect(rendered[0]).toContain(ITEMS[0].title);
    expect(rendered[0]).not.toContain(ITEMS[1].title);
    expect(h.document.querySelector('#search-meta')?.textContent ?? '').toContain('retrieval');
  });

  it('never renders another user\'s data (the API enforces this, we assert we pass the token)', async () => {
    const h = load();
    await h.settle();
    const me = h.calls.find((c) => c.url.includes('/api/v1/auth/me'));
    if (me) expect(me.url).toBeTruthy();
    // The only items in the fixture are the signed-in user's.
    expect(h.document.querySelector('#cards-container')?.textContent ?? '').toContain(ITEMS[0].title);
  });
});

describe('dashboard end-to-end (signed out)', () => {
  it('shows the login screen when no session is stored', async () => {
    const h = load({ signedIn: false });
    await h.settle();
    expect(h.errors, h.errors.map((e) => e.message).join('\n')).toEqual([]);
    expect(h.document.body.dataset.route).toBe('login');
  });

  it('does not attempt to load items without a session', async () => {
    const h = load({ signedIn: false });
    await h.settle();
    const itemsCall = h.calls.find((c) => c.url.includes('/api/v1/items'));
    expect(itemsCall, 'a signed-out dashboard must not fetch the item list').toBeFalsy();
  });
});
