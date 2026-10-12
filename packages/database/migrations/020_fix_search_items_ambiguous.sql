-- Migration 020: fix `search_items` RPC — `lex_score` is ambiguous.
--
-- The original `search_items` function (migration 005) returns
-- columns named `lex_score`, `sem_score`, `combined_score`, `rank`
-- from a RETURN QUERY block. The block includes a CTE called
-- `lexical` whose projection lists `lex_score` and a `combined`
-- CTE that also references the same name. When the outer SELECT
-- resolves `lex_score` against the function's RETURNS TABLE
-- signature, Postgres sees two visible bindings and aborts with
-- "column reference \"lex_score\" is ambiguous".
--
-- The function is no longer the one used by the API — the search
-- endpoint routes through `runSearch` in
-- `packages/database/src/search-service.ts` — but a few code paths
-- still call it (manual SQL probes, the original migration's
-- `combined` CTE row count diagnostic, and any future feature that
-- wants a single SQL primitive). Fix the function in-place so any
-- of those calls stop returning an error.
--
-- Strategy: rename the ambiguous columns inside the CTEs to names
-- that don't collide with the RETURNS TABLE signature. The
-- RETURNS TABLE contract is unchanged, so existing callers keep
-- working.

CREATE OR REPLACE FUNCTION search_items(
  p_user_id UUID,
  p_query TEXT,
  p_tags TEXT[] DEFAULT NULL,
  p_kind TEXT[] DEFAULT NULL,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  type TEXT,
  title TEXT,
  source_url TEXT,
  raw_text TEXT,
  ocr_text TEXT,
  status TEXT,
  captured_at TIMESTAMPTZ,
  lex_score REAL,
  sem_score REAL,
  combined_score REAL,
  rank INT
) AS $$
BEGIN
  RETURN QUERY
  WITH
    -- Lexical search results. We use `i_id` everywhere as the
    -- primary key alias so it never collides with the `id` column
    -- in the RETURNS TABLE signature (Postgres otherwise raises
    -- "column reference \"id\" is ambiguous" inside RETURN QUERY).
    lexical AS (
      SELECT
        i.id AS i_id,
        ts_rank_cd(i.searchable_text, plainto_tsquery('simple', p_query)) AS lex_ts_rank,
        COUNT(*) OVER() AS total_lex
      FROM items i
      WHERE i.user_id = p_user_id
        AND i.searchable_text @@ plainto_tsquery('simple', p_query)
        AND (p_kind IS NULL OR i.type = ANY(p_kind))
      ORDER BY ts_rank_cd(i.searchable_text, plainto_tsquery('simple', p_query)) DESC
    ),
    -- Get max lexical score for normalization.
    max_lex AS (
      SELECT COALESCE(MAX(lex_ts_rank), 1) AS val FROM lexical
    ),
    -- Vector search (simplified - assumes embeddings exist).
    vector_search AS (
      SELECT
        ie.item_id,
        1 - (ie.embedding <=> (
          SELECT embedding FROM item_embeddings
          WHERE item_id IN (SELECT i.id FROM items i WHERE i.user_id = p_user_id LIMIT 1)
        )) AS vec_sem_score
      FROM item_embeddings ie
      WHERE ie.item_id IN (SELECT l.i_id FROM lexical l)
    ),
    -- Combine scores. Aliases use the `c_` prefix so none of them
    -- collide with the RETURNS TABLE columns. The outer SELECT
    -- rebinds the names that the caller expects.
    combined AS (
      SELECT
        l.i_id AS c_id,
        l.lex_ts_rank / NULLIF((SELECT val FROM max_lex), 0) AS c_norm_lex,
        COALESCE(vs.vec_sem_score, 0) AS c_norm_sem,
        0.4 * (l.lex_ts_rank / NULLIF((SELECT val FROM max_lex), 0)) +
        0.6 * COALESCE(vs.vec_sem_score, 0) AS c_combined_val
      FROM lexical l
      LEFT JOIN vector_search vs ON vs.item_id = l.i_id
    )
  SELECT
    i.id,
    i.type,
    i.title,
    i.source_url,
    i.raw_text,
    i.ocr_text,
    i.status,
    i.captured_at,
    COALESCE(c.c_norm_lex, 0)::REAL AS lex_score,
    COALESCE(c.c_norm_sem, 0)::REAL AS sem_score,
    COALESCE(c.c_combined_val, 0)::REAL AS combined_score,
    ROW_NUMBER() OVER (ORDER BY COALESCE(c.c_combined_val, 0) DESC)::INT AS rank
  FROM items i
  JOIN combined c ON c.c_id = i.id
  ORDER BY c.c_combined_val DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- The GRANT from migration 005 is preserved because CREATE OR
-- REPLACE keeps the function's identity; only the body changes.
