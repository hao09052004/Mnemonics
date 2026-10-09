# M5 — Re-rank

## Why

A 200-page PDF that was searched for a phrase on page 80 used
to return nothing. M4 fixed that by indexing chunks. M5
improves the ranking of the chunks that come back.

## What

After the existing RRF blend in
`packages/database/src/search-service.ts`, each hit's `rrf`
score is blended with a second-pass cosine similarity
against the query embedding:

    score = (1 - RERANK_ALPHA) * rrf + RERANK_ALPHA * cosine(query, hit.embedding)

`RERANK_ALPHA` is a single constant in
`packages/database/src/search-service.ts`. Today it is `0.3`.
It is not a config knob.

## Gate

The step is **off by default**. Set
`SEARCH_RERANK_ENABLED=true` in the API's environment to
turn it on. When off, `runSearch` returns the same hit
order as the post-M4 build, byte for byte. Cardinality is
preserved when on; only the order changes.

## Status in this milestone

M5 ships the re-rank *infrastructure* and the unit-tested
blend math. The legs in `runSearch` do not yet return
per-hit embeddings in the fused list, so when the env var
is on the re-rank step falls through to its no-op path
(cosine = 0 for every hit). The behaviour is byte-equal
to the off case.

Surfacing per-hit embeddings through the legs is a future
change. M7 (search result explainability) is the natural
home: when M7 adds per-hit embeddings to the
`SearchResponse`, the re-rank step becomes live
automatically without further changes to this milestone.

## Tests

- `packages/database/src/__tests__/search-rerank.test.ts`
  — pure unit tests for `rerankHits`:
  - identity when no query embedding is provided;
  - re-orders hits when the second-pass cosine flips the
    RRF order;
  - preserves the cardinality of the input;
  - `RERANK_ALPHA` is in the open interval `(0, 1)`;
  - a hit with a zero-norm embedding is kept and not
    re-scored (it keeps its RRF contribution).
- `apps/api/src/routes/__tests__/search-rerank.test.ts`
  — HTTP-level test for the env-var gate:
  - `SEARCH_RERANK_ENABLED` unset returns the M4 hit
    order;
  - `SEARCH_RERANK_ENABLED=true` is byte-equal to the
    unset case in this milestone (the per-hit embedding
    plumbing is future work).

## Out of scope

- Query expansion (planned but dropped from M5).
- A new cross-encoder model.
- BM25 tuning.
- Surfacing the re-rank score in the UI (that is M7).
- Per-hit embedding plumbing through the search legs
  (deferred to M7 or a follow-up).
