-- Memory Understanding enrichment rows.
--
-- Why a separate table?
--   * `items` is the hot capture row; we want a write-amplification
--     of 1 on capture. Enrichment is async + versioned.
--   * The schema stores the three independent concepts from spec §20:
--       - caption        = IMAGE DESCRIPTION (factual, visual)
--       - tldr           = TLDR (interpretation, retrieval-oriented)
--       - summary        = free-form long summary (optional)
--     Each has its own provenance column so the UI can show
--     "AI", "user-edited", "from OCR" labels without inference.
--   * `status` is independent of `items.status`. A failed caption
--     must NEVER flip the item to `failed` — the core memory is
--     already usable without understanding metadata.

CREATE TABLE IF NOT EXISTS item_enrichments (
  item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- IMAGE DESCRIPTION: factual description of what is visible.
  caption TEXT,
  caption_provider TEXT,
  caption_model TEXT,
  caption_confidence DOUBLE PRECISION,
  caption_status TEXT NOT NULL DEFAULT 'pending' CHECK (caption_status IN (
    'pending', 'processing', 'ready', 'failed', 'disabled'
  )),
  caption_error_code TEXT,
  caption_created_at TIMESTAMPTZ,
  caption_updated_at TIMESTAMPTZ,

  -- TLDR: short, retrieval-oriented interpretation.
  tldr TEXT,
  tldr_source TEXT NOT NULL DEFAULT 'pending' CHECK (tldr_source IN (
    'pending', 'local_ai', 'cloud_ai', 'heuristic', 'user'
  )),
  tldr_provider TEXT,
  tldr_model TEXT,
  tldr_prompt_version TEXT,
  tldr_status TEXT NOT NULL DEFAULT 'pending' CHECK (tldr_status IN (
    'pending', 'processing', 'ready', 'failed', 'disabled'
  )),
  tldr_error_code TEXT,
  tldr_created_at TIMESTAMPTZ,
  tldr_updated_at TIMESTAMPTZ,

  -- optional long-form summary (TLDR-friendly extended detail)
  summary TEXT,
  summary_provider TEXT,
  summary_model TEXT,
  summary_status TEXT NOT NULL DEFAULT 'pending' CHECK (summary_status IN (
    'pending', 'processing', 'ready', 'failed', 'disabled'
  )),

  -- generic bookkeeping
  prompt_version TEXT,
  processing_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS item_enrichments_user_status_idx
  ON item_enrichments (user_id, tldr_status, caption_status);

-- Reject cross-user enrichment rows defensively. If a row is ever
-- (re)parented to an item the user does not own, the constraint
-- makes the UPDATE fail loudly. (The `user_id` column itself is
-- informational; ownership is anchored to the item via RLS.)
CREATE OR REPLACE FUNCTION enforce_item_enrichment_ownership()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.user_id <> (SELECT user_id FROM items WHERE id = NEW.item_id) THEN
    RAISE EXCEPTION 'item_enrichment.user_id does not match items.user_id';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS item_enrichments_ownership_trigger ON item_enrichments;
CREATE TRIGGER item_enrichments_ownership_trigger
  BEFORE INSERT OR UPDATE ON item_enrichments
  FOR EACH ROW EXECUTE FUNCTION enforce_item_enrichment_ownership();

ALTER TABLE item_enrichments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_enrichments_owner_policy ON item_enrichments;
CREATE POLICY item_enrichments_owner_policy ON item_enrichments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM items
      WHERE items.id = item_enrichments.item_id
        AND items.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM items
      WHERE items.id = item_enrichments.item_id
        AND items.user_id = auth.uid()
    )
  );