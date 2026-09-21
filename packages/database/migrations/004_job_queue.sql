-- Migration 004: Job Queue System
-- Adds jobs table for background processing

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('ocr', 'tag', 'embed')),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  payload JSONB DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Indexes for efficient job processing
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status) WHERE status IN ('pending', 'processing');
CREATE INDEX IF NOT EXISTS jobs_item_id_idx ON jobs (item_id);
CREATE INDEX IF NOT EXISTS jobs_user_id_idx ON jobs (user_id);
CREATE INDEX IF NOT EXISTS jobs_created_at_idx ON jobs (created_at ASC);

-- RLS for jobs
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobs_owner_policy ON jobs;
CREATE POLICY jobs_owner_policy ON jobs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add embedding_status column to items for tracking processing state
ALTER TABLE items ADD COLUMN IF NOT EXISTS embedding_status TEXT DEFAULT NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS ocr_engine TEXT DEFAULT NULL;
ALTER TABLE items ADD COLUMN IF NOT EXISTS ocr_confidence NUMERIC(3,2) DEFAULT NULL;
