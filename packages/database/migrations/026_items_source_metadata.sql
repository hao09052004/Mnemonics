-- Migration 026: items.source_metadata
--
-- Why:
-- The classifier (M2) and the structured search filters (M3) both
-- need access to parsed page metadata (JSON-LD, Open Graph, the
-- Readability article body) without re-fetching the source URL or
-- re-parsing the HTML. The extension already does that work in
-- the active tab; persisting the result here lets every later
-- stage read it in O(1) and skip the network round-trip.
--
-- Forward compatibility:
--   * JSONB column, NULL by default. Pre-M1 rows stay NULL forever.
--   * GIN index on jsonb_path_ops keeps the M3 structured-filter
--     leg cheap on large libraries. Built with IF NOT EXISTS so
--     the migration is idempotent.
--   * No existing column is altered. No existing row is rewritten.

BEGIN;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS source_metadata JSONB;

CREATE INDEX IF NOT EXISTS items_source_metadata_gin
  ON items USING GIN (source_metadata jsonb_path_ops);

COMMIT;
