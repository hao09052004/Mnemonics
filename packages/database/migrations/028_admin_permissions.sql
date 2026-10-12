-- 028_admin_permissions.sql
-- Permission matrix used by `requirePermission(perm)` in the API.
-- Roles → permission set is intentionally flat: a user either has
-- `dashboard.user.read` or they don't. New permissions are added by
-- inserting rows here; the API resolves them at request time.

CREATE TABLE IF NOT EXISTS role_permissions (
  role       TEXT NOT NULL CHECK (role IN ('user','admin')),
  permission TEXT NOT NULL,
  PRIMARY KEY (role, permission)
);

INSERT INTO role_permissions (role, permission) VALUES
  ('user',  'dashboard.user.read'),
  ('user',  'billing.self.read'),
  ('user',  'billing.self.checkout'),
  ('user',  'analytics.self.read'),
  ('admin', 'dashboard.user.read'),
  ('admin', 'billing.self.read'),
  ('admin', 'billing.self.checkout'),
  ('admin', 'analytics.self.read'),
  ('admin', 'admin.analytics.read'),
  ('admin', 'admin.users.read'),
  ('admin', 'admin.users.manage'),
  ('admin', 'admin.payments.read'),
  ('admin', 'admin.payments.review'),
  ('admin', 'admin.subscriptions.read'),
  ('admin', 'admin.subscriptions.manage'),
  ('admin', 'admin.system.read'),
  ('admin', 'admin.audit.read'),
  ('admin', 'admin.roles.manage')
ON CONFLICT (role, permission) DO NOTHING;

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_permissions_deny ON role_permissions;
CREATE POLICY role_permissions_deny ON role_permissions
  FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);
