-- 027_role_audit_log.sql
-- Append-only audit trail of role changes (admin promotions/demotions).
-- Only the service-role DB pool (see migration 007) reads/writes this table.
-- A second table `role_permissions` (028) maps roles to permissions.

CREATE TABLE IF NOT EXISTS role_audit_log (
  id            BIGSERIAL    PRIMARY KEY,
  actor_user_id UUID         NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  -- System bootstrap (CLI) uses NULL actor; a manual admin change uses the
  -- admin's own UUID.
  target_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_role      TEXT         NULL,
  new_role      TEXT         NOT NULL CHECK (new_role IN ('user','admin')),
  reason        TEXT         NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS role_audit_log_target_idx
  ON role_audit_log (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS role_audit_log_actor_idx
  ON role_audit_log (actor_user_id, created_at DESC);

ALTER TABLE role_audit_log ENABLE ROW LEVEL SECURITY;

-- Authenticated users (and the API) must not be able to read or write
-- the audit log through the public PostgREST layer. The service-role
-- pool used by the API bypasses RLS (migration 007).
DROP POLICY IF EXISTS role_audit_log_deny ON role_audit_log;
CREATE POLICY role_audit_log_deny ON role_audit_log
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
