CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('link', 'text', 'image')),
  title TEXT NOT NULL,
  source_url TEXT,
  raw_text TEXT,
  ocr_text TEXT,
  searchable_text TSVECTOR,
  summary TEXT,
  error_code TEXT,
  captured_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'ready', 'failed')),
  client_request_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS items_user_created_at_idx ON items (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  width INTEGER,
  height INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  UNIQUE (user_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS item_embeddings (
  item_id UUID PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS item_embeddings_vector_idx
  ON item_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS items_owner_policy ON items;
CREATE POLICY items_owner_policy ON items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS assets_owner_policy ON assets;
CREATE POLICY assets_owner_policy ON assets
  FOR ALL USING (EXISTS (SELECT 1 FROM items WHERE items.id = assets.item_id AND items.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM items WHERE items.id = assets.item_id AND items.user_id = auth.uid()));

DROP POLICY IF EXISTS tags_owner_policy ON tags;
CREATE POLICY tags_owner_policy ON tags
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS item_tags_owner_policy ON item_tags;
CREATE POLICY item_tags_owner_policy ON item_tags
  FOR ALL USING (EXISTS (SELECT 1 FROM items JOIN tags ON tags.id = item_tags.tag_id WHERE items.id = item_tags.item_id AND items.user_id = auth.uid() AND tags.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM items JOIN tags ON tags.id = item_tags.tag_id WHERE items.id = item_tags.item_id AND items.user_id = auth.uid() AND tags.user_id = auth.uid()));

DROP POLICY IF EXISTS item_embeddings_owner_policy ON item_embeddings;
CREATE POLICY item_embeddings_owner_policy ON item_embeddings
  FOR ALL USING (EXISTS (SELECT 1 FROM items WHERE items.id = item_embeddings.item_id AND items.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM items WHERE items.id = item_embeddings.item_id AND items.user_id = auth.uid()));

INSERT INTO storage.buckets (id, name, public)
VALUES ('mnemonics-assets', 'mnemonics-assets', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS mnemonics_assets_read ON storage.objects;
CREATE POLICY mnemonics_assets_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'mnemonics-assets' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS mnemonics_assets_insert ON storage.objects;
CREATE POLICY mnemonics_assets_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'mnemonics-assets' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS mnemonics_assets_delete ON storage.objects;
CREATE POLICY mnemonics_assets_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'mnemonics-assets' AND (storage.foldername(name))[1] = auth.uid()::text);