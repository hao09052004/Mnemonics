/**
 * Admin analytics (M5).
 *
 *   * `GET /api/v1/admin/analytics/overview`  — top KPIs (users,
 *     subscriptions, revenue, product, AI).
 *   * `GET /api/v1/admin/analytics/revenue`  — paid totals,
 *     monthly/yearly split, refunded + pending totals, MRR run
 *     rate. Pending transfers are NOT counted as revenue.
 *   * `GET /api/v1/admin/analytics/users`     — user growth +
 *     retention. D1/D7/D30 retention is returned only when
 *     the historical data is sufficient (≥ 30 days of signups).
 *   * `GET /api/v1/admin/analytics/product`   — captures, capture
 *     types, success rate.
 *   * `GET /api/v1/admin/analytics/ai`        — Gemini task
 *     breakdown, latency, error categories, free-tier rate
 *     limits vs provider quotas.
 *   * `GET /api/v1/admin/analytics/system`    — system health,
 *     request error rate, queue depth, DB connectivity.
 *
 * The MRR / ARR numbers are labelled as **estimated run rate**
 * because the product is bank-transfer-driven and not an
 * auto-renewing subscription. Verified collections (paid
 * payment_orders) are the only revenue truth.
 */
import { Router, type Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAuth, requirePermission, type AuthedRequest } from '../rbac.js';

export interface AdminAnalyticsDeps {
  pool: Pool;
  supabase: SupabaseClient;
  /** Latency percentiles from the request-timings ring buffer. */
  getRequestTimings?: () => Array<{ route: string; p50_ms: number; p95_ms: number; n: number }>;
}

const rangeSchema = z
  .object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
  })
  .strict();

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoDateNDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function clampRange(parsed: { from?: string; to?: string }): { from: string; to: string } {
  const to = parsed.to ?? todayIso();
  const maxFrom = isoDateNDaysAgo(0);
  const requestedFrom = parsed.from ?? isoDateNDaysAgo(30);
  // Hard cap at 365 days to keep the SQL cheap.
  const minAllowed = isoDateNDaysAgo(365);
  const from = requestedFrom < minAllowed ? minAllowed : requestedFrom;
  return { from: from > to ? to : from, to: to > maxFrom ? maxFrom : to };
}

export function createAdminAnalyticsRouter(deps: AdminAnalyticsDeps): Router {
  const router = Router();
  const auth = requireAuth({ pool: deps.pool, supabase: deps.supabase });

  // -------- overview ----------------------------------------------------
  router.get(
    '/overview',
    auth,
    requirePermission('admin.analytics.read'),
    async (_req: AuthedRequest, res: Response) => {
      try {
        // Use a small helper that swallows per-table errors so a
        // missing optional table (e.g. `payment_orders` in a
        // partial migration) does not break the whole overview.
        const safeCount = async (sql: string, fallback = 0): Promise<number> => {
          try {
            const r = await deps.pool.query<{ n: string }>(sql);
            return Number.parseInt(r.rows[0]?.n ?? String(fallback), 10);
          } catch {
            return fallback;
          }
        };
        const safeSum = async (sql: string, fallback = 0): Promise<number> => {
          try {
            const r = await deps.pool.query<{ n: string }>(sql);
            return Number.parseInt(r.rows[0]?.n ?? String(fallback), 10);
          } catch {
            return fallback;
          }
        };
        const users = {
          total: await safeCount(`SELECT COUNT(*)::text AS n FROM auth.users`),
          today: await safeCount(
            `SELECT COUNT(*)::text AS n FROM auth.users WHERE created_at >= (NOW() - INTERVAL '1 day')`
          ),
          period: await safeCount(
            `SELECT COUNT(*)::text AS n FROM auth.users WHERE created_at >= (NOW() - INTERVAL '30 day')`
          ),
          memory: await safeCount(
            `SELECT COUNT(*)::text AS n FROM user_entitlements WHERE family = 'memory'`
          ),
          mastery: await safeCount(
            `SELECT COUNT(*)::text AS n FROM user_entitlements WHERE family = 'mastery'`
          )
        };
        const revenue = {
          verifiedVnd: await safeSum(
            `SELECT COALESCE(SUM(amount_vnd), 0)::text AS n FROM payment_orders WHERE status = 'paid'`
          ),
          refundedVnd: await safeSum(
            `SELECT COALESCE(SUM(amount_vnd), 0)::text AS n FROM payment_orders WHERE status = 'refunded'`
          ),
          pendingVnd: await safeSum(
            `SELECT COALESCE(SUM(amount_vnd), 0)::text AS n FROM payment_orders WHERE status = 'pending'`
          ),
          verifiedOrders: await safeCount(
            `SELECT COUNT(*)::text AS n FROM payment_orders WHERE status = 'paid'`
          ),
          paid30dVnd: await safeSum(
            `SELECT COALESCE(SUM(amount_vnd), 0)::text AS n FROM payment_orders WHERE status = 'paid' AND paid_at >= (NOW() - INTERVAL '30 day')`
          )
        };
        const captures = {
          total: await safeCount(`SELECT COUNT(*)::text AS n FROM items`),
          period: await safeCount(
            `SELECT COUNT(*)::text AS n FROM items WHERE captured_at >= (NOW() - INTERVAL '30 day')`
          ),
          success: await safeCount(`SELECT COUNT(*)::text AS n FROM items WHERE status = 'ready'`),
          failed: await safeCount(`SELECT COUNT(*)::text AS n FROM items WHERE status = 'failed'`)
        };
        const semantic = await safeCount(
          `SELECT COUNT(*)::text AS n FROM analytics_events WHERE event_name = 'semantic_search_performed' AND created_at >= (NOW() - INTERVAL '30 day')`
        );
        const successRate =
          captures.total === 0
            ? null
            : captures.success / Math.max(1, captures.total);

        const activatedCount = await safeCount(`SELECT COUNT(DISTINCT user_id)::text AS n FROM items`);
        const engagedCount = await safeCount(`SELECT COUNT(DISTINCT user_id)::text AS n FROM spaces`);
        const payingCount = await safeCount(`SELECT COUNT(DISTINCT user_id)::text AS n FROM payment_orders WHERE status = 'paid'`);

        const funnel = {
          registered: users.total,
          activated: activatedCount,
          engaged: engagedCount,
          paying: payingCount,
          totalItems: captures.total,
          activationRate: users.total > 0 ? Number(((activatedCount / users.total) * 100).toFixed(1)) : 0,
          engagementRate: activatedCount > 0 ? Number(((engagedCount / activatedCount) * 100).toFixed(1)) : 0,
          conversionRate: users.total > 0 ? Number(((payingCount / users.total) * 100).toFixed(1)) : 0
        };

        res.json({
          data: {
            users,
            revenue,
            product: {
              totalCaptures: captures.total,
              captures30d: captures.period,
              successRate,
              semanticSearch30d: semantic
            },
            funnel
          }
        });
      } catch (e) {
        console.error('[admin/analytics] overview failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải tổng quan' } });
      }
    }
  );

  // -------- revenue -----------------------------------------------------
  router.get(
    '/revenue',
    auth,
    requirePermission('admin.analytics.read'),
    async (req: AuthedRequest, res: Response) => {
      const parsed = rangeSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Tham số không hợp lệ' } });
        return;
      }
      const { from, to } = clampRange(parsed.data);
      try {
        const hasPaymentOrders = await deps.pool.query<{ exists: boolean }>(
          `SELECT EXISTS (SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='payment_orders' AND column_name='interval') AS exists`
        );
        if (!hasPaymentOrders.rows[0]?.exists) {
          res.json({
            data: {
              range: { from, to },
              pending: { count: 0, vnd: 0 },
              paid: { count: 0, vnd: 0 },
              refunded: { count: 0, vnd: 0 },
              cancelled: { count: 0, vnd: 0 },
              rejected: { count: 0, vnd: 0 },
              byInterval: [],
              daily: [],
              estimatedMonthlyRunRate: {
                vnd: 0,
                activeSubscribers: 0,
                caveat: 'Estimated run rate (sum of paid active Mastery subscriptions, normalized to a monthly figure). Not contracted MRR.'
              },
              note: 'payment_orders.amount_vnd not present in this database.'
            }
          });
          return;
        }
        const totals = await deps.pool.query<{ status: string; n: string; vnd: string }>(
          `SELECT status, COUNT(*)::text AS n, COALESCE(SUM(amount_vnd), 0)::text AS vnd
             FROM payment_orders
            WHERE DATE(created_at AT TIME ZONE 'UTC') BETWEEN $1 AND $2
            GROUP BY status`,
          [from, to]
        );
        const byInterval = await deps.pool.query<{ interval: string; n: string; vnd: string }>(
          `SELECT interval, COUNT(*)::text AS n, COALESCE(SUM(amount_vnd), 0)::text AS vnd
             FROM payment_orders
            WHERE status = 'paid' AND DATE(paid_at AT TIME ZONE 'UTC') BETWEEN $1 AND $2
            GROUP BY interval`,
          [from, to]
        );
        const daily = await deps.pool.query<{ day: string; vnd: string; n: string }>(
          `SELECT DATE(paid_at AT TIME ZONE 'UTC')::text AS day,
                  COALESCE(SUM(amount_vnd), 0)::text AS vnd,
                  COUNT(*)::text AS n
             FROM payment_orders
            WHERE status = 'paid' AND DATE(paid_at AT TIME ZONE 'UTC') BETWEEN $1 AND $2
            GROUP BY day ORDER BY day ASC`,
          [from, to]
        );
        const activeSubs = await deps.pool.query<{ monthly_run_rate_vnd: string; n: string }>(
          `SELECT
              COALESCE(SUM(
                CASE plan_id
                  WHEN 'mastery-monthly' THEN amount_vnd
                  WHEN 'mastery-yearly'  THEN amount_vnd / 12
                  ELSE 0
                END
              ), 0)::text AS monthly_run_rate_vnd,
              COUNT(*)::text AS n
             FROM user_subscriptions
            WHERE status = 'active' AND plan_id IN ('mastery-monthly','mastery-yearly')`
        );
        const sumBy = (status: string) => {
          const row = totals.rows.find((r) => r.status === status);
          return { count: row ? Number.parseInt(row.n, 10) : 0, vnd: row ? Number.parseInt(row.vnd, 10) : 0 };
        };
        res.json({
          data: {
            range: { from, to },
            pending: sumBy('pending'),
            paid: sumBy('paid'),
            refunded: sumBy('refunded'),
            cancelled: sumBy('cancelled'),
            rejected: sumBy('rejected'),
            byInterval: byInterval.rows.map((r) => ({
              interval: r.interval,
              count: Number.parseInt(r.n, 10),
              vnd: Number.parseInt(r.vnd, 10)
            })),
            daily: daily.rows.map((r) => ({
              day: r.day,
              count: Number.parseInt(r.n, 10),
              vnd: Number.parseInt(r.vnd, 10)
            })),
            estimatedMonthlyRunRate: {
              vnd: Number.parseInt(activeSubs.rows[0].monthly_run_rate_vnd, 10),
              activeSubscribers: Number.parseInt(activeSubs.rows[0].n, 10),
              caveat: 'Estimated run rate (sum of paid active Mastery subscriptions, normalized to a monthly figure). Not contracted MRR.'
            }
          }
        });
      } catch (e) {
        console.error('[admin/analytics] revenue failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải doanh thu' } });
      }
    }
  );

  // -------- users / growth ----------------------------------------------
  router.get(
    '/users',
    auth,
    requirePermission('admin.analytics.read'),
    async (req: AuthedRequest, res: Response) => {
      const parsed = rangeSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Tham số không hợp lệ' } });
        return;
      }
      const { from, to } = clampRange(parsed.data);
      try {
        const daily = await deps.pool.query<{ day: string; n: string }>(
          `SELECT DATE(created_at AT TIME ZONE 'UTC')::text AS day,
                  COUNT(*)::text AS n
             FROM auth.users
            WHERE DATE(created_at AT TIME ZONE 'UTC') BETWEEN $1 AND $2
            GROUP BY day ORDER BY day ASC`,
          [from, to]
        );
        // Retention is only meaningful when we have ≥ 30 days of
        // signups. Below that we return null and a human-readable
        // reason.
        const oldest = await deps.pool.query<{ day: string | null }>(
          `SELECT MIN(DATE(created_at AT TIME ZONE 'UTC'))::text AS day FROM auth.users`
        );
        const oldestDay = oldest.rows[0]?.day ?? null;
        let retention: null | {
          d1: number | null;
          d7: number | null;
          d30: number | null;
          sampleSize: number;
          note?: string;
        } = null;
        if (oldestDay) {
          const oldestDate = new Date(oldestDay + 'T00:00:00Z');
          const ageDays = Math.floor((Date.now() - oldestDate.getTime()) / 86_400_000);
          if (ageDays >= 30) {
            const sample = await deps.pool.query<{
              cohort_day: string;
              size: string;
              d1: string;
              d7: string;
              d30: string;
            }>(
              `WITH signups AS (
                 SELECT id::text AS uid,
                        DATE(created_at AT TIME ZONE 'UTC')::text AS cohort_day
                   FROM auth.users
                  WHERE created_at >= (NOW() - INTERVAL '60 day')
               ),
               activity AS (
                 SELECT DISTINCT user_id::text AS uid,
                         DATE(created_at AT TIME ZONE 'UTC')::text AS active_day
                   FROM items
               )
               SELECT s.cohort_day,
                      COUNT(*)::text AS size,
                      COUNT(*) FILTER (
                        WHERE EXISTS (
                          SELECT 1 FROM activity a
                           WHERE a.uid = s.uid
                             AND a.active_day = (DATE(s.cohort_day) + INTERVAL '1 day')::date::text
                        )
                      )::text AS d1,
                      COUNT(*) FILTER (
                        WHERE EXISTS (
                          SELECT 1 FROM activity a
                           WHERE a.uid = s.uid
                             AND a.active_day = (DATE(s.cohort_day) + INTERVAL '7 day')::date::text
                        )
                      )::text AS d7,
                      COUNT(*) FILTER (
                        WHERE EXISTS (
                          SELECT 1 FROM activity a
                           WHERE a.uid = s.uid
                             AND a.active_day = (DATE(s.cohort_day) + INTERVAL '30 day')::date::text
                        )
                      )::text AS d30
                 FROM signups s
                 GROUP BY s.cohort_day`
            );
            const totalSize = sample.rows.reduce((s, r) => s + Number.parseInt(r.size, 10), 0);
            const d1 = sample.rows.reduce((s, r) => s + Number.parseInt(r.d1, 10), 0);
            const d7 = sample.rows.reduce((s, r) => s + Number.parseInt(r.d7, 10), 0);
            const d30 = sample.rows.reduce((s, r) => s + Number.parseInt(r.d30, 10), 0);
            retention = {
              d1: totalSize > 0 ? d1 / totalSize : null,
              d7: totalSize > 0 ? d7 / totalSize : null,
              d30: totalSize > 0 ? d30 / totalSize : null,
              sampleSize: totalSize
            };
          } else {
            retention = {
              d1: null,
              d7: null,
              d30: null,
              sampleSize: 0,
              note: 'Not enough historical data (need ≥ 30 days of signups)'
            };
          }
        }
        res.json({
          data: {
            range: { from, to },
            daily: daily.rows.map((r) => ({ day: r.day, count: Number.parseInt(r.n, 10) })),
            retention
          }
        });
      } catch (e) {
        console.error('[admin/analytics] users failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải phân tích người dùng' } });
      }
    }
  );

  // -------- product -----------------------------------------------------
  router.get(
    '/product',
    auth,
    requirePermission('admin.analytics.read'),
    async (req: AuthedRequest, res: Response) => {
      const parsed = rangeSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Tham số không hợp lệ' } });
        return;
      }
      const { from, to } = clampRange(parsed.data);
      try {
        const byType = await deps.pool.query<{ type: string; n: string }>(
          `SELECT type, COUNT(*)::text AS n
             FROM items
            WHERE DATE(captured_at AT TIME ZONE 'UTC') BETWEEN $1 AND $2
            GROUP BY type ORDER BY n DESC`,
          [from, to]
        );
        const byStatus = await deps.pool.query<{ status: string; n: string }>(
          `SELECT status, COUNT(*)::text AS n
             FROM items
            WHERE DATE(captured_at AT TIME ZONE 'UTC') BETWEEN $1 AND $2
            GROUP BY status`,
          [from, to]
        );
        const daily = await deps.pool.query<{ day: string; n: string; failed: string }>(
          `SELECT DATE(captured_at AT TIME ZONE 'UTC')::text AS day,
                  COUNT(*)::text AS n,
                  COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
             FROM items
            WHERE DATE(captured_at AT TIME ZONE 'UTC') BETWEEN $1 AND $2
            GROUP BY day ORDER BY day ASC`,
          [from, to]
        );
        res.json({
          data: {
            range: { from, to },
            byType: byType.rows.map((r) => ({ type: r.type, count: Number.parseInt(r.n, 10) })),
            byStatus: byStatus.rows.map((r) => ({ status: r.status, count: Number.parseInt(r.n, 10) })),
            daily: daily.rows.map((r) => ({
              day: r.day,
              count: Number.parseInt(r.n, 10),
              failed: Number.parseInt(r.failed, 10)
            }))
          }
        });
      } catch (e) {
        console.error('[admin/analytics] product failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải phân tích sản phẩm' } });
      }
    }
  );

  // -------- AI usage ----------------------------------------------------
  router.get(
    '/ai',
    auth,
    requirePermission('admin.analytics.read'),
    async (req: AuthedRequest, res: Response) => {
      const parsed = rangeSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: { code: 'INVALID_QUERY', message: 'Tham số không hợp lệ' } });
        return;
      }
      const { from, to } = clampRange(parsed.data);
      try {
        const byTask = await deps.pool.query<{ task_type: string; n: string; success: string; failed: string; avg_latency_ms: string | null; tokens: string | null }>(
          `SELECT task_type,
                  COUNT(*)::text AS n,
                  COUNT(*) FILTER (WHERE status = 'success')::text AS success,
                  COUNT(*) FILTER (WHERE status IN ('failed','rate_limited'))::text AS failed,
                  ROUND(AVG(latency_ms) FILTER (WHERE latency_ms IS NOT NULL))::text AS avg_latency_ms,
                  COALESCE(SUM(input_tokens + output_tokens), 0)::text AS tokens
             FROM ai_usage_events
            WHERE DATE(created_at AT TIME ZONE 'UTC') BETWEEN $1 AND $2
            GROUP BY task_type ORDER BY n DESC`,
          [from, to]
        );
        const rateLimits = await deps.pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n
             FROM ai_usage_events
            WHERE status = 'rate_limited' AND DATE(created_at AT TIME ZONE 'UTC') BETWEEN $1 AND $2`,
          [from, to]
        );
        const total = byTask.rows.reduce((s, r) => s + Number.parseInt(r.n, 10), 0);
        res.json({
          data: {
            range: { from, to },
            total: { calls: total },
            rateLimited: Number.parseInt(rateLimits.rows[0].n, 10),
            byTask: byTask.rows.map((r) => ({
              task: r.task_type,
              count: Number.parseInt(r.n, 10),
              success: Number.parseInt(r.success, 10),
              failed: Number.parseInt(r.failed, 10),
              avgLatencyMs: r.avg_latency_ms ? Number.parseInt(r.avg_latency_ms, 10) : null,
              tokens: r.tokens ? Number.parseInt(r.tokens, 10) : null,
              caveat: 'Token counts only appear when the upstream provider reports them. `null` is the honest answer for free-tier Gemini.'
            })),
            internalLimits: {
              geminiRateLimitRpm: Number.parseInt(process.env.GEMINI_RATE_LIMIT_RPM ?? '0', 10) || null,
              geminiMaxConcurrent: Number.parseInt(process.env.GEMINI_MAX_CONCURRENT_REQUESTS ?? '0', 10) || null,
              geminiMaxRetries: Number.parseInt(process.env.GEMINI_MAX_RETRIES ?? '0', 10) || null,
              geminiRequestTimeoutMs: Number.parseInt(process.env.GEMINI_REQUEST_TIMEOUT_MS ?? '0', 10) || null,
              aiUserDailyLimit: Number.parseInt(process.env.AI_USER_DAILY_LIMIT ?? '0', 10) || null,
              caveat: 'These are the in-process rate limit knobs. They are NOT Google\'s actual project quotas. Do not treat them as authoritative remaining Google quota.'
            }
          }
        });
      } catch (e) {
        console.error('[admin/analytics] ai failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải phân tích AI' } });
      }
    }
  );

  // -------- system health -----------------------------------------------
  router.get(
    '/system',
    auth,
    requirePermission('admin.system.read'),
    async (_req: AuthedRequest, res: Response) => {
      let dbStatus: 'ok' | 'error' | 'unavailable' = 'ok';
      try {
        await deps.pool.query('SELECT 1');
      } catch {
        dbStatus = 'error';
      }
      try {
        const queue = await deps.pool.query<{
          pending: string;
          processing: string;
          failed: string;
          completed: string;
          oldest_pending_age: string | null;
        }>(
          `SELECT
              COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
              COUNT(*) FILTER (WHERE status = 'processing')::text AS processing,
              COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
              COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
              COALESCE(ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (WHERE status = 'pending')))), 0)::text AS oldest_pending_age
             FROM jobs`
        );
        const qRow = queue.rows[0];
        const pendingCount = Number.parseInt(qRow?.pending ?? '0', 10);
        const oldestAge = Number.parseInt(qRow?.oldest_pending_age ?? '0', 10);

        let aiStats = {
          total24h: 0,
          failed24h: 0,
          rateLimited24h: 0,
          failureRate: 0,
          avgLatencyMs: 0
        };
        try {
          const aiQuery = await deps.pool.query<{
            total: string;
            failed: string;
            rate_limited: string;
            avg_latency: string | null;
          }>(
            `SELECT
               COUNT(*)::text AS total,
               COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
               COUNT(*) FILTER (WHERE status = 'rate_limited')::text AS rate_limited,
               ROUND(AVG(latency_ms))::text AS avg_latency
             FROM ai_usage_events
             WHERE created_at >= NOW() - INTERVAL '24 hours'`
          );
          const aiRow = aiQuery.rows[0];
          const total = Number.parseInt(aiRow?.total ?? '0', 10);
          const failed = Number.parseInt(aiRow?.failed ?? '0', 10);
          const rateLimited = Number.parseInt(aiRow?.rate_limited ?? '0', 10);
          aiStats = {
            total24h: total,
            failed24h: failed,
            rateLimited24h: rateLimited,
            failureRate: total > 0 ? failed / total : 0,
            avgLatencyMs: Number.parseInt(aiRow?.avg_latency ?? '0', 10)
          };
        } catch {
          // Table may not exist yet in dev/test environment
        }

        const rawTimings = deps.getRequestTimings?.() ?? [];
        const timings = rawTimings.slice(0, 50);
        const durations = rawTimings.map((t: any) => typeof t === 'number' ? t : (t?.durationMs ?? t?.duration ?? 0)).sort((a: number, b: number) => a - b);
        const latencyPercentiles = {
          p50: durations.length > 0 ? durations[Math.floor(durations.length * 0.5)] : 0,
          p95: durations.length > 0 ? durations[Math.floor(durations.length * 0.95)] : 0,
          p99: durations.length > 0 ? durations[Math.floor(durations.length * 0.99)] : 0
        };

        let systemState: 'healthy' | 'degraded' | 'unavailable' = 'healthy';
        if (dbStatus !== 'ok') {
          systemState = 'unavailable';
        } else if (oldestAge > 600 || aiStats.failureRate > 0.2) {
          systemState = 'degraded';
        }

        res.json({
          data: {
            database: dbStatus,
            systemState,
            queue: {
              pending: pendingCount,
              processing: Number.parseInt(qRow?.processing ?? '0', 10),
              failed: Number.parseInt(qRow?.failed ?? '0', 10),
              completed: Number.parseInt(qRow?.completed ?? '0', 10),
              succeeded: Number.parseInt(qRow?.completed ?? '0', 10),
              oldestPendingAgeSeconds: oldestAge
            },
            ai: aiStats,
            latencyPercentiles,
            requestTimings: timings,
            uptimeSeconds: Math.floor(process.uptime())
          }
        });
      } catch (e) {
        console.error('[admin/analytics] system failed', e);
        res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Không thể tải tình trạng' } });
      }
    }
  );

  return router;
}
