-- Migration 009: make searchable_text a real PostgreSQL tsvector column.
-- Migration 001 originally created this column as TEXT while migration 005
-- installed a tsvector trigger. Convert existing databases safely so inserts
-- and updates do not fail at runtime.
ALTER TABLE items
  ALTER COLUMN searchable_text TYPE TSVECTOR
  USING CASE
    WHEN searchable_text IS NULL OR searchable_text = '' THEN NULL
    ELSE to_tsvector('simple', searchable_text)
  END;

CREATE INDEX IF NOT EXISTS items_searchable_text_idx
  ON items USING GIN(searchable_text);
