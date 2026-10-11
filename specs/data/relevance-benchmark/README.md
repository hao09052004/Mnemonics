# M4 — Relevance Benchmark

This is the golden dataset the M4 benchmark runner uses
to score `runSearch()`'s ranking quality. The benchmark
exercises every retrieval leg (lexical, semantic, chunk,
structured) and is the regression gate for the smart
search feature.

## Shape

- **60 memories**: 10 products, 10 articles, 5 recipes, 5
  videos, 5 quotes, 5 highlights, 5 notes, 5 images, 5
  screenshots, 5 documents. ~20% Vietnamese.
- **30 queries** with hand-labelled `relevant_ids` and
  `labels` (`lexical | semantic | structured | hybrid`).

## Files

- `dataset.json` — the dataset itself.
- `../../packages/bench/src/dataset.ts` — loader.
- `../../packages/bench/src/benchmark.ts` — runner.
- `../../packages/bench/src/seeder.ts` — DB seeder.

## Running

```bash
pnpm bench:report
```

The benchmark uses the same Postgres the dev environment
uses. The seeder creates a fresh bench user + items +
classifications per run, and cleans them up.

## Baselines (M4 acceptance)

- **Recall@5 ≥ 0.50**
- **Precision@5 ≥ 0.50**
- **MRR@10 ≥ 0.40**
- **Classifier F1 ≥ 0.90** (seeder writes the ground
  truth, so the harness is a regression check that the
  seeder is honest)

A future M5 sweep will raise these baselines after the
M4 acceptance is in place.
