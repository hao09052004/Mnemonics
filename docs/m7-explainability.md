# M7 — Search result explainability

## Why

M5 lifts the relevance ceiling for chunk-level hits, but
the user cannot see *why* a hit was returned. The
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

The block is **off by default** (env var
`SEARCH_EXPLAINABILITY_ENABLED=true` turns it on). When
off, the response is byte-equal to the post-M6 response.

The web dashboard renders a `<details>` pill below the
snippet. The expansion is a 5-row table with the four
decimal-place scores. Touch devices tap to toggle.
The extension renders the same string with no expand —
the popup width is too narrow for a table.

Related items (`auto-link-similar`) carry a smaller
`explanation: { weight }` field. The only signal for a
related item is the edge weight; there is no lexical or
chunk leg.

## Where

- `packages/database/src/search-explainability.ts` — the
  pure builder. Returns `null` when the env var is unset.
- `packages/database/src/search-service.ts` — wires the
  builder into `runSearch`. Per-leg tracking happens
  alongside the existing legs and the RRF step.
- `apps/api/src/jobs/auto-link-similar.ts` — adds the
  same shape (just `weight`) to related items.
- `apps/api/src/routes/search.ts` — forwards the field
  to the HTTP response. While in there, also forwards
  the M4 `page_start` / `page_end` / `chunk_index`
  fields that the route was silently stripping.
- `apps/web/src/components/dashboard/MemoryCard.tsx` —
  the pill (`<details>`).
- `apps/extension/dashboard.js` — the extension pill
  (string template, no expand).

## Out of scope

- A graph or drill-down view of the explanation.
- Per-leg weights inside the explanation (we ship
  per-leg *scores*, not the raw weights).
- Auto-link "why this is similar" beyond the edge
  weight.
- Re-rank fields beyond the post-RRF score. The
  per-alpha contributions are future work.
- Per-hit embedding plumbing through the legs. The M5
  re-rank step is currently a no-op (it falls through
  when no per-hit embedding is plumbed). When that
  plumbing lands in a future change, the M7
  explanation's `rerank` field becomes the live
  post-re-rank score without any further M7 work.
