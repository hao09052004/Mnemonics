-- 035_profiles_is_suspended.sql
-- Administrative suspension flag for profiles (spec 0005 / RBAC security audit).
--
-- When `is_suspended` is TRUE:
--   - The user cannot authenticate to any API endpoint (HTTP 403 ACCOUNT_SUSPENDED).
--   - Their existing data remains preserved.
--   - An administrator can un-suspend the user via POST /api/v1/admin/users/:id/suspend.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS profiles_is_suspended_idx
  ON profiles (is_suspended)
  WHERE is_suspended = TRUE;
