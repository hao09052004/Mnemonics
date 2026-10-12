/**
 * Backwards-compatible shim around the unified RBAC module.
 *
 * Prefer importing from `./rbac.ts` for new code. The legacy
 * exports here keep existing call-sites working while the
 * migration to `requirePermission()` is rolled out.
 */
import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@mnemonics/shared';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Pool } from 'pg';
import {
  getUserRole,
  getPermissionsForRole,
  type AuthedRequest,
  type Permission
} from './rbac.js';

export type { AuthedRequest } from './rbac.js';
export type AuthenticatedRequest = AuthedRequest;

function unauthorized(request: Request, response: Response) {
  response.status(401).json({
    error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ', requestId: request.id }
  });
}

function forbidden(request: Request, response: Response) {
  response.status(403).json({
    error: { code: 'FORBIDDEN', message: 'Bạn không có quyền quản trị', requestId: request.id }
  });
}

/**
 * @deprecated Use `requireAuth({ pool, supabase })` from `./rbac.ts`.
 * The legacy version (kept for back-compat) still uses the
 * `app_metadata.role` JWT claim, which is not authoritative.
 */
export function requireSupabaseAuth(supabase: SupabaseClient) {
  return async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) {
      unauthorized(request, response);
      return;
    }
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      unauthorized(request, response);
      return;
    }
    request.userId = data.user.id;
    request.user = data.user;
    // Best-effort: the legacy callers may not have a pool, so we
    // fall back to the (untrusted) JWT claim. New callers should
    // use `requireAuth({ pool, supabase })` from `./rbac.ts`.
    const metadata = data.user.app_metadata as Record<string, unknown> | undefined;
    request.userRole = metadata?.role === 'admin' ? 'admin' : 'user';
    next();
  };
}

/**
 * Strict variant of `requireSupabaseAuth` that uses the database
 * `profiles.role` as the canonical source. Use this for any
 * protected route that must NOT be forgeable via a JWT claim.
 */
export function requireSupabaseAuthWithPool(opts: { pool: Pool; supabase: SupabaseClient }) {
  return async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token) {
      unauthorized(request, response);
      return;
    }
    const { data, error } = await opts.supabase.auth.getUser(token);
    if (error || !data.user) {
      unauthorized(request, response);
      return;
    }
    request.userId = data.user.id;
    request.user = data.user;
    try {
      request.userRole = await getUserRole(opts.pool, data.user.id);
      request.userPermissions = await getPermissionsForRole(opts.pool, request.userRole);
    } catch (e) {
      console.error('[auth] role resolution failed', e);
      unauthorized(request, response);
      return;
    }
    next();
  };
}

/**
 * @deprecated Use `requirePermission('admin.<x>')` from `./rbac.ts`.
 * The legacy version reads `request.userRole` set by
 * `requireSupabaseAuth` (which is JWT-claim based).
 */
export function requireAdmin(request: AuthenticatedRequest, response: Response, next: NextFunction) {
  if (request.userRole !== 'admin') {
    forbidden(request, response);
    return;
  }
  next();
}

/**
 * Same shape as `requirePermission` from `./rbac.ts` but with
 * the legacy `request.userRole` checks so old call-sites still
 * work until they are migrated.
 */
export function requirePermissionLegacy(perm: Permission | string) {
  return async (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    if (!request.userId) {
      unauthorized(request, response);
      return;
    }
    if (!request.userPermissions?.has(perm)) {
      response.status(403).json({
        error: { code: 'FORBIDDEN', message: `Thiếu quyền: ${perm}`, requestId: request.id }
      });
      return;
    }
    next();
  };
}

export function requireDevelopmentAuth(expectedToken: string, developmentUserId = '00000000-0000-4000-8000-000000000001') {
  return (request: AuthenticatedRequest, response: Response, next: NextFunction) => {
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!token || token !== expectedToken) {
      response.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ', requestId: request.id }
      });
      return;
    }
    request.userId = developmentUserId;
    next();
  };
}

void (null as unknown as User); // keep import non-empty
