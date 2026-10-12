-- Migration 023: document chunks for long-PDF semantic recall
--
-- Why:
-- The current embed pipeline (`apps/api/src/jobs/handlers/embed.ts`)
-- truncates any document to the first ~8 000 characters before
-- embedding. A phrase on page 80 of a 200-page PDF therefore never
-- reaches the embedding model, and a search for that phrase
-- returns nothing — even though extraction succeeded.
--
-- This migration adds a parallel `item_document_chunks` table.
-- Each row is one chunk (target 500 tokens, hard cap 800,
-- ~12% overlap with neighbours). Search runs against the chunks
-- and aggregates hits back to the parent item, so the
-- `items.embedding` row continues to serve Related Memories
-- and the cluster graph.
--
-- Identity safety (see migration 022): every chunk carries the
-- embedding identity triple (model, dimensions, version). A
-- chunk is comparable to another chunk iff all three fields
-- match exactly. The view `item_document_chunks_real` is the
-- only read surface the search service is allowed to use.

BEGIN;

CREATE TABLE IF NOT EXISTS item_document_chunks (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id         UUID         NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  chunk_index     INTEGER      NOT NULL CHECK (chunk_index >= 0),
  page_start      INTEGER,
  page_end        INTEGER,
  char_start      INTEGER      NOT NULL,
  char_end        INTEGER      NOT NULL,
  content         TEXT         NOT NULL,
  content_hash    TEXT         NOT NULL,
  token_estimate  INTEGER      NOT NULL DEFAULT 0,
  embedding       vector(1024),
  embedding_model TEXT,
  embedding_dimensions INTEGER,
  embedding_version TEXT,
  embedding_kind  TEXT         NOT NULL DEFAULT 'unknown',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, chunk_index),
  UNIQUE (item_id, content_hash)
);

-- Lookup by item is the dominant access pattern. The search
-- service also filters by user_id; the composite index keeps
-- the planner from re-sorting when we ask for "all chunks of
-- this item owned by this user".
CREATE INDEX IF NOT EXISTS item_document_chunks_item_idx
  ON item_document_chunks (item_id, chunk_index);

CREATE INDEX IF NOT EXISTS item_document_chunks_user_idx
  ON item_document_chunks (user_id, item_id);

-- pgvector index for ANN search. Same cosine-op choice as
-- `item_embeddings_vector_idx` (migration 017). Built on the
-- real-embedding subset so that legacy / unknown rows are
-- excluded from the index.
CREATE INDEX IF NOT EXISTS item_document_chunks_vector_idx
  ON item_document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10)
  WHERE embedding_kind = 'real';

-- updated_at trigger, mirroring the rest of the schema.
DROP TRIGGER IF EXISTS item_document_chunks_set_updated_at ON item_document_chunks;
CREATE TRIGGER item_document_chunks_set_updated_at
  BEFORE UPDATE ON item_document_chunks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Identity guard, mirroring the item_embeddings trigger from
-- migration 017. A chunk whose stored dimensions disagree with
-- the column width is a bug we want surfaced at write time.
CREATE OR REPLACE FUNCTION enforce_item_document_chunk_dimensions()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.embedding IS NOT NULL AND NEW.embedding_dimensions IS NOT NULL
     AND NEW.embedding_dimensions <> 1024 THEN
    RAISE EXCEPTION
      'item_document_chunks.embedding_dimensions is %, but the column is vector(1024). '
      'Refusing to store a vector from a different embedding space: '
      'mixing dimensions silently corrupts similarity search.',
      NEW.embedding_dimensions;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS item_document_chunks_dimensions_trigger ON item_document_chunks;
CREATE TRIGGER item_document_chunks_dimensions_trigger
  BEFORE INSERT OR UPDATE ON item_document_chunks
  FOR EACH ROW EXECUTE FUNCTION enforce_item_document_chunk_dimensions();

-- Row-level security. The user_id predicate is the same shape
-- as every other table; tests bypass it via the development
-- token, but production paths run through Supabase RLS.
ALTER TABLE item_document_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_document_chunks_owner_policy ON item_document_chunks;
CREATE POLICY item_document_chunks_owner_policy ON item_document_chunks
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Convenience view that filters out non-real rows. The search
-- service uses this view as its single read surface, so the
-- legacy / unknown rows never leak into similarity joins.
CREATE OR REPLACE VIEW item_document_chunks_real AS
  SELECT *
    FROM item_document_chunks
   WHERE embedding_kind = 'real';

COMMIT;
