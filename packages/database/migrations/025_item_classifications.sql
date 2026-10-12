-- Migration 025: item_classifications (M2 of spec 0005)
--
-- The classifier writes one row per item. A second row at a new
-- classifier_version can replace the first; the table's primary
-- key is the item_id. The status column is independent of
-- items.status — a failed classification must NEVER flip the
-- item to `failed`.
--
-- Identity safety:
--   * The status enum is closed and matches the spec.
--   * The detected_type enum is closed (11 values).
--   * RLS is enabled; the policy delegates to items.user_id.
--   * The attributes/entities/evidence JSONB columns are NOT
--     validated at the database layer — the API layer
--     (`sourceMetadataSchema` + the classify handler's merge
--     step) is the source of truth. The DB stores whatever
--     the API writes.

BEGIN;

CREATE TABLE IF NOT EXISTS item_classifications (
  item_id            UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  detected_type      TEXT CHECK (detected_type IN (
    'article','product','recipe','video','quote','highlight',
    'webpage','image','note','document','other'
  )),
  category           TEXT,
  description        TEXT,

  attributes         JSONB NOT NULL DEFAULT '{}'::jsonb,
  entities           JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence           JSONB NOT NULL DEFAULT '{}'::jsonb,

  confidence         DOUBLE PRECISION,
  provider           TEXT,
  model              TEXT,
  classifier_version TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','processing','ready','failed','skipped'
  )),
  error_code         TEXT,
  content_hash       TEXT,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS item_classifications_user_idx
  ON item_classifications (user_id);

CREATE INDEX IF NOT EXISTS item_classifications_detected_type_idx
  ON item_classifications (user_id, detected_type);

CREATE INDEX IF NOT EXISTS item_classifications_category_idx
  ON item_classifications (user_id, category);

CREATE INDEX IF NOT EXISTS item_classifications_attrs_gin
  ON item_classifications USING GIN (attributes jsonb_path_ops);

CREATE INDEX IF NOT EXISTS item_classifications_updated_at_idx
  ON item_classifications (user_id, updated_at DESC);

-- updated_at maintenance trigger (the database has the
-- generic update_updated_at_column() function from earlier
-- migrations).
DROP TRIGGER IF EXISTS item_classifications_set_updated_at ON item_classifications;
CREATE TRIGGER item_classifications_set_updated_at
  BEFORE UPDATE ON item_classifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Ownership guard: refuse to write a row whose user_id does
-- not match the parent item's user_id. The RLS policy also
-- covers this, but a trigger makes the failure mode loud at
-- INSERT time rather than silent at SELECT time.
CREATE OR REPLACE FUNCTION enforce_item_classification_ownership()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id <> (SELECT user_id FROM items WHERE id = NEW.item_id) THEN
    RAISE EXCEPTION 'item_classifications.user_id does not match items.user_id';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS item_classifications_ownership_trigger ON item_classifications;
CREATE TRIGGER item_classifications_ownership_trigger
  BEFORE INSERT OR UPDATE ON item_classifications
  FOR EACH ROW EXECUTE FUNCTION enforce_item_classification_ownership();

ALTER TABLE item_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_classifications_owner_policy ON item_classifications;
CREATE POLICY item_classifications_owner_policy ON item_classifications
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM items
      WHERE items.id = item_classifications.item_id
        AND items.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM items
      WHERE items.id = item_classifications.item_id
        AND items.user_id = auth.uid()
    )
  );

COMMIT;
