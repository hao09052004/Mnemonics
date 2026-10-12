-- Add OCR metadata + per-user quota tracking.
--
-- The existing ocr_text / ocr_engine / ocr_confidence columns (added
-- in earlier migrations) were minimal: enough to display text, not
-- enough to drive UX states like "Reading text from image…" or to
-- throttle usage per user.
--
-- This migration is idempotent so it can be re-applied safely
-- against a database that was partially migrated by an older
-- release.

-- Per-OCR-job metadata: language hint we asked for, when we ran
-- the job, and any provider error code (so the UI can show
-- "Text recognition unavailable" and offer a retry).
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS ocr_language TEXT,
  ADD COLUMN IF NOT EXISTS ocr_processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_error_code TEXT;

-- Per-user daily counter for OCR.Space calls. One row per
-- (user_id, quota_date) so the soft cap survives process restarts and is
-- correct under a single API server. For horizontal-scale deployments you
-- should swap this for a Redis-backed implementation; the counter
-- interface in @mnemonics/ai supports that swap without touching the
-- job handler.
CREATE TABLE IF NOT EXISTS ocr_quota (
  user_id      UUID        NOT NULL,
  quota_date   DATE        NOT NULL,
  calls_used   INTEGER     NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, quota_date)
);

-- Fast lookup of "today's count" for a user.
CREATE INDEX IF NOT EXISTS ocr_quota_user_date_idx
  ON ocr_quota (user_id, quota_date DESC);

-- RLS: ocr_quota is a per-user table; a user can read and write
-- only their own row. The API uses the service-role client which
-- bypasses RLS by design.
ALTER TABLE ocr_quota ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ocr_quota' AND policyname = 'ocr_quota_owner_read'
  ) THEN
    CREATE POLICY ocr_quota_owner_read
      ON ocr_quota FOR SELECT
      USING (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ocr_quota' AND policyname = 'ocr_quota_owner_write'
  ) THEN
    CREATE POLICY ocr_quota_owner_write
      ON ocr_quota FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;