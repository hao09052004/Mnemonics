# Core Experience — Release Readiness Checklist

This is the operator checklist for shipping spec 0005
(*Core Capture, Classification & Smart Search*). It is
written for the person cutting the release — it tells them
what to run, in what order, and what "good" looks like.

The benchmark numbers and the E2E acceptance matrix are
the single regression gate. If they are green, the
milestone is ready to merge.

---

## 1. Pre-flight: branch and code

```bash
git checkout feat/core-capture-classification-smart-search
git fetch origin
git rebase origin/main
```

The four milestone plans live at:

- [`../plans/2026-10-11-core-capture-classification-smart-search-m1-capture.md`](../plans/2026-10-11-core-capture-classification-smart-search-m1-capture.md)
- `…-m2-classification.md`
- `…-m3-search.md`
- [`../plans/2026-10-11-core-capture-classification-smart-search-m4-quality.md`](../plans/2026-10-11-core-capture-classification-smart-search-m4-quality.md)

The acceptance criterion is verbatim from
[`../0005-core-capture-classification-smart-search.md`](../0005-core-capture-classification-smart-search.md)
§18:

> *A wooden chair product page is saved through the
> extension with a single click. The memory persists, the
> classifier fills in `detected_type = 'product'`,
> `category = 'furniture'`, `material = 'wood'` (from
> JSON-LD). A search for "wooden furniture" finds the chair
> as the top hit. An existing Smart Space with the rule
> "wooden furniture" automatically includes the chair on
> next open. The user did not enter a title, a tag, a
> category, or a folder.*

---

## 2. Quality gates (run in order)

```bash
pnpm -r typecheck   # Gate 02
pnpm -r test        # Gates 03 + 04 (no security here)
pnpm -r build       # compile every package
```

**Expected:** every command exits 0. The total test count
across the repo must be at least the value in
[§4](#4-test-count-baseline) of this document.

---

## 3. M4 benchmark (the single regression gate)

```bash
pnpm --filter @mnemonics/bench exec vitest run
node quality-gates/runners/run-bench.mjs
```

The benchmark uses the same Postgres the dev environment
uses and **does not** require a Gemini key (the runner
sets `BENCH_FAKE_GEMINI=true` by default). The classifier
F1 is checked against a 60-memory, 11-class hand-labelled
golden dataset; the relevance benchmark is 30 queries
spanning lexical, semantic, structured, and hybrid intents.

### Acceptance baselines

| Metric        | Baseline | What "good" means |
|---------------|---------:|-------------------|
| Recall@5      | ≥ 0.50   | 50% of the dataset's `relevant_ids` show up in the top 5 |
| Precision@5   | ≥ 0.50   | 50% of the top 5 are actually relevant |
| MRR@10        | ≥ 0.40   | The first relevant hit is in the top 2.5 on average |
| Classifier F1 | ≥ 0.90   | The seeder writes the ground truth, so the harness is a regression check that the seeder is honest |

The runner writes the latest numbers to
`docs/bench-results.json`; the PR body is rendered from
that file.

---

## 4. Test count baseline

The pre-M4 baseline is **411 tests** (across the four
`packages/*` workspaces + `apps/api` + `apps/web`). The
M4 push adds:

- `@mnemonics/bench` — 8 tests (4 dataset + 4 integration)
- `apps/api` — 7 E2E acceptance tests A–G

Post-M4 floor: **819 tests** (verified on `feat/core-capture-classification-smart-search`):

| Package          | Tests | Skipped |
|------------------|------:|--------:|
| `@mnemonics/shared`  | 35  | 0 |
| `@mnemonics/ai`      | 137 | 1 |
| `apps/extension`     | 78  | 0 |
| `apps/web`           | 143 | 0 |
| `@mnemonics/database`| 100 | 0 |
| `apps/api`           | 318 | 1 |
| `@mnemonics/bench`   | 8   | 0 |
| **Total**            | **819** | **2** |

---

## 5. Database migrations

Two new migrations land in this branch:

- `025_item_classifications.sql` — the
  `item_classifications` table, indexes, RLS, and the
  `item_classifications_attributes_gin` GIN index.
- `026_items_source_metadata.sql` — the
  `items.source_metadata` JSONB column.

Apply locally with:

```bash
pnpm --filter @mnemonics/database exec tsx scripts/migrate.ts --apply
```

The runner is idempotent; it will report
`[ALREADY-APPLIED]` for migrations that have already been
committed to `schema_migrations`.

---

## 6. Ranking weights (pinned)

| Weight  | Value | Source |
|---------|------:|--------|
| LEX     | 0.4   | `packages/database/src/search-service.ts` |
| SEM     | 0.6   | same file |
| STRUCT  | 0.5   | same file |
| RRF k   | 60    | reciprocal-rank-fusion formula |

A future ranking-weight sweep raises these baselines after
the M4 acceptance is in place. M5 owns that work.

---

## 7. Free Tier verification

Before merging, confirm:

- `AI_FREE_ONLY=true` in the staging environment.
- The classifier is configured to return a structured
  `PROVIDER_ERROR` rather than retrying on the paid
  fallback when Free Tier is on.
- The bench runner **never** calls the real Gemini
  provider; the `BENCH_FAKE_GEMINI=true` flag stubs it.

A `[ ]` here means the release is not Free-Tier-safe.

---

## 8. PR description template

When you open the release PR, paste:

> ### What this PR ships
>
> M1 — one-click capture (link / selection / image /
> screenshot / document), Readability extraction, capture
> surface metadata.
>
> M2 — AI classifier (Gemini → noop fallback), structured
> `item_classifications` row, JSONB attributes, JSON-LD
> overrides, user-edit precedence.
>
> M3 — 4-leg RRF search (lexical + semantic + chunk +
> structured), deterministic query parser, Smart Spaces
> with live rule execution.
>
> M4 — relevance benchmark + golden dataset, E2E
> acceptance suite (tests A–G), release report.
>
> ### Benchmark numbers
>
> (paste the table from `docs/bench-results.json`)
>
> ### Acceptance matrix
>
> | Letter | What it proves | Test |
> |--------|----------------|------|
> | A | capture + classify | `apps/api/src/__tests__/e2e/acceptance-m4.test.ts` |
> | B | lexical + semantic search | same file |
> | C | structured filter narrows | same file |
> | D | Smart Space resolves | same file |
> | E | new memory auto-appears | same file |
> | F | failure isolation | same file |
> | G | cross-user isolation | same file |

---

## 9. Post-merge smoke

After the PR is merged:

- [ ] Pull the production deployment branch.
- [ ] Run the bench against the staging DB.
- [ ] Open one capture, one search, and one Smart Space in
      the dashboard. Confirm the wooden-chair acceptance
      scenario end-to-end.
- [ ] Close the spec and tag the release.

— end of checklist —
