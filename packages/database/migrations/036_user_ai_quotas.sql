-- 036_user_ai_quotas.sql
-- Multi-instance atomic per-user daily AI quota tracking and shared rate limiting.

CREATE TABLE IF NOT EXISTS user_ai_quotas (
  user_id UUID NOT NULL,
  date_key DATE NOT NULL DEFAULT CURRENT_DATE,
  usage_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_user_ai_quotas_lookup
  ON user_ai_quotas (user_id, date_key);

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key TEXT NOT NULL,
  reset_at BIGINT NOT NULL,
  count INT NOT NULL DEFAULT 1,
  PRIMARY KEY (key)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_reset
  ON rate_limit_counters (reset_at);

ALTER TABLE user_ai_quotas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_ai_quotas_service_only ON user_ai_quotas;
CREATE POLICY user_ai_quotas_service_only ON user_ai_quotas
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

ALTER TABLE rate_limit_counters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rate_limit_counters_service_only ON rate_limit_counters;
CREATE POLICY rate_limit_counters_service_only ON rate_limit_counters
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
