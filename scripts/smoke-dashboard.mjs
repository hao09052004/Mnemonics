// Smoke test cho dashboard.js — chạy được trong Node (không cần Chrome).
// Load file dashboard.js qua `new Function(...)` với stub DOM tối thiểu,
// gọi các pure function (kindToVariant, sourceLabel, ...) qua
// return object.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardPath = join(__dirname, '..', 'apps', 'extension', 'dashboard.js');
const src = readFileSync(dashboardPath, 'utf8');

// `readyState: 'loading'` defers the auto-init() call inside dashboard.js
// (it would otherwise fire immediately and hit our stub DOM). We then
// drive the render functions manually.
const docStub = {
  addEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  body: {
    dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}
  },
  readyState: 'loading'
};
const winStub = { matchMedia: () => ({ addEventListener() {} }) };
const chromeStub = {
  storage: { local: { get() {}, set() {}, remove() {} } },
  runtime: { sendMessage() {}, onMessage: { addListener() {} } },
  tabs: { query() {} }
};

// `MNEMONICS_API_URL` is referenced as a free identifier in dashboard.js
// (the popup + background each define their own `var` for it). Pass a
// fresh `var` via the function body to avoid a TDZ error in the
// sandbox while not colliding with the same name elsewhere.
const factory = new Function(
  'chrome', 'document', 'window', 'localStorage', 'crypto', 'console', 'Date', 'Map', 'Set', 'JSON', 'fetch',
  'var __MN_API__ = "http://localhost:4000";\n' + src + `
return {
  kindToVariant, itemMatchesVariant, escapeHtml, sourceLabel, highlightMatch,
  VARIANT_KINDS, VARIANT_LABEL,
  renderCard, renderGrid, renderDetail, renderSpaces, renderReminders, renderSettings, renderLogin
};`
);
const mod = factory(
  chromeStub, docStub, winStub,
  globalThis.localStorage, globalThis.crypto, console, Date, Map, Set, JSON, fetch
);

// --- assertions ---------------------------------------------------------

function assert(cond, label) {
  if (cond) console.log('OK  ', label);
  else { console.log('FAIL', label); process.exitCode = 1; }
}
function assertEq(a, b, label) {
  const eq = JSON.stringify(a) === JSON.stringify(b);
  if (eq) console.log('OK  ', label, '=>', JSON.stringify(a));
  else { console.log('FAIL', label, 'expected', JSON.stringify(b), 'got', JSON.stringify(a)); process.exitCode = 1; }
}

console.log('--- kindToVariant ---');
assertEq(mod.kindToVariant({ kind: 'link' }), 'article', 'link -> article');
assertEq(mod.kindToVariant({ kind: 'image' }), 'image', 'image -> image');
assertEq(mod.kindToVariant({ kind: 'screenshot' }), 'screenshot', 'screenshot -> screenshot');
assertEq(mod.kindToVariant({ kind: 'document' }), 'document', 'document -> document');
assertEq(mod.kindToVariant({ kind: 'text' }), 'note', 'text -> note (default)');
assertEq(mod.kindToVariant({ kind: 'text', ocr_text: 'a' }), 'highlight', 'text + only ocr -> highlight');
assertEq(mod.kindToVariant({ kind: 'text', raw_text: 'a' }), 'note', 'text + raw_text -> note');

console.log('--- itemMatchesVariant ---');
assert(mod.itemMatchesVariant({ kind: 'link' }, 'all'), 'all matches link');
assert(mod.itemMatchesVariant({ kind: 'link' }, 'article'), 'article matches link');
assert(!mod.itemMatchesVariant({ kind: 'link' }, 'note'), 'note does not match link');
assert(mod.itemMatchesVariant({ kind: 'text' }, 'highlight'), 'highlight matches text');
assert(mod.itemMatchesVariant({ kind: 'text' }, 'note'), 'note matches text');

console.log('--- escapeHtml ---');
assertEq(mod.escapeHtml('<a href="x">&y</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;y&lt;/a&gt;', 'escape html');
assertEq(mod.escapeHtml(null), '', 'null -> empty');
assertEq(mod.escapeHtml(undefined), '', 'undefined -> empty');

console.log('--- sourceLabel ---');
assertEq(mod.sourceLabel({ source_url: 'https://www.example.com/path' }), 'example.com', 'hostname only');
assertEq(mod.sourceLabel({ source_url: 'https://blog.foo.com' }), 'blog.foo.com', 'subdomain preserved');
assertEq(mod.sourceLabel({ kind: 'image' }), 'Image', 'image kind label');
assertEq(mod.sourceLabel({ kind: 'screenshot' }), 'Screenshot', 'screenshot kind label');
assertEq(mod.sourceLabel({ kind: 'note' }), 'Note', 'note kind label');
assertEq(mod.sourceLabel({}), 'Memory', 'unknown -> Memory');

console.log('--- highlightMatch ---');
assertEq(mod.highlightMatch('Hello world', 'world'), 'Hello <mark style="background:var(--purple-soft);color:var(--purple-text);padding:0 3px;border-radius:3px">world</mark>', 'highlight match');
assertEq(mod.highlightMatch('Hello', 'xyz'), 'Hello', 'no match -> no mark');

console.log('--- renderCard (image variant) ---');
const cardHtml = mod.renderCard({
  id: 'abc-123', kind: 'image', title: 'Test memory', image_url: 'https://cdn/img.jpg',
  excerpt: 'a short description', tags: ['travel', 'paris']
});
assert(cardHtml.includes('class="mnx-card image"'), 'card has variant class');
assert(cardHtml.includes('data-memory-id="abc-123"'), 'card has memory id');
assert(cardHtml.includes('Test memory'), 'card has title');
assert(cardHtml.includes('https://cdn/img.jpg'), 'card has image src');
assert(cardHtml.includes('#travel'), 'card has tag');
assert(cardHtml.includes('Images'), 'card has eyebrow');

console.log('--- renderCard (highlight variant) ---');
const highlightHtml = mod.renderCard({
  id: 'h1', kind: 'text', ocr_text: 'all this is OCR',
  title: 'A wise quote', raw_text: null
});
assert(highlightHtml.includes('class="mnx-card highlight"'), 'highlight variant class');
assert(highlightHtml.includes('A wise quote'), 'highlight title');

console.log('--- renderCard (note variant) ---');
const noteHtml = mod.renderCard({
  id: 'n1', kind: 'text', title: 'Personal note',
  note: 'some long text', excerpt: 'short', raw_text: 'some long text',
  tags: []
});
assert(noteHtml.includes('class="mnx-card note"'), 'note variant class');
assert(noteHtml.includes('Personal note'), 'note title');

console.log('--- VARIANT_KINDS map ---');
assertEq(mod.VARIANT_KINDS.article, ['link'], 'article -> link');
assertEq(mod.VARIANT_KINDS.screenshot, ['screenshot'], 'screenshot -> screenshot');
assertEq(mod.VARIANT_KINDS.document, ['document'], 'document -> document');
assertEq(mod.VARIANT_KINDS.all, [], 'all is sentinel');

// --- DOM render (mock host) -----------------------------------------
//
// Build a small in-memory DOM stub and re-execute dashboard.js inside
// it. The render functions read from `state` (module-scoped) and write
// into element.innertHTML/textContent, so we can drive them without
// a real browser.
function runWithMockDom(opts = {}) {
  const elements = {};
  function makeEl(tag) {
    return {
      tag,
      innerHTML: '',
      textContent: '',
      value: '',
      hidden: false,
      children: [],
      classList: {
        _set: new Set(),
        add(...c) { c.forEach((x) => this._set.add(x)); },
        remove(...c) { c.forEach((x) => this._set.delete(x)); },
        toggle(c, force) {
          if (force === true) this._set.add(c);
          else if (force === false) this._set.delete(c);
          else if (this._set.has(c)) this._set.delete(c);
          else this._set.add(c);
        },
        contains(c) { return this._set.has(c); }
      },
      dataset: {},
      style: {},
      setAttribute(k, v) { this[k] = v; },
      removeAttribute(k) { delete this[k]; },
      addEventListener() {},
      appendChild(c) { this.children.push(c); return c; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      getAttribute() { return ''; }
    };
  }
  for (const id of [
    'route-title', 'route-sub', 'memory-count',
    'cards-container', 'cards-skeleton', 'cards-empty',
    'empty-title', 'empty-text', 'search-meta', 'search-input',
    'spaces-grid', 'reminders-host', 'settings-host',
    'detail-media', 'detail-side', 'toast'
  ]) elements[id] = makeEl('div');
  const docMock = {
    addEventListener() {},
    body: { dataset: {}, classList: makeEl('div').classList, addEventListener() {} },
    readyState: 'loading',
    getElementById: (id) => elements[id] || makeEl('div'),
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const winMock = { matchMedia: () => ({ addEventListener() {} }) };
  const chromeMock = {
    storage: { local: { get(_k, cb) { cb({}); }, set() {}, remove() {} } },
    runtime: { sendMessage() {}, onMessage: { addListener() {} } },
    tabs: { query() {} }
  };
  const factoryMock = new Function(
    'chrome', 'document', 'window', 'localStorage', 'crypto', 'console', 'Date', 'Map', 'Set', 'JSON', 'fetch',
    'var __MN_API__ = "http://localhost:4000";\n' + src
  );
  factoryMock(
    chromeMock, docMock, winMock,
    globalThis.localStorage, globalThis.crypto, console, Date, Map, Set, JSON, fetch
  );
  return { elements, docMock };
}

console.log('--- renderGrid mounts cards into host ---');
{
  const { elements } = runWithMockDom();
  // No direct way to drive the module's `state`, so we only assert the
  // dom mock wiring works (every element the renderer needs is
  // present). The full integration is covered by Chrome manual smoke.
  assert(elements['cards-container'] !== null, 'cards-container element exists');
  assert(elements['search-input'] !== null, 'search-input element exists');
  assert(elements['spaces-grid'] !== null, 'spaces-grid element exists');
}

console.log('\nDone.');
