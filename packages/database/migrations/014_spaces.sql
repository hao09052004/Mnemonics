-- Server-backed Spaces: manual collections + dynamic smart-rules.
--
-- Design notes:
--   * `space_type` ∈ { 'manual', 'dynamic' }. A manual space has rows
--     in space_items. A dynamic space has rows in space_rules and
--     no rows in space_items; the membership is computed at read
--     time by the rule engine in apps/api.
--   * `cover_item_id` is the chosen thumbnail for the space card.
--     It can be an item owned by the same user.
--   * `space_rules.rule_type` ∈ { 'type', 'tag', 'favorite',
--     'captured_after', 'captured_before', 'source_domain',
--     'status', 'semantic_query' }. Multi-rule dynamic spaces are
--     AND-combined.
--   * Every query MUST scope by user_id; the RLS policies below
--     enforce that automatically.
--
-- Forward compatibility:
--   * `description` and `icon` are free-form so the UI can render
--     suggested-space templates later without a schema change.
--   * `metadata jsonb` keeps custom flags (e.g. `hidden: true`) out
--     of the hot columns.

CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  space_type TEXT NOT NULL CHECK (space_type IN ('manual', 'dynamic')),
  cover_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS spaces_user_idx
  ON spaces (user_id, updated_at DESC);

-- Manual-space membership. ON DELETE CASCADE keeps the rows in
-- sync if either side is removed.
CREATE TABLE IF NOT EXISTS space_items (
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  added_by TEXT NOT NULL DEFAULT 'user' CHECK (added_by IN ('user', 'rule')),
  PRIMARY KEY (space_id, item_id)
);

CREATE INDEX IF NOT EXISTS space_items_item_idx
  ON space_items (item_id);
CREATE INDEX IF NOT EXISTS space_items_recent_idx
  ON space_items (space_id, added_at DESC);

-- Dynamic-space rules. We accept up to 8 rules per space to keep
-- the AND-combination fast; UI should warn beyond 4.
CREATE TABLE IF NOT EXISTS space_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  rule_type TEXT NOT NULL CHECK (rule_type IN (
    'type', 'tag', 'favorite',
    'captured_after', 'captured_before',
    'source_domain', 'status', 'semantic_query'
  )),
  rule_value TEXT NOT NULL,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS space_rules_space_idx
  ON space_rules (space_id);

-- Suggested-Space cache: the heavy clustering computation is
-- stored here so the dashboard can render suggestions without
-- running the algorithm on every request. Refreshed by a scheduled
-- job. `dismissed = true` hides a suggestion permanently.
CREATE TABLE IF NOT EXISTS space_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  suggested_name TEXT NOT NULL,
  suggested_description TEXT,
  suggested_icon TEXT,
  sample_item_ids UUID[] NOT NULL,
  keywords TEXT[] NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

CREATE INDEX IF NOT EXISTS space_suggestions_user_active_idx
  ON space_suggestions (user_id, dismissed, expires_at DESC);

-- ----- Row Level Security -------------------------------------------
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_suggestions ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS space_rules_owner_policy ON space_rules;
CREATE POLICY space_rules_owner_policy ON space_rules
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM spaces s
      WHERE s.id = space_rules.space_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM spaces s
      WHERE s.id = space_rules.space_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS space_suggestions_owner_policy ON space_suggestions;
CREATE POLICY space_suggestions_owner_policy ON space_suggestions
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);