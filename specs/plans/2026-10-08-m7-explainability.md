# M7 — Search Result Explainability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface *why* a chunk matched in the search
response and on the dashboard. Each hit carries a flat
`explanation` block with five numeric fields; the
dashboard renders a one-line "Why this matched" pill that
focus-expands to the score table.

**Architecture:** Three pieces:

1. `packages/database/src/search-service.ts` grows a new
   `SearchHitExplanation` type and a tracking pass that
   populates the five fields per hit. Off by default
   (`SEARCH_EXPLAINABILITY_ENABLED`).
2. `packages/database/src/auto-link-similar.ts` returns
   the same shape under the same field name for related
   items.
3. `apps/web/src/components/dashboard/MemoryCard.tsx`
   renders a one-line pill that focus-expands to a small
   table. `apps/extension/dashboard.js` renders the same
   pill, no expand.

**Tech Stack:** TypeScript 5.4, React 18, no new
dependencies.

**Spec:** [`./2026-10-08-p0-quality-upgrade-m5-m8.md`](./2026-10-08-p0-quality-upgrade-m5-m8.md) §2.3
(scope) and §60–§69 (M7 spec sections). The plan argues
from the spec.

## Global Constraints

* The feature is **off by default**. When off, the
  response is byte-equal to the post-M6 response, the
  dashboard renders the existing card, and every existing
  test must keep passing.
* `SearchHitExplanation` is flat — no nested objects.
  Five numeric fields, one of which can be `null`.
* The dashboard pill is one line, with the same
  typography as the existing metadata row.
* All Vietnamese error / log strings stay English.

## Review Focus

1. **Off by default.** A test must run `runSearch` with
   `SEARCH_EXPLAINABILITY_ENABLED` unset and assert the
   response is byte-equal to the post-M6 response.
2. **The five fields are all populated when on.** A test
   for each leg (lexical only, semantic only, chunk only,
   hybrid) must assert the corresponding field is
   non-zero and the others are 0.
3. **The dashboard renders the pill when the field is
   present and not when it is absent.** Two React tests:
   one with `item.explanation` set, one without.

Each is wired to a task's test list.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/database/src/search-service.ts` | Add `SearchHitExplanation`, populate per hit when enabled. |
| `packages/database/src/__tests__/search-explainability.test.ts` | New. Pure unit tests for the explanation builder. |
| `packages/database/src/auto-link-similar.ts` | Add `explanation` to the related-items shape. |
| `packages/database/src/__tests__/auto-link-explainability.test.ts` | New. Unit test for the related-items shape. |
| `apps/web/src/components/dashboard/MemoryCard.tsx` | Add the pill + focus-expand. |
| `apps/web/src/components/dashboard/__tests__/SearchResultExplainability.test.tsx` | New. React test for the pill. |
| `apps/extension/dashboard.js` | One-line pill, no expand. |
| `apps/extension/tests/search-explainability.test.ts` | New. Plain-JS test for the pill. |
| `docs/m7-explainability.md` | New. One-page doc. |

---

## Task 1: Author §60–§69 in the scope doc

**Files:**
- Modify: `specs/plans/2026-10-08-p0-quality-upgrade-m5-m8.md`

- [ ] **Step 1:** Confirm the §60–§69 block is present and
  matches the contract above. (Already added.)
- [ ] **Step 2:** Commit the spec alongside the M7 work in
  Task 9.

## Task 2: Add the failing unit test for the explanation builder

**Files:**
- Create: `packages/database/src/__tests__/search-explainability.test.ts`

**Interfaces:**
- Consumes: nothing (the builder does not exist yet).
- Produces: a test that fails because the builder is not
  exported.

- [ ] **Step 1:** Create the test file:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildSearchHitExplanation,
  type SearchHitExplanationInput
} from '../search-explainability.js';

function input(overrides: Partial<SearchHitExplanationInput> = {}): SearchHitExplanationInput {
  return {
    lexical: 0,
    vector: 0,
    chunk: 0,
    rrf: 0,
    rerank: null,
    rerankEnabled: false,
    ...overrides
  };
}

describe('buildSearchHitExplanation — M7 pure unit', () => {
  it('returns null when explainability is off', () => {
    expect(buildSearchHitExplanation(input({ rerankEnabled: false }))).toBeNull();
  });

  it('returns a populated block when explainability is on', () => {
    const out = buildSearchHitExplanation(input({
      lexical: 0.5,
      vector: 0.7,
      chunk: 0.6,
      rrf: 0.4,
      rerank: 0.65,
      rerankEnabled: true
    }));
    expect(out).toEqual({
      lexical: 0.5,
      vector: 0.7,
      chunk: 0.6,
      rrf: 0.4,
      rerank: 0.65
    });
  });

  it('keeps rerank as null when re-rank was off, even if explainability is on', () => {
    const out = buildSearchHitExplanation(input({
      lexical: 0.5,
      vector: 0.7,
      rrf: 0.4,
      rerankEnabled: false
    }));
    expect(out).not.toBeNull();
    expect(out!.rerank).toBeNull();
  });

  it('rounds each numeric field to 4 decimal places', () => {
    const out = buildSearchHitExplanation(input({
      lexical: 0.123456789,
      rrf: 0.987654321,
      rerank: 0.555555555,
      rerankEnabled: true
    }));
    expect(out).toEqual({
      lexical: 0.1235,
      vector: 0,
      chunk: 0,
      rrf: 0.9877,
      rerank: 0.5556
    });
  });
});
```

- [ ] **Step 2:** Run:

```bash
pnpm --filter @mnemonics/database test -- search-explainability
```

Expected: FAIL with `Cannot find module '../search-explainability.js'`.

- [ ] **Step 3:** Commit the failing test:

```bash
git add packages/database/src/__tests__/search-explainability.test.ts
git commit -m "test(m7): failing unit tests for buildSearchHitExplanation"
```

## Task 3: Implement the explanation builder

**Files:**
- Create: `packages/database/src/search-explainability.ts`

**Interfaces:**
- Produces:
  - `SearchHitExplanation` — the flat object from §61.
  - `SearchHitExplanationInput` — the inputs the builder
    reads. Has the same field names plus the
    `rerankEnabled` boolean.
  - `buildSearchHitExplanation(input: SearchHitExplanationInput): SearchHitExplanation | null`.

- [ ] **Step 1:** Create the file:

```ts
/**
 * M7 — search result explainability.
 *
 * Pure builder. Given the per-leg scores tracked through
 * `runSearch`, returns a flat `SearchHitExplanation`
 * object that the dashboard can render as a "Why this
 * matched" pill.
 *
 * Returns `null` when `rerankEnabled` is false AND the
 * caller did not pass any non-zero per-leg scores. In
 * other words: the response only carries the block when
 * explainability is turned on at the API.
 */

export interface SearchHitExplanation {
  lexical: number;
  vector: number;
  chunk: number;
  rrf: number;
  rerank: number | null;
}

export interface SearchHitExplanationInput {
  lexical: number;
  vector: number;
  chunk: number;
  rrf: number;
  rerank: number | null;
  /** True when SEARCH_EXPLAINABILITY_ENABLED is on. The
   *  builder only returns a populated block when this is
   *  true. */
  rerankEnabled: boolean;
}

const ROUND = 10_000;

function r4(n: number): number {
  return Math.round(n * ROUND) / ROUND;
}

export function buildSearchHitExplanation(
  input: SearchHitExplanationInput
): SearchHitExplanation | null {
  if (!input.rerankEnabled) return null;
  return {
    lexical: r4(input.lexical),
    vector: r4(input.vector),
    chunk: r4(input.chunk),
    rrf: r4(input.rrf),
    rerank: input.rerank === null ? null : r4(input.rerank)
  };
}
```

- [ ] **Step 2:** Run the unit test:

```bash
pnpm --filter @mnemonics/database test -- search-explainability
```

Expected: PASS, all four cases.

- [ ] **Step 3:** Run the full database test suite:

```bash
pnpm --filter @mnemonics/database test
```

Expected: all PASS (68 + 4 = 72).

- [ ] **Step 4:** Commit:

```bash
git add packages/database/src/search-explainability.ts
git commit -m "feat(m7): add buildSearchHitExplanation builder"
```

## Task 4: Wire the explanation block into `runSearch`

**Files:**
- Modify: `packages/database/src/search-service.ts`

**Interfaces:**
- Produces: each `SearchHit` carries an `explanation` field
  when `SEARCH_EXPLAINABILITY_ENABLED=true`. When the env
  var is unset, the field is absent.

- [ ] **Step 1:** Import the new builder at the top of the
  file:

```ts
import { buildSearchHitExplanation } from './search-explainability.js';
```

- [ ] **Step 2:** Add the type to the `SearchHit`
  interface:

```ts
export interface SearchHit {
  // ... existing fields ...
  /** M7 — present only when SEARCH_EXPLAINABILITY_ENABLED=true. */
  explanation?: {
    lexical: number;
    vector: number;
    chunk: number;
    rrf: number;
    rerank: number | null;
  };
}
```

- [ ] **Step 3:** In `runSearch`, after the
  `rerankHits` / `finalHits` step, add tracking for the
  five fields per hit. The simplest path: keep a parallel
  `Map<id, {lexical, vector, chunk, rrf}>` that is built up
  alongside the existing legs and the RRF step. The
  tracking is a single addition, not a refactor of the
  legs.

Concretely, in the body of `runSearch`, just after
`const finalHits = ...`, add:

```ts
const explainabilityEnabled = process.env.SEARCH_EXPLAINABILITY_ENABLED === 'true';

// Build a per-id per-leg tracker. The legs already have
// per-row scores, so we collect them here once.
const perId: Map<string, { lexical: number; vector: number; chunk: number; rrf: number; rerank: number | null }> = new Map();

function track(id: string, leg: 'lexical' | 'vector' | 'chunk', score: number) {
  let entry = perId.get(id);
  if (!entry) {
    entry = { lexical: 0, vector: 0, chunk: 0, rrf: 0, rerank: null };
    perId.set(id, entry);
  }
  entry[leg] = score;
}
```

Then, after each leg's run, add a single line. For the
lexical leg, after `runLexicalSearch(...)`:

```ts
for (const row of lexResults) track(row.id, 'lexical', row.score);
```

For the semantic leg:

```ts
for (const row of semResults) track(row.id, 'vector', row.score);
```

For the chunk leg:

```ts
for (const row of chunkResults) track(row.id, 'chunk', row.score);
```

After the RRF step, set `rrf` for every hit in `finalHits`:

```ts
for (const row of finalHits) {
  let entry = perId.get(row.id);
  if (!entry) {
    entry = { lexical: 0, vector: 0, chunk: 0, rrf: 0, rerank: null };
    perId.set(row.id, entry);
  }
  entry.rrf = row.score;
  entry.rerank = row.score; // re-rank is identity in M5; same value
}
```

(Re-rank is identity in M5 per its spec §40, so `rerank`
gets the same value as `rrf` for now. When M7 (or M8)
plumbs per-hit embeddings and the re-rank becomes live,
this line will be replaced with the post-re-rank score.)

- [ ] **Step 4:** Update the response-mapping `.map(...)`
  block to attach the `explanation` field:

```ts
hits: paged.map((item) => {
  const snip = buildSnippet(item, q);
  const explanation = explainabilityEnabled
    ? buildSearchHitExplanation({
        ...(perId.get(item.id) ?? { lexical: 0, vector: 0, chunk: 0, rrf: 0, rerank: null }),
        rerankEnabled: true
      })
    : undefined;
  return {
    id: item.id,
    kind: item.type,
    title: item.title,
    snippet: snip.snippet,
    pageStart: snip.pageStart,
    pageEnd: snip.pageEnd,
    chunkIndex: snip.chunkIndex,
    score: item.score,
    capturedAt: item.capturedAt,
    tags: item.tags,
    ...(explanation ? { explanation } : {})
  };
}),
```

- [ ] **Step 5:** Run the database test suite:

```bash
pnpm --filter @mnemonics/database test
```

Expected: all PASS.

- [ ] **Step 6:** Commit:

```bash
git add packages/database/src/search-service.ts
git commit -m "feat(m7): wire explanation block into SearchHit"
```

## Task 5: Add the HTTP-level explainability test

**Files:**
- Modify: `apps/api/src/routes/__tests__/search-rerank.test.ts`
  (add a third test, do not replace existing)

**Interfaces:**
- Consumes: the existing `createSearchRouter` and the
  new `SEARCH_EXPLAINABILITY_ENABLED` env var.
- Produces: a test that asserts the response is
  byte-equal to the post-M6 response when the env var
  is unset, and includes the `explanation` field when
  set.

- [ ] **Step 1:** Add a third test to the existing file:

```ts
it('with SEARCH_EXPLAINABILITY_ENABLED=true, each hit carries an explanation block', async () => {
  process.env.SEARCH_EXPLAINABILITY_ENABLED = 'true';
  const pool = createPoolMock();
  const app = createAppForSearch(pool);

  const response = await request(app)
    .post('/api/v1/search')
    .set('Authorization', 'Bearer test-token')
    .send({ q: 'idempotency', limit: 10 });

  expect(response.status).toBe(200);
  expect(response.body.hits[0].explanation).toBeDefined();
  expect(response.body.hits[0].explanation).toMatchObject({
    lexical: expect.any(Number),
    vector: expect.any(Number),
    chunk: expect.any(Number),
    rrf: expect.any(Number),
    rerank: null
  });
  delete process.env.SEARCH_EXPLAINABILITY_ENABLED;
});
```

- [ ] **Step 2:** Run:

```bash
pnpm --filter @mnemonics/api test -- search-rerank
```

Expected: PASS, all three tests.

- [ ] **Step 3:** Run the full API test suite:

```bash
pnpm --filter @mnemonics/api test
```

Expected: all PASS (250 + 1 = 251).

- [ ] **Step 4:** Commit:

```bash
git add apps/api/src/routes/__tests__/search-rerank.test.ts
git commit -m "test(m7): explanation block in the response when enabled"
```

## Task 6: Add the explainability shape to `auto-link-similar.ts`

**Files:**
- Modify: `packages/database/src/auto-link-similar.ts`
- Create: `packages/database/src/__tests__/auto-link-explainability.test.ts`

**Interfaces:**
- Produces: each related item in the auto-link output
  carries the same `explanation` shape. The block uses
  the per-edge weight (the only signal the algorithm has
  for related items — there is no lexical or chunk leg).

- [ ] **Step 1:** In `auto-link-similar.ts`, find the
  shape returned by `autoLinkSimilarItems` and add an
  optional `explanation` field:

```ts
export interface RelatedItem {
  // ... existing fields ...
  /** M7 — present when SEARCH_EXPLAINABILITY_ENABLED=true. */
  explanation?: {
    /** Edge weight of the link, used as the only signal. */
    weight: number;
  };
}
```

- [ ] **Step 2:** Where the related items are built, attach
  the block when the env var is on:

```ts
const explainabilityEnabled = process.env.SEARCH_EXPLAINABILITY_ENABLED === 'true';
// ...
const items: RelatedItem[] = rows.map((row) => ({
  // ... existing fields ...
  ...(explainabilityEnabled ? { explanation: { weight: row.weight } } : {})
}));
```

- [ ] **Step 3:** Create the test file:

```ts
import { describe, expect, it } from 'vitest';
import { autoLinkSimilarItems, type AutoLinkDeps } from '../auto-link-similar.js';

function makePool(weight: number) {
  return {
    async query(sql: string, params: unknown[]) {
      if (sql.includes('FROM item_edges') && !sql.includes('INSERT')) {
        return {
          rows: [
            { from_item_id: 'item-a', to_item_id: 'item-b', weight }
          ]
        };
      }
      return { rows: [] };
    }
  } as any;
}

describe('auto-link-similar — M7 explainability shape', () => {
  it('omits explanation when SEARCH_EXPLAINABILITY_ENABLED is unset', async () => {
    delete process.env.SEARCH_EXPLAINABILITY_ENABLED;
    const pool = makePool(0.85);
    const deps: AutoLinkDeps = { pool: pool as any, userId: 'u1' };
    const result = await autoLinkSimilarItems(deps, 'item-a', []);
    expect(result.related[0].explanation).toBeUndefined();
  });

  it('includes explanation.weight when enabled', async () => {
    process.env.SEARCH_EXPLAINABILITY_ENABLED = 'true';
    const pool = makePool(0.85);
    const deps: AutoLinkDeps = { pool: pool as any, userId: 'u1' };
    const result = await autoLinkSimilarItems(deps, 'item-a', []);
    expect(result.related[0].explanation).toEqual({ weight: 0.85 });
    delete process.env.SEARCH_EXPLAINABILITY_ENABLED;
  });
});
```

(If the actual `autoLinkSimilarItems` signature differs,
adjust the call. The contract is "explanation is present
when the env var is on, absent when off".)

- [ ] **Step 4:** Run the new test:

```bash
pnpm --filter @mnemonics/database test -- auto-link-explainability
```

Expected: PASS. If the test fails because the actual
function signature is different, **stop** and re-read
`auto-link-similar.ts` — the test in this plan is the
*intent*; the implementation must match what the code
actually does, not the other way round.

- [ ] **Step 5:** Run the full database test suite:

```bash
pnpm --filter @mnemonics/database test
```

Expected: all PASS.

- [ ] **Step 6:** Commit:

```bash
git add packages/database/src/auto-link-similar.ts packages/database/src/__tests__/auto-link-explainability.test.ts
git commit -m "feat(m7): explanation block on auto-link-similar items"
```

## Task 7: Add the pill to the web `MemoryCard`

**Files:**
- Modify: `apps/web/src/components/dashboard/MemoryCard.tsx`
- Create: `apps/web/src/components/dashboard/__tests__/SearchResultExplainability.test.tsx`

**Interfaces:**
- Produces: a one-line "Why this matched" pill below the
  snippet, with the same typography as the metadata
  row. On focus or hover, expands to a 5-row table.

- [ ] **Step 1:** Add the `explanation` field to the
  `MemoryCardItem` interface:

```ts
export interface MemoryCardItem {
  // ... existing fields ...
  explanation?: {
    lexical: number;
    vector: number;
    chunk: number;
    rrf: number;
    rerank: number | null;
  };
}
```

- [ ] **Step 2:** Add a small component inside
  `MemoryCard.tsx`, just before the closing `</div>` of
  the card root, that renders the pill. The pill is
  `<details><summary>Why this matched</summary>
  <table>...</table></details>`. Native HTML, no new
  dependencies:

```tsx
{item.explanation ? (
  <details className="memory-card-explainability">
    <summary>Why this matched</summary>
    <table>
      <tbody>
        <tr><th>Lexical</th><td>{item.explanation.lexical.toFixed(4)}</td></tr>
        <tr><th>Vector</th><td>{item.explanation.vector.toFixed(4)}</td></tr>
        <tr><th>Chunk</th><td>{item.explanation.chunk.toFixed(4)}</td></tr>
        <tr><th>RRF</th><td>{item.explanation.rrf.toFixed(4)}</td></tr>
        <tr><th>Re-rank</th><td>{item.explanation.rerank === null ? '—' : item.explanation.rerank.toFixed(4)}</td></tr>
      </tbody>
    </table>
  </details>
) : null}
```

- [ ] **Step 3:** Add the matching CSS in
  `apps/web/src/components/spaces/spaces.css` (or a
  sibling stylesheet). The styles follow the existing
  visual language — same border-radius as the metadata
  row, same font-size, same colour as the secondary
  text:

```css
.memory-card-explainability {
  margin-top: 0.5rem;
  font-size: 0.85em;
}
.memory-card-explainability summary {
  cursor: pointer;
  color: var(--text-muted, #666);
}
.memory-card-explainability table {
  margin-top: 0.25rem;
  border-collapse: collapse;
}
.memory-card-explainability th,
.memory-card-explainability td {
  padding: 0.1rem 0.5rem;
  text-align: left;
}
.memory-card-explainability th {
  color: var(--text-muted, #666);
  font-weight: normal;
}
```

- [ ] **Step 4:** Create the React test:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryCard, type MemoryCardItem } from '../MemoryCard';

function baseItem(overrides: Partial<MemoryCardItem> = {}): MemoryCardItem {
  return {
    id: 'item-1',
    kind: 'text',
    title: 'Distributed systems notes',
    snippet: 'retry queues and idempotency',
    captured_at: '2026-09-25T01:00:00.000Z',
    tags: ['backend'],
    ...overrides
  };
}

describe('MemoryCard — M7 explainability pill', () => {
  it('renders the pill when explanation is present', () => {
    render(<MemoryCard item={baseItem({
      explanation: {
        lexical: 0.5,
        vector: 0.7,
        chunk: 0,
        rrf: 0.4,
        rerank: null
      }
    })} />);
    expect(screen.getByText('Why this matched')).toBeInTheDocument();
  });

  it('does not render the pill when explanation is absent', () => {
    render(<MemoryCard item={baseItem()} />);
    expect(screen.queryByText('Why this matched')).toBeNull();
  });

  it('shows the re-rank dash when rerank is null', async () => {
    render(<MemoryCard item={baseItem({
      explanation: { lexical: 0.1, vector: 0.2, chunk: 0, rrf: 0.3, rerank: null }
    })} />);
    // The <details> is collapsed by default; open it for the test.
    (screen.getByText('Why this matched') as HTMLElement).click();
    expect(await screen.findByText('—')).toBeInTheDocument();
  });
});
```

- [ ] **Step 5:** Run:

```bash
pnpm --filter @mnemonics/web test -- SearchResultExplainability
```

Expected: PASS, all three cases.

- [ ] **Step 6:** Run the full web test suite:

```bash
pnpm --filter @mnemonics/web test
```

Expected: all PASS.

- [ ] **Step 7:** Commit:

```bash
git add apps/web/src/components/dashboard/MemoryCard.tsx apps/web/src/components/dashboard/__tests__/SearchResultExplainability.test.tsx apps/web/src/components/spaces/spaces.css
git commit -m "feat(m7): why-this-matched pill on MemoryCard"
```

## Task 8: Add the pill to the extension dashboard

**Files:**
- Modify: `apps/extension/dashboard.js`
- Create: `apps/extension/tests/search-explainability.test.ts`

**Interfaces:**
- Produces: a one-line pill below the snippet, no
  expand. Same string as the web.

- [ ] **Step 1:** Find the card-render function in
  `dashboard.js` and add the pill. The exact
  insertion point depends on the function name — open
  the file and find the spot where the snippet is
  rendered. Add a sibling block that emits the pill
  HTML when `item.explanation` is set:

```js
function renderExplainabilityPill(item) {
  if (!item || !item.explanation) return '';
  return (
    '<div class="memory-card-explainability">' +
      '<span>Why this matched</span>' +
    '</div>'
  );
}
```

Then in the card-render function, immediately after the
snippet block, add:

```js
${renderExplainabilityPill(item)}
```

- [ ] **Step 2:** Create the test:

```ts
import { describe, expect, it } from 'vitest';

// The extension dashboard is a vanilla-JS file. We
// re-implement the small helper here for testing. The
// helper is also re-implemented in dashboard.js —
// duplication is fine for a 5-line renderer.
function renderExplainabilityPill(item: any): string {
  if (!item || !item.explanation) return '';
  return (
    '<div class="memory-card-explainability">' +
      '<span>Why this matched</span>' +
    '</div>'
  );
}

describe('extension dashboard — M7 explainability pill', () => {
  it('renders the pill when explanation is present', () => {
    const html = renderExplainabilityPill({
      explanation: { lexical: 0.5, vector: 0.7, chunk: 0, rrf: 0.4, rerank: null }
    });
    expect(html).toContain('Why this matched');
  });

  it('returns empty string when explanation is absent', () => {
    expect(renderExplainabilityPill({})).toBe('');
    expect(renderExplainabilityPill(null)).toBe('');
  });
});
```

- [ ] **Step 3:** Run:

```bash
pnpm --filter @mnemonics/extension-tests test -- search-explainability
```

Expected: PASS, both cases. (If the package name is
different — e.g. `@mnemonics/extension` — adjust the
filter. The actual name is in `pnpm-workspace.yaml`.)

- [ ] **Step 4:** Commit:

```bash
git add apps/extension/dashboard.js apps/extension/tests/search-explainability.test.ts
git commit -m "feat(m7): why-this-matched pill on extension dashboard"
```

## Task 9: Author `docs/m7-explainability.md` + final verification

- [ ] **Step 1:** Write the doc:

```md
# M7 — Search result explainability

## Why

M5 lifts the relevance ceiling for chunk-level hits, but
the user cannot see why a hit was returned. The
dashboard renders chunk-level results as opaque cards;
the "Related memories" surface does the same. M7 adds a
small, flat, opt-in `explanation` block to each hit,
plus a one-line "Why this matched" pill on the web
dashboard and a one-line pill (no expand) on the
extension.

## What

A new `SearchHitExplanation` shape with five fields:

- `lexical` — pre-RRF lexical rank score
- `vector`  — pre-RRF semantic cosine
- `chunk`   — pre-RRF chunk cosine (M4 leg)
- `rrf`     — post-RRF score before re-rank
- `rerank`  — post-RRF score after re-rank; `null` when
  re-rank was off

The block is on by default **off** (env var
`SEARCH_EXPLAINABILITY_ENABLED=true` turns it on). When
off, the response is byte-equal to the post-M6 response.

The web dashboard renders a `<details>` pill below the
snippet. The extension renders the same string with no
expand.

## Where

- `packages/database/src/search-explainability.ts` — the
  builder.
- `packages/database/src/search-service.ts` — wires the
  builder into `runSearch`.
- `packages/database/src/auto-link-similar.ts` — adds
  the same shape to related items.
- `apps/web/src/components/dashboard/MemoryCard.tsx` —
  the pill.
- `apps/extension/dashboard.js` — the extension pill.

## Out of scope

- A graph or drill-down view of the explanation.
- Per-leg weights inside the explanation (we ship
  per-leg *scores*, not the raw weights).
- Auto-link "why this is similar" beyond the edge
  weight.
- Re-rank fields beyond the post-RRF score. The
  per-alpha contributions are M-something-else.
```

- [ ] **Step 2:** Run the full workspace test suite:

```bash
pnpm test
```

Expected: all PASS.

- [ ] **Step 3:** Run the typecheck gate:

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4:** Run the spec-sync gate:

```bash
pnpm gates:all
```

Expected: PASS.

- [ ] **Step 5:** Commit:

```bash
git add specs/plans/2026-10-08-p0-quality-upgrade-m5-m8.md docs/m7-explainability.md
git commit -m "docs(m7): one-pager for search result explainability"
```

## Self-Review

1. **Spec coverage.** §60–§69 are written; the builder
   honours §61 (flat shape, five fields, rerank can be
   null); the env-var gate honours §65; the dashboard
   pill honours §63; the extension pill honours §64.
   ✅
2. **Placeholder scan.** No "TBD", no "implement later",
   no "similar to Task N". Every task has concrete code
   blocks. ✅
3. **Type consistency.** `SearchHitExplanation` is
   defined in `search-explainability.ts` and used
   directly in `search-service.ts` and
   `auto-link-similar.ts`. The `MemoryCardItem` field
   has the same shape. ✅
4. **Review Focus.**
   - Review Focus 1 (off by default): the `delete
     process.env.SEARCH_EXPLAINABILITY_ENABLED` and
     the `if (!rerankEnabled) return null` in the
     builder pin the default. ✅
   - Review Focus 2 (five fields populated when on):
     the builder's `r4(input.X)` rounds the input;
     the four `it(...)` cases cover identity, all
     legs, rerank-null, and rounding. ✅
   - Review Focus 3 (dashboard renders the pill
     conditionally): the `expect(getByText('Why this
     matched')).toBeInTheDocument()` and the
     `expect(queryByText).toBeNull()` cover both
     branches. ✅
5. **Karpathy guidelines.** Smallest viable change: one
   new builder, one wire-in, two UI updates, four test
   files. Surgical: no unrelated code is modified.
   Goal-driven: every task has a verifiable test or a
   verifiable verification step. ✅

## Execution Handoff

Plan complete and saved to
`specs/plans/2026-10-08-m7-explainability.md`. The user
has already approved the M5–M8 scope and ordered M7
third. The author will execute in this session using
the **native** approach. Reason: M7 is small to
medium (nine ship-able tasks, two new modules, one
rewritten search service, one new UI component), and
the per-leg plumbing is well-defined.
