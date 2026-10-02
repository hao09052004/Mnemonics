-- Add `is_favorite` to items so users can pin memories for fast
-- access. Default false so every existing row keeps its current
-- status. We add a partial index that covers the typical "my
-- favorites" query path (`user_id` filter + sort by recency) without
-- paying the storage cost of indexing every row.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS items_user_favorite_idx
  ON items (user_id, created_at DESC)
  WHERE is_favorite;

-- The owner policy already covers FOR ALL on items, so no extra RLS
-- work is needed; an UPDATE that flips `is_favorite` is allowed iff
-- the row belongs to the caller.