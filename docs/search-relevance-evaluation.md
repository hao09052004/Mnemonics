# Search Relevance Evaluation

This document is the operator-facing reference for the M4
quality gate. It covers the architecture, the dataset, the
ranking weights, the failure modes, and the operator
deployment steps for spec 0005's relevance benchmark.

> For the on-call checklist, see
> [`./core-experience-release-checklist.md`](./core-experience-release-checklist.md).

## 1. Why this exists

The smart search feature (spec 0005 §3–§4) blends four
retrieval legs — lexical, semantic, chunk, and structured —
into a single ranked list using reciprocal-rank fusion.
Tuning the four weights and the deterministic query parser
is a numbers game. Without a labelled golden set and a
repeatable benchmark, every change is guesswork.

The bench package (`packages/bench/`) is the single
regression gate. The runner scripts the four legs, scores
the rankings, and writes a release-readiness report. It
runs on the real Postgres the dev environment uses and
**does not** call the live Gemini provider (Gemini is
stubbed via `BENCH_FAKE_GEMINI=true`).

## 2. Architecture

```
   spec 0005 §4
   ┌─────────────────────────────────────────────────────┐
   │  SearchRequest (q, filters, limit, offset)          │
   └──────────┬──────────────────────────┬───────────────┘
              │                          │
              │ runSearch()              │ parseQuery() — deterministic
              │                          │   (date windows, type hints,
              │                          │    structured tokens)
              ▼                          ▼
   ┌─────────────────────────────────────────────────────┐
   │  four RRF legs                                      │
   │  1. lexical    — to_tsquery('simple', q)            │
   │  2. semantic   — pgvector cosine (gemini embedding) │
   │  3. chunk      — item_document_chunks (documents)   │
   │  4. structured — GIN on item_classifications        │
   └──────────────────────────┬──────────────────────────┘
                              │
                              ▼
   ┌─────────────────────────────────────────────────────┐
   │  reciprocal-rank-fusion                              │
   │  score += (1 / (60 + rank + 1)) * weight            │
   │  weights: lex=0.4  sem=0.6  struct=0.5  chunk=0.5   │
   └──────────────────────────┬──────────────────────────┘
                              │
                              ▼
                    SearchResponse (hits, explain)
```

`SearchResponse.explain_data` returns the per-leg
contributions so an operator can see which leg won and
which leg was silent.

## 3. The golden dataset

`specs/data/relevance-benchmark/dataset.json` holds:

- **60 memories** spread across all 11 detected types:
  10 products, 10 articles, 5 recipes, 5 videos, 5 quotes,
  5 highlights, 5 notes, 5 images, 5 screenshots, 5
  documents. ~20% Vietnamese.
- **30 queries** with hand-labelled `relevant_ids` and
  `labels` drawn from `lexical | semantic | structured |
  hybrid`.

The seeder (`packages/bench/src/seeder.ts`) inserts the
dataset into a fresh bench user, returns a
`Map<datasetId, itemsId>` so the runner can re-key
`relevant_ids` to the real `items.id` on every re-run.

## 4. Ranking weights (pinned)

| Weight   | Value | Source                                       |
|----------|------:|----------------------------------------------|
| LEX      | 0.4   | `packages/database/src/search-service.ts`     |
| SEM      | 0.6   | same file                                    |
| STRUCT   | 0.5   | same file                                    |
| CHUNK    | 0.5   | same file                                    |
| RRF k    | 60    | the constant in the RRF formula              |

The M4 baselines (below) are pinned against these
weights. A future M5 sweep raises the bar after the
golden dataset grows.

## 5. Baselines

The M4 acceptance floor (spec 0005 §18) is:

| Metric         | Baseline |
|----------------|---------:|
| Recall@5       | ≥ 0.50   |
| Precision@5    | ≥ 0.50   |
| MRR@10         | ≥ 0.40   |
| Classifier F1  | ≥ 0.90   |

The runner throws `Benchmark regression: …` on a miss
and the bench tests fail. The threshold is intentionally
loose at the M4 boundary so the seed dataset clears it
out of the box. A regression alert is the gate — not a
score.

## 6. Failure modes

- **Gemini is down.** The bench stubs the classifier and
  the embedder via `BENCH_FAKE_GEMINI=true`. The runner
  still scores the lexical leg and the structured leg
  correctly.
- **Database is unreachable.** The bench's `setup.ts`
  reads `DATABASE_URL` from the repo-root `.env`. The
  vitest suite prints `skipIfNoDb` and exits 0 — the
  tests are not a wall of connection errors on a
  contributor's laptop.
- **A leg returns 0 candidates.** The runner does not
  throw on an empty leg; it just shows the leg count as
  0. The RRF formula degrades gracefully.
- **The dataset is out of date with the schema.** The
  seeder uses the same `ItemRepository` and
  `ClassificationRepository` the production code uses, so
  a schema change forces a dataset update.

## 7. Operator deployment steps

1. **Run the bench in CI** on every PR that touches
   `packages/database/src/search-service.ts`,
   `packages/ai/`, or `specs/data/relevance-benchmark/`.
2. **Block the merge** if the bench throws. The bench is
   wired to `gate-08-knowledge-regression.md`; the runner
   is `quality-gates/runners/knowledge-regression.mjs`.
3. **Read the report** at `docs/bench-results.json`. The
   release report is the markdown render of that JSON;
   the `pnpm bench:report` script writes both.
4. **Compare across runs** — every commit that changes a
   ranking weight must be paired with a bench run that
   records the previous numbers. The release report's
   `## 5. Ranking Weights (pinned)` section is the
   diff that proves no weight changed.
5. **Free-Tier verification.** The runner never calls
   the real Gemini provider, so Free Tier quota is not
   burned in CI.

## 8. M5 follow-ups

The bench baselines are intentionally loose. A future M5
sweep will:

- Grow the dataset to 200+ memories and 100+ queries.
- Add a per-class F1 score for the classifier harness.
- Sweep the four weights with a grid search.
- Add a `/api/v1/search/ab` endpoint that the bench can
  hit to A/B test two configurations in production.

For now, the M4 gate is the single source of truth for
"is the search good enough to ship".

— end of evaluation doc —
