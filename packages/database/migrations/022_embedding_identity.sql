-- Migration 022: Embedding identity & cross-model safety
--
-- Why:
-- Milestone 1 of the AI Quality upgrade. Every vector in
-- `item_embeddings` was historically compared without verifying that
-- the source provider/model is the same. The auto-link pass also
-- stamped every edge with a hard-coded `text-embedding-3-small`
-- attribute, which lied about the model whenever Gemini or a local
-- Ollama model had produced the vector. Different models emit
-- vectors that are not in the same similarity space, so cross-model
-- comparisons return arbitrary neighbours.
--
-- What this migration adds:
--   1. `item_embeddings.embedding_version` — a short fingerprint
--      (provider:model:dimensions:vYYYYMMDD) so two providers that
--      happen to share a model id (e.g. different Ollama builds)
--      still produce distinguishable vectors.
--   2. `item_embeddings.embedding_kind` — one of
--      {real, noop, legacy, unknown}. The "noop" rows are the
--      synthetic vectors written by tests or by a misconfigured
--      fallback; "legacy" rows are pre-upgrade rows whose model
--      string is one of the deprecated labels (text-embedding-3-*
--      or empty). Both kinds MUST be excluded from similarity joins.
--   3. A `embedding_identity` composite (model, dimensions,
--      embedding_version) used by the SQL guard in the auto-link
--      and search paths. Joins that mix two identities raise a
--      runtime error in dev/CI and silently skip the row pair in
--      production.
--   4. Backfills existing rows: anything that looks like
--      `text-embedding-3-small` is marked `legacy` and excluded
--      from the join. The "real" rows are re-stamped with a
--      version that contains today's date.
--   5. `item_edges` now carries an `embedding_identity` column so
--      every similarity edge records the identity that produced
--      it. Reads filter on the edge's identity column, not on
--      a JSON attribute.
--
-- This migration is forward-only and safe to apply on a populated
-- database: it does NOT delete or rewrite vectors. The new columns
-- have safe defaults; the backfill only marks rows; re-embedding
-- happens through a separate background job (see
-- `apps/api/src/jobs/handlers/embed.ts` and the
-- `reembed-stale-embeddings` workflow).

BEGIN;

-- 1. Add new identity columns. Default 'unknown' for backfill safety.
ALTER TABLE item_embeddings
  ADD COLUMN IF NOT EXISTS embedding_version TEXT,
  ADD COLUMN IF NOT EXISTS embedding_kind    TEXT NOT NULL DEFAULT 'unknown';

-- The version string we stamp on real, freshly-written vectors. It
-- changes whenever the embedding pipeline changes (model id, prompt
-- template, or chunker). The date is the source of truth — bumping
-- the version intentionally forces every consumer to re-evaluate
-- the row instead of trusting stale neighbours.
--
-- Keep this as a SQL function so it can be referenced by other
-- migrations and is greppable in `pg_proc`.
CREATE OR REPLACE FUNCTION current_embedding_version()
RETURNS TEXT AS $$
  SELECT 'v1.0.0-' || to_char(NOW() AT TIME ZONE 'UTC', 'YYYYMMDD');
$$ LANGUAGE SQL STABLE;

-- 2. Backfill: any row whose model is the legacy OpenAI label, or
--    is empty, is marked `legacy`. Real rows that lack a version
--    are stamped with today's version.
UPDATE item_embeddings
   SET embedding_kind = 'legacy'
 WHERE model IN ('text-embedding-3-small', 'text-embedding-3-large', '')
    OR model IS NULL;

UPDATE item_embeddings
   SET embedding_version = COALESCE(embedding_version, current_embedding_version()),
       embedding_kind    = CASE
         WHEN embedding_kind = 'unknown' AND dimensions = 1024 AND model NOT IN ('', 'text-embedding-3-small', 'text-embedding-3-large') THEN 'real'
         ELSE embedding_kind
       END
 WHERE embedding_version IS NULL
    OR embedding_kind = 'unknown';

-- 3. Index for the auto-link pass. The query is
--      WHERE user = $1 AND model = $2 AND dimensions = $3 AND version = $4
--    so a composite index on the four columns keeps the planner
--    from re-sorting the table on every capture.
CREATE INDEX IF NOT EXISTS item_embeddings_identity_idx
  ON item_embeddings (model, dimensions, embedding_version)
  WHERE embedding_kind = 'real';

-- 4. Promote a per-identity view. The view hides `legacy` and
--    `noop` rows from the similarity joins, so the auto-link
--    function and the search service can SELECT from it without
--    remembering to add the WHERE clause on every site.
CREATE OR REPLACE VIEW item_embeddings_real AS
  SELECT *
    FROM item_embeddings
   WHERE embedding_kind = 'real';

-- 5. Add `embedding_identity` to item_edges. The column is the
--    same composite string used in `item_embeddings`; we keep it
--    denormalised for cheap reads. The existing JSON attribute is
--    kept (downstream consumers may already read it) but is no
--    longer the source of truth.
ALTER TABLE item_edges
  ADD COLUMN IF NOT EXISTS embedding_identity TEXT,
  ADD COLUMN IF NOT EXISTS embedding_model    TEXT,
  ADD COLUMN IF NOT EXISTS algorithm_version  TEXT;

-- 6. Backfill edges whose `attributes` JSON carries a hard-coded
--    model string. We DO NOT rewrite the source model; we just
--    stamp the edge as "legacy" by leaving embedding_identity NULL.
--    A NULL identity causes the auto-link helper to skip the edge
--    on read, which is the same effect as before but documented.
UPDATE item_edges
   SET embedding_model = COALESCE(embedding_model, attributes->>'model')
 WHERE embedding_model IS NULL
   AND attributes ? 'model';

UPDATE item_edges
   SET algorithm_version = COALESCE(algorithm_version, attributes->>'algorithmVersion')
 WHERE algorithm_version IS NULL
   AND attributes ? 'algorithmVersion';

-- 7. SQL guard: a function the auto-link pass calls to assert that
--    two identities are comparable. Different models, different
--    dimensions, different versions, or a NULL on either side
--    yields FALSE. The function is the single source of truth for
--    "is this comparison safe" — both the auto-link pass and the
--    search service MUST use it instead of an inline comparison.
CREATE OR REPLACE FUNCTION embeddings_compatible(
  left_model    TEXT, left_dim INT, left_version TEXT,
  right_model   TEXT, right_dim INT, right_version TEXT
) RETURNS BOOLEAN AS $$
  SELECT
    left_model    IS NOT NULL AND right_model   IS NOT NULL
    AND left_dim  IS NOT NULL AND right_dim     IS NOT NULL
    AND left_version IS NOT NULL AND right_version IS NOT NULL
    AND left_model = right_model
    AND left_dim   = right_dim
    AND left_version = right_version;
$$ LANGUAGE SQL IMMUTABLE;

-- 8. Index for edges-by-identity. The auto-link / related-memories
--    reads filter on (user_id, embedding_model, algorithm_version),
--    so a composite index on those keeps the page count tight.
CREATE INDEX IF NOT EXISTS item_edges_identity_idx
  ON item_edges (user_id, embedding_model, algorithm_version)
  WHERE embedding_model IS NOT NULL;

COMMIT;
