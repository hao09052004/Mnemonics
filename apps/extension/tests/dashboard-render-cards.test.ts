/**
 * Smoke tests for the smooth-scroll reconciliation logic in
 * `renderCards`. We mount a fake container and assert that two
 * consecutive renders with the same data produce *zero* DOM mutations
 * on the second pass. The 3-second background sync was previously
 * tearing the whole list down (causing the visible "lag behind my
 * scroll" jank) — this test pins the no-op optimisation in place.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function createFakeContainer() {
  // Track every child identity across renders so we can assert no-op
  // semantics — the same identity must be reused when the data is
  // identical.
  const store: any[] = [];
  const counter = { next: 0 };
  function makeChild(id: string) {
    return {
      marker: counter.next++,
      id,
      getAttribute(name: string) {
        if (name === 'data-memory-id') return id;
        return '';
      }
    };
  }
  const container: any = {
    _html: '',
    children: store,
    get innerHTML() { return this._html; },
    set innerHTML(v: string) {
      this._html = v;
      store.length = 0;
      if (!v) return;
      // Each top-level `<div class="memory-card" data-memory-id="X">…`
      // becomes one DomNode in our store. We don't parse the full HTML
      // — the renderer only cares about child count + identity for
      // the no-op path.
      const matches = v.match(/data-memory-id="([^"]+)"/g) || [];
      for (const m of matches) {
        const id = m.match(/data-memory-id="([^"]+)"/)![1];
        store.push(makeChild(id));
      }
    },
    appendChild(node: any) {
      // Real DOM nodes: push a single marker. A fragment carries its
      // own `_parsed` array — append that wholesale so surgical /
      // full-replace paths both end up with the right number of
      // children visible in container.children.
      if (node && Array.isArray(node._parsed)) {
        for (const child of node._parsed) store.push(child);
      } else if (node) {
        store.push(node);
      }
    }
  };
  return { container, store, counter, makeChild };
}

function loadDashboardModule() {
  const src = readFileSync(
    join(__dirname, '..', 'dashboard.js'),
    'utf8'
  );
  const marker = "document.addEventListener('DOMContentLoaded'";
  const idx = src.indexOf(marker);
  const stripped = idx >= 0 ? src.slice(0, idx) : src;

  function buildDocStub(fake: ReturnType<typeof createFakeContainer>) {
  const counter = fake.counter;
  const store = fake.store;
  return {
    addEventListener: () => {},
    getElementById: (id: string) => {
      if (id === 'cards-container') return fake.container;
      // item-count + a few other ids the renderer touches — return a
      // stub element with a no-op textContent setter.
      return { textContent: '', innerHTML: '', value: '' };
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    body: { classList: { toggle: () => {} } },
    visibilityState: 'visible',
    createElement: (tag: string) => {
      let firstChild: any = null;
      return {
        tag,
        get innerHTML() { return ''; },
        set innerHTML(v: string) {
          // The reconciler does `tmp.innerHTML = cardHtmls[idx]` then
          // reads `tmp.firstElementChild`. We hand back a synthetic
          // child carrying the same id so the surgical path can
          // identify it later.
          const match = (v.match(/data-memory-id="([^"]+)"/) || [])[1];
          firstChild = match ? fake.makeChild(match) : null;
        },
        get firstElementChild() { return firstChild; },
        appendChild: () => {}
      };
    },
    createDocumentFragment: () => ({
      // When `appendChild` is called we move the parsed nodes from
      // the fragment into the container's store. The reconciler reads
      // them back via container.children.
      _parsed: [] as any[],
      appendChild(node: any) {
        this._parsed.push(node);
      }
    }),
    createRange: () => ({
      createContextualFragment: (s: string) => {
        // The full-replace path only uses createContextualFragment to
        // convert a string of HTML into nodes. We don't actually
        // parse — instead we hand back one synthetic node per
        // data-memory-id marker we recognise.
        const matches = s.match(/data-memory-id="([^"]+)"/g) || [];
        const nodes = matches.map((m: string) => {
          const id = m.match(/data-memory-id="([^"]+)"/)![1];
          return fake.makeChild(id);
        });
        return {
          _parsed: nodes,
          appendChild(node: any) {
            this._parsed.push(node);
          },
          get childNodes() { return nodes; }
        } as any;
      }
    })
  };
}
  const docStub: any = buildDocStub(fake);
  const winStub: any = { matchMedia: () => ({ addEventListener: () => {}, addListener: () => {} }) };

  // Pull the renderCards function out of the module body so we can
  // call it directly with synthetic data.
  const sandboxFn = new Function(
    'chrome', 'document', 'window', 'localStorage', 'crypto', 'console', 'Date', 'Map', 'Set', 'JSON', 'fetch',
    stripped + '\nreturn { renderCards };'
  );
  const exported = sandboxFn(
    { storage: { local: { get: () => {}, set: () => {}, remove: () => {} } }, runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } }, tabs: { query: () => {} } },
    docStub,
    winStub,
    globalThis.localStorage,
    globalThis.crypto,
    console,
    Date,
    Map,
    Set,
    JSON
  );
  return exported;
}

let fake: ReturnType<typeof createFakeContainer>;
let renderCards: any;

beforeEach(() => {
  fake = createFakeContainer();
  // jsdom doesn't exist in this package — we mount our lightweight
  // fake container before loading the module so the `renderCards`
  // function closes over the right reference.
  renderCards = loadDashboardModule().renderCards;
});

describe('renderCards smooth-scroll reconciliation', () => {
  it('skips DOM mutations when the data round-trips unchanged', () => {
    const data = [
      { id: 'a', type: 'note', title: 'Hello', note: ' ', tags: [], space: 'Work', date: 'Today' },
      { id: 'b', type: 'link', title: 'World', note: ' ', tags: [], space: 'Work', date: 'Today', url: 'https://example.com' }
    ];

    renderCards(data);
    const firstCount = fake.store.length;
    const firstIdentity = fake.store.map((n: any) => n.marker);

    renderCards(data);
    const secondCount = fake.store.length;
    const secondIdentity = fake.store.map((n: any) => n.marker);

    expect(secondCount).toBe(firstCount);
    expect(secondIdentity).toEqual(firstIdentity);
  });

  it('keeps the card count stable when one card mutates', () => {
    const before_data = [
      { id: 'a', type: 'note', title: 'Hello', note: ' ', tags: [], space: 'Work', date: 'Today' },
      { id: 'b', type: 'link', title: 'World', note: ' ', tags: [], space: 'Work', date: 'Today', url: 'https://example.com' }
    ];
    const after_data = [
      { id: 'a', type: 'note', title: 'Hello', note: ' ', tags: [], space: 'Work', date: 'Today' },
      { id: 'b', type: 'link', title: 'World', note: 'EDITED', tags: [], space: 'Work', date: 'Today', url: 'https://example.com' }
    ];

    renderCards(before_data);
    const firstCount = fake.store.length;

    renderCards(after_data);
    const secondCount = fake.store.length;

    // Both cards must remain visible even when one mutates.
    expect(firstCount).toBe(2);
    expect(secondCount).toBe(2);
  });

  it('handles appending a new card at the end without losing existing ones', () => {
    const initial = [
      { id: 'a', type: 'note', title: 'Hello', note: ' ', tags: [], space: 'Work', date: 'Today' }
    ];
    const with_extra = [
      { id: 'a', type: 'note', title: 'Hello', note: ' ', tags: [], space: 'Work', date: 'Today' },
      { id: 'b', type: 'link', title: 'World', note: ' ', tags: [], space: 'Work', date: 'Today', url: 'https://example.com' }
    ];

    renderCards(initial);
    const firstCount = fake.store.length;

    renderCards(with_extra);
    const secondCount = fake.store.length;

    expect(firstCount).toBe(1);
    expect(secondCount).toBe(2);
  });

  it('handles clearing back to empty state without throwing', () => {
    const data = [
      { id: 'a', type: 'note', title: 'Hello', note: ' ', tags: [], space: 'Work', date: 'Today' }
    ];

    renderCards(data);
    expect(() => renderCards([])).not.toThrow();
  });
});

describe('favorites filter behaviour', () => {
  function getSorter() {
    const src = readFileSync(
      join(__dirname, '..', 'dashboard.js'),
      'utf8'
    );
    const marker = "document.addEventListener('DOMContentLoaded'";
    const idx = src.indexOf(marker);
    const stripped = idx >= 0 ? src.slice(0, idx) : src;

    const sandboxFn = new Function(
      'chrome', 'document', 'window', 'localStorage', 'crypto', 'console', 'Date', 'Map', 'Set', 'JSON', 'fetch',
      stripped + '\nreturn { applySortFilter, setFavoritesOnlyForTests };'
    );
    return sandboxFn(
      { storage: { local: { get: () => {}, set: () => {}, remove: () => {} } }, runtime: { sendMessage: () => {}, onMessage: { addListener: () => {} } }, tabs: { query: () => {} } },
      { addEventListener: () => {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { toggle: () => {} } }, visibilityState: 'visible' },
      { matchMedia: () => ({ addEventListener: () => {}, addListener: () => {} }) },
      globalThis.localStorage,
      globalThis.crypto,
      console,
      Date,
      Map,
      Set,
      JSON
    );
  }

  function makeItem(id: string, isFavorite: boolean) {
    return {
      id,
      type: 'note',
      title: 'Item ' + id,
      note: 'body',
      excerpt: '',
      tags: [],
      space: '',
      date: '',
      sourceType: '',
      capturedAt: new Date(),
      isFavorite
    };
  }

  it('keeps every item when currentFavoritesOnly is false', () => {
    const { applySortFilter, setFavoritesOnlyForTests } = getSorter();
    setFavoritesOnlyForTests(false);
    const data = [makeItem('a', true), makeItem('b', false), makeItem('c', true)];
    const result = applySortFilter(data);
    expect(result.map((i: any) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('drops non-favorites when currentFavoritesOnly is true', () => {
    const { applySortFilter, setFavoritesOnlyForTests } = getSorter();
    setFavoritesOnlyForTests(true);
    try {
      const data = [makeItem('a', true), makeItem('b', false), makeItem('c', true)];
      const result = applySortFilter(data);
      expect(result.map((i: any) => i.id)).toEqual(['a', 'c']);
    } finally {
      setFavoritesOnlyForTests(false);
    }
  });
});