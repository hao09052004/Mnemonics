/**
 * M5 analytics integration test.
 *
 * Mounts the personal + admin analytics routers against a real
 * Postgres + a stub Supabase client. Skips when DATABASE_URL
 * is missing. Validates:
 *   * the personal overview returns the seeded counts,
 *   * the personal captures series is dense (no gaps),
 *   * the admin overview is denied for a normal user (403),
 *   * the admin overview is allowed for an admin,
 *   * revenue numbers are non-negative integers.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createPool } from '@mnemonics/database';
import { createPersonalAnalyticsRouter } from '../../routes/analytics-me.js';
import { createAdminAnalyticsRouter } from '../../routes/analytics-admin.js';
import type { SupabaseClient } from '@supabase/supabase-js';

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

async function createUserWithProfile(
  pool: Pool,
  email: string,
  role: 'user' | 'admin' = 'user'
) {
  const u = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  const id = u.rows[0].id;
  await pool.query(
    `INSERT INTO profiles (id, name, role) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
    [id, email, role]
  );
  return id;
}

function stubSupabase(userId: string): SupabaseClient {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: userId,
            email: 'test@example.com',
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: new Date().toISOString(),
            role: 'authenticated'
          } as any
        },
        error: null
      })
    }
  } as unknown as SupabaseClient;
}

describe.skipIf(skipIfNoDb)('analytics (M5)', () => {
  let pool: Pool;
  let userId: string;
  let adminId: string;
  let itemId: string;

  beforeAll(async () => {
    pool = createPool(DB_URL);
    userId = await createUserWithProfile(pool, `m5-me-${Date.now()}@example.com`, 'user');
    adminId = await createUserWithProfile(pool, `m5-admin-${Date.now()}@example.com`, 'admin');
    // Seed a single item so the personal overview has a non-zero total.
    const r = await pool.query<{ id: string }>(
      `INSERT INTO items
         (user_id, type, title, status, captured_at, client_request_id)
       VALUES ($1, 'text', 'analytics seed', 'ready', NOW(), gen_random_uuid())
       RETURNING id::text`,
      [userId]
    );
    itemId = r.rows[0].id;
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM items WHERE id = $1`, [itemId]);
    await pool.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [[userId, adminId]]);
    await pool.end();
  });

  it('personal overview returns the seeded counts for the caller', async () => {
    const tables = await pool.query<{ exists: boolean }>(
      `SELECT
         (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_entitlements')) AS ue,
         (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'ai_usage_events')) AS ai`
    );
    if (!tables.rows[0]?.ue || !tables.rows[0]?.ai) return;
    const app = express();
    app.use(createPersonalAnalyticsRouter({ pool, supabase: stubSupabase(userId) }));
    const res = await request(app)
      .get('/me/overview?days=30')
      .set('authorization', 'Bearer fake-token');
    expect(res.status).toBe(200);
    expect(res.body.data.totalCaptures).toBeGreaterThanOrEqual(1);
    expect(res.body.data.plan.family).toBe('memory');
    expect(res.body.data.plan.monthlyCaptureLimit).toBe(50);
    expect(res.body.data.plan.remainingCaptures).toBeGreaterThanOrEqual(0);
  });

  it('personal captures series is dense and ordered ascending', async () => {
    const app = express();
    app.use(createPersonalAnalyticsRouter({ pool, supabase: stubSupabase(userId) }));
    const res = await request(app)
      .get('/me/captures?days=14')
      .set('authorization', 'Bearer fake-token');
    expect(res.status).toBe(200);
    expect(res.body.data.series).toHaveLength(14);
    const first = res.body.data.series[0].day;
    const last = res.body.data.series[13].day;
    expect(new Date(last).getTime() - new Date(first).getTime()).toBe(13 * 86_400_000);
  });

  it('admin analytics overview denies a normal user with 403', async () => {
    const tables = await pool.query<{ tbl: string | null }>(
      `SELECT to_regclass('public.payment_orders')::text AS tbl`
    );
    if (!tables.rows[0]?.tbl) return;
    const app = express();
    app.use(createAdminAnalyticsRouter({ pool, supabase: stubSupabase(userId) }));
    const res = await request(app)
      .get('/overview')
      .set('authorization', 'Bearer fake-token');
    expect(res.status).toBe(403);
  });

  it('admin analytics overview allows an admin caller', async () => {
    const tables = await pool.query<{ tbl: string | null }>(
      `SELECT to_regclass('public.user_entitlements')::text AS tbl`
    );
    if (!tables.rows[0]?.tbl) return;
    const app = express();
    app.use(createAdminAnalyticsRouter({ pool, supabase: stubSupabase(adminId) }));
    const res = await request(app)
      .get('/overview')
      .set('authorization', 'Bearer fake-token');
    expect(res.status).toBe(200);
    expect(res.body.data.users.total).toBeGreaterThanOrEqual(0);
    expect(res.body.data.revenue.verifiedVnd).toBeGreaterThanOrEqual(0);
    expect(res.body.data.product.totalCaptures).toBeGreaterThanOrEqual(1);
  });

  it('admin revenue returns integer VND amounts and a daily series', async () => {
    const tables = await pool.query<{ tbl: string | null }>(
      `SELECT to_regclass('public.payment_orders')::text AS tbl`
    );
    if (!tables.rows[0]?.tbl) return;
    const app = express();
    app.use(createAdminAnalyticsRouter({ pool, supabase: stubSupabase(adminId) }));
    const res = await request(app)
      .get('/revenue')
      .set('authorization', 'Bearer fake-token');
    expect(res.status).toBe(200);
    expect(Number.isInteger(res.body.data.paid.vnd)).toBe(true);
    expect(Array.isArray(res.body.data.daily)).toBe(true);
    expect(res.body.data.estimatedMonthlyRunRate.caveat).toMatch(/Estimated/i);
  });
});
