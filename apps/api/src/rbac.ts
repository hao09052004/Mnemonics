/**
 * Unified role + permission middleware.
 *
 * Architectural decisions (see specs/plans/2026-10-12-saas-billing-admin-analytics-m1-rbac.md):
 *
 * - The canonical role lives in `profiles.role` (Postgres). The
 *   Supabase `app_metadata.role` is a *mirror* only — the API
 *   reads the profile row on every authenticated request, so a
 *   forged or stale JWT claim is harmless.
 * - A flat permission table (`role_permissions`) is the source
 *   of truth for what each role can do. `requirePermission(perm)`
 *   looks up the user's permissions in the same request that
 *   resolved their role.
 * - No role is ever read from a request body, query string,
 *   localStorage, or client-claimable JWT. There is no HTTP
 *   route that promotes a user; the only write path is the
 *   `bootstrap-admin` CLI.
 */
import type { NextFunction, Request, Response } from 'express';
import type { Pool } from 'pg';
import type { SupabaseClient, User } from '@supabase/supabase-js';

export type UserRole = 'user' | 'admin';

export const USER_ROLES = ['user', 'admin'] as const satisfies readonly UserRole[];

export const PERMISSIONS = [
  'dashboard.user.read',
  'billing.self.read',
  'billing.self.checkout',
  'analytics.self.read',
  'admin.analytics.read',
  'admin.users.read',
  'admin.users.manage',
  'admin.payments.read',
  'admin.payments.review',
  'admin.subscriptions.read',
  'admin.subscriptions.manage',
  'admin.system.read',
  'admin.audit.read',
  'admin.roles.manage'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type AuthedRequest = Request & {
  userId?: string;
  user?: User;
  userRole?: UserRole;
  userPermissions?: ReadonlySet<string>;
};

/** Read the canonical role from `profiles`. Falls back to `'user'`. */
export async function getUserRole(pool: Pool, userId: string): Promise<UserRole> {
  const r = await pool.query<{ role: UserRole }>(
    'SELECT role FROM profiles WHERE id = $1 LIMIT 1',
    [userId]
  );
  const row = r.rows[0]?.role;
  return row === 'admin' ? 'admin' : 'user';
}

/** Read the permission set for a role. */
export async function getPermissionsForRole(
  pool: Pool,
  role: UserRole
): Promise<ReadonlySet<string>> {
  const r = await pool.query<{ permission: string }>(
    'SELECT permission FROM role_permissions WHERE role = $1',
    [role]
  );
  return new Set(r.rows.map((x) => x.permission));
}

/** Return the role and permission set in one DB round-trip (preferred). */
export async function resolveAuthContext(
  pool: Pool,
  userId: string
): Promise<{ role: UserRole; permissions: ReadonlySet<string> }> {
  const role = await getUserRole(pool, userId);
  const permissions = await getPermissionsForRole(pool, role);
  return { role, permissions };
}

function unauth(response: Response) {
  response.status(401).json({
    error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ' }
  });
}

function forbidden(response: Response, perm: string) {
  response.status(403).json({
    error: { code: 'FORBIDDEN', message: `Thiếu quyền: ${perm}` }
  });
}

/**
 * `requireAuth` resolves the canonical role + permissions from
 * the database on every request. The Supabase `app_metadata`
 * JWT claim is *not* trusted.
 */
export function requireAuth(opts: { pool: Pool; supabase: SupabaseClient }) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) {
      unauth(res);
      return;
    }
    const { data, error } = await opts.supabase.auth.getUser(token);
    if (error || !data.user) {
      unauth(res);
      return;
    }
    req.userId = data.user.id;
    req.user = data.user;
    try {
      const ctx = await resolveAuthContext(opts.pool, data.user.id);
      req.userRole = ctx.role;
      req.userPermissions = ctx.permissions;
    } catch (e) {
      // Fail closed: a DB error during role resolution must NOT
      // grant elevated access.
      console.error('[rbac] role resolution failed', e);
      unauth(res);
      return;
    }
    next();
  };
}

/** Permit only callers whose permission set contains `perm`. */
export function requirePermission(perm: Permission | string) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      unauth(res);
      return;
    }
    if (!req.userPermissions?.has(perm)) {
      forbidden(res, perm);
      return;
    }
    next();
  };
}
