-- 031_analytics_events.sql
-- Product analytics events table (M5).
--
-- Privacy contract:
--   * `metadata` is JSONB; callers MUST NOT store raw memory
--     contents, raw OCR/PDF text, search query text, AI prompts,
--     or any other user content. It is reserved for privacy-safe
--     counters and booleans.
--   * `user_id` is NULL for unauthenticated visitors, but the
--     product funnel is *post-signup* — these are only emitted
--     after a session exists. We still allow NULL to keep the
--     schema flexible for future pre-signup analytics.
--   * RLS: rows are inserted only by the service role (the API
--     uses the service key for analytics writes). Reads are
--     gated by the API endpoint which checks `admin.analytics.read`.

CREATE TABLE IF NOT EXISTS analytics_events (
  id              BIGSERIAL    PRIMARY KEY,
  user_id         UUID         NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  event_name      TEXT         NOT NULL,
  entity_type     TEXT         NULL,
  schema_version  TEXT         NOT NULL DEFAULT '1',
  source          TEXT         NOT NULL DEFAULT 'server', -- server | client
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS analytics_events_user_idx
  ON analytics_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_name_time_idx
  ON analytics_events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_created_at_idx
  ON analytics_events (created_at DESC);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytics_events_service_only ON analytics_events;
CREATE POLICY analytics_events_service_only ON analytics_events
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
