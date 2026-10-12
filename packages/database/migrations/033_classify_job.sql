-- Classifier job type (M4).
--
-- The M4 pipeline (item_classifications, see migration 025)
-- classifies captured items through a deterministic, async
-- queue worker. The worker is enqueued via the existing
-- `jobs` table so a stuck classification can be retried the
-- same way as OCR / embed / enrich, but the CHECK constraint
-- on `jobs.type` was last widened in migration 019 (which
-- added `extract_document`).
--
-- Without this migration, the first `classify` job insert
-- fails with:
--
--   new row for relation "jobs" violates check constraint "jobs_type_check"
--
-- The same pattern as 016 (enrich) and 019 (extract_document):
-- drop + re-add the constraint with the new member appended.
-- Existing rows are unaffected; the constraint is a closed
-- set by design (operators can see at a glance what job
-- kinds exist).

BEGIN;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_type_check
  CHECK (type IN ('ocr', 'tag', 'embed', 'enrich', 'extract_document', 'classify'));

COMMIT;
