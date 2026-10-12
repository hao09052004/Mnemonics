-- Migration 009: keep legacy databases compatible with the tsvector search column.
-- Fresh databases are created correctly by migration 001. This migration is
-- intentionally conditional so it is safe after migration 005 has already
-- converted a legacy TEXT column.
DO $func$
DECLARE
  current_type TEXT;
BEGIN
  SELECT udt_name INTO current_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'items'
    AND column_name = 'searchable_text';

  IF current_type = 'text' THEN
    ALTER TABLE items
      ALTER COLUMN searchable_text TYPE TSVECTOR
      USING CASE
        WHEN searchable_text IS NULL OR searchable_text = '' THEN NULL
        ELSE to_tsvector('simple', searchable_text)
      END;
  END IF;
END
$func$;

CREATE INDEX IF NOT EXISTS items_searchable_text_idx
  ON items USING GIN(searchable_text);
