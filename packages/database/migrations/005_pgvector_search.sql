-- Migration 005: pgvector Search Integration
-- Adds full-text search capabilities and improves embedding storage

-- Create full-text search index on items
ALTER TABLE items ADD COLUMN IF NOT EXISTS searchable_text TSVECTOR;

-- Create GIN index for full-text search
CREATE INDEX IF NOT EXISTS items_searchable_text_idx ON items USING GIN(searchable_text);

-- Create function to update searchable text
CREATE OR REPLACE FUNCTION update_searchable_text()
RETURNS TRIGGER AS $$
BEGIN
  NEW.searchable_text := to_tsvector('simple',
    COALESCE(NEW.title, '') || ' ' ||
    COALESCE(NEW.raw_text, '') || ' ' ||
    COALESCE(NEW.ocr_text, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-update searchable text
DROP TRIGGER IF EXISTS update_items_searchable_text ON items;
CREATE TRIGGER update_items_searchable_text
  BEFORE INSERT OR UPDATE OF title, raw_text, ocr_text ON items
  FOR EACH ROW
  EXECUTE FUNCTION update_searchable_text();

-- Add index for vector dimensions lookup
ALTER TABLE item_embeddings ADD COLUMN IF NOT EXISTS vector vector(1536);

-- Update existing embedding storage for multi-model support
-- The column vector already exists with 1536 dimensions

-- Create search function using hybrid lexical + vector search
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
    -- Lexical search results
    lexical AS (
      SELECT
        i.id,
        ts_rank_cd(i.searchable_text, plainto_tsquery('simple', p_query)) AS lex_score,
        COUNT(*) OVER() AS total_lex
      FROM items i
      WHERE i.user_id = p_user_id
        AND i.searchable_text @@ plainto_tsquery('simple', p_query)
        AND (p_kind IS NULL OR i.type = ANY(p_kind))
      ORDER BY ts_rank_cd(i.searchable_text, plainto_tsquery('simple', p_query)) DESC
    ),
    -- Get max lexical score for normalization
    max_lex AS (
      SELECT COALESCE(MAX(lex_score), 1) AS val FROM lexical
    ),
    -- Vector search (simplified - assumes embeddings exist)
    vector_search AS (
      SELECT
        ie.item_id,
        1 - (ie.embedding <=> (
          SELECT embedding FROM item_embeddings
          WHERE item_id IN (SELECT id FROM items WHERE user_id = p_user_id LIMIT 1)
        )) AS sem_score
      FROM item_embeddings ie
      WHERE ie.item_id IN (SELECT id FROM lexical)
    ),
    -- Combine scores
    combined AS (
      SELECT
        l.id,
        l.lex_score / NULLIF((SELECT val FROM max_lex), 0) AS norm_lex,
        COALESCE(vs.sem_score, 0) AS norm_sem,
        0.4 * (l.lex_score / NULLIF((SELECT val FROM max_lex), 0)) +
        0.6 * COALESCE(vs.sem_score, 0) AS combined_score
      FROM lexical l
      LEFT JOIN vector_search vs ON vs.item_id = l.id
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
    COALESCE(c.norm_lex, 0)::REAL AS lex_score,
    COALESCE(c.norm_sem, 0)::REAL AS sem_score,
    COALESCE(c.combined_score, 0)::REAL AS combined_score,
    ROW_NUMBER() OVER (ORDER BY COALESCE(c.combined_score, 0) DESC)::INT AS rank
  FROM items i
  JOIN combined c ON c.id = i.id
  ORDER BY c.combined_score DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Create RLS policies for search
DROP POLICY IF EXISTS items_search_policy ON items;
CREATE POLICY items_search_policy ON items
  FOR SELECT USING (auth.uid() = user_id);

-- Grant execute on search function
GRANT EXECUTE ON FUNCTION search_items TO authenticated;
