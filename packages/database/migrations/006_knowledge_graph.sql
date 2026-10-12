-- Migration 006: Knowledge Graph Edges
-- Creates relationships between items

CREATE TABLE IF NOT EXISTS item_edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL CHECK (edge_type IN ('similar', 'references', 'related', 'duplicate', 'parent', 'child')),
  weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),
  attributes JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, from_item_id, to_item_id, edge_type)
);

CREATE INDEX IF NOT EXISTS item_edges_from_idx ON item_edges(from_item_id);
CREATE INDEX IF NOT EXISTS item_edges_to_idx ON item_edges(to_item_id);
CREATE INDEX IF NOT EXISTS item_edges_user_idx ON item_edges(user_id);
CREATE INDEX IF NOT EXISTS item_edges_type_idx ON item_edges(edge_type);

-- RLS for item_edges
ALTER TABLE item_edges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS item_edges_owner_policy ON item_edges;
CREATE POLICY item_edges_owner_policy ON item_edges
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Function to find related items (basic version using embeddings)
CREATE OR REPLACE FUNCTION find_related_items(
  p_user_id UUID,
  p_item_id UUID,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  related_id UUID,
  similarity REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    ie2.item_id AS related_id,
    1 - (ie1.embedding <=> ie2.embedding) AS similarity
  FROM item_embeddings ie1
  JOIN item_embeddings ie2 ON ie1.item_id != ie2.item_id
  JOIN items i1 ON i1.id = ie1.item_id AND i1.user_id = p_user_id
  JOIN items i2 ON i2.id = ie2.item_id AND i2.user_id = p_user_id
  WHERE ie1.item_id = p_item_id
  ORDER BY ie1.embedding <=> ie2.embedding
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION find_related_items TO authenticated;
