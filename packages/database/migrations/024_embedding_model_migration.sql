-- M8 — embedding-model migration path.
--
-- The M1–M7 hard-coded the embedding model to
-- `bge-m3-or-gemini` (or whatever the env var was set to)
-- for every user. M8 introduces a path to change the
-- model for one user without nuking the table.
--
-- This migration adds:
--   1. A SQL function `re_embed_user(user_id, target_model)
--      → integer` that returns the count of items for the
--      user whose current `embedding_model` differs from
--      the target. The function is count-only; the actual
--      re-embed is an orchestration step that calls this
--      function once and then enqueues one `embed` job
--      per item with `targetEmbeddingModel` in the
--      payload. The orchestration is a deployment runbook,
--      not in this migration.
--   2. A partial index on `(item_id, model)` on
--      `item_embeddings` (the `item_embeddings` schema
--      has no `user_id` column — the user is reached
--      through `item_embeddings.item_id → items.id`)
--      so the count and the batch can use the same
--      scan.

-- 1. The function.
CREATE OR REPLACE FUNCTION re_embed_user(
  p_user_id uuid,
  p_target_model text
) RETURNS integer
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  result integer;
BEGIN
  SELECT COUNT(*)::integer
    INTO result
    FROM items i
    JOIN item_embeddings ie ON ie.item_id = i.id
   WHERE i.user_id = p_user_id
     AND i.status = 'ready'
     AND ie.model IS DISTINCT FROM p_target_model;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION re_embed_user(uuid, text) IS
  'M8 — count items for a user whose embedding_model differs from the target. The function is count-only; the orchestration step that does the actual re-embed is not in this migration.';

-- 2. Partial index. The planner uses this for the count
--    above and for the in-process batch that the
--    orchestration step runs. The columns on
--    `item_embeddings` are `item_id` (not `user_id` —
--    the user is reached via the `items` join) and
--    `model` (not `embedding_model` — see migration 022
--    which added the `embedding_model` column on
--    `item_edges` and `content_clusters` only).
CREATE INDEX IF NOT EXISTS item_embeddings_item_model_idx
  ON item_embeddings (item_id, model)
  WHERE model IS NOT NULL;
