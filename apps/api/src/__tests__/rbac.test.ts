/**
 * RBAC unit tests.
 *
 * These tests run without a real Postgres. They mock the
 * `pg.Pool` and the `SupabaseClient` so the `requireAuth` and
 * `requirePermission` paths can be exercised in isolation.
 *
 * Goals:
 *  1. A normal user (role=user) cannot access an admin route.
 *  2. An admin (role=admin) can access the admin route.
 *  3. A forged `app_metadata.role = 'admin'` in the JWT does
 *     NOT bypass the check (the role is read from `profiles`).
 *  4. `requirePermission('admin.audit.read')` denies a user
 *     who has `admin.users.read` but not `admin.audit.read`.
 */
import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Pool } from 'pg';
import { requireAuth, requirePermission, getUserRole, getPermissionsForRole, resolveAuthContext } from '../rbac.js';

interface FakeUser {
  id: string;
  email: string;
  app_metadata: { role?: 'user' | 'admin' };
}

function makePool(
  profile: { id: string; role: 'user' | 'admin'; is_suspended?: boolean } | null,
  permissions: string[]
): Pool {
  // Tiny stand-in. `pg.Pool`'s public surface is `query(text, params)`.
  const pool = {
    query: vi.fn(async (text: string, params: unknown[]) => {
      if (/FROM\s+profiles\s+WHERE\s+id\s*=\s*\$1/i.test(text)) {
        if (!profile) return { rows: [], rowCount: 0 };
        return {
          rows: [{ role: profile.role, is_suspended: profile.is_suspended ?? false }],
          rowCount: 1
        };
      }
      if (/FROM\s+role_permissions\s+WHERE\s+role\s*=\s*\$1/i.test(text)) {
        return { rows: permissions.map((permission) => ({ permission })), rowCount: permissions.length };
      }
      // Not used by RBAC tests; return an empty result so unexpected
      // queries don't crash the suite.
      void params;
      return { rows: [], rowCount: 0 };
    })
  } as unknown as Pool;
  return pool;
}

function makeSupabase(user: FakeUser | null, error: { message: string } | null = null) {
  return {
    auth: {
      getUser: vi.fn(async (_token: string) => {
        if (error) return { data: { user: null }, error };
        if (!user) return { data: { user: null }, error: { message: 'invalid' } };
        return { data: { user: user as unknown as import('@supabase/supabase-js').User }, error: null };
      })
    }
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

function buildApp(opts: {
  pool: Pool;
  supabase: import('@supabase/supabase-js').SupabaseClient;
  perm: string;
}) {
  const app = express();
  app.get(
    '/protected',
    requireAuth({ pool: opts.pool, supabase: opts.supabase }),
    requirePermission(opts.perm),
    (_req, res) => res.json({ ok: true })
  );
  return app;
}

describe('rbac.getUserRole / getPermissionsForRole', () => {
  it('falls back to "user" when the profile row is missing', async () => {
    const pool = makePool(null, []);
    expect(await getUserRole(pool, 'no-such-user')).toBe('user');
  });

  it('returns "admin" when the profile row says admin', async () => {
    const pool = makePool({ id: 'u1', role: 'admin' }, ['admin.system.read']);
    expect(await getUserRole(pool, 'u1')).toBe('admin');
    expect(await getPermissionsForRole(pool, 'admin')).toEqual(new Set(['admin.system.read']));
  });

  it('resolveAuthContext returns role + permissions in one shot', async () => {
    const pool = makePool({ id: 'u2', role: 'user' }, ['dashboard.user.read']);
    const ctx = await resolveAuthContext(pool, 'u2');
    expect(ctx.role).toBe('user');
    expect(ctx.permissions.has('dashboard.user.read')).toBe(true);
    expect(ctx.permissions.has('admin.system.read')).toBe(false);
  });
});

describe('rbac middleware (mocked pool + supabase)', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const pool = makePool(null, []);
    const supabase = makeSupabase(null);
    const app = buildApp({ pool, supabase, perm: 'admin.analytics.read' });
    const res = await request(app).get('/protected');
    expect(res.status).toBe(401);
  });

  it('rejects an authenticated user without the permission with 403', async () => {
    const user: FakeUser = { id: '00000000-0000-4000-8000-000000000001', email: 'u@example.com', app_metadata: { role: 'user' } };
    const pool = makePool({ id: user.id, role: 'user' }, ['dashboard.user.read']);
    const supabase = makeSupabase(user);
    const app = buildApp({ pool, supabase, perm: 'admin.analytics.read' });
    const res = await request(app).get('/protected').set('authorization', 'Bearer fake-jwt');
    expect(res.status).toBe(403);
  });

  it('grants access to an admin who has the permission', async () => {
    const user: FakeUser = { id: '00000000-0000-4000-8000-000000000002', email: 'a@example.com', app_metadata: { role: 'admin' } };
    const pool = makePool({ id: user.id, role: 'admin' }, ['admin.analytics.read']);
    const supabase = makeSupabase(user);
    const app = buildApp({ pool, supabase, perm: 'admin.analytics.read' });
    const res = await request(app).get('/protected').set('authorization', 'Bearer fake-jwt');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('does NOT trust a forged app_metadata.role="admin" claim', async () => {
    // The JWT claims admin; the profile says user. The DB wins.
    const user: FakeUser = { id: '00000000-0000-4000-8000-000000000003', email: 'f@example.com', app_metadata: { role: 'admin' } };
    const pool = makePool({ id: user.id, role: 'user' }, ['dashboard.user.read']);
    const supabase = makeSupabase(user);
    const app = buildApp({ pool, supabase, perm: 'admin.analytics.read' });
    const res = await request(app).get('/protected').set('authorization', 'Bearer forged-jwt');
    expect(res.status).toBe(403);
  });

  it('an admin who lacks the specific permission is denied (least-privilege)', async () => {
    // The admin has *some* admin perms but not the requested one.
    const user: FakeUser = { id: '00000000-0000-4000-8000-000000000004', email: 'p@example.com', app_metadata: { role: 'admin' } };
    const pool = makePool({ id: user.id, role: 'admin' }, ['admin.users.read', 'admin.payments.read']);
    const supabase = makeSupabase(user);
    const app = buildApp({ pool, supabase, perm: 'admin.audit.read' });
    const res = await request(app).get('/protected').set('authorization', 'Bearer fake-jwt');
    expect(res.status).toBe(403);
  });

  it('rejects a suspended user with 403 ACCOUNT_SUSPENDED', async () => {
    const user: FakeUser = { id: '00000000-0000-4000-8000-000000000005', email: 'suspended@example.com', app_metadata: { role: 'user' } };
    const pool = makePool({ id: user.id, role: 'user', is_suspended: true }, ['dashboard.user.read']);
    const supabase = makeSupabase(user);
    const app = buildApp({ pool, supabase, perm: 'dashboard.user.read' });
    const res = await request(app).get('/protected').set('authorization', 'Bearer fake-jwt');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });

  it('rejects a suspended admin with 403 ACCOUNT_SUSPENDED', async () => {
    const user: FakeUser = { id: '00000000-0000-4000-8000-000000000006', email: 'admin-suspended@example.com', app_metadata: { role: 'admin' } };
    const pool = makePool({ id: user.id, role: 'admin', is_suspended: true }, ['admin.system.read']);
    const supabase = makeSupabase(user);
    const app = buildApp({ pool, supabase, perm: 'admin.system.read' });
    const res = await request(app).get('/protected').set('authorization', 'Bearer fake-jwt');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
  });
});
