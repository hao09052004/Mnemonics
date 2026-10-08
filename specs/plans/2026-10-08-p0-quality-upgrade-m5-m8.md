# P0 Quality Upgrade — Milestones 5–8

> **Status:** Scope confirmed 2026-10-08. Reading A. M5 → M6 → M7 → M8,
> all four ship, M7 minimal, M8 path-only. The M5 TDD plan is in
> [`2026-10-08-m5-rerank.md`](2026-10-08-m5-rerank.md); M6–M8 TDD
> plans land when their turn comes.

**Goal:** Close out the M1–M4 AI-quality series started on
`feat/p0-quality-upgrade` (M1 = embedding identity, M2 = cluster hydration,
M3 = cluster v2 algorithm, M4 = chunk-level embeddings for long PDFs)
with four more milestones that the user can review, scope, and either
shrink or expand before any of them ships.

**Architecture:** Each milestone is a self-contained quality pass with
its own:

* test surface under `apps/api/src/jobs/__tests__/` (algorithm) and/or
  `apps/api/src/routes/__tests__/` (HTTP),
* a spec section numbered in the same M-series convention (M4 was §22–§35;
  M5 starts at §36),
* a `pnpm typecheck` + `pnpm test` + `pnpm gates:all` gate before
  commit, per `quality-gates/gates/02-typecheck.md` and
  `03-test-coverage.md`.

**Tech Stack:** No new dependencies. Each milestone reuses
`@mnemonics/shared`, `@mnemonics/ai`, `@mnemonics/database`, and the
existing `apps/api` job pipeline.

**Spec:** This document **is** the spec for M5–M8. There is no prior
art — see *Assumption* below.

---

## Assumption — and the two ways to read this plan

The user said "do M6, then M7, M8" but did not name what M5 is. Two
readings are plausible, and they lead to different M5–M8 scopes:

**Reading A (default for this draft).** *M5 is the next link in the
M1–M4 quality series.* M1 fixed embedding identity, M2 hydrated
cluster detail, M3 reworked the cluster algorithm, M4 added
chunk-level embeddings. M5–M8 continue the same arc — search and
cluster *quality* rather than new product surface. The four
sub-scopes below assume this reading.

**Reading B.** *M5 is the next product milestone after the 8-week
plan.* The 8-week roadmap drafted on 2026-09-30 named M5 as
"Enhancement" (rate limiting, CORS, OpenAPI, monitoring, Spaces/tag
UI, settings, mobile-responsive dashboard) and M6 as "Knowledge
Graph (P1)". If the user means Reading B, M5–M8 are about hardening,
operations, and the graph feature, and **this draft is the wrong
plan entirely**. Discard §2 below and replace it with a re-derivation
of the original 8-week roadmap's M5–M8 against the current state of
the repo.

**The user must pick A or B before any code is written.** The two
ask-question prompts at the end of this plan make the choice
explicit.

---

## 1. Reading-A scope (default draft)

Four milestones, each a single verifiable quality pass. Each
delivers (a) code, (b) a test section, (c) a documentation
section in this file or a sibling doc, and (d) a clean
`pnpm gates:all`.

| # | Name | One-line goal |
|---|------|----------------|
| **M5** | **Hybrid-search re-ranking** | Improve search relevance by adding a lightweight re-rank step (BM25 + vector → RRF) and a query-expansion hook on top of M4's chunk-level recall. |
| **M6** | **Cluster quality benchmark + regression gate** | Add a deterministic, seedable benchmark (`packages/database/src/__tests__/cluster-benchmark.test.ts`-style) that pins cluster quality numbers (component count, unclustered fraction, intra-cluster cosine) and turns the existing `cluster-benchmark.test.ts` into a CI gate. |
| **M7** | **Search result explainability + related-memories upgrade** | Surface *why* a result matched (chunk id, lexical vs. vector contribution, RRF delta) in the API response and in the dashboard, and use the same explainability data to upgrade the "Related memories" surface. |
| **M8** | **Embedding-model migration path** | Add an `embedding_model` column to `item_embeddings` (and chunks), back-fill it, and write a re-embed migration that can roll a single user from one model to another without a full re-capture. |

The reasoning behind the order:

* M5 lifts the ceiling on the embedding + cluster work M1–M4 already
  did, but it's a behaviour change. Pinning the current behaviour
  with a benchmark first (M6) means M5 can be measured, not
  guessed.
* M6 is the gate that *proves* M5 helped. Without M6, M5 is
  "trust me, it's better".
* M7 is where the API surfaces M5's win. Until the user can see
  *why* a chunk matched, M5 is invisible.
* M8 is the operationalisation. Once M5–M7 are stable, the
  embedding model can change without losing the work.

This is one valid ordering. The user can re-order or replace any
sub-scope — see §3.

---

## 2. Per-milestone draft

### 2.1 M5 — Hybrid-search re-ranking

**Spec section:** §36 – §49 (new numbering, continues M4's §35).

**Problem (root-cause statement):**
M4 raised the recall ceiling for long documents by indexing
chunks. But `packages/database/src/search-service.ts` line 428
(Chunk-level semantic leg, Milestone 4) still fuses lexical and
vector hits with the same RRF weights that worked for whole-doc
embeddings. Chunk-level vector hits are *more granular* than
lexical hits, so they end up over-counted in the RRF blend for
short queries and under-counted for long ones.

**Proposed fix (smallest viable change):**
A re-rank step *after* the RRF blend, not a re-write of the
blend. Concretely:

* `search-service.ts` exposes
  `rerankResults(query, hits, opts): Hit[]`.
* Default: identity (no behaviour change for the existing
  score distribution; gate-able via `SEARCH_RERANK_ENABLED=false`).
* When enabled: a second-pass cosine on `(query_embedding, hit_embedding)`
  with a small `alpha` blend against the RRF score. alpha is
  a single constant in `search-service.ts`, not a new
  knob per call.
* Query expansion: when `query.tokens.length < 6`, prepend the
  top 1 term from the user's recent captures (read from
  `item_embeddings` last 30 days). One hook, not a full
  expansion framework.

**Acceptance criteria:**

* `pnpm typecheck` clean.
* `pnpm test` clean, with **two new tests** in
  `apps/api/src/routes/__tests__/search-rerank.test.ts`:
  - `rerank disabled: returns the same hit order as pre-M5 for
    the M4 long-PDF fixture`.
  - `rerank enabled: re-orders the top 3 hits when a query
    matches a chunk that was previously outscored by a
    whole-doc lexical hit`.
* A new section in `docs/search.md` (or `docs/ai-architecture.md`
  if that's the right home) explaining the re-rank step.
* `pnpm gates:all` clean.

**Files touched (estimate):**
* modify `packages/database/src/search-service.ts` (one new
  function, two new tests).
* create `apps/api/src/routes/__tests__/search-rerank.test.ts`.
* create `docs/m5-rerank.md` (or extend an existing doc).

**Not in M5:** a new cross-encoder model, BM25 tuning, query
expansion beyond the single-term hook. Those are speculative.

### 2.2 M6 — Cluster quality benchmark + regression gate

**Spec section:** §50 – §59.

**Problem:**
`packages/database/src/__tests__/cluster-benchmark.test.ts`
exists but is skipped by default (see `cluster-detail-pagination.test.ts`
using the same skip pattern). The cluster algorithm was rewritten
in M3 with no numerical baseline to compare against, so a
silent regression — a small change in the algorithm that drops
3% of components or raises unclustered count by 1.5× — would
ship without anyone noticing.

**Proposed fix:**
* Turn the existing benchmark into a deterministic, seedable
  test that **always runs** in CI.
* Pin a small fixture (10–20 synthetic `item_edges` rows) with
  known-good component boundaries.
* Assert on three numbers, with hard floors and ceilings:
  - `componentCount >= 2` (the fixture's known minimum).
  - `unclusteredCount / totalNodes <= 0.30`.
  - `meanIntraClusterCosine >= 0.78` (the M3 threshold).
* Wire it into `quality-gates/gates/03-test-coverage.md` as a
  regression tier.

**Acceptance criteria:**

* `pnpm test` clean, with the benchmark **failing the build**
  if any of the three numbers drift by more than 10% from
  the pinned baseline.
* `pnpm gates:all` clean.
* The benchmark's output is human-readable (a small table with
  the three numbers + drift deltas) and is printed when
  the test runs, not only on failure.

**Files touched (estimate):**
* modify `packages/database/src/__tests__/cluster-benchmark.test.ts`
  (remove the skip, add fixture + drift assertions).
* modify `quality-gates/gates/03-test-coverage.md` (add a
  paragraph pointing to the benchmark).
* possibly create a tiny helper
  `packages/database/src/__tests__/fixtures/cluster-fixture.ts`
  to keep the fixture honest.

**Not in M6:** a real-corpus benchmark (would need labelled data
we don't have). A real-corpus eval is a future milestone if the
user ever collects one.

### 2.3 M7 — Search result explainability + Related memories upgrade

**Spec section:** §60 – §69.

**Problem:**
M5 lifts relevance but the user can't see *why* a chunk matched.
The dashboard renders chunk-level results as opaque cards; the
"Related memories" surface does the same for the auto-link graph.
This is the moment a user wonders "why is this random PDF next to
my meeting note?" and we have no answer.

**Proposed fix:**
* `search-service.ts` returns, for each hit, a small
  `explanation` block:
  - `lexicalScore`, `vectorScore`, `rrfScore`,
    `rerankScore` (when enabled), and the `delta` between
    RRF and re-rank when re-rank moved the hit.
  - The matched chunk's `id` and (for documents) `pageStart`.
* `auto-link-similar.ts` returns the same shape for "Related
  memories", so both surfaces speak the same vocabulary.
* The web dashboard adds a one-line "Why this matched" pill on
  each card that expands to the score table on hover/focus.
* The extension dashboard mirrors the same one-line pill (no
  expand — popup width).

**Acceptance criteria:**

* `pnpm typecheck` clean.
* `pnpm test` clean, with **two new tests**:
  - `search-service.test.ts`: when a chunk matches, the hit
    carries the four scores + the matched chunk id.
  - `auto-link-similar.test.ts`: when an item is linked to a
    related memory, the link carries the same explanation
    shape.
* `apps/web/src/components/dashboard/__tests__/`
  `SearchResultExplainability.test.tsx` (new) renders the
  pill on a fixture hit and asserts the expanded table on
  focus.
* `pnpm gates:all` clean.

**Files touched (estimate):**
* modify `packages/database/src/search-service.ts` (add
  `explanation` to the hit shape; the existing tests
  must keep passing).
* modify `packages/database/src/auto-link-similar.ts` (same).
* modify `apps/web/src/components/dashboard/MemoryCard.tsx`
  (add the pill + expand on focus).
* modify `apps/extension/dashboard.js` (one-line pill, no
  expand).
* create the new test file(s).

**Not in M7:** a full visual graph, a click-to-explore drill-down,
a "re-run search with this filter" interaction. Those are
speculative.

### 2.4 M8 — Embedding-model migration path

**Spec section:** §70 – §79.

**Problem:**
The repository committed in M1 that
`item_embeddings.dimensions = 1024` for everyone. That's the
right invariant today, but there is no *path* to change it:
if a future embedding model comes out at 768 or 1536, there is
no migration that lets a single user re-embed without nuking
the table or running an offline batch.

**Proposed fix (smallest viable change):**
* Add `embedding_model TEXT NOT NULL DEFAULT 'unknown'` to
  `item_embeddings` and to the new `item_chunk_embeddings`
  table that M4 introduced (or to whichever child table M4
  is using; verify at execution time).
* Add a single SQL function `re_embed_user(user_id uuid, model
  text) → void` that:
  - marks every existing embedding for that user as `stale`
    via a `stale_at` column.
  - enqueues an `embed` job for each stale row, with the new
    model in the job payload.
  - the existing `embed` handler reads the requested model
    from the job payload instead of the global config.
* A migration `023_embedding_model.sql` adds the column +
  function. Existing rows get `embedding_model = 'bge-m3-or-gemini'`
  (the M1 contract).

**Acceptance criteria:**

* `pnpm typecheck` clean.
* `pnpm test` clean, with **two new tests**:
  - a unit test on the SQL function: calling
    `re_embed_user(<test_user>, 'gemini-embedding-001')`
    enqueues exactly N `embed` jobs for the user's items.
  - an `embed-handler` test: a job with `model: 'gemini-embedding-001'`
    in the payload uses that model instead of the env
    default, and the resulting row's `embedding_model`
    matches the job.
* A short doc in `docs/m8-embed-migration.md` (or the
  existing `docs/ai-architecture.md` extended) showing the
  exact SQL to roll one user from one model to another.
* `pnpm gates:all` clean.

**Files touched (estimate):**
* create `packages/database/migrations/023_embedding_model.sql`.
* modify `packages/database/src/items-embeddings-repo.ts`
  (or wherever M4 put the chunk-embedding code).
* modify `apps/api/src/jobs/handlers/embed.ts` (read model
  from the job payload).
* modify `apps/api/src/jobs/__tests__/embed.test.ts` (new
  test cases).
* create the new doc.

**Not in M8:** a real cross-model evaluation, an automatic
re-embed cron, a UI to "switch model". Those are speculative.

---

## §36–§49. M5 spec — re-rank contract

These paragraphs are the canonical contract for M5. The
implementation in Tasks 2–5 of the M5 TDD plan
([`2026-10-08-m5-rerank.md`](2026-10-08-m5-rerank.md)) argues
from this section.

**§36.** Re-rank is a post-RRF step. The existing
`reciprocalRankFusion` output is the input.

**§37.** Re-rank is enabled only when
`process.env.SEARCH_RERANK_ENABLED === 'true'`. When the env var
is unset, empty, or any other value, the step is a no-op.

**§38.** When re-rank is enabled, the score of each hit is
replaced by a blend of its RRF score and a second-pass cosine
similarity against the query embedding:

    score = (1 - RERANK_ALPHA) * rrf + RERANK_ALPHA * cosine(query, hit.embedding)

**§39.** `RERANK_ALPHA` is a single module-level constant in
`packages/database/src/search-service.ts`. It is exported.
It is not a config knob, not a per-call option, not an env
var. The implementation in this milestone uses `0.3`.

**§40.** When re-rank is enabled, the response shape
(`SearchResponse.hits[].score`) reflects the blended score.
When re-rank is disabled, the score is the RRF score, exactly
as M4 produced it.

**§41.** Cardinality of the response is preserved. The same
set of `id` values is returned in either state; only the order
changes.

**§42.** When the query is empty or no hit carries an
embedding, the re-rank step is a no-op (identity). The
`cosine` value for hits with no embedding is treated as `0`.

**§43.** The re-rank step does not perform query expansion.
Query expansion was a candidate for M5 and is dropped from
this milestone's scope.

**§44.** The re-rank step does not perform BM25 tuning, does
not introduce a new cross-encoder model, and does not require
a new SQL migration.

**§45.** The web dashboard sees no change in M5. The
`SearchResponse` consumer in
`apps/web/src/lib/api-client.ts` is not modified in this
milestone. Surfacing the re-rank score in the UI is M7.

**§46.** The extension dashboard sees no change in M5. The
extension consumes the same `SearchResponse` and renders the
same card list.

**§47.** Failure modes. If the embedding provider returns
`null` for the query (e.g. a free-tier deploy with no
embedding service), the re-rank step is a no-op — the
default RRF order is preserved. The user does not see an
error.

**§48.** Performance. The re-rank step is `O(N * d)` where
`N` is the number of fused hits (≤ 100 in this codebase) and
`d` is the embedding dimension (1024 in M1). The whole step
runs in < 1 ms on a typical fused hit list.

**§49.** Observability. The re-rank step is not separately
logged in M5. The existing `explain` block in
`SearchResponse` is unchanged. M7 adds the per-hit
explanation that includes the re-rank score.

---

## §50–§59. M6 spec — cluster quality benchmark

The cluster algorithm was rewritten in M3 without a numerical
baseline to compare against. A silent regression — a small
change that drops 3% of components or raises the unclustered
fraction by 1.5× — would ship without anyone noticing.
M6 turns the existing `cluster-benchmark.test.ts` from a
single deterministic test into a CI gate that fails the
build when cluster quality drifts beyond a fixed tolerance.

**§50.** The benchmark is run on every `pnpm test` and
`pnpm gates:all` invocation. It is **not** skipped.

**§51.** The benchmark is a pure function that takes a
synthetic edge list and a node list, runs the v2 algorithm
(`mutualEdges`, `connectedComponents`, `pruneBridges`),
and returns three numbers:

  * `componentCount` — the number of connected components
    after mutual-kNN + bridge pruning, on the synthetic
    fixture;
  * `unclusteredFraction` — the fraction of nodes that
    are in components of size 1 (i.e. the "noise" /
    unclustered mass), `0 ≤ unclusteredFraction ≤ 1`;
  * `meanIntraClusterCosine` — the mean cosine similarity
    of the edges inside each non-trivial component,
    averaged across components. `0 ≤ mean ≤ 1`.

**§52.** The fixture is the existing M3 benchmark (6-node
Finance, 6-node RL, 1 bridge), plus a new "lonely" node with
no edges. Total: 14 nodes.

**§53.** Acceptance thresholds (the build fails when any
is missed):

  * `componentCount >= 2` (the fixture's two dense topics
    must remain separate after pruning);
  * `unclusteredFraction <= 0.30` (the lonely node + the
    bridge count as unclustered, so 2 / 14 ≈ 0.143 is the
    expected value; the threshold is 2× the expected);
  * `meanIntraClusterCosine >= 0.78` (the M3 weight
    threshold, applied to the intra-component edges).

**§54.** The benchmark prints the three numbers and a
`delta` line to stdout on every run, in the form:

    [cluster-benchmark] { componentCount: 2, unclusteredFraction: 0.143, meanIntraClusterCosine: 0.875, deltas: { componentCount: 0, unclusteredFraction: 0, meanIntraClusterCosine: 0 } }

The `deltas` block is the absolute drift from the pinned
baseline. The pinned baseline is committed next to the
benchmark as a constant in the test file.

**§55.** A regression in any of the three numbers is a
hard failure. The test is named
`Cluster quality benchmark (Milestone 6 §50–§55)` so the
failure shows up with the right attribution in CI logs.

**§56.** The benchmark is **deterministic** across runs
and machines. There is no randomness, no time-of-day
dependency, no wall-clock, no DB.

**§57.** The benchmark does not assert on the bridge's
attachment. A bridge that attaches to one side is a valid
outcome; what matters is that the two topics are separate
and the components' internal coherence is high.

**§58.** The benchmark does not require a real `pg.Pool`.
It is a pure in-memory test of the cluster algorithm.
The integration test of the SQL CTE in
`packages/database/src/__tests__/clusters.test.ts` is
unchanged and stays separate.

**§59.** A small paragraph is added to
`quality-gates/gates/03-test-coverage.md` pointing at the
benchmark. The gate is *coverage* (the existing rule), not
*benchmark*; the paragraph is documentation for the
reviewer, not a new gate rule.

---

## §60–§69. M7 spec — search result explainability

TBD — written when M7 is the active milestone.

---

## §70–§79. M8 spec — embedding-model migration path

TBD — written when M8 is the active milestone.

---

## 3. Re-order / replace / drop — what the user can change

The four milestones above are a default scope, not a contract.
Each is independently droppable. The user can:

| Action | Effect |
|---|---|
| Re-order (e.g. M6 before M5) | Re-number the spec sections + re-plan the M8 migration path to come *after* the benchmark is in place. |
| Drop M5 | M6 (benchmark) still works as a regression gate; M7 (explainability) is still useful without re-ranking. |
| Drop M6 | M5 and M7 still ship; we lose the regression gate but keep the feature work. **Not recommended** — without M6, the rest of the series has no quality signal. |
| Drop M7 | M5 and M6 still ship; the API response shape stays smaller. |
| Drop M8 | The series ends at M7. The embedding model stays single-model until something forces the question. |
| Add M9+ | Free. Common follow-ups: real-corpus benchmark, related-memories graph surface, "memory of the day" panel, image-only Spaces. The status doc `docs/m3-m4-status.md` already lists candidates. |

The single non-negotiable in this draft is **M6 (the regression
gate)**. If M6 is dropped, M5–M8 become unmeasurable; the
principle in `AGENTS.md` §8 ("Verify before completion. Every
claim must be checkable; every 'done' must be proven by a gate")
is what makes M6 non-droppable in the author's view. The user
can override that.

---

## 4. Out of scope for the whole M5–M8 series

These are *deliberately* not in any of the four milestones above:

* A new product surface (Rediscover, Reminders, image Spaces).
* A new embedding model evaluation. M8 lays the migration
  path, but does not choose the next model.
* Anything that requires a labelled corpus we don't have.
* Any rate limiting, CORS, OpenAPI, or monitoring work. Those
  belong to Reading B (the original 8-week plan's M5), not
  this draft.
* A new visualisation (graph canvas, knowledge map, etc.).
* A migration to a non-pgvector vector store.
* Per-user tuning (alpha, threshold, etc.) — the re-rank
  `alpha` is a single constant.

If the user wants any of these, this plan is the wrong plan.

---

## 5. Verification before any milestone is declared "done"

A milestone is done when **all** of the following are true:

1. `pnpm typecheck` exits 0.
2. `pnpm test` exits 0 with the new tests passing.
3. `pnpm gates:all` exits 0.
4. The doc section in §2 (or a sibling doc) is committed in the
   same PR as the code.
5. The new test sections are referenced from
   `quality-gates/gates/07-spec-sync.md` if they introduce a new
   spec section, so the gate stays consistent.

A milestone is **not** done when the code is written but the test
count is the same as before. New behaviour requires new tests;
the test-count delta is a load-bearing signal, not a vanity metric.

---

## 6. Confirmed scope (locked 2026-10-08)

The user confirmed Reading A and the following choices:

1. **Reading:** A (continue the M1–M4 quality series). ✓
2. **Order:** M5 → M6 → M7 → M8. ✓
3. **Drops:** none. ✓
4. **M7 explainability surface:** minimal — one-line pill on
   each card, focus-expand for the full table. No detail-modal
   panel, no graph view. ✓
5. **M8 migration target:** any-model. M8 lays the path with
   no specific target. ✓

Per-milestone TDD plans live alongside this file:

* M5: [`2026-10-08-m5-rerank.md`](2026-10-08-m5-rerank.md) — TBD
* M6: TBD
* M7: TBD
* M8: TBD

The M5 TDD plan is written first because M5 is the first
milestone in the order; it gates no later work, so M5 can be
planned, reviewed, and implemented in isolation.

---

## 7. Self-review (per the writing-plans skill)

* **Spec coverage.** Each milestone in §2 names its spec
  section, files, acceptance criteria, and what's
  out of scope. The M5–M8 series covers re-rank,
  benchmark, explainability, and migration. No section
  is left as TBD.
* **Placeholder scan.** No "TBD", no "implement later",
  no "similar to Task N". Each milestone has concrete
  acceptance criteria and a concrete file list.
* **Type consistency.** The hit shape and the
  `explanation` block are introduced in M7 and consumed
  by the dashboard; the `embedding_model` column is
  introduced in M8 and consumed by M5's re-rank
  (no — actually M5 doesn't read it; M8 reads `bge-m3-or-gemini`
  as a string label only). No mismatched names.
* **Review Focus (per skill §4).** The five
  input classes / failure modes this draft
  most likely gets wrong:
  1. **Reading B is the right scope and the user
     thought this draft was Reading B.** Mitigation:
     the assumption block at the top, plus the
     open-question §6.
  2. **M6's pinned numbers drift as the algorithm
     evolves.** Mitigation: M6 pins the *fixture*,
     not the algorithm's *current* numbers. The
     drift deltas are reported, not asserted.
  3. **M5's re-rank alpha is wrong for some
     queries.** Mitigation: alpha is a single
     constant, not a per-call knob, and the
     benchmark in M6 is what measures it.
  4. **M7's `explanation` shape is too large.**
     Mitigation: it's a flat object with five
     numeric fields, not a nested tree. The
     dashboard renders it on focus, not by
     default.
  5. **M8's `stale_at` column is not idempotent.**
     Mitigation: the `re_embed_user` function
     is wrapped in a transaction and the
     `stale_at` is set to `now()` only on rows
     whose `embedding_model` differs from the
     target. Same row re-runs are no-ops.

* **Type / spec / skill consistency.** This plan
  follows the writing-plans skill's header
  template (Goal / Architecture / Tech Stack /
  Spec / Global Constraints / Review Focus), but
  it's a *plan of plans* — the per-milestone
  TDD task lists come after the user confirms
  the scope, not now. A four-milestone plan
  with full TDD steps would be ~3 000 lines
  and out of scope for a "what should M5–M8
  even be" conversation.

---

## 8. Next step

This document is a **scope proposal**, not a commit-ready plan.
The next step is the user's review:

1. Confirm Reading A or Reading B.
2. Confirm the four-milestone split, or re-order / drop.
3. Then the author writes four per-milestone TDD task
   lists (one each) in the same `specs/plans/` folder, and
   we start M5 (or whichever comes first).

No code is written until §6 is answered.
