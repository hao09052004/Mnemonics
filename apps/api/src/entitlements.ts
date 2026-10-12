/**
 * Entitlements — the read-side projection that powers:
 *   * the Memory 50/month cap,
 *   * the Mastery "semantic search" gate,
 *   * the pricing UI ("current plan"),
 *   * the admin dashboard's plan breakdown.
 *
 * The `user_entitlements` table is the source of truth for
 * "what can this user do right now". It is kept in sync with
 * `user_subscriptions` by `applyEntitlement` (called by the
 * payment webhook, the admin reconciliation flow, and the
 * bootstrap script).
 *
 * The role admin does NOT bypass billing rules. The 50/month
 * cap and the semantic search gate both read from this
 * module; an admin on the `memory` plan still has the cap
 * and still cannot use semantic search.
 */
import type { Pool, PoolClient } from 'pg';

export type PlanFamily = 'memory' | 'mastery';
export type PlanId = 'memory' | 'mastery-monthly' | 'mastery-yearly';

export interface Entitlement {
  userId: string;
  planId: PlanId;
  family: PlanFamily;
  validUntil: Date | null;
  semanticSearchEnabled: boolean;
  monthlyCaptureLimit: number | null; // null = unlimited
}

export interface Plan {
  id: PlanId;
  displayName: string;
  family: PlanFamily;
  interval: 'forever' | 'month' | 'year';
  amountVnd: number;
  monthlyCaptureLimit: number | null;
  semanticSearchEnabled: boolean;
  isActive: boolean;
}

interface EntitlementRow {
  user_id: string;
  plan_id: PlanId;
  family: PlanFamily;
  valid_until: Date | null;
  semantic_search_enabled: boolean;
  monthly_capture_limit: number | null;
}

interface PlanRow {
  id: PlanId;
  display_name: string;
  family: PlanFamily;
  interval: 'forever' | 'month' | 'year';
  amount_vnd: string;          // BIGINT comes back as string from pg
  monthly_capture_limit: number | null;
  semantic_search_enabled: boolean;
  is_active: boolean;
}

export const MEMORY_PLAN_ID: PlanId = 'memory';
export const MASTERY_MONTHLY_PLAN_ID: PlanId = 'mastery-monthly';
export const MASTERY_YEARLY_PLAN_ID: PlanId = 'mastery-yearly';

const DEFAULT_MEMORY: Entitlement = {
  userId: '',
  planId: MEMORY_PLAN_ID,
  family: 'memory',
  validUntil: null,
  semanticSearchEnabled: false,
  monthlyCaptureLimit: 50
};

/** Read the live entitlement for a user. Defaults to memory. */
export async function getEntitlement(
  pool: Pool,
  userId: string
): Promise<Entitlement> {
  const r = await pool.query<EntitlementRow>(
    `SELECT user_id::text, plan_id, family, valid_until,
            semantic_search_enabled, monthly_capture_limit
       FROM user_entitlements
      WHERE user_id = $1`,
    [userId]
  );
  if (!r.rowCount) {
    return { ...DEFAULT_MEMORY, userId };
  }
  return mapEntitlement(r.rows[0]);
}

function mapEntitlement(row: EntitlementRow): Entitlement {
  return {
    userId: row.user_id,
    planId: row.plan_id,
    family: row.family,
    validUntil: row.valid_until ? new Date(row.valid_until) : null,
    semanticSearchEnabled: row.semantic_search_enabled,
    monthlyCaptureLimit: row.monthly_capture_limit
  };
}

export async function listPlans(pool: Pool): Promise<Plan[]> {
  const r = await pool.query<PlanRow>(
    `SELECT id, display_name, family, interval,
            amount_vnd::text AS amount_vnd,
            monthly_capture_limit, semantic_search_enabled, is_active
       FROM subscription_plans
      WHERE is_active = TRUE
      ORDER BY amount_vnd ASC`
  );
  return r.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    family: row.family,
    interval: row.interval,
    amountVnd: Number.parseInt(row.amount_vnd, 10),
    monthlyCaptureLimit: row.monthly_capture_limit,
    semanticSearchEnabled: row.semantic_search_enabled,
    isActive: row.is_active
  }));
}

export async function getPlan(pool: Pool, planId: PlanId): Promise<Plan | null> {
  const r = await pool.query<PlanRow>(
    `SELECT id, display_name, family, interval,
            amount_vnd::text AS amount_vnd,
            monthly_capture_limit, semantic_search_enabled, is_active
       FROM subscription_plans WHERE id = $1`,
    [planId]
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    displayName: row.display_name,
    family: row.family,
    interval: row.interval,
    amountVnd: Number.parseInt(row.amount_vnd, 10),
    monthlyCaptureLimit: row.monthly_capture_limit,
    semanticSearchEnabled: row.semantic_search_enabled,
    isActive: row.is_active
  };
}

/**
 * Apply an entitlement to a user. Used by the payment webhook
 * (M3), the admin reconciliation flow (M4), and the bootstrap
 * script. Closes the previous `active` row, inserts a new
 * `active` row in `user_subscriptions`, and refreshes the
 * `user_entitlements` projection.
 *
 * If `validUntil` is null, the entitlement never expires
 * (memory plan).
 */
export async function applyEntitlement(
  pool: Pool,
  args: {
    userId: string;
    planId: PlanId;
    validUntil: Date | null;
    source: 'payment' | 'admin_adjust' | 'bootstrap' | 'system';
    note?: string;
  }
): Promise<Entitlement> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const plan = await fetchPlanForUpdate(client, args.planId);
    if (!plan) {
      throw new Error(`Unknown plan: ${args.planId}`);
    }
    // Close any active subscription.
    await client.query(
      `UPDATE user_subscriptions
          SET status = 'expired', updated_at = NOW()
        WHERE user_id = $1 AND status = 'active'`,
      [args.userId]
    );
    // Insert the new active subscription.
    await client.query(
      `INSERT INTO user_subscriptions
         (user_id, plan_id, status, period_start, period_end, source, note)
       VALUES ($1, $2, 'active', NOW(), $3, $4, $5)`,
      [args.userId, plan.id, args.validUntil, args.source, args.note ?? null]
    );
    // Refresh the projection.
    await client.query(
      `INSERT INTO user_entitlements
         (user_id, plan_id, family, valid_until, semantic_search_enabled, monthly_capture_limit, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET plan_id = EXCLUDED.plan_id,
             family = EXCLUDED.family,
             valid_until = EXCLUDED.valid_until,
             semantic_search_enabled = EXCLUDED.semantic_search_enabled,
             monthly_capture_limit = EXCLUDED.monthly_capture_limit,
             updated_at = NOW()`,
      [
        args.userId,
        plan.id,
        plan.family,
        args.validUntil,
        plan.semanticSearchEnabled,
        plan.monthlyCaptureLimit
      ]
    );
    await client.query('COMMIT');
    return {
      userId: args.userId,
      planId: plan.id,
      family: plan.family,
      validUntil: args.validUntil,
      semanticSearchEnabled: plan.semanticSearchEnabled,
      monthlyCaptureLimit: plan.monthlyCaptureLimit
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function fetchPlanForUpdate(client: PoolClient, planId: PlanId): Promise<Plan | null> {
  const r = await client.query<PlanRow>(
    `SELECT id, display_name, family, interval,
            amount_vnd::text AS amount_vnd,
            monthly_capture_limit, semantic_search_enabled, is_active
       FROM subscription_plans WHERE id = $1 FOR SHARE`,
    [planId]
  );
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    displayName: row.display_name,
    family: row.family,
    interval: row.interval,
    amountVnd: Number.parseInt(row.amount_vnd, 10),
    monthlyCaptureLimit: row.monthly_capture_limit,
    semanticSearchEnabled: row.semantic_search_enabled,
    isActive: row.is_active
  };
}

/**
 * Throw `CaptureLimitReached` when the user is on the `memory`
 * plan and has used the month's quota. Mastery has no cap
 * (`monthly_capture_limit = NULL`).
 *
 * Must be called inside the same transaction that inserts the
 * new item so the count and the insert are atomic.
 */
export class CaptureLimitReached extends Error {
  readonly code = 'CAPTURE_LIMIT_REACHED';
  readonly used: number;
  readonly limit: number;
  constructor(used: number, limit: number) {
    super(`Capture limit reached: used ${used} of ${limit} this month`);
    this.used = used;
    this.limit = limit;
  }
}

export async function enforceCaptureLimit(
  client: PoolClient,
  userId: string
): Promise<void> {
  try {
    await client.query('SELECT enforce_capture_limit($1)', [userId]);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes('CAPTURE_LIMIT_REACHED')) {
      // Re-fetch the count for the error payload.
      const v = await client.query<{ count: string; limit: number | null }>(
        `SELECT (SELECT count(*) FROM items WHERE user_id = $1
                   AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::text AS count,
                (SELECT monthly_capture_limit FROM user_entitlements WHERE user_id = $1) AS limit`,
        [userId]
      );
      const used = Number.parseInt(v.rows[0]?.count ?? '0', 10);
      const limit = v.rows[0]?.limit ?? 50;
      throw new CaptureLimitReached(used, limit);
    }
    throw e;
  }
}
