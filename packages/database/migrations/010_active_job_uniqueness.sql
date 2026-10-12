-- Migration 010: active job uniqueness
-- Ensure only one pending or processing job exists for each item/stage.
--
-- Older deployments may already contain duplicate in-flight jobs from retry
-- races. Preserve the most recently updated processing job (or oldest pending
-- job when nothing is processing) and mark other active duplicates failed
-- before adding the unique partial index.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY item_id, type
      ORDER BY
        CASE WHEN status = 'processing' THEN 0 ELSE 1 END,
        updated_at DESC,
        id
    ) AS rn
  FROM jobs
  WHERE status IN ('pending', 'processing')
)
UPDATE jobs
SET
  status = 'failed',
  error = COALESCE(error, 'deduplicated during active-job uniqueness migration'),
  updated_at = NOW()
WHERE id IN (
  SELECT id FROM ranked WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_item_type_idx
  ON jobs (item_id, type)
  WHERE status IN ('pending', 'processing');
