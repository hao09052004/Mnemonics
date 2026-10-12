/**
 * Personal analytics (M5).
 *
 * Two endpoints:
 *   * `GET /api/v1/analytics/me/overview` — counts + plan summary
 *     scoped to the caller.
 *   * `GET /api/v1/analytics/me/captures` — daily capture count
 *     for the last N days, useful for the trend chart.
 *
 * All metrics are derived from real database rows. No mock
 * numbers. Empty datasets return zero counts (and `null` where
 * "not enough data" is a more honest answer than `0`).
 */
import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, requirePermission, type AuthedRequest } from '../rbac.js';
import { getEntitlement } from '../entitlements.js';

export interface PersonalAnalyticsDeps {
  pool: Pool;
  supabase: SupabaseClient;
}

const overviewQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).optional().default(30)
  })
  .strict();

const capturesQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).optional().default(30)
  })
  .strict();

function isoDateNDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function createPersonalAnalyticsRouter(deps: PersonalAnalyticsDeps): Router {
  const router = Router();
  const auth = requireAuth({ pool: deps.pool, supabase: deps.supabase });

  router.get(
    '/me/overview',
    auth,
    requirePermission('analytics.self.read'),
    async (req: AuthedRequest, res: Response) => {
      const parsed = overviewQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Tham số không hợp lệ' } });
        return;
      }
      const userId = req.userId!;
      const days = parsed.data.days;
      const since = isoDateNDaysAgo(days);
      try {
        const ent = await getEntitlement(deps.pool, userId);
        const counts = await deps.pool.query<{
          total: string;
          this_month: string;
          this_period: string;
        }>(
          `SELECT
              COUNT(*)::text AS total,
              COUNT(*) FILTER (
                WHERE DATE_TRUNC('month', captured_at AT TIME ZONE 'UTC') =
                    DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')
              )::text AS this_month,
              COUNT(*) FILTER (WHERE captured_at >= $2::timestamptz)::text AS this_period
            FROM items WHERE user_id = $1`,
          [userId, since]
        );
        const types = await deps.pool.query<{ type: string; n: string }>(
          `SELECT type, COUNT(*)::text AS n FROM items
            WHERE user_id = $1
            GROUP BY type ORDER BY n DESC`,
          [userId]
        );
        const spaces = await deps.pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM spaces WHERE user_id = $1`,
          [userId]
        );
        const tags = await deps.pool.query<{ n: string }>(
          `SELECT COUNT(DISTINCT it.tag_id)::text AS n
             FROM item_tags it
             JOIN items i ON i.id = it.item_id
            WHERE i.user_id = $1`,
          [userId]
        );
        const aiCalls = await deps.pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n
             FROM ai_usage_events
            WHERE user_id = $1 AND created_at >= $2::timestamptz`,
          [userId, since]
        );
        const totalCaptures = Number.parseInt(counts.rows[0]?.total ?? '0', 10);
        const thisMonth = Number.parseInt(counts.rows[0]?.this_month ?? '0', 10);
        const capturesThisPeriod = Number.parseInt(counts.rows[0]?.this_period ?? '0', 10);
        const remaining =
          ent.monthlyCaptureLimit !== null
            ? Math.max(0, ent.monthlyCaptureLimit - thisMonth)
            : null;
        res.json({
          data: {
            totalCaptures,
            thisMonth,
            capturesThisPeriod,
            daysWindow: days,
            plan: {
              id: ent.planId,
              family: ent.family,
              validUntil: ent.validUntil,
              semanticSearchEnabled: ent.semanticSearchEnabled,
              monthlyCaptureLimit: ent.monthlyCaptureLimit,
              remainingCaptures: remaining
            },
            spaces: Number.parseInt(spaces.rows[0]?.n ?? '0', 10),
            distinctTags: Number.parseInt(tags.rows[0]?.n ?? '0', 10),
            aiCallsThisPeriod: Number.parseInt(aiCalls.rows[0]?.n ?? '0', 10),
            byType: types.rows.map((r) => ({
              type: r.type,
              count: Number.parseInt(r.n, 10)
            }))
          }
        });
      } catch (e) {
        console.error('[analytics/me] overview failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải phân tích' } });
      }
    }
  );

  router.get(
    '/me/captures',
    auth,
    requirePermission('analytics.self.read'),
    async (req: AuthedRequest, res: Response) => {
      const parsed = capturesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Tham số không hợp lệ' } });
        return;
      }
      const userId = req.userId!;
      const days = parsed.data.days;
      const since = isoDateNDaysAgo(days);
      try {
        const r = await deps.pool.query<{ day: string; n: string }>(
          `SELECT DATE(captured_at AT TIME ZONE 'UTC')::text AS day,
                  COUNT(*)::text AS n
             FROM items
            WHERE user_id = $1
              AND captured_at >= $2::timestamptz
            GROUP BY day
            ORDER BY day ASC`,
          [userId, since]
        );
        // Build a dense day series so the chart doesn't have gaps.
        const series: Array<{ day: string; count: number }> = [];
        const seen = new Map(r.rows.map((row) => [row.day, Number.parseInt(row.n, 10)]));
        for (let i = days - 1; i >= 0; i--) {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() - i);
          const day = d.toISOString().slice(0, 10);
          series.push({ day, count: seen.get(day) ?? 0 });
        }
        res.json({ data: { days, series } });
      } catch (e) {
        console.error('[analytics/me] captures failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải chuỗi lưu' } });
      }
    }
  );

  return router;
}
