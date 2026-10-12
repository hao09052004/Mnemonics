# M1 — Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make browser-extension page capture one-click, zero-friction,
and metadata-rich, so a single click persists a memory with full
JSON-LD / Open Graph / Readability data attached, ready for M2
classification.

**Architecture:** The extension runs an in-tab metadata extraction
(Readability + JSON-LD + Open Graph), then POSTs the canonical
`source_metadata` blob alongside the existing capture payload. The
API persists `source_metadata` in a new additive column on
`items`. The existing capture pipeline (tag → embed → enrich) is
unchanged. M2 will read from `items.source_metadata` to feed the
classifier.

**Tech Stack:** TypeScript 5.4 (apps/extension, apps/api,
packages/shared), Node 22, `@mozilla/readability` (new
extension-only dependency), no API/database new dependencies.

**Spec:** [`../0005-core-capture-classification-smart-search.md`](../0005-core-capture-classification-smart-search.md)
§1 (Purpose), §4 (Principles), §5.5 (Source metadata), §6 (Capture
pipeline), §6.4 (Page extraction in the extension), §6.5 (Failure
isolation), §14 (Migrations), §17 (Milestones).

## Global Constraints

- The existing capture contract (`captureInputSchema` in
  `packages/shared/src/index.ts`) MUST NOT change. New metadata
  arrives through a sibling optional field.
- No destructive schema rewrites. New column is
  `ALTER TABLE items ADD COLUMN IF NOT EXISTS source_metadata JSONB`.
- The migration is additive and idempotent. No existing row is
  touched.
- The Readability library is bundled into the extension only.
  `apps/api` does not gain a new dependency.
- Readability is bounded: 4-second hard timeout, 100 000-character
  text cap, sanitized output.
- All Vietnamese error / log strings stay English in the API
  (existing convention).
- `pnpm typecheck`, `pnpm test`, and `pnpm build` are green at
  the end of every task.
- PR #16 fixes (working web capture dialogs, shared query
  embeddings) are preserved. No reverts, no "improvements" of
  adjacent code.

## Review Focus

1. **Readability extraction is bounded.** A pathological page
   (1MB HTML, 50 000 nodes) must finish or fail within 4 seconds
   and never block the service worker. Test: a 1.2 MB HTML
   fixture must complete within 4.5 seconds on the test runner.
2. **A failed extraction falls back to the existing title path.**
   When Readability throws or times out, the extension sends the
   same payload it sent before M1. The persisted memory must
   have `source_metadata IS NULL` or `source_metadata.article IS
   NULL`, never a partial object.
3. **A failed server-side persistence leaves no orphan storage.**
   The existing `imageStorage.remove` cleanup in
   `apps/api/src/routes/capture.ts` already covers images. The
   document path is unchanged. The new field has no storage
   implications.
4. **`source_metadata` does not leak into responses.** The
   `GET /api/v1/items/:id` and `/api/v1/items` list responses
   must not include the new field (yet — M2 surfaces it). A
   test must assert the absence in the response shape.
5. **The "Save as Space" affordance is unaffected.** M1 must not
   change `space-rule.ts`, `spaces.ts`, or the rule shape. A
   Smart Space created today keeps working tomorrow.

Each is wired to a task's test list.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/extension/manifest.json` | Add `readability.js` (vendored bundle) to `web_accessible_resources` if needed. |
| `apps/extension/readability.js` | Vendored copy of `@mozilla/readability` (or a minimal HTML extractor) usable from the service worker. |
| `apps/extension/extraction.js` | New module: `extractPageMetadata()` returning `ExtractedPage`. Bounded 4s timeout. |
| `apps/extension/extension.js` | Call `extractPageMetadata` on popup open and before send; show "Reading page…" pill while in flight. |
| `apps/extension/background.js` | Extend `uploadTextCapture` to accept `source_metadata`; do not extract server-side. |
| `apps/extension/extension.css` | Add `.reading-pill` style. |
| `packages/shared/src/index.ts` | Add `sourceMetadataSchema` (Zod); add `source_metadata?` to each capture variant. |
| `apps/api/src/routes/capture.ts` | Persist `source_metadata` on item create. Validate at the route boundary. |
| `apps/api/src/storage.ts` (no change unless needed) | — |
| `packages/database/src/item-repository.ts` | Extend `createPendingItem` to accept `sourceMetadata`. |
| `packages/database/src/item-repository.test.ts` (new) | Unit tests for the new column. |
| `packages/database/migrations/026_items_source_metadata.sql` | New migration. |
| `apps/extension/__tests__/extraction.test.mjs` (new) | Unit tests for `extractPageMetadata`. |
| `apps/api/src/routes/__tests__/capture-source-metadata.test.ts` (new) | HTTP-level test. |
| `docs/core-capture-workflow.md` (new) | Operator-facing doc. |
| `specs/data/extraction-fixtures/*.html` (new) | Deterministic test fixtures (product, article, recipe, no-meta). |

---

## Task 1: Add `source_metadata` to `items`

**Files:**
- Create: `packages/database/migrations/026_items_source_metadata.sql`
- Modify: `packages/database/src/item-repository.ts` (accept the new field on create)
- Test: `packages/database/src/item-repository.test.ts` (new file)

**Interfaces:**
- Consumes: `ItemRepository.createPendingItem({ userId, capture })` already accepts the capture.
- Produces: same signature, with one extra field on the persisted row.

- [ ] **Step 1: Write the failing test**

```ts
// packages/database/src/item-repository.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPool } from 'pg';
import { createItemRepository } from './item-repository.js';

const skipIfNoDb = !process.env.DATABASE_URL;
describe.skipIf(skipIfNoDb)('ItemRepository — source_metadata', () => {
  let pool;
  let userId;
  beforeEach(async () => {
    pool = createPool(process.env.DATABASE_URL);
    const res = await pool.query(
      `INSERT INTO auth.users (id, raw_user_meta_data)
       VALUES (gen_random_uuid(), jsonb_build_object('email', $1))
       RETURNING id`,
      [`smeta-${Date.now()}@example.com`]
    );
    userId = res.rows[0].id;
  });
  afterEach(async () => {
    await pool.query(`DELETE FROM items WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
    await pool.end();
  });
  it('persists source_metadata on a link capture', async () => {
    const repo = createItemRepository(pool);
    const sourceMetadata = {
      ogTitle: 'Wooden Chair — A timeless piece',
      jsonLd: [{ '@type': 'Product', 'name': 'Wooden Chair', 'material': 'Wood' }],
      article: null,
      contentHash: 'sha256:abcd'
    };
    const item = await repo.createPendingItem({
      userId,
      capture: {
        type: 'link',
        title: 'Wooden Chair',
        sourceUrl: 'https://example.com/chair',
        clientRequestId: crypto.randomUUID()
      },
      sourceMetadata
    });
    const res = await pool.query(`SELECT source_metadata FROM items WHERE id = $1`, [item.id]);
    expect(res.rows[0].source_metadata).toEqual(sourceMetadata);
  });
  it('leaves source_metadata NULL when not provided', async () => {
    const repo = createItemRepository(pool);
    const item = await repo.createPendingItem({
      userId,
      capture: {
        type: 'link',
        title: 'no metadata',
        sourceUrl: 'https://example.com/x',
        clientRequestId: crypto.randomUUID()
      }
    });
    const res = await pool.query(`SELECT source_metadata FROM items WHERE id = $1`, [item.id]);
    expect(res.rows[0].source_metadata).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @mnemonics/database exec vitest run src/item-repository.test.ts`
Expected: FAIL with `column "source_metadata" of relation "items" does not exist`.

- [ ] **Step 3: Add the migration**

```sql
-- packages/database/migrations/026_items_source_metadata.sql
BEGIN;
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS source_metadata JSONB;
CREATE INDEX IF NOT EXISTS items_source_metadata_gin
  ON items USING GIN (source_metadata jsonb_path_ops);
COMMIT;
```

- [ ] **Step 4: Extend the repository**

In `packages/database/src/item-repository.ts`, find the `INSERT` in
`createPendingItem` and add a new parameter:

```ts
export interface CreateItemInput {
  userId: string;
  capture: CaptureInput;
  sourceMetadata?: Record<string, unknown> | null;
}
```

Persist `source_metadata = $N` with the new field, or `NULL` when
omitted. Reuse the existing parameterized query pattern.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @mnemonics/database exec vitest run src/item-repository.test.ts`
Expected: PASS (2/2).

- [ ] **Step 6: Run the existing test suite for regression**

Run: `pnpm --filter @mnemonics/database exec vitest run`
Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add packages/database/migrations/026_items_source_metadata.sql \
        packages/database/src/item-repository.ts \
        packages/database/src/item-repository.test.ts
git commit -m "feat(db): add items.source_metadata column"
```

---

## Task 2: Add `sourceMetadataSchema` to the shared contract

**Files:**
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `sourceMetadataSchema` (Zod); optional `source_metadata` field on every capture variant.

- [ ] **Step 1: Define the schema**

In `packages/shared/src/index.ts`, append (or merge with the
existing capture section):

```ts
export const sourceMetadataSchema = z.object({
  ogTitle: z.string().max(2000).optional(),
  ogDescription: z.string().max(5000).optional(),
  ogImage: z.string().url().max(2048).optional(),
  canonicalUrl: z.string().url().max(2048).optional(),
  jsonLd: z.array(z.record(z.unknown())).max(20).optional(),
  article: z
    .object({
      title: z.string().max(2000).optional(),
      byline: z.string().max(500).optional(),
      excerpt: z.string().max(2000).optional(),
      contentHtml: z.string().max(500_000).optional(),
      textContent: z.string().max(100_000).optional()
    })
    .nullable()
    .optional(),
  contentHash: z.string().max(128).optional()
}).strict();
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;
```

Add `source_metadata: sourceMetadataSchema.optional()` to each
existing capture variant. The `.strict()` rejects unknown keys
the extension might send.

- [ ] **Step 2: Run the shared typecheck**

Run: `pnpm --filter @mnemonics/shared exec tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "feat(shared): add sourceMetadataSchema to capture contract"
```

---

## Task 3: Persist `source_metadata` in the capture route

**Files:**
- Modify: `apps/api/src/routes/capture.ts` (text and image paths)
- Test: `apps/api/src/routes/__tests__/capture-source-metadata.test.ts` (new)

**Interfaces:**
- Consumes: `captureInputSchema` now carries `source_metadata?`.
- Produces: a row with `source_metadata` set.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/routes/__tests__/capture-source-metadata.test.ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';

describe('POST /api/v1/captures — source_metadata', () => {
  it('persists the metadata blob when provided', async () => {
    const app = createApp(/* test deps */);
    const response = await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .send({
        type: 'link',
        title: 'Wooden Chair',
        sourceUrl: 'https://example.com/chair',
        clientRequestId: crypto.randomUUID(),
        source_metadata: {
          ogTitle: 'Wooden Chair',
          jsonLd: [{ '@type': 'Product', 'material': 'Wood' }],
          contentHash: 'sha256:abcd'
        }
      });
    expect(response.status).toBe(201);
    expect(response.body.data.source_metadata).toEqual({
      ogTitle: 'Wooden Chair',
      jsonLd: [{ '@type': 'Product', 'material': 'Wood' }],
      contentHash: 'sha256:abcd'
    });
  });
  it('does not echo source_metadata in the GET response', async () => {
    // M1 intentionally hides the field from the wire until M2 surfaces it.
    const app = createApp(/* test deps */);
    const create = await request(app)
      .post('/api/v1/captures')
      .set('Authorization', 'Bearer mnemonics-dev-token')
      .send({ /* …with source_metadata… */ });
    const id = create.body.data.id;
    const read = await request(app)
      .get('/api/v1/items/' + id)
      .set('Authorization', 'Bearer mnemonics-dev-token');
    expect(read.body.item).not.toHaveProperty('source_metadata');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mnemonics/api exec vitest run src/routes/__tests__/capture-source-metadata.test.ts`
Expected: FAIL — `source_metadata` is not persisted.

- [ ] **Step 3: Wire the route**

In `apps/api/src/routes/capture.ts`, the text capture handler
(line ~110) and the image handler (line ~165) both call
`repository.createPendingItem(...)`. Add a `sourceMetadata`
parameter. In `app.ts`'s response shape (line ~80), do NOT echo
`source_metadata` back. The image route does not change beyond
accepting the optional field.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @mnemonics/api exec vitest run src/routes/__tests__/capture-source-metadata.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Run the full API test suite for regression**

Run: `pnpm --filter @mnemonics/api exec vitest run`
Expected: All existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/capture.ts \
        apps/api/src/routes/__tests__/capture-source-metadata.test.ts
git commit -m "feat(api): persist source_metadata on capture (M1)"
```

---

## Task 4: Vendor `@mozilla/readability` for the extension

**Files:**
- Modify: `apps/extension/package.json` (add `@mozilla/readability`)
- Create: `apps/extension/readability-loader.js` (or copy the
  vendored file under `apps/extension/vendor/readability/`)

**Interfaces:**
- Produces: a `readabilityLoader` module the service worker can
  load. No new global pollution.

- [ ] **Step 1: Add the dependency**

```bash
pnpm --filter extension add @mozilla/readability
```

(If the extension is not a pnpm workspace member, install the
  vendored file directly into `apps/extension/vendor/`.)

- [ ] **Step 2: Write a load smoke test**

```js
// apps/extension/__tests__/readability-load.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

test('readability is loadable from the extension', async () => {
  const mod = await import('../readability-loader.js');
  assert.equal(typeof mod.parseArticle, 'function');
});
```

- [ ] **Step 3: Wire the loader**

The loader reads the current document, clones it, runs
`new Readability(doc).parse()`, and returns the parsed object
wrapped in a try/catch. The loader is the **only** place the
Readability API is called.

- [ ] **Step 4: Run the smoke test**

Run: `pnpm --filter @mnemonics/extension-tests exec vitest run __tests__/readability-load.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/package.json apps/extension/readability-loader.js \
        apps/extension/__tests__/readability-load.test.mjs
git commit -m "feat(extension): vendor @mozilla/readability for in-tab extraction"
```

---

## Task 5: `extractPageMetadata()` with bounded timeout

**Files:**
- Create: `apps/extension/extraction.js`
- Create: `apps/extension/__tests__/extraction.test.mjs`
- Create: `specs/data/extraction-fixtures/{product,article,recipe,nometa}.html`

**Interfaces:**
- Produces: `extractPageMetadata(): Promise<ExtractedPage | null>`.
  Bounded 4-second timeout. `null` on any failure.

- [ ] **Step 1: Write the failing test**

```js
// apps/extension/__tests__/extraction.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPageMetadata } from '../extraction.js';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const fixtures = {
  product: readFileSync('specs/data/extraction-fixtures/product.html', 'utf8'),
  article: readFileSync('specs/data/extraction-fixtures/article.html', 'utf8'),
  recipe: readFileSync('specs/data/extraction-fixtures/recipe.html', 'utf8'),
  nometa: readFileSync('specs/data/extraction-fixtures/nometa.html', 'utf8')
};

function makeDom(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/' });
  return dom.window.document;
}

test('product fixture extracts JSON-LD Product', async () => {
  const out = await extractPageMetadata(makeDom(fixtures.product), 'https://example.com/chair');
  assert.equal(out.ogTitle, 'Wooden Chair');
  assert.equal(out.jsonLd[0]['@type'], 'Product');
  assert.equal(out.jsonLd[0].material, 'Wood');
  assert.notEqual(out.contentHash, undefined);
});

test('article fixture extracts Readability text', async () => {
  const out = await extractPageMetadata(makeDom(fixtures.article), 'https://example.com/news');
  assert.equal(out.article !== null, true);
  assert.match(out.article.textContent, /leadership/i);
});

test('nometa fixture returns null article but keeps og title', async () => {
  const out = await extractPageMetadata(makeDom(fixtures.nometa), 'https://example.com/');
  assert.equal(out.article, null);
  assert.equal(out.ogTitle, 'Simple page');
});

test('huge fixture completes within 4.5 seconds', async () => {
  const huge = '<html><body>' + 'x'.repeat(1_200_000) + '</body></html>';
  const start = Date.now();
  const out = await extractPageMetadata(makeDom(huge), 'https://example.com/huge');
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 4500, 'extraction took ' + elapsed + 'ms');
  assert.equal(out.article, null);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @mnemonics/extension-tests exec vitest run __tests__/extraction.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `extraction.js`**

```js
// apps/extension/extraction.js
import { parseArticle } from './readability-loader.js';
import { sha256Sync } from './hash.js';

const TIMEOUT_MS = 4000;
const TEXT_CAP = 100_000;

function readMeta(doc, keys) {
  for (const k of keys) {
    const sel = `meta[property="${k}"], meta[name="${k}"]`;
    const el = doc.querySelector(sel);
    if (el && el.content) return el.content;
  }
  return undefined;
}

function readJsonLd(doc) {
  const out = [];
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(s.textContent);
      if (Array.isArray(parsed)) out.push(...parsed);
      else if (parsed['@graph']) out.push(...parsed['@graph']);
      else out.push(parsed);
    } catch (_) { /* malformed — skip */ }
  }
  return out.slice(0, 20);
}

function readCanonical(doc) {
  const link = doc.querySelector('link[rel="canonical"]');
  return link ? link.href : undefined;
}

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('EXTRACTION_TIMEOUT')), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

export async function extractPageMetadata(doc, url) {
  const ogTitle = readMeta(doc, ['og:title', 'twitter:title']);
  const ogDescription = readMeta(doc, ['og:description', 'twitter:description']);
  const ogImage = readMeta(doc, ['og:image']);
  const canonicalUrl = readCanonical(doc) || url;
  const jsonLd = readJsonLd(doc);

  let article = null;
  try {
    const parsed = await withTimeout(parseArticle(doc), TIMEOUT_MS);
    if (parsed && parsed.textContent) {
      const text = parsed.textContent.slice(0, TEXT_CAP);
      article = {
        title: parsed.title,
        byline: parsed.byline,
        excerpt: parsed.excerpt,
        contentHtml: parsed.content,  // already sanitized by Readability
        textContent: text
      };
    }
  } catch (_) {
    article = null;
  }

  const textSource = article ? article.textContent : ogDescription || '';
  const contentHash = 'sha256:' + sha256Sync(textSource).slice(0, 32);

  return {
    ogTitle, ogDescription, ogImage,
    canonicalUrl,
    jsonLd,
    article,
    contentHash
  };
}
```

Add `apps/extension/hash.js` (a 30-line `sha256Sync` built on
`crypto.subtle` or a vendored SHA-256).

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @mnemonics/extension-tests exec vitest run __tests__/extraction.test.mjs`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add apps/extension/extraction.js apps/extension/hash.js \
        apps/extension/__tests__/extraction.test.mjs \
        specs/data/extraction-fixtures/
git commit -m "feat(extension): bounded in-tab page metadata extraction"
```

---

## Task 6: Wire extraction into the popup + background

**Files:**
- Modify: `apps/extension/extension.js`
- Modify: `apps/extension/background.js`
- Modify: `apps/extension/manifest.json`

**Interfaces:**
- Consumes: `extractPageMetadata`.
- Produces: `source_metadata` sent alongside the capture payload.

- [ ] **Step 1: Write the failing test**

Use a stub for `chrome.tabs` and `chrome.scripting`:

```js
// apps/extension/__tests__/popup-extract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
// Stub the chrome.* globals the popup uses
global.chrome = { tabs: { query: (_opts, cb) => cb([{ id: 1, url: 'https://example.com/c', title: 'X' }]) }, scripting: { executeScript: () => Promise.resolve([{ result: { ogTitle: 'Y' } }]) } };
// Import the popup code and assert it sends source_metadata
```

A simpler approach: the test asserts that the popup's `sendToApi`
helper always includes `source_metadata` when present.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mnemonics/extension-tests exec vitest run __tests__/popup-extract.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Wire the popup**

In `apps/extension/extension.js`, on `DOMContentLoaded`, after
reading `tabs[0]`, kick off `extractPageMetadata` against the
cloned document. While in flight, show a "Reading page…" pill.
On completion, store the result in `currentSourceMetadata`. On
`save-btn` click, include `source_metadata: currentSourceMetadata`
in the payload.

Use `chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: readDOM })` to grab a serializable clone of the
DOM from the page context. The popup then runs Readability on
the clone.

- [ ] **Step 4: Wire the background**

In `apps/extension/background.js`, extend `uploadTextCapture` to
accept and forward `source_metadata` in the JSON body. The
context-menu flow also passes through (the tab itself is the
source page).

- [ ] **Step 5: Manifest**

Ensure `host_permissions: ["<all_urls>"]` is present (it already
is for PR #16). No new permissions are needed.

- [ ] **Step 6: Run all extension tests**

Run: `pnpm --filter @mnemonics/extension-tests exec vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/extension.js apps/extension/background.js \
        apps/extension/manifest.json apps/extension/__tests__/popup-extract.test.mjs
git commit -m "feat(extension): include source_metadata on save"
```

---

## Task 7: Web dashboard mirror of source_metadata

**Files:**
- Modify: `apps/web/src/lib/api-client.ts`
- Modify: `apps/web/src/components/dashboard/LinkCaptureDialog.tsx`
- Modify: `apps/web/src/components/dashboard/NoteCaptureDialog.tsx`
- Modify: `apps/web/src/components/dashboard/ImageCaptureDialog.tsx`

**Interfaces:**
- Produces: same field on the web capture paths.

- [ ] **Step 1: Update the API client**

Add `sourceMetadata?: SourceMetadata` to the `CaptureInput` type
in `apps/web/src/lib/api-client.ts`. The web side runs the same
extraction (server-side Readability is **not** added in M1; the
client uses `DOMParser` on the current document when the dialog
opens).

- [ ] **Step 2: Hook the dialogs**

In each dialog, when the title or URL field changes, run
`extractPageMetadata` against the parent document. Cache the
result. Submit it with the payload.

- [ ] **Step 3: Test**

Add a web component test that asserts the payload includes
`source_metadata` after the user types a URL.

- [ ] **Step 4: Run the web test suite**

Run: `pnpm --filter @mnemonics/web exec vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api-client.ts apps/web/src/components/dashboard/LinkCaptureDialog.tsx \
        apps/web/src/components/dashboard/NoteCaptureDialog.tsx \
        apps/web/src/components/dashboard/ImageCaptureDialog.tsx
git commit -m "feat(web): web dialogs attach source_metadata"
```

---

## Task 8: Operator doc and CI run

**Files:**
- Create: `docs/core-capture-workflow.md`
- Modify: `.github/workflows/ci.yml` (add the extension tests)

- [ ] **Step 1: Author the doc**

`docs/core-capture-workflow.md` explains:

- The one-click sequence (extension → background → API).
- The `source_metadata` lifecycle (extract → persist → read in
  M2).
- The 4-second timeout and the failure fallback.
- The list of supported JSON-LD types.
- How to inspect `items.source_metadata` in the Supabase UI.

- [ ] **Step 2: Add the extension test step to CI**

In `.github/workflows/ci.yml`, after the existing
`pnpm test` job, add a new step:

```yaml
- name: Extension unit tests
  run: pnpm --filter @mnemonics/extension-tests exec vitest run
```

- [ ] **Step 3: Run the full CI matrix locally**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: All green.

- [ ] **Step 4: Commit**

```bash
git add docs/core-capture-workflow.md .github/workflows/ci.yml
git commit -m "docs(capture): workflow doc + CI step for extension tests"
```

---

## Out of scope for M1 (deferred to M2/M3)

- `item_classifications` table (M2)
- `classify` job (M2)
- Gemini structured-output prompt + provider (M2)
- `attributes` JSONB column (M2)
- `detected_type` enum (M2)
- Structured search filters (M3)
- Natural query parser (M3)
- Save as Space on extension popup (M3)
- Backfill script (M4)
- Relevance benchmark (M4)
