-- Migration 010: active job uniqueness
-- Ensure only one pending or processing job exists for each item/stage.
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_item_type_idx
  ON jobs (item_id, type)
  WHERE status IN ('pending', 'processing');
