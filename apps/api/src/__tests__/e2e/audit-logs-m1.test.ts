/**
 * M1 — Audit log router integration test.
 *
 * Requires a real Postgres (the rest of the e2e suite does).
 * Skipped automatically when DATABASE_URL is missing.
 *
 * The test:
 *  - Creates a user + profile (role = user).
 *  - Manually inserts a row into `role_audit_log` (simulating
 *    a bootstrap-admin action).
 *  - Mounts the audit-logs router with a stub Supabase client
 *    that always returns the user — the strict middleware
 *    must read the role from the database and DENY the
 *    user (403).
 *  - Then patches the profile role to `admin` and asserts the
 *    same request now succeeds and returns the seeded row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { createPool } from '@mnemonics/database';
import { createAuditLogsRouter } from '../../routes/audit-logs.js';
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

async function createUserWithProfile(pool: Pool, email: string, role: 'user' | 'admin' = 'user') {
  const u = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, raw_user_meta_data)
     VALUES (gen_random_uuid(), jsonb_build_object('email', $1::text))
     RETURNING id`,
    [email]
  );
  const id = u.rows[0].id;
  // profiles row is normally created by the `handle_new_user`
  // trigger; create it explicitly so the test does not depend on
  // the trigger's existence.
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

describe.skipIf(skipIfNoDb)('audit-logs router (M1 RBAC)', () => {
  let pool: Pool;
  let userId: string;
  let adminId: string;

  beforeAll(async () => {
    pool = createPool(DB_URL);
    userId = await createUserWithProfile(pool, `m1-rbac-user-${Date.now()}@example.com`, 'user');
    adminId = await createUserWithProfile(pool, `m1-rbac-admin-${Date.now()}@example.com`, 'admin');
    // Seed an audit row attributed to the system bootstrap.
    await pool.query(
      `INSERT INTO role_audit_log (actor_user_id, target_user_id, old_role, new_role, reason)
       VALUES (NULL, $1, 'user', 'admin', 'integration-test seed')`,
      [adminId]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [[userId, adminId]]);
    await pool.end();
  });

  it('denies a non-admin caller with 403', async () => {
    const app = express();
    app.use(createAuditLogsRouter({ pool, supabase: stubSupabase(userId) }));
    const res = await request(app)
      .get('/?limit=10')
      .set('authorization', 'Bearer fake-token');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('returns the seeded audit row for an admin caller', async () => {
    const app = express();
    app.use(createAuditLogsRouter({ pool, supabase: stubSupabase(adminId) }));
    const res = await request(app)
      .get('/?limit=10')
      .set('authorization', 'Bearer fake-token');
    expect(res.status).toBe(200);
    expect(res.body.data.limit).toBe(10);
    const found = res.body.data.items.find((it: any) => it.target_user_id === adminId);
    expect(found).toBeTruthy();
    expect(found.new_role).toBe('admin');
    expect(found.old_role).toBe('user');
    expect(found.reason).toBe('integration-test seed');
  });

  it('a forged app_metadata.role=admin does not bypass the check', async () => {
    // Stub claims the user is admin in the JWT, but profiles
    // says user. The DB wins.
    const forgedSupabase = {
      auth: {
        getUser: async () => ({
          data: {
            user: {
              id: userId,
              email: 'forged@example.com',
              app_metadata: { role: 'admin' },
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
    const app = express();
    app.use(createAuditLogsRouter({ pool, supabase: forgedSupabase }));
    const res = await request(app)
      .get('/')
      .set('authorization', 'Bearer forged-token');
    expect(res.status).toBe(403);
  });
});
