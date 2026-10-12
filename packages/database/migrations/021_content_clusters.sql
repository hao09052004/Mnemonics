-- Migration 021: Content Clusters
--
-- A cluster is an automatically computed group of memories that share
-- semantic similarity. It is NOT a Space:
--   * Spaces are user-owned, persistent, and may be manual or smart.
--   * Clusters are computed, recomputable, and owned by the algorithm.
--
-- This migration introduces the two tables the cluster service needs
-- plus the read policies that scope every read/write to a single
-- authenticated user. The Smart-Space spec (migration 018) explicitly
-- drops the older `space_suggestions` table; content clusters live
-- beside Spaces, never inside them.
--
-- Concurrency: a refresh is a single transaction that drops and
-- rewrites the rows for one user. The RLS policies use the standard
-- `auth.uid() = user_id` clause so the same statements are safe in
-- both Supabase and the development-token modes (the latter simply
-- bypasses RLS via the SET LOCAL role workaround added in 007).

CREATE TABLE IF NOT EXISTS content_clusters (
  id            TEXT        PRIMARY KEY,        -- stable hash of sorted member ids
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  signature     TEXT        NOT NULL,           -- duplicate of id, kept for explicit joins
  title         TEXT,
  summary       TEXT,
  representative_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  item_count    INTEGER     NOT NULL CHECK (item_count > 0),
  average_edge_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
  algorithm_version     TEXT NOT NULL,
  embedding_model       TEXT NOT NULL,
  similarity_threshold  DOUBLE PRECISION NOT NULL,
  min_size             INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS content_clusters_user_idx
  ON content_clusters (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS content_clusters_representative_idx
  ON content_clusters (representative_item_id)
  WHERE representative_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS content_cluster_items (
  cluster_id TEXT NOT NULL REFERENCES content_clusters(id) ON DELETE CASCADE,
  item_id    UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  score      DOUBLE PRECISION NOT NULL DEFAULT 0,
  rank       INTEGER NOT NULL,
  PRIMARY KEY (cluster_id, item_id)
);

-- Reverse lookup (memory -> cluster). This is the index the
-- "memory detail page" hits to know which cluster a memory is in.
CREATE INDEX IF NOT EXISTS content_cluster_items_item_idx
  ON content_cluster_items (item_id);

-- Trigger: keep updated_at honest.
DROP TRIGGER IF EXISTS content_clusters_set_updated_at ON content_clusters;
CREATE TRIGGER content_clusters_set_updated_at
  BEFORE UPDATE ON content_clusters
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row-level security. Same shape as the rest of the schema.
ALTER TABLE content_clusters ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_cluster_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_clusters_owner_policy ON content_clusters;
CREATE POLICY content_clusters_owner_policy ON content_clusters
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS content_cluster_items_owner_policy ON content_cluster_items;
CREATE POLICY content_cluster_items_owner_policy ON content_cluster_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM content_clusters cc
       WHERE cc.id = content_cluster_items.cluster_id
         AND cc.user_id = auth.uid()
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM content_clusters cc
       WHERE cc.id = content_cluster_items.cluster_id
         AND cc.user_id = auth.uid()
    )
  );

-- A memory can only belong to one cluster at a time (spec §40 — v1
-- keeps the simple "one primary cluster per memory" model). A
-- partial unique index on item_id enforces that at the storage
-- level rather than only at the application level.
CREATE UNIQUE INDEX IF NOT EXISTS content_cluster_items_one_per_item
  ON content_cluster_items (item_id);
