-- 032_ai_usage_events.sql
-- AI usage telemetry (M5).
--
-- Tracks every Gemini call (text, embedding, image, vision,
-- tldr, ocr, document-extract). The API records success/failure,
-- latency, optional token counts (when the provider reports
-- them), and the error category.
--
-- The table does NOT store prompts or model responses — only
-- the metadata required to compute operational metrics.
-- `ai_user_quota_daily` is the read-side aggregate we already
-- use for the rate limit (see packages/ai/src/user-quota.ts).

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         UUID         NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  provider        TEXT         NOT NULL DEFAULT 'gemini',
  model           TEXT         NOT NULL,
  task_type       TEXT         NOT NULL CHECK (task_type IN (
    'embedding','text_generation','image_description',
    'ocr','tldr','vision','document_extract','other'
  )),
  status          TEXT         NOT NULL CHECK (status IN ('success','failed','rate_limited','cached')),
  input_tokens    INT          NULL,
  output_tokens   INT          NULL,
  latency_ms      INT          NULL,
  error_code      TEXT         NULL,
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_usage_events_user_idx
  ON ai_usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_task_time_idx
  ON ai_usage_events (task_type, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_model_time_idx
  ON ai_usage_events (model, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_status_time_idx
  ON ai_usage_events (status, created_at DESC);

ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_events_service_only ON ai_usage_events;
CREATE POLICY ai_usage_events_service_only ON ai_usage_events
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
