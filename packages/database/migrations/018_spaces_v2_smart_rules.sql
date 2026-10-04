-- Migration 018: Spaces v2 — Smart rule model, curated color, no AI.
--
-- Why this exists on top of 014 (which is not yet applied anywhere):
--
--   1. 'dynamic' → 'smart'. The product name for a criteria-backed
--      Space is "Smart Space" (specs/api/spaces.md §3). Keeping
--      'dynamic' in the CHECK constraint would permanently bake a
--      vocabulary mismatch into every query and every JSON payload.
--
--   2. Colour. 014 had `icon` but no colour, so the UI had to
--      derive identity from an emoji. Colour is metadata only, drawn
--      from a closed enum so the palette can never be a free-form
--      string (that would let a client inject #ff00ff neon).
--
--   3. Drop Suggested Spaces. The clustering pass over item
--      embeddings (space_suggestions + /spaces/suggestions/*) is AI
--      Spaces, which the Spaces scope explicitly excludes. Smart
--      Spaces are deterministic and re-run the existing search
--      service; nothing in this feature needs suggestions.
--
--   4. Smart rules become a saved SearchRequest, not a row-per-
--      predicate. A Smart Space must resolve to exactly the same
--      result set as typing the same query into Everything, which
--      means it has to be expressible in the SAME shape the search
--      service accepts. One JSONB document validated by Zod at the
--      API boundary is strictly better than eight AND-combined rows
--      re-implemented in a second SQL dialect that inevitably drifts
--      from the real search.
--
-- Forward compatibility:
--   * rule_version lets a future SearchRequest change be migrated
--     deterministically instead of guessed at.
--   * Manual membership keeps its own table; Smart membership is
--     never materialised, so a new matching item needs no write.

BEGIN;

-- ----- 1. Colour + kind vocabulary --------------------------------
-- 014 created the table without a colour column and with
-- space_type CHECK (space_type IN ('manual','dynamic')).
ALTER TABLE spaces
  DROP CONSTRAINT IF EXISTS spaces_space_type_check;

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS color TEXT;

-- Curated palette. Deliberately short: seven muted hues that read
-- as a 6px dot or a 2px left border without fighting the
-- #15171C surface. Any colour outside this set is rejected by the
-- CHECK, not by client-side validation, so a hand-rolled fetch
-- cannot smuggle in a saturated value.
ALTER TABLE spaces
  ADD CONSTRAINT spaces_color_check CHECK (
    color IS NULL OR color IN (
      'violet', 'blue', 'teal', 'sage', 'amber', 'rose', 'slate'
    )
  );

DO $$
BEGIN
  -- Rename the value in place when the table already exists (a dev
  -- database that ran 014 by hand). No-op on a fresh install.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'spaces' AND column_name = 'space_type'
  ) THEN
    UPDATE spaces SET space_type = 'smart' WHERE space_type = 'dynamic';
  END IF;
END
$$;

ALTER TABLE spaces
  ADD CONSTRAINT spaces_space_type_check CHECK (space_type IN ('manual', 'smart'));

-- `icon` was the 014 identity mechanism. Colour supersedes it, but
-- the column is left in place rather than dropped: dropping it would
-- discard data some dev databases already hold, and it is harmless.

-- ----- 2. Smart rule document -------------------------------------
-- Replaces the row-per-predicate space_rules table.
--
-- The document is the same shape /api/v1/search accepts, so a Smart
-- Space resolves through the one search service instead of a
-- parallel implementation. `query` and the filter buckets are all
-- optional; at least one must be present, which Zod enforces at the
-- API edge (a rule that matches everything is not a Space, it is a
-- second Everything view).
ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS rule JSONB;

ALTER TABLE spaces
  ADD COLUMN IF NOT EXISTS rule_version SMALLINT NOT NULL DEFAULT 1;

-- A smart Space must carry a rule; a manual Space must not. Enforced
-- here rather than in the repository so a direct SQL write cannot
-- produce a smart Space that silently behaves as "everything".
ALTER TABLE spaces
  DROP CONSTRAINT IF EXISTS spaces_rule_shape_check;
ALTER TABLE spaces
  ADD CONSTRAINT spaces_rule_shape_check CHECK (
    (space_type = 'smart' AND rule IS NOT NULL)
    OR (space_type = 'manual' AND rule IS NULL)
  );

-- ----- 3. Retire the row-per-predicate rule table ------------------
-- Superseded by spaces.rule. Dropping is safe because no release has
-- shipped 014; IF EXISTS keeps a re-run idempotent. The table also
-- carried the RuleType vocabulary that the API no longer accepts.
DROP TABLE IF EXISTS space_rules;

-- ----- 4. Retire Suggested Spaces --------------------------------
-- See the header note. The table holds only derived, recomputable
-- data (clusters of the user's own embeddings), so there is no user
-- content at risk in dropping it.
DROP TABLE IF EXISTS space_suggestions;

-- ----- 5. Membership invariants ----------------------------------
-- 014 allowed a row in space_items for a smart Space. Membership of
-- a Smart Space is computed from its rule, so a manual row there
-- would be invisible (the reader ignores space_items for smart
-- Spaces) while still counting in listSpaces(). That produces a
-- space whose card says "12 memories" and whose detail page shows
-- 3. Reject the write instead.
--
-- This has to be a trigger, not a CHECK constraint: Postgres does
-- not allow a subquery in CHECK, and "is the parent space manual?"
-- is inherently a cross-table question. A CHECK would also be
-- evaluated per-row without being able to see the space, so the
-- constraint is enforced where the information lives.
CREATE OR REPLACE FUNCTION space_items_require_manual_space()
RETURNS TRIGGER AS $$
DECLARE
  parent_type TEXT;
BEGIN
  SELECT space_type INTO parent_type FROM spaces WHERE id = NEW.space_id;
  IF parent_type IS NULL THEN
    RAISE EXCEPTION 'Space % does not exist', NEW.space_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF parent_type <> 'manual' THEN
    RAISE EXCEPTION
      'Cannot add a memory to a % Space: its membership is decided by its saved criteria',
      parent_type
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS space_items_manual_only_trigger ON space_items;
CREATE TRIGGER space_items_manual_only_trigger
  BEFORE INSERT OR UPDATE ON space_items
  FOR EACH ROW EXECUTE FUNCTION space_items_require_manual_space();

-- ----- 6. Preview support ----------------------------------------
-- listSpaces() needs a cheap representative thumbnail per Space. The
-- column already exists from 014; the index below is what makes
-- "most recent N members" cheap instead of a sort over the whole
-- membership table.
CREATE INDEX IF NOT EXISTS space_items_recent_idx
  ON space_items (space_id, added_at DESC);

COMMIT;

-- ----- 7. updated_at maintenance ---------------------------------
-- 014 stored updated_at but never maintained it, so a rename or a
-- recolour left the All-Spaces sort order stale and "last updated"
-- on a card was always the creation date. The All Spaces page orders
-- by this column, so a stale value is a visible bug, not cosmetic.
CREATE OR REPLACE FUNCTION spaces_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS spaces_touch_updated_at_trigger ON spaces;
CREATE TRIGGER spaces_touch_updated_at_trigger
  BEFORE UPDATE ON spaces
  FOR EACH ROW EXECUTE FUNCTION spaces_touch_updated_at();

-- ----- 8. Re-assert RLS ------------------------------------------
-- 014 enabled RLS on space_rules and space_suggestions. Those tables
-- are gone; the policies on spaces / space_items are recreated so a
-- database that applied 014 keeps the same guarantees after the
-- drop, and so this migration is the single place to audit.
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spaces_owner_policy ON spaces;
CREATE POLICY spaces_owner_policy ON spaces
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS space_items_owner_policy ON space_items;
CREATE POLICY space_items_owner_policy ON space_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM spaces s
      WHERE s.id = space_items.space_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM spaces s
      WHERE s.id = space_items.space_id
        AND s.user_id = auth.uid()
    )
  );
