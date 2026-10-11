/**
 * Audit log router.
 *
 * Read-only endpoint that returns the most recent admin
 * actions (role changes, sensitive operations) for the admin
 * dashboard. The endpoint is gated by `admin.audit.read`.
 *
 * Pagination is offset-based; the UI uses an infinite scroll.
 * For very long histories a `before=<id>` cursor will be added
 * in a future milestone.
 */
import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import { requireAuth, requirePermission, type AuthedRequest } from '../rbac.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuditLogsRouterDeps {
  pool: Pool;
  supabase: SupabaseClient;
}

interface AuditRow {
  id: string;
  actor_user_id: string | null;
  target_user_id: string;
  old_role: string | null;
  new_role: string;
  reason: string | null;
  created_at: string;
}

export function createAuditLogsRouter(deps: AuditLogsRouterDeps): Router {
  const router = Router();
  const auth = requireAuth({ pool: deps.pool, supabase: deps.supabase });

  router.get('/', auth, requirePermission('admin.audit.read'), async (req: AuthedRequest, res: Response) => {
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const offset = clampInt(req.query.offset, 0, 100_000, 0);
    try {
      const r = await deps.pool.query<AuditRow>(
        `SELECT id::text,
                actor_user_id::text,
                target_user_id::text,
                old_role,
                new_role,
                reason,
                created_at::text
         FROM role_audit_log
         ORDER BY id DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      res.json({ data: { items: r.rows, limit, offset } });
    } catch (e) {
      console.error('[audit-logs] query failed', e);
      res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải nhật ký' } });
    }
  });

  return router;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
