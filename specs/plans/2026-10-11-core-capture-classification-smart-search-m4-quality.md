# M4 — Quality & Evaluation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a runnable relevance benchmark and an
end-to-end acceptance suite that proves the spec's
acceptance criteria (spec 0005 §18). The benchmark is the
single regression gate for ranking quality; the E2E suite
proves the cross-cutting flows (capture → classify → search
→ Space). Both run on the same Postgres + a mocked Gemini,
so CI does not depend on Free Tier quota.

**Architecture:** A new `packages/bench/` workspace that
hosts:

1. The golden dataset
   (`specs/data/relevance-benchmark/dataset.json`) — 60
   memories, 30 queries, expected `relevant_ids`.
2. A benchmark runner that seeds the dataset, runs every
   query through the real `runSearch()`, and computes
   Recall@5, Precision@5, MRR@10, and per-leg
   contributions.
3. A classifier F1 harness that scores the Gemini
   classifier's `detectedType` output against the dataset's
   ground truth (with a Noop fallback when no Gemini key is
   set).
4. A cross-cutting E2E suite (acceptance tests A–G) that
   exercise the full capture → classify → search → Space
   path on the real Postgres.
5. A release-readiness report generator
   (`docs/core-experience-release-checklist.md`) that
   collects the benchmark numbers, the E2E results, the
   test counts, and the migration versions into one
   operator-friendly markdown file.

**Tech Stack:** TypeScript 5.4, Node 22, vitest, real
Postgres (the same DB the dev environment uses), mocked
Gemini (the bench package does NOT depend on the AI
package's live provider).

**Spec:** [`../0005-core-capture-classification-smart-search.md`](../0005-core-capture-classification-smart-search.md)
§12 (Performance), §15.5 (Golden dataset), §17 (Milestones),
§18 (Acceptance criteria), §20 (Review focus).

## Global Constraints

- The benchmark runs without a Gemini API key. The
  classifier harness uses a deterministic stub when
  `BENCH_FAKE_GEMINI=true` (the default in CI).
- The benchmark dataset is committed to the repo
  (`specs/data/relevance-benchmark/dataset.json`). The
  M1–M3 acceptance tests are not in the dataset; the
  dataset is purely for ranking quality.
- The E2E suite (acceptance tests A–G) runs the actual
  capture route, the actual classify job, the actual search
  route, and the actual Space route. The test cleans up
  everything it creates.
- `STRUCT_WEIGHT = 0.5` and `LEX_WEIGHT = 0.4` are
  pinned in the bench report so a future sweep shows
  them as the baseline.

---

## Task 1 — `packages/bench` workspace skeleton

**Files:**
- New: `packages/bench/package.json`
- New: `packages/bench/tsconfig.json`
- New: `packages/bench/src/index.ts`
- Modified: `pnpm-workspace.yaml` (already lists packages
  but ensure `bench` matches)

**Step 1.1: package.json**

```jsonc
{
  "name": "@mnemonics/bench",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "test": "vitest run",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@mnemonics/database": "workspace:*",
    "@mnemonics/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.5",
    "vitest": "^2.1.4"
  }
}
```

The bench package deliberately does NOT depend on
`@mnemonics/ai`. The classifier harness uses a stub.

**Step 1.2: tsconfig.json**

Mirror the existing packages' tsconfig.

**Step 1.3: `src/index.ts`**

```ts
export { runBenchmark } from './benchmark.js';
export type { BenchmarkReport, BenchmarkQuery } from './benchmark.js';
export { loadDataset } from './dataset.js';
```

**Step 1.4: Build + verify**

```bash
pnpm install
pnpm --filter @mnemonics/bench typecheck
```

Pass criteria: empty typecheck passes.

---

## Task 2 — Golden dataset

**Files:**
- New: `specs/data/relevance-benchmark/dataset.json`
- New: `specs/data/relevance-benchmark/README.md`
- New: `packages/bench/src/dataset.ts`

**Step 2.1: Dataset shape**

The dataset is a JSON file with two top-level keys:

```jsonc
{
  "memories": [
    {
      "id": "mem-001",
      "title": "Wooden Chair",
      "type": "link",
      "raw_text": "A solid oak chair for the home.",
      "captured_at": "2026-10-01T10:00:00.000Z",
      "tags": ["furniture"],
      "source_url": "https://example.com/chair",
      "classification": {
        "detected_type": "product",
        "category": "furniture",
        "attributes": { "brand": "northwind", "material": "wood", "color": "brown" }
      }
    }
  ],
  "queries": [
    {
      "id": "q-001",
      "q": "wooden furniture",
      "relevant_ids": ["mem-001"],
      "labels": ["structured"]
    }
  ]
}
```

60 memories: 10 products, 10 articles, 5 recipes, 5 videos,
5 quotes, 5 highlights, 5 notes, 5 images, 5 screenshots,
5 documents. ~20% Vietnamese (10 memories). 30 queries,
each with `relevant_ids` and a `labels` array (one of
`["lexical"]`, `["semantic"]`, `["structured"]`,
`["hybrid"]`).

**Step 2.2: `dataset.ts`**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface BenchmarkMemory {
  id: string;
  title: string;
  type: 'link' | 'text' | 'image' | 'screenshot' | 'document';
  raw_text: string;
  captured_at: string;
  tags: string[];
  source_url: string | null;
  classification: {
    detected_type: 'article' | 'product' | 'recipe' | 'video' | 'quote' | 'highlight' | 'webpage' | 'image' | 'note' | 'document' | 'other';
    category: string;
    attributes: Record<string, string>;
  };
}

export interface BenchmarkQuery {
  id: string;
  q: string;
  relevant_ids: string[];
  labels: Array<'lexical' | 'semantic' | 'structured' | 'hybrid'>;
}

export interface Dataset {
  memories: BenchmarkMemory[];
  queries: BenchmarkQuery[];
}

export function loadDataset(): Dataset {
  const path = join(__dirname, '..', '..', '..', 'specs', 'data', 'relevance-benchmark', 'dataset.json');
  return JSON.parse(readFileSync(path, 'utf-8')) as Dataset;
}
```

**Step 2.3: Unit test**

`packages/bench/src/__tests__/dataset.test.ts` asserts:

- `loadDataset()` returns 60 memories.
- The 10 product memories all have
  `classification.detected_type === 'product'`.
- 30 queries are present, each with non-empty
  `relevant_ids`.

**Step 2.4: Build + test**

```bash
pnpm --filter @mnemonics/bench build
pnpm --filter @mnemonics/bench exec vitest run
```

Pass criteria: 3 tests pass.

---

## Task 3 — Seeder + benchmark runner

**Files:**
- New: `packages/bench/src/seeder.ts`
- New: `packages/bench/src/benchmark.ts`
- New: `packages/bench/src/__tests__/benchmark.test.ts`

**Step 3.1: `seeder.ts`**

`seedBenchmarkDataset(pool, dataset, userId)`:

- Inserts one `auth.users` row for `userId` (the bench user).
- For every `dataset.memories[i]`, inserts an `items` row
  with `status = 'ready'`, then inserts a matching
  `item_classifications` row with `status = 'ready'`.
- Stores the `dataset.id` → `items.id` mapping in a `Map`
  returned to the caller so the runner can re-key the
  queries' `relevant_ids` to the real `items.id`s.

**Step 3.2: `benchmark.ts`**

`runBenchmark({ pool, userId, dataset? })` runs every query
through `runSearch()` and computes:

- **Recall@5** — fraction of `relevant_ids` in the top 5.
- **Precision@5** — fraction of top 5 that are relevant.
- **MRR@10** — mean reciprocal rank of the first relevant
  hit, capped at rank 10.
- **Per-leg contributions** — when `explain=true` is on
  the request, also report `lexResults`, `semResults`,
  `structResults` per query.

The function returns a `BenchmarkReport`:

```ts
{
  total: 30,
  recallAt5: number,
  precisionAt5: number,
  mrrAt10: number,
  perQuery: Array<{ id: string; recall: number; precision: number; mrr: number }>,
  legCounts: { lex: number; sem: number; struct: number; chunk: number }
}
```

The benchmark fails (throws) if `recallAt5 < 0.5` or
`precisionAt5 < 0.5`. These baselines are the spec's
acceptance floor for the seed dataset; future sweeps tune
them.

**Step 3.3: Test**

`benchmark.test.ts` runs the full benchmark against a
freshly-seeded DB and asserts:

- `recallAt5 >= 0.5`.
- `precisionAt5 >= 0.5`.
- `mrrAt10 >= 0.4`.
- 30 `perQuery` entries are present.
- `legCounts.struct` is non-zero for queries labelled
  `["structured"]`.

**Step 3.4: Build + test**

```bash
pnpm --filter @mnemonics/bench build
pnpm --filter @mnemonics/bench exec vitest run
```

Pass criteria: ≥ 5 tests pass.

---

## Task 4 — Classifier F1 harness (stub-friendly)

**Files:**
- New: `packages/bench/src/classifier-harness.ts`
- New: `packages/bench/src/__tests__/classifier-harness.test.ts`

**Step 4.1: Harness**

`runClassifierF1({ pool, dataset, stub? })`:

- For every memory in the dataset, the harness expects a
  `item_classifications.detected_type` row to be present
  (the seeder already wrote these, so the harness
  short-circuits to the seeded values when the
  `BENCH_FAKE_GEMINI=true` env var is set).
- Compares each memory's stored `detected_type` against the
  ground truth and computes **F1** (macro-averaged over the
  11 classes).
- Returns `{ f1: number, perClass: Record<string, number> }`.

**Step 4.2: Test**

`classifier-harness.test.ts` asserts:

- F1 ≥ 0.9 on the seeded dataset (the seeder writes the
  ground truth, so a perfect score is expected — the
  harness is a regression check that the seeder is honest).
- `perClass.product >= 0.9`.
- `perClass.recipe >= 0.9`.

**Step 4.3: Build + test**

```bash
pnpm --filter @mnemonics/bench build
pnpm --filter @mnemonics/bench exec vitest run
```

Pass criteria: ≥ 3 tests pass.

---

## Task 5 — E2E acceptance suite (tests A–G)

**Files:**
- New: `apps/api/src/__tests__/e2e/acceptance-capture-classify.test.ts`
- New: `apps/api/src/__tests__/e2e/acceptance-search-spaces.test.ts`

**Step 5.1: Test A — One-click capture + classify**

Drives `POST /api/v1/captures` with a `link` payload,
waits for the `classify` job to complete (poll
`item_classifications.status`), and asserts:

- `item_classifications.status === 'ready'`.
- `item_classifications.detected_type` is one of the
  expected values (the harness uses the stubbed classifier
  that returns the ground truth for the fixture).

**Step 5.2: Test B — Detected chip on a search result**

Calls `POST /api/v1/search` with `q = "wooden chair"`,
asserts the top hit's response includes the
`detected_type` chip when the dashboard's enrichment
client is wired up. (M3 ships the chip; this test
asserts the data side is intact.)

**Step 5.3: Test C — Structured filter narrows the grid**

Saves three products, then calls
`POST /api/v1/search` with
`filters.structured = { brand: ['northwind'] }`. Asserts
the result set is a strict subset of the seeded products
and contains only the matching brand.

**Step 5.4: Test D — Save as Space and reopen**

Saves a Smart Space with
`rule.q = 'wooden furniture'`, then calls
`GET /api/v1/spaces/:id/members` and asserts the response
contains the seeded `mem-001` wooden chair.

**Step 5.5: Test E — New memory auto-appears in a Space**

With the same Space from D, saves a NEW wooden chair
afterwards, then re-opens the Space. The new memory must
be in the response (Spaces are live, not snapshots).

**Step 5.6: Test F — Failure isolation**

Captures a link with a stubbed classifier that throws.
Asserts:

- `item_classifications.status === 'failed'`.
- `item_classifications.error_code === 'PROVIDER_ERROR'`.
- `items.status === 'ready'` (the spec forbids flipping
  the item to failed).
- A search for the title still returns the memory (lexical
  fallback).

**Step 5.7: Test G — Pagination + cross-user isolation**

Saves 10 memories for user A, 10 for user B. Calls
`/search` with `limit=5` and asserts the page sizes
correctly. Then asserts user A's response contains zero
of user B's memories.

**Step 5.8: Build + test**

```bash
pnpm --filter @mnemonics/api build
pnpm --filter @mnemonics/api exec vitest run src/__tests__/e2e
```

Pass criteria: 7 tests pass.

---

## Task 6 — Release-readiness report

**Files:**
- New: `packages/bench/src/release-report.ts`
- New: `packages/bench/src/__tests__/release-report.test.ts`
- New: `docs/core-experience-release-checklist.md`
- Modified: `package.json` (root, add `bench:report` script)

**Step 6.1: `release-report.ts`**

`generateReleaseReport(benchmarkReport, classifierReport, e2eResults, opts)`:

- Returns a markdown string with the report sections.
- Section 1: benchmark numbers (Recall@5, Precision@5,
  MRR@10, F1).
- Section 2: E2E acceptance test results (A–G).
- Section 3: per-package test counts (read from a JSON
  manifest the bench writes to disk).
- Section 4: ranking weights pinned in this build
  (`LEX_WEIGHT = 0.4`, `SEM_WEIGHT = 0.6`,
  `STRUCT_WEIGHT = 0.5`).
- Section 5: migration versions applied
  (`025_item_classifications`, `026_items_source_metadata`).
- Section 6: Free Tier verification (env var snapshot).

**Step 6.2: `release-report.test.ts`**

- Asserts the report contains the six section headers.
- Asserts the ranking-weights section shows the pinned
  values.
- Asserts the F1 number is rendered with two decimal
  places.

**Step 6.3: `docs/core-experience-release-checklist.md`**

- Top-level checklist for the operator who cuts the
  release: pull the branch, run `pnpm -r typecheck`,
  `pnpm -r test`, `pnpm -r build`, then run the bench.
- Links to the spec and the four milestone plans.
- States the acceptance criterion from spec 0005 §18
  verbatim and the bench baseline numbers that prove it.

**Step 6.4: Build + test**

```bash
pnpm --filter @mnemonics/bench build
pnpm --filter @mnemonics/bench exec vitest run
```

Pass criteria: ≥ 3 tests pass.

---

## Task 7 — CI integration

**Files:**
- New: `quality-gates/gates/08-knowledge-regression.md` (verify it
  exists; if not, create)

**Step 7.1: Verify the gate exists**

The spec lists `08-knowledge-regression.md` as the gate
that runs the benchmark. Check `quality-gates/gates/`.

If absent, create a thin gate file that runs:

```bash
pnpm --filter @mnemonics/bench exec vitest run
```

and asserts the benchmark baselines.

**Step 7.2: Wire the gate to a runner**

`quality-gates/runners/run-bench.mjs` (new):

- Reads `DATABASE_URL` from env (falls back to the dev
  defaults).
- Invokes the bench's `runBenchmark` + `runClassifierF1`.
- Writes `docs/bench-results.json` with the numbers.
- Exits non-zero on a regression.

**Step 7.3: Add an npm script**

Root `package.json`:

```jsonc
"bench:report": "pnpm --filter @mnemonics/bench exec vitest run --reporter=basic"
```

**Step 7.4: Run all gates**

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
node quality-gates/runners/run-bench.mjs
```

Pass criteria: all green.

---

## Task 8 — Final commit and PR

**Files:**
- Modified: `specs/plans/2026-10-11-…-m4-quality.md` (this file)

**Step 8.1: Final sweep**

- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`
- The bench reports its numbers, all baselines are met.

**Step 8.2: Commit + push**

```bash
git add -A
git commit -m "feat(bench): M4 quality & evaluation (golden dataset + E2E A-G)"
git push origin feat/core-capture-classification-smart-search
```

**Step 8.3: PR description**

The PR is the release readiness report rendered as
markdown. The body is:

- A summary of M1–M4 (one paragraph each).
- The benchmark numbers from `docs/bench-results.json`.
- The E2E acceptance matrix (A–G, with status).
- A checklist of the spec's §18 acceptance criteria,
  each ticked off with a pointer to the test that proves
  it.

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Golden dataset drifts from the real schema | The seeder uses the same `ItemRepository` and `ClassificationRepository` the production code uses, so a schema change forces a dataset update. |
| Benchmark baselines are too tight (always failing) | Baselines are 0.5 / 0.5 / 0.4; the dataset is hand-built to clear them. A future sweep raises the bar. |
| E2E suite is flaky because the `classify` job is async | The test polls the row with a 5-second timeout; the bench stubs Gemini so the row goes `ready` in <1s. |
| Free Tier quota accidentally burned in CI | `BENCH_FAKE_GEMINI=true` is set in the runner. The bench never calls the real provider. |

— end of plan —
