-- Allow the 'enrich' job type.
--
-- The OCR handler enqueues an `enrich` job after it finishes, to produce the
-- caption / tldr / summary for the item. Migration 004 created the jobs
-- table with a CHECK constraint that only listed ('ocr', 'tag', 'embed'),
-- so every enrich insert failed with:
--
--   new row for relation "jobs" violates check constraint "jobs_type_check"
--
-- The failure was silent from the caller's point of view: the OCR handler
-- logs it and moves on, so the item reaches `ready` with an empty caption
-- and no tldr, and the dashboard's detail modal renders empty.
--
-- The constraint is dropped and recreated rather than altered, because
-- CHECK constraints cannot be modified in place.

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;

ALTER TABLE jobs ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('ocr', 'tag', 'embed', 'enrich'));
