import { describe, expect, it } from 'vitest';
import { createMemoryAudit } from '../audit.js';
import { createMemoryThrottle } from '../throttle.js';
import { createSupabaseUsers } from '../supabase-users.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Audit } from '../audit.js';
import type { Throttle } from '../throttle.js';
import type { SupabaseUsersFacade } from '../supabase-users.js';
import request from 'supertest';
import { createApp } from '../../app.js';
import express from 'express';
import { createAuthRouter } from '../routes.js';

function fakeSupabase() {
  return {
    auth: {
      async getUser() { return { data: { user: null }, error: { message: 'no user' } }; }
    }
  } as any;
}

function fakeRepo() {
  return {
    async findByClientRequestId() { return null; },
    async createPendingItem() { return { id: 'fake-id', userId: 'u', status: 'pending' as const }; },
    async createPendingImageItem() { return { id: 'fake-img', userId: 'u', status: 'pending' as const }; }
  };
}

describe('createMemoryAudit', () => {
  it('collects events in memory', async () => {
    const audit = createMemoryAudit();
    await audit.record({ kind: 'login', email: 'a@b.co' });
    await audit.record({ kind: 'logout' });
    expect(audit.events).toHaveLength(2);
    expect(audit.events[0].kind).toBe('login');
    expect(audit.events[1].kind).toBe('logout');
  });
});

describe('createMemoryThrottle', () => {
  it('reports unlocked for a fresh email', async () => {
    const t = createMemoryThrottle();
    const r = await t.check('fresh@x.co');
    expect(r.locked).toBe(false);
    expect(r.retryAfterSeconds).toBe(0);
  });

  it('locks after 5 attempts within the window', async () => {
    const t = createMemoryThrottle();
    for (let i = 0; i < 4; i++) {
      const r = await t.recordFailure('foo@x.co');
      expect(r.locked).toBe(false);
    }
    const fifth = await t.recordFailure('foo@x.co');
    expect(fifth.locked).toBe(true);
    expect(fifth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('check() reports the existing lock', async () => {
    const t = createMemoryThrottle();
    for (let i = 0; i < 5; i++) await t.recordFailure('bar@x.co');
    const r = await t.check('bar@x.co');
    expect(r.locked).toBe(true);
  });

  it('reset() clears the lock', async () => {
    const t = createMemoryThrottle();
    for (let i = 0; i < 5; i++) await t.recordFailure('baz@x.co');
    await t.reset('baz@x.co');
    const r = await t.check('baz@x.co');
    expect(r.locked).toBe(false);
  });
});

// Direct wiring: mount the router with a fake supabase, real in-memory
// throttle + audit, and ensure the router's envelope shape matches the spec.
describe('router + memory deps integration', () => {
  function buildRouter() {
    const audit: Audit = createMemoryAudit();
    const throttle: Throttle = createMemoryThrottle();
    const calls: Array<{ method: string; args: any }> = [];
    const users: SupabaseUsersFacade = {
      async signUp(input: any) {
        calls.push({ method: 'signUp', args: input });
        return { data: { user: null, session: null }, error: { message: 'already registered' } };
      },
      async signIn(input: any) {
        calls.push({ method: 'signIn', args: input });
        return { data: { user: null, session: null }, error: { message: 'bad' } };
      },
      async refresh(input: any) {
        calls.push({ method: 'refresh', args: input });
        return { data: { user: null, session: null }, error: { message: 'bad' } };
      },
      async signOut() { return { error: null }; },
      async resendVerification() { return { error: null }; },
      async me() { return { data: { user: null, session: null }, error: null }; },
      async generateRecoveryLink() { return { data: null, error: null }; }
    };
    const router = createAuthRouter({ users, throttle, audit, supabase: fakeSupabase() });
    return { router, audit, calls };
  }

  it('passes signOut call (no token) without throwing', async () => {
    const { router, audit } = buildRouter();
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.id = 'req-id'; next(); });
    app.use('/api/v1/auth', router);

    const r = await request(app).post('/api/v1/auth/logout').send();
    expect(r.status).toBe(204);
    expect(audit.events.find((e) => e.kind === 'logout')).toBeTruthy();
  });

  it('returns the right envelope when signUp reports a duplicate', async () => {
    const { router, audit } = buildRouter();
    const app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => { req.id = 'req-id'; next(); });
    app.use('/api/v1/auth', router);
    const r = await request(app).post('/api/v1/auth/register').send({
      email: 'taken@x.co', password: 'Password1!ok', name: 'X'
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ user: null, session: null });
    expect(audit.events.find((e) => e.kind === 'register_duplicate_email')).toBeTruthy();
  });
});

// Drive the same router with the REAL createSupabaseUsers (using a fake
// supabase-like object as the client). This pulls routes.ts into the
// happy-path branch through signIn success.
describe('createApp + createSupabaseUsers', () => {
  it('happy-path login returns 200 with envelope', async () => {
    const fakeUser = {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'a@b.co',
      email_confirmed_at: '2026-09-19T00:00:00Z',
      phone: '',
      confirmed_at: '2026-09-19T00:00:00Z',
      last_sign_in_at: '2026-09-19T00:00:00Z',
      app_metadata: {},
      user_metadata: { name: 'Tester' },
      identities: [],
      factors: null,
      created_at: '2026-09-19T00:00:00Z',
      updated_at: '2026-09-19T00:00:00Z'
    } as any;
    const client = {
      auth: {
        signInWithPassword: async () => ({ data: { user: fakeUser, session: { access_token: 'at', refresh_token: 'rt', expires_at: 1, expires_in: 1, token_type: 'bearer', user: fakeUser } }, error: null })
      }
    } as unknown as SupabaseClient;
    const users = createSupabaseUsers(client);
    const throttle = createMemoryThrottle();
    const audit = createMemoryAudit();
    const app = createApp(fakeRepo(), 'dev-token', 'fake-uid', undefined, client as any, { users, throttle, audit });
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'Password1!ok' });
    expect(r.status).toBe(200);
    expect(r.body.data.user.email).toBe('a@b.co');
    expect(r.body.data.session.accessToken).toBe('at');
  });
});
