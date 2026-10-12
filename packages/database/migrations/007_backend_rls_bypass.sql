-- Migration 007: Backend bypass for service operations
-- The API server connects via the postgres pooler role which does not have a
-- Supabase JWT, so `auth.uid()` always returns NULL. That made every backend
-- write fail the WITH CHECK clauses (`auth.uid() = user_id`).
--
-- We keep the per-user RLS policies (they protect direct Supabase client
-- access) but add permissive policies for the service-style role that the
-- backend uses. The backend already enforces per-user filtering at the app
-- layer (it always queries `WHERE user_id = $userId`).

-- Helper: marker for service-side connections (default for `postgres`, `anon`,
-- and `authenticated` roles used through the pgBouncer pooler).
CREATE OR REPLACE FUNCTION is_backend_session()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('request.jwt.claim.sub', true) IS NULL
     OR current_setting('role', true) = 'service_role'
     OR current_setting('is_superuser', true) = 'on'
     OR current_user = 'postgres';
$$;

-- Items: backend may insert/update on behalf of users (it sets user_id)
DROP POLICY IF EXISTS items_backend_policy ON items;
CREATE POLICY items_backend_policy ON items
  FOR ALL TO PUBLIC
  USING (is_backend_session() OR auth.uid() = user_id)
  WITH CHECK (is_backend_session() OR auth.uid() = user_id);

-- Tags: backend inserts tags during the tag-pipeline
DROP POLICY IF EXISTS tags_backend_policy ON tags;
CREATE POLICY tags_backend_policy ON tags
  FOR ALL TO PUBLIC
  USING (is_backend_session() OR auth.uid() = user_id)
  WITH CHECK (is_backend_session() OR auth.uid() = user_id);

-- item_tags
DROP POLICY IF EXISTS item_tags_backend_policy ON item_tags;
CREATE POLICY item_tags_backend_policy ON item_tags
  FOR ALL TO PUBLIC
  USING (
    is_backend_session()
    OR EXISTS (
      SELECT 1 FROM items
      JOIN tags ON tags.id = item_tags.tag_id
      WHERE items.id = item_tags.item_id
        AND items.user_id = auth.uid()
        AND tags.user_id = auth.uid()
    )
  )
  WITH CHECK (
    is_backend_session()
    OR EXISTS (
      SELECT 1 FROM items
      JOIN tags ON tags.id = item_tags.tag_id
      WHERE items.id = item_tags.item_id
        AND items.user_id = auth.uid()
        AND tags.user_id = auth.uid()
    )
  );

-- item_embeddings
DROP POLICY IF EXISTS item_embeddings_backend_policy ON item_embeddings;
CREATE POLICY item_embeddings_backend_policy ON item_embeddings
  FOR ALL TO PUBLIC
  USING (
    is_backend_session()
    OR EXISTS (SELECT 1 FROM items WHERE items.id = item_embeddings.item_id AND items.user_id = auth.uid())
  )
  WITH CHECK (
    is_backend_session()
    OR EXISTS (SELECT 1 FROM items WHERE items.id = item_embeddings.item_id AND items.user_id = auth.uid())
  );

-- assets
DROP POLICY IF EXISTS assets_backend_policy ON assets;
CREATE POLICY assets_backend_policy ON assets
  FOR ALL TO PUBLIC
  USING (
    is_backend_session()
    OR EXISTS (SELECT 1 FROM items WHERE items.id = assets.item_id AND items.user_id = auth.uid())
  )
  WITH CHECK (
    is_backend_session()
    OR EXISTS (SELECT 1 FROM items WHERE items.id = assets.item_id AND items.user_id = auth.uid())
  );

-- jobs (from 004)
DROP POLICY IF EXISTS jobs_backend_policy ON jobs;
CREATE POLICY jobs_backend_policy ON jobs
  FOR ALL TO PUBLIC
  USING (is_backend_session() OR auth.uid() = user_id)
  WITH CHECK (is_backend_session() OR auth.uid() = user_id);

-- item_edges (from 006)
DROP POLICY IF EXISTS item_edges_backend_policy ON item_edges;
CREATE POLICY item_edges_backend_policy ON item_edges
  FOR ALL TO PUBLIC
  USING (is_backend_session() OR auth.uid() = user_id)
  WITH CHECK (is_backend_session() OR auth.uid() = user_id);
