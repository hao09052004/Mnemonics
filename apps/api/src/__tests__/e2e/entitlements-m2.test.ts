/**
 * Entitlements integration tests (M2).
 *
 * Requires a real Postgres. Skipped automatically when
 * DATABASE_URL is missing.
 *
 * Coverage:
 *   * `subscription_plans` is seeded with memory / mastery-monthly / mastery-yearly.
 *   * A new user gets the `memory` entitlement by default.
 *   * `enforce_capture_limit` allows ≤50 captures in a month
 *     and rejects the 51st.
 *   * `applyEntitlement` upgrades the user to mastery and
 *     removes the capture cap.
 *   * Mastery `semanticSearchEnabled` is true; memory is false.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { createPool } from '@mnemonics/database';
import {
  getEntitlement,
  listPlans,
  applyEntitlement,
  enforceCaptureLimit,
  CaptureLimitReached,
  MASTERY_MONTHLY_PLAN_ID,
  MEMORY_PLAN_ID
} from '../../entitlements.js';

function loadDotEnv(): void {
  try {
    const text = readFileSync(join(process.cwd(), '.env'), 'utf-8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {/* ignore */}
}
loadDotEnv();

const DB_URL = process.env.DATABASE_URL ?? '';
const skipIfNoDb = !DB_URL;

async function createUser(pool: Pool, email: string) {
  const u = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  return u.rows[0].id;
}

describe.skipIf(skipIfNoDb)('entitlements (M2 pricing)', () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    pool = createPool(DB_URL);
    userId = await createUser(pool, `m2-ent-${Date.now()}@example.com`);
  });

  afterAll(async () => {
    if (!pool) return;
    // Wipe test artifacts in dependency order.
    await pool.query(`DELETE FROM items WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_subscriptions WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM user_entitlements WHERE user_id = $1`, [userId]);
    await pool.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);
    await pool.end();
  });

  it('seeds memory + mastery plans with the documented VND amounts', async () => {
    const plans = await listPlans(pool);
    const ids = plans.map((p) => p.id);
    expect(ids).toContain('memory');
    expect(ids).toContain('mastery-monthly');
    expect(ids).toContain('mastery-yearly');
    const monthly = plans.find((p) => p.id === 'mastery-monthly')!;
    const yearly = plans.find((p) => p.id === 'mastery-yearly')!;
    expect(monthly.amountVnd).toBe(29_000);
    expect(yearly.amountVnd).toBe(249_000);
    const memory = plans.find((p) => p.id === 'memory')!;
    expect(memory.monthlyCaptureLimit).toBe(50);
    expect(memory.semanticSearchEnabled).toBe(false);
    expect(monthly.monthlyCaptureLimit).toBeNull();
    expect(monthly.semanticSearchEnabled).toBe(true);
  });

  it('a new user starts on the memory plan with no semantic search', async () => {
    const ent = await getEntitlement(pool, userId);
    expect(ent.planId).toBe('memory');
    expect(ent.family).toBe('memory');
    expect(ent.semanticSearchEnabled).toBe(false);
    expect(ent.monthlyCaptureLimit).toBe(50);
  });

  it('allows up to 50 captures in a calendar month and rejects the 51st', async () => {
    // Seed 49 items (we already have 0 at this point because
    // the table is wiped in afterAll). The 50th capture is
    // the boundary; the 51st is rejected.
    for (let i = 0; i < 49; i++) {
      await pool.query(
        `INSERT INTO items (user_id, type, title, client_request_id, status, captured_at)
         VALUES ($1, 'text', $2, $3, 'ready', NOW())`,
        [userId, `bulk-${i}`, crypto.randomUUID()]
      );
    }
    // 49 → 50: allowed
    const client = await pool.connect();
    try {
      await enforceCaptureLimit(client, userId);
      await client.query(
        `INSERT INTO items (user_id, type, title, client_request_id, status, captured_at)
         VALUES ($1, 'text', 'fiftieth', $2, 'ready', NOW())`,
        [userId, crypto.randomUUID()]
      );
    } finally {
      client.release();
    }
    // 50 → 51: rejected
    const c2 = await pool.connect();
    let caught: unknown = null;
    try {
      await enforceCaptureLimit(c2, userId);
    } catch (e) {
      caught = e;
    } finally {
      c2.release();
    }
    expect(caught).toBeInstanceOf(CaptureLimitReached);
    expect((caught as CaptureLimitReached).limit).toBe(50);
    expect((caught as CaptureLimitReached).used).toBe(50);
  });

  it('upgrading to mastery removes the capture cap', async () => {
    await applyEntitlement(pool, {
      userId,
      planId: MASTERY_MONTHLY_PLAN_ID,
      validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      source: 'admin_adjust',
      note: 'integration-test upgrade'
    });
    const ent = await getEntitlement(pool, userId);
    expect(ent.planId).toBe(MASTERY_MONTHLY_PLAN_ID);
    expect(ent.family).toBe('mastery');
    expect(ent.semanticSearchEnabled).toBe(true);
    expect(ent.monthlyCaptureLimit).toBeNull();

    // The cap is gone — even with 50+ items, a new capture is allowed.
    const client = await pool.connect();
    try {
      await enforceCaptureLimit(client, userId);
    } finally {
      client.release();
    }
  });

  it('reverting to memory closes the active subscription and re-arms the cap', async () => {
    await applyEntitlement(pool, {
      userId,
      planId: MEMORY_PLAN_ID,
      validUntil: null,
      source: 'admin_adjust',
      note: 'revert to memory'
    });
    const ent = await getEntitlement(pool, userId);
    expect(ent.planId).toBe(MEMORY_PLAN_ID);
    expect(ent.family).toBe('memory');
    expect(ent.semanticSearchEnabled).toBe(false);
    expect(ent.monthlyCaptureLimit).toBe(50);
  });
});
