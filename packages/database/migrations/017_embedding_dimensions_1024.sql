-- Migration 017: embedding column 1536 -> 1024 dimensions
--
-- Why:
-- The product direction is now "Gemini first, local Ollama second, never
-- OpenAI". The local fallback has to be a REAL semantic fallback, not a
-- silent degradation to lexical-only search. The problem is that the
-- pgvector column was pinned to vector(1536) and Ollama cannot produce
-- 1536-d vectors:
--
--   * nomic-embed-text  -> 768
--   * bge-small         -> 384
--   * bge-m3            -> 1024
--
-- We cannot zero-pad or truncate a local vector to 1536 and pretend it
-- works: cosine distance across 768 real dimensions plus 768 literal
-- zeros is dominated by the zero tail and the ranking becomes noise.
--
-- 1024 is the widest local dimension with a real local model
-- (bge-m3, `ollama pull bge-m3`), and Gemini can be asked for exactly
-- 1024 via `outputDimensionality`, so a SINGLE column serves BOTH
-- providers with no model mixing. Mixing embedding spaces in one
-- column silently corrupts nearest-neighbour results, so "one dimension,
-- both providers" is the only safe shape.
--
-- Existing 1536-d rows are deleted rather than migrated: there is no
-- correct way to down-project 1536 -> 1024, and a stale vector in a
-- different space is worse than no vector (it would be compared
-- against new 1024-d query vectors and return arbitrary neighbours).
-- Re-embedding is automatic: items still have a jobs row / can be
-- re-enqueued, and search degrades to lexical-only until then.

BEGIN;

-- 1. Drop the ivfflat index first: it is built on the old column type
--    and cannot be altered in place.
DROP INDEX IF EXISTS item_embeddings_vector_idx;

-- 2. Clear rows whose vectors are in the old (1536-d) space.
DELETE FROM item_embeddings
 WHERE dimensions <> 1024
    OR cardinality(embedding::real[]) <> 1024;

-- 3. Re-type the column. A vector column can only change width by
--    dropping and re-adding it; the USING clause rebuilds the
--    (now-empty) rows at the new width.
ALTER TABLE item_embeddings
  ALTER COLUMN embedding TYPE vector(1024)
  USING embedding::vector(1024);

-- 4. Recreate the index at the new width.
CREATE INDEX IF NOT EXISTS item_embeddings_vector_idx
  ON item_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- 5. The multi-model helper column added by migration 005 was declared
--    vector(1536) as well. Keep it consistent so nothing can reintroduce
--    a 1536-d vector.
ALTER TABLE item_embeddings
  ALTER COLUMN vector TYPE vector(1024)
  USING vector::vector(1024);

COMMIT;

-- 6. Fail loudly rather than silently serving a mixed embedding space.
--    `dimensions` is written by saveEmbedding on every upsert, so it is
--    the authoritative record of what space a row lives in. A row that
--    disagrees with the column width is a bug we want surfaced at write
--    time, not discovered as nonsense search results later.
CREATE OR REPLACE FUNCTION enforce_item_embedding_dimensions()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.dimensions <> 1024 THEN
    RAISE EXCEPTION
      'item_embeddings.dimensions is %, but the column is vector(1024). '
      'Refusing to store a vector from a different embedding space: '
      'mixing dimensions silently corrupts similarity search.',
      NEW.dimensions;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS item_embeddings_dimensions_trigger ON item_embeddings;
CREATE TRIGGER item_embeddings_dimensions_trigger
  BEFORE INSERT OR UPDATE ON item_embeddings
  FOR EACH ROW EXECUTE FUNCTION enforce_item_embedding_dimensions();
