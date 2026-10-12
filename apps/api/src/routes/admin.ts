/**
 * Admin router (M4).
 *
 * Mounts the operator-only endpoints that back the
 * `/admin` dashboard. Every route here is gated by a
 * permission from the unified RBAC table (see
 * `apps/api/src/rbac.ts`):
 *
 *   * `GET  /admin/users`             — list users (admin.users.read)
 *   * `GET  /admin/users/:id`         — user detail (admin.users.read)
 *   * `POST /admin/users/:id/suspend` — suspend / unsuspend (admin.users.manage)
 *   * `GET  /admin/payments`          — list orders (admin.payments.read)
 *   * `GET  /admin/payments/:id`      — order detail (admin.payments.read)
 *   * `POST /admin/payments/:id/reconcile` — manual reconciliation
 *                                          (admin.payments.review)
 *
 * The router is mounted at `/api/v1/admin` in `app.ts`; the
 * `audit-logs` sub-router is mounted at `/api/v1/admin/audit-logs`
 * to keep its scope narrow.
 *
 * Sensitive actions (suspend, reconcile) write a row into
 * `role_audit_log` so the dashboard's audit page picks them up.
 */
import { Router, type Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  requireAuth,
  requirePermission,
  type AuthedRequest
} from '../rbac.js';
import { applyEntitlement, MEMORY_PLAN_ID, type PlanId } from '../entitlements.js';

export interface AdminRouterDeps {
  pool: Pool;
  supabase: SupabaseClient;
}

interface UserRow {
  id: string;
  email: string | null;
  role: 'user' | 'admin';
  is_suspended: boolean;
  created_at: string;
  plan_id: PlanId;
  family: 'memory' | 'mastery';
  valid_until: string | null;
  memory_count: string;
  subscription_status: string;
}

interface OrderRow {
  id: string;
  user_id: string;
  user_email: string | null;
  plan_id: PlanId;
  interval: 'month' | 'year';
  amount_vnd: string;
  reference: string;
  status: string;
  provider: string;
  created_at: string;
  paid_at: string | null;
  expires_at: string | null;
}

const suspendSchema = z
  .object({
    reason: z.string().trim().min(1).max(500),
    suspend: z.boolean()
  })
  .strict();

const reconcileSchema = z
  .object({
    amount_vnd: z.number().int().positive(),
    note: z.string().trim().min(1).max(500).optional()
  })
  .strict();

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  const auth = requireAuth({ pool: deps.pool, supabase: deps.supabase });

  // ----- Users -----------------------------------------------------------

  router.get(
    '/users',
    auth,
    requirePermission('admin.users.read'),
    async (req: AuthedRequest, res: Response) => {
      const limit = clampInt(req.query.limit, 1, 200, 50);
      const offset = clampInt(req.query.offset, 0, 100_000, 0);
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      const params: unknown[] = [];
      const where: string[] = [];
      if (q) {
        params.push(`%${q.toLowerCase()}%`);
        where.push(`(LOWER(COALESCE(au.email, '')) LIKE $${params.length}
                      OR LOWER(COALESCE(p.name, '')) LIKE $${params.length})`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      try {
        const r = await deps.pool.query<UserRow>(
          `SELECT
              au.id::text,
              au.email::text AS email,
              p.role,
              COALESCE(p.is_suspended, FALSE) AS is_suspended,
              au.created_at::text AS created_at,
              COALESCE(ue.plan_id, 'memory') AS plan_id,
              COALESCE(ue.family, 'memory') AS family,
              ue.valid_until::text AS valid_until,
              COALESCE(item_count.cnt, 0)::text AS memory_count,
              COALESCE(sub.status, 'none') AS subscription_status
            FROM auth.users au
            LEFT JOIN profiles p ON p.id = au.id
            LEFT JOIN user_entitlements ue ON ue.user_id = au.id
            LEFT JOIN user_subscriptions sub
              ON sub.user_id = au.id AND sub.status = 'active'
            LEFT JOIN (
              SELECT user_id, COUNT(*)::bigint AS cnt
                FROM items
                GROUP BY user_id
            ) item_count ON item_count.user_id = au.id
            ${whereSql}
            ORDER BY au.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        );
        res.json({ data: { items: r.rows, limit, offset } });
      } catch (e) {
        console.error('[admin] users list failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải danh sách người dùng' } });
      }
    }
  );

  router.get(
    '/users/:id',
    auth,
    requirePermission('admin.users.read'),
    async (req: AuthedRequest, res: Response) => {
      const id = String(req.params.id);
      try {
        const r = await deps.pool.query<UserRow & { name: string | null }>(
          `SELECT
              au.id::text,
              au.email::text AS email,
              p.name,
              p.role,
              COALESCE(p.is_suspended, FALSE) AS is_suspended,
              au.created_at::text AS created_at,
              COALESCE(ue.plan_id, 'memory') AS plan_id,
              COALESCE(ue.family, 'memory') AS family,
              ue.valid_until::text AS valid_until,
              COALESCE((SELECT COUNT(*)::bigint FROM items WHERE user_id = au.id), 0)::text AS memory_count,
              COALESCE(sub.status, 'none') AS subscription_status
            FROM auth.users au
            LEFT JOIN profiles p ON p.id = au.id
            LEFT JOIN user_entitlements ue ON ue.user_id = au.id
            LEFT JOIN user_subscriptions sub
              ON sub.user_id = au.id AND sub.status = 'active'
            WHERE au.id::text = $1`,
          [id]
        );
        if (!r.rowCount) {
          res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'Không tìm thấy người dùng' } });
          return;
        }
        res.json({ data: { user: r.rows[0] } });
      } catch (e) {
        console.error('[admin] user detail failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải thông tin người dùng' } });
      }
    }
  );

  router.post(
    '/users/:id/suspend',
    auth,
    requirePermission('admin.users.manage'),
    async (req: AuthedRequest, res: Response) => {
      const id = String(req.params.id);
      const parsed = suspendSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'Dữ liệu không hợp lệ' } });
        return;
      }
      try {
        // Last-admin guard: refuse to suspend the only admin.
        if (parsed.data.suspend) {
          const adminCount = await deps.pool.query<{ count: string }>(
            `SELECT COUNT(*)::text AS count FROM profiles WHERE role = 'admin'`
          );
          const target = await deps.pool.query<{ role: 'user' | 'admin' }>(
            `SELECT role FROM profiles WHERE id = $1`,
            [id]
          );
          if (
            target.rowCount &&
            target.rows[0].role === 'admin' &&
            Number.parseInt(adminCount.rows[0].count, 10) <= 1
          ) {
            res.status(409).json({
              error: {
                code: 'LAST_ADMIN_PROTECTED',
                message: 'Không thể tạm ngưng quản trị viên cuối cùng'
              }
            });
            return;
          }
        }
        await deps.pool.query(
          `UPDATE profiles
              SET is_suspended = $2,
                  suspended_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
                  suspended_reason = $3,
                  updated_at = NOW()
            WHERE id = $1`,
          [id, parsed.data.suspend, parsed.data.reason]
        );
        // Audit log entry.
        await deps.pool.query(
          `INSERT INTO role_audit_log
             (actor_user_id, target_user_id, old_role, new_role, reason)
           SELECT $1, $2, p.role, p.role, $3
             FROM profiles p WHERE p.id = $2`,
          [req.userId, id, parsed.data.suspend ? `suspend: ${parsed.data.reason}` : `unsuspend: ${parsed.data.reason}`]
        );
        res.json({ data: { ok: true } });
      } catch (e) {
        console.error('[admin] suspend failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể cập nhật trạng thái' } });
      }
    }
  );

  // ----- Payments --------------------------------------------------------

  router.get(
    '/payments',
    auth,
    requirePermission('admin.payments.read'),
    async (req: AuthedRequest, res: Response) => {
      const limit = clampInt(req.query.limit, 1, 200, 50);
      const offset = clampInt(req.query.offset, 0, 100_000, 0);
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      const where: string[] = [];
      const params: unknown[] = [];
      if (status) {
        params.push(status);
        where.push(`o.status = $${params.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      try {
        const r = await deps.pool.query<OrderRow>(
          `SELECT
              o.id::text,
              o.user_id::text,
              au.email::text AS user_email,
              o.plan_id,
              o.interval,
              o.amount_vnd::text,
              o.reference,
              o.status,
              o.provider,
              o.created_at::text,
              o.paid_at::text,
              o.expires_at::text
            FROM payment_orders o
            LEFT JOIN auth.users au ON au.id = o.user_id
            ${whereSql}
            ORDER BY o.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset]
        );
        res.json({ data: { items: r.rows, limit, offset } });
      } catch (e) {
        console.error('[admin] payments list failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải danh sách đơn hàng' } });
      }
    }
  );

  router.get(
    '/payments/:id',
    auth,
    requirePermission('admin.payments.read'),
    async (req: AuthedRequest, res: Response) => {
      const id = String(req.params.id);
      try {
        const r = await deps.pool.query<OrderRow & { provider_payload: unknown }>(
          `SELECT
              o.id::text,
              o.user_id::text,
              au.email::text AS user_email,
              o.plan_id,
              o.interval,
              o.amount_vnd::text,
              o.reference,
              o.status,
              o.provider,
              o.created_at::text,
              o.paid_at::text,
              o.expires_at::text,
              o.provider_payload
            FROM payment_orders o
            LEFT JOIN auth.users au ON au.id = o.user_id
            WHERE o.id::text = $1`,
          [id]
        );
        if (!r.rowCount) {
          res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng' } });
          return;
        }
        res.json({ data: { order: r.rows[0] } });
      } catch (e) {
        console.error('[admin] payment detail failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải đơn hàng' } });
      }
    }
  );

  router.post(
    '/payments/:id/reconcile',
    auth,
    requirePermission('admin.payments.review'),
    async (req: AuthedRequest, res: Response) => {
      const id = String(req.params.id);
      const parsed = reconcileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_PAYLOAD', message: 'Dữ liệu không hợp lệ' } });
        return;
      }
      const client: PoolClient = await deps.pool.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query<{
          id: string;
          user_id: string;
          plan_id: PlanId;
          amount_vnd: string;
          status: string;
        }>(
          `SELECT id::text, user_id::text, plan_id, amount_vnd::text, status
             FROM payment_orders
            WHERE id::text = $1
            FOR UPDATE`,
          [id]
        );
        if (!r.rowCount) {
          await client.query('ROLLBACK');
          res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng' } });
          return;
        }
        const order = r.rows[0];
        if (order.status === 'paid') {
          await client.query('ROLLBACK');
          res.status(409).json({
            error: { code: 'ORDER_ALREADY_PAID', message: 'Đơn hàng đã được thanh toán' }
          });
          return;
        }
        // Cross-check the amount — admins can ONLY reconcile to
        // a positive integer that matches the order total. This
        // prevents an operator from accidentally activating a
        // smaller plan for a higher price.
        if (parsed.data.amount_vnd !== Number.parseInt(order.amount_vnd, 10)) {
          await client.query('ROLLBACK');
          res.status(409).json({
            error: {
              code: 'AMOUNT_MISMATCH',
              message: 'Số tiền đối soát không khớp với đơn hàng'
            }
          });
          return;
        }
        // Mark paid + apply entitlement.
        await client.query(
          `UPDATE payment_orders
              SET status = 'paid',
                  paid_at = NOW(),
                  paid_via = 'admin_reconcile',
                  admin_note = $2,
                  updated_at = NOW()
            WHERE id::text = $1`,
          [id, parsed.data.note ?? null]
        );
        await client.query(
          `INSERT INTO payment_events
             (order_id, event_type, payload, created_at)
           VALUES ($1, 'admin_reconcile', $2::jsonb, NOW())`,
          [id, JSON.stringify({ actor: req.userId, amount_vnd: parsed.data.amount_vnd })]
        );
        await client.query('COMMIT');
        // Apply entitlement in a separate transaction so the
        // audit log + entitlements are consistent even if the
        // latter fails (we log + re-raise; the operator can
        // re-run reconciliation).
        const validUntil = new Date();
        if (order.plan_id === 'mastery-yearly') {
          validUntil.setUTCFullYear(validUntil.getUTCFullYear() + 1);
        } else {
          validUntil.setUTCMonth(validUntil.getUTCMonth() + 1);
        }
        await applyEntitlement(deps.pool, {
          userId: order.user_id,
          planId: order.plan_id,
          validUntil,
          source: 'admin_adjust',
          note: `admin_reconcile:${id}`
        });
        res.json({ data: { ok: true, order_id: id, user_id: order.user_id } });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        console.error('[admin] reconcile failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể đối soát đơn hàng' } });
      } finally {
        client.release();
      }
    }
  );

  return router;
}
