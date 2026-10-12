# M3 — Smart Search & Dynamic Smart Spaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every search behave the same on web, extension,
and inside a saved Smart Space. The user can type a natural
query like "wooden chairs from last week" or apply structured
chips like `Recipe` + `Italian`; both flow through the same
`runSearch()` and the same weighted reciprocal-rank fusion.

**Architecture:** Three additive pieces, all behind a single
`runSearch()` entry point.

1. A pure, deterministic query parser
   (`@mnemonics/database/query-parser.ts`) that turns a free-text
   query into (a) strict `filters` for `detected_type`, `category`,
   `brand`, `material`, `color`, `merchant`, `author`, (b) a
   date window for `captured_after` / `captured_before`, and (c)
   the residual semantic `q`.
2. A `structured` retrieval leg inside `runSearch()` that
   scores memories by the count of matching classification
   attributes and feeds the result into the existing
   reciprocal-rank fusion with `STRUCT_WEIGHT = 0.5`.
3. A new `searchFilters.structured` Zod group; the existing
   `SearchRequest` accepts the new keys without breaking the
   dashboard's parsing of older saved Spaces.

**Tech Stack:** TypeScript 5.4, Node 22, existing
`runSearch()` in `packages/database/src/search-service.ts`.
No new dependencies.

**Spec:** [`../0005-core-capture-classification-smart-search.md`](../0005-core-capture-classification-smart-search.md)
§7.1 (Filter group), §7.2 (Structured retrieval leg),
§7.3 (Deterministic query parser), §7.4 (Lexical-only fallback),
§7.5 (Re-embed trigger), §8.1 (Save current search),
§8.2 (Filter compatibility), §8.3 (Web/extension parity).

## Global Constraints

- `runSearch()` is the ONLY retrieval path. Smart Spaces
  resolve through `resolveSmartSpaceIds`, which already calls
  `runSearch()`. This milestone extends `runSearch()`, not
  the Space code.
- The query parser is a pure function (no I/O). Every phrase
  it can recognise has a unit test in
  `packages/database/src/__tests__/query-parser.test.ts`.
- The `structured` leg is empty when no `structured` keys are
  provided OR when the user has zero `item_classifications`
  rows. An empty leg must NEVER raise; it just produces no
  candidates.
- `STRUCT_WEIGHT = 0.5` is exported from
  `@mnemonics/database/search-service` so the M4 benchmark
  can sweep it.
- A failed `embedOne` already degrades to lexical-only
  (PR #16, `ad857cf`). The new code does not change that
  behaviour; the parser still runs, the `structured` and
  `lexical` legs still return hits, the semantic + chunk
  legs return `[]`.

---

## Task 1 — Query parser module + tests

**Files:**
- New: `packages/database/src/query-parser.ts`
- New: `packages/database/src/__tests__/query-parser.test.ts`
- Modified: `packages/database/src/index.ts` (re-export)

**Step 1.1: Write the parser**

Create `packages/database/src/query-parser.ts`. The module
exports a single pure function:

```ts
parseQuery(input: string, now?: Date): ParsedQuery
```

`ParsedQuery` has the same shape as a `SearchFilters` (the new
`structured` group included), plus a `residualQ` string. The
parser:

1. Splits on whitespace.
2. Recognises date phrases via a regex table:
   - `today`, `yesterday`
   - `this week`, `last week` (7-day window ending now)
   - `this month`, `last month` (calendar month)
   - `N days ago` / `N weeks ago` / `N months ago`
   - `before YYYY-MM-DD`, `after YYYY-MM-DD`
   The default "this week" window is `[now - 7d, now]`. The
   default "this month" window is the first day of the current
   month → now. All windows are emitted in UTC.
3. Recognises type hints via a controlled vocabulary map
   (`articles | videos | recipes | products | quotes |
   highlights | notes | images | documents | webpages` →
   `detected_type`). The map is the source of truth and is
   exported so the M4 dataset can reference it.
4. Recognises structured tokens matching the closed set
   `brand:`, `material:`, `color:`, `merchant:`, `author:`.
   Each token's value is the next whitespace-separated word.
5. Confidence gate: matched filters with contradictions
   (e.g. `brand:foo AND brand:bar`) are dropped, not
   silently AND-ed into an empty result.
6. Everything unmatched stays in `residualQ` for the
   semantic leg.

**Step 1.2: Unit tests**

`query-parser.test.ts` covers, at minimum:

- `parseQuery('wooden chairs')` → no filters, residual
  `wooden chairs`.
- `parseQuery('recipes this week')` →
  `structured.detectedType = ['recipe']`,
  `filters.captured_after / captured_before` set to a
  7-day window ending at `now` (when `now` is passed).
- `parseQuery('brand:ikea material:wood')` →
  `structured.brand = ['ikea']`, `structured.material = ['wood']`,
  residual empty.
- `parseQuery('brand:foo brand:bar')` → both brand filters
  dropped (contradiction).
- `parseQuery('2 days ago', new Date('2026-10-11T10:00:00Z'))`
  → `captured_after = 2026-10-09T00:00:00Z`.
- `parseQuery('articles')` →
  `structured.detectedType = ['article']`.
- `parseQuery('')` → all empty.

**Step 1.3: Re-export from `@mnemonics/database`**

`packages/database/src/index.ts` adds:

```ts
export { parseQuery } from './query-parser.js';
export type { ParsedQuery } from './query-parser.js';
```

**Step 1.4: Build + test**

```bash
pnpm --filter @mnemonics/database build
pnpm --filter @mnemonics/database exec vitest run \
  src/__tests__/query-parser.test.ts
```

Pass criteria: ≥ 7 tests pass.

---

## Task 2 — `SearchFilters.structured` Zod group

**Files:**
- Modified: `packages/shared/src/index.ts`
- Modified: `packages/database/src/search-service.ts`

**Step 2.1: Zod schema**

In `packages/shared/src/index.ts` add a new optional
`searchFiltersStructuredSchema`:

```ts
export const detectedTypeSchema = z.enum([
  'article','product','recipe','video','quote','highlight',
  'webpage','image','note','document','other'
]);

export const searchFiltersStructuredSchema = z.object({
  detectedType: z.array(detectedTypeSchema).optional(),
  category: z.array(z.string().max(80)).optional(),
  brand: z.array(z.string().max(80)).optional(),
  material: z.array(z.string().max(80)).optional(),
  color: z.array(z.string().max(80)).optional(),
  merchant: z.array(z.string().max(80)).optional(),
  author: z.array(z.string().max(120)).optional()
}).strict();
```

`searchFiltersSchema` is updated to add an optional
`structured: searchFiltersStructuredSchema` key. Unknown keys
are rejected (existing behaviour).

**Step 2.2: Type mirrors**

In `packages/database/src/search-service.ts`:

```ts
export interface SearchFiltersStructured {
  detectedType?: DetectedType[];
  category?: string[];
  brand?: string[];
  material?: string[];
  color?: string[];
  merchant?: string[];
  author?: string[];
}

export interface SearchFilters {
  tags?: string[];
  kind?: SearchKind[];
  captured_after?: string;
  captured_before?: string;
  favorite?: boolean;
  structured?: SearchFiltersStructured; // new
}
```

**Step 2.3: Verify build + existing search tests**

```bash
pnpm --filter @mnemonics/shared build
pnpm --filter @mnemonics/database build
pnpm --filter @mnemonics/database exec vitest run
```

Pass criteria: existing search tests still pass; the new key
is tolerated when absent.

---

## Task 3 — `structured` retrieval leg inside `runSearch()`

**Files:**
- Modified: `packages/database/src/search-service.ts`
- New: `packages/database/src/__tests__/search-structured.test.ts`

**Step 3.1: New weight constant**

Add to `search-service.ts`:

```ts
export const STRUCT_WEIGHT = 0.5;
```

**Step 3.2: New leg implementation**

`runSearch()` gains a fourth leg, `runStructuredLeg(pool,
userId, filters, limit)`. The leg:

1. Returns `[]` when `filters.structured` is undefined or
   all of its keys are empty.
2. Otherwise runs one SQL query against
   `item_classifications` for the user, joining to
   `items` for status (only `ready` items match).
3. Scores each row by the number of matched structured keys
   divided by the total number of structured keys the user
   asked for. A row that matches every requested key has
   score 1.0.
4. `attempts` is bounded at `CANDIDATE_LIMIT` (100).
5. Joins on the chip-level `detected_type` filter and on
   each of the `attributes->>key` lookups via
   `attributes ?| ARRAY[...]` (any-of) for each key, with
   AND semantics across distinct keys.
6. Returns the items as `SearchHit` objects with `score`
   set to the match count.

The leg feeds the existing reciprocal-rank fusion alongside
`lexHits`, `semHits`, `chunkHits` with weight
`STRUCT_WEIGHT`.

**Step 3.3: Backward-compat empty leg**

When the user has no `item_classifications` rows for the
requested keys, the query returns zero rows; the leg is
empty. No errors, no warnings.

**Step 3.4: Tests**

`search-structured.test.ts` covers:

- Empty `structured` → leg returns `[]` and `runSearch()`
  produces the same hits as a control run without the key.
- `structured.detectedType = ['recipe']` matches items whose
  classification has `detected_type = 'recipe'`.
- `structured.brand = ['ikea']` AND `structured.material =
  ['wood']` only matches items whose classification's
  `attributes` JSONB contains both `ikea` (in the brand
  key) and `wood` (in the material key).
- The leg's contribution is visible in the response's
  `explain.structResults` (and `weights.struct`) so the M4
  benchmark can sweep `STRUCT_WEIGHT`.

**Step 3.5: Build + test**

```bash
pnpm --filter @mnemonics/database build
pnpm --filter @mnemonics/database exec vitest run \
  src/__tests__/search-structured.test.ts
```

Pass criteria: ≥ 4 tests pass.

---

## Task 4 — Wire the parser into the search route

**Files:**
- Modified: `apps/api/src/routes/search.ts`

**Step 4.1: Parse the request `q`**

`POST /api/v1/search` and `GET /api/v1/search` both accept
`q` as a free-text string. The route now runs `parseQuery(q)`
and:

1. Merges `parsed.structured` into the request's
   `filters.structured` (existing filters win; the parser
   only fills missing keys).
2. Merges `parsed.captured_after` /
   `parsed.captured_before` into `filters.captured_*`
   (existing values win).
3. Sets `q` to `parsed.residualQ` for the semantic leg.

**Step 4.2: Validation**

The existing Zod schema already accepts the new `structured`
group from Task 2.2. No additional validation is needed.

**Step 4.3: Test**

Add `apps/api/src/routes/__tests__/search-structured.test.ts`:

- `POST /api/v1/search` with `q = "recipes this week"`
  issues a SQL query against `item_classifications` with
  `detected_type = 'recipe'` AND a captured window.
- `POST /api/v1/search` with `q = "brand:ikea material:wood"`
  issues a SQL query for both attributes and a non-empty
  residual.
- The response's `explain.weights.struct` equals
  `STRUCT_WEIGHT = 0.5`.

**Step 4.4: Build + test**

```bash
pnpm --filter @mnemonics/api build
pnpm --filter @mnemonics/api exec vitest run \
  src/routes/__tests__/search-structured.test.ts
```

Pass criteria: ≥ 3 tests pass; existing search tests
unchanged.

---

## Task 5 — Smart Space "Save as Space" uses the same path

**Files:**
- Modified: `apps/web/src/pages/DashboardPage.tsx` (already
  has the button; this task makes it pass the parsed query)
- Modified: `apps/web/src/lib/api-client.ts` (add a
  `createSpaceFromSearch` helper if missing)

**Step 5.1: Wire the existing button**

The dashboard already has a "Save as Space" button on the
Everything view. This task:

1. Confirms the button reads the current `SearchRequest` from
   the search-context store and POSTs to
   `POST /api/v1/spaces` with a `SearchRequest` body.
2. Adds a second trigger on the extension popup that does the
   same: read the active search, POST it.

The server side is unchanged — `POST /api/v1/spaces` already
accepts a `SearchRequest` and persists it. The new behaviour
is that the search request sent to the server now includes
the parsed `structured` filters and the residual `q`.

**Step 5.2: Filter-compat smoke test**

Add `apps/web/src/pages/__tests__/save-as-space-structured.test.tsx`:

- The button calls `POST /api/v1/spaces` with a body whose
  `filters.structured.detectedType` matches the parsed
  query's `detectedType`.
- Saved Space round-trip: open the same Space, the request
  that the page reads back contains the same structured
  filters.

**Step 5.3: Build + test**

```bash
pnpm --filter @mnemonics/web build
pnpm --filter @mnemonics/web exec vitest run \
  src/pages/__tests__/save-as-space-structured.test.tsx
```

Pass criteria: ≥ 2 tests pass.

---

## Task 6 — Web search UI: structured filter chips

**Files:**
- Modified: `apps/web/src/components/search/FilterChips.tsx`
- Modified: `apps/web/src/components/search/SearchBar.tsx`
- New: `apps/web/src/lib/structured-filters.ts`

**Step 6.1: New chip group**

A new "Detected" chip group on the search results page. Each
chip toggles a `detectedType` value in the
`SearchFilters.structured.detectedType` array. The chip is
hidden when the user has no `item_classifications` rows for
the active Space (the route's `explain` payload already
reports this — we re-use it).

**Step 6.2: Sidebar**

A small sidebar of "Brand", "Material", "Color", "Author"
input fields. Each input parses the value as a `string[]` and
appends it to the corresponding `structured` key. Empty inputs
clear the key.

**Step 6.3: Test**

Add `apps/web/src/components/search/__tests__/FilterChips.test.tsx`:

- Clicking the "Recipe" chip adds `'recipe'` to
  `filters.structured.detectedType` and re-issues the
  search.
- Typing in the "Brand" sidebar updates
  `filters.structured.brand` and re-issues the search.

**Step 6.4: Build + test**

```bash
pnpm --filter @mnemonics/web build
pnpm --filter @mnemonics/web exec vitest run \
  src/components/search/__tests__/FilterChips.test.tsx
```

Pass criteria: ≥ 2 tests pass.

---

## Task 7 — Documentation

**Files:**
- New: `docs/smart-search.md`
- Modified: `specs/api/search.md` (add the structured
  filters section)

**Step 7.1: `docs/smart-search.md`**

Covers:

- The two filter groups: existing (`tags`, `kind`, dates,
  `favorite`) and new (`structured`).
- The query parser's recognised phrases with examples.
- The `STRUCT_WEIGHT = 0.5` constant and how the
  reciprocal-rank fusion works.
- The "Save as Space" flow: the button on web and extension
  reads the active `SearchRequest` and POSTs it to
  `POST /api/v1/spaces`; the same request drives
  `runSearch()` on open.
- The fact that the spec forbids a second search engine;
  `runSearch()` is the only entry point.

**Step 7.2: `specs/api/search.md`**

Add a new section listing the `structured` filter group
keys, the JSON shape, and a worked example.

**Step 7.3: README mention**

A one-line addition to the top-level `README.md` mentioning
the new chip group on the search page.

**Step 7.4: Build + test**

No new build step. Verify the existing
`pnpm -r typecheck` still passes.

---

## Task 8 — Spec sync + quality gates

**Files:**
- Modified: `specs/0004-workflow-state-machine.md` (auto-generated;
  do not hand-edit — the runner picks up the new task IDs).

**Step 8.1: Run all quality gates**

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
```

Pass criteria: every package compiles, every test passes.

**Step 8.2: PR description**

Add a PR description that:

- Links to spec 0005 §7 and §8.
- Lists the new files (parser, tests, docs).
- Lists the changed files (shared, search-service, search
  route, web components).
- Mentions `STRUCT_WEIGHT = 0.5` and the M4 benchmark that
  will sweep it.

---

## Risk register

| Risk | Mitigation |
|------|------------|
| GIN-indexed `attributes ?| ARRAY[...]` is slow on very large libraries | The leg has `LIMIT 100`; the index is already present from M2. |
| Parser splits on whitespace and breaks quoted phrases | Spec does not require quoted phrases; the parser is intentionally minimal (~50 lines). |
| Web extension popup already calls `/spaces` with a different body | This task changes the body to the same `SearchRequest` shape; the route accepts both, so old clients still work. |
| `runSearch` regression on existing Spaces | The new `structured` key is optional; `runSearch()` falls back to the existing behaviour when it's absent. |

— end of plan —
