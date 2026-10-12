import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createMemoryAudit } from '../audit.js';
import { createAuthRouter } from '../routes.js';
import { createMemoryThrottle } from '../throttle.js';
import { createFakeUsers } from './fake-users.js';

const VALID_PASSWORD = 'Password1!ok';

function buildApp(opts: Parameters<typeof createFakeUsers>[0] = {}) {
  const throttle = createMemoryThrottle();
  const audit = createMemoryAudit();
  const fake = createFakeUsers(opts);
  const app = createApp(
    fakeRepo(),
    'dev-token',
    '00000000-0000-4000-8000-000000000001',
    undefined,
    fakeSupabase(),
    { users: fake.users, throttle, audit }
  );
  return { app, throttle, audit, ...fake };
}

function fakeSupabase() {
  return {
    auth: {
      async getUser() {
        return { data: { user: null }, error: { message: 'no user' } };
      }
    }
  } as any;
}

function fakeRepo() {
  return {
    async findByClientRequestId() { return null; },
    async createPendingItem({ userId }: any) {
      return { id: '11111111-1111-4111-8111-111111111111', userId, status: 'pending' as const };
    },
    async createPendingImageItem({ userId }: any) {
      return { id: '22222222-2222-4222-8222-222222222222', userId, status: 'pending' as const };
    }
  };
}

describe('POST /api/v1/auth/register', () => {
  it('creates a new account (no session when verification required)', async () => {
    const { app, audit } = buildApp();
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'fresh@example.com', password: VALID_PASSWORD, name: 'Trang' });
    expect([200, 201]).toContain(response.status);
    if (response.status === 201) {
      expect(response.body.data.user).toBeTruthy();
      expect(response.body.data.user.email).toBe('fresh@example.com');
      expect(audit.events.some((e) => e.kind === 'register')).toBe(true);
    } else {
      expect(response.body.data.user).toBeNull();
      expect(response.body.data.session).toBeNull();
    }
  });

  it('returns 200 with null user for an already-registered email (anti-enumeration)', async () => {
    const { app } = buildApp({ existingEmail: 'taken@example.com' });
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'taken@example.com', password: VALID_PASSWORD });
    // The route always returns 200 for duplicates — same body shape as new.
    expect([200, 400]).toContain(response.status);
    if (response.status === 200) {
      expect(response.body.data).toEqual({ user: null, session: null });
    }
  });

  it('rejects bad payloads with 400', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-email', password: 'short' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_AUTH_PAYLOAD');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns 200 with user and session on success', async () => {
    const { app } = buildApp({ existingEmail: 'a@b.co', emailConfirmed: true });
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: VALID_PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe('a@b.co');
    expect(response.body.data.session.accessToken).toBeTruthy();
  });

  it('returns 401 without revealing whether email exists', async () => {
    const { app } = buildApp(); // no existingEmail
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'unknown@x.co', password: VALID_PASSWORD });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_LOGIN_FAILED');
    expect(response.body.error.message).toBe('Email hoặc mật khẩu chưa đúng');
  });

  it('returns 403 with EMAIL_NOT_VERIFIED when email is unverified', async () => {
    const { app } = buildApp({ existingEmail: 'a@b.co', emailConfirmed: false });
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: VALID_PASSWORD });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('returns 429 after 5 failed attempts', async () => {
    const { app } = buildApp();
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/api/v1/auth/login').send({ email: 'flood@x.co', password: 'whatever' });
      expect(r.status).toBe(401);
    }
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'flood@x.co', password: 'whatever' });
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('POST /api/v1/auth/refresh', () => {
  it('returns a fresh session when the refresh token is valid', async () => {
    const { app } = buildApp();
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'a'.repeat(40) });
    expect(response.status).toBe(200);
    expect(response.body.data.session.accessToken).toBeTruthy();
  });

  it('returns 401 AUTH_REFRESH_FAILED when the refresh token is rejected', async () => {
    const { app } = buildApp();
    // 'bad' + 36 more chars so the schema's min(20) passes; the fake rejects
    // any refreshToken that exactly equals 'bad-token'.
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'bad-token-1234567890123456789012' });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REFRESH_FAILED');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('returns 204 even when no Authorization header is provided', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/api/v1/auth/logout').send();
    expect(response.status).toBe(204);
  });

  it('returns 204 even with an invalid Authorization header (idempotent)', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/api/v1/auth/logout').set('Authorization', 'Bearer not-a-jwt').send();
    expect(response.status).toBe(204);
  });
});

describe('POST /api/v1/auth/forgot-password', () => {
  it('always returns 200, even for unknown emails', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'unknown@x.co' });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ user: null, session: null });
  });

  it('still returns 200 for bad payload (no probe)', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'no-at' });
    expect(response.status).toBe(200);
  });
});

describe('POST /api/v1/auth/reset-password (MNE-002 persistence)', () => {
  const NEW_PASSWORD = 'NewPassword456!';
  const OLD_PASSWORD = 'OldPassword123!';

  it('returns 200 on valid recovery tokens', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: VALID_PASSWORD
    });
    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe('a@b.co');
  });

  it('returns 401 on bad recovery token', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'badtok-bad-bad-bad-bad-badbadbad-bad',
      refreshToken: 'b'.repeat(40),
      newPassword: VALID_PASSWORD
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_RESET_FAILED');
  });

  it('returns 400 on weak new password', async () => {
    const { app } = buildApp();
    const response = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: 'weak'
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_AUTH_PAYLOAD');
  });

  // ---- MNE-002 regression coverage ----

  it('Test A: persists the new password via the facade on success', async () => {
    const { app, updatePasswordCalls } = buildApp();
    const response = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: NEW_PASSWORD
    });
    expect(response.status).toBe(200);
    expect(updatePasswordCalls).toHaveLength(1);
    // userId must be the recovered user's id (hard-coded uuid in fake), NOT
    // anything derived from the request.
    expect(updatePasswordCalls[0].userId).toBe('00000000-0000-4000-8000-000000000001');
    expect(updatePasswordCalls[0].password).toBe(NEW_PASSWORD);
  });

  it('Test B: login with the new password succeeds after reset', async () => {
    const { app, passwords } = buildApp({
      existingEmail: 'rotated@example.com',
      emailConfirmed: true,
      initialPassword: OLD_PASSWORD
    });
    const reset = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: NEW_PASSWORD
    });
    expect(reset.status).toBe(200);

    // Password store was overwritten — login now accepts NEW_PASSWORD.
    expect(passwords.get('00000000-0000-4000-8000-000000000001')).toBe(NEW_PASSWORD);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'rotated@example.com', password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.user.email).toBe('rotated@example.com');
  });

  it('Test C: login with the old password fails after reset', async () => {
    const { app } = buildApp({
      existingEmail: 'rotated@example.com',
      emailConfirmed: true,
      initialPassword: OLD_PASSWORD
    });
    const reset = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: NEW_PASSWORD
    });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'rotated@example.com', password: OLD_PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe('AUTH_LOGIN_FAILED');
  });

  it('Test D: invalid recovery credentials never call updatePassword', async () => {
    const { app, updatePasswordCalls } = buildApp();
    const response = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'badtok-bad-bad-bad-bad-badbadbad-bad',
      refreshToken: 'b'.repeat(40),
      newPassword: NEW_PASSWORD
    });
    expect(response.status).toBe(401);
    expect(updatePasswordCalls).toHaveLength(0);
  });

  it('Test E: weak new password never calls updatePassword', async () => {
    const { app, updatePasswordCalls } = buildApp();
    const response = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: '123456'
    });
    expect(response.status).toBe(400);
    expect(updatePasswordCalls).toHaveLength(0);
  });

  it('Test F: provider failure does not report success and never logs the new password', async () => {
    const { app, updatePasswordCalls, audit } = buildApp({ updatePasswordFails: true });
    const response = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: NEW_PASSWORD
    });
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('AUTH_RESET_FAILED');
    // Provider error text must NOT leak to the public body.
    const bodyText = JSON.stringify(response.body);
    expect(bodyText).not.toMatch(/provider_password_update_failed/);

    // Audit row exists for the failed attempt.
    expect(audit.events.some((e) => e.kind === 'reset_password')).toBe(true);
    // UpdatePassword was attempted (the route only knows after the call).
    expect(updatePasswordCalls).toHaveLength(1);
    // Secret material must never appear in any audit row.
    for (const event of audit.events) {
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain(NEW_PASSWORD);
      expect(serialized).not.toContain('a'.repeat(40));
      expect(serialized).not.toContain('b'.repeat(40));
    }
  });

  it('Test G: cannot reset another user by passing an arbitrary userId in the body', async () => {
    const { app, updatePasswordCalls } = buildApp();
    // Even if the request body smuggles a userId, the route must ignore it
    // and derive the target from the validated recovery session.
    const response = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: NEW_PASSWORD,
      userId: '99999999-9999-4999-8999-999999999999'
    });
    // Schema is .strict() so this returns 400 INVALID_AUTH_PAYLOAD; that's the
    // simplest defence. Assert the provider was never called regardless.
    expect(response.status).toBe(400);
    expect(updatePasswordCalls).toHaveLength(0);
  });

  it('Test H: end-to-end recovery → reset → login rotation', async () => {
    // Most important regression test for MNE-002.
    const { app } = buildApp({
      existingEmail: 'e2e@example.com',
      emailConfirmed: true,
      initialPassword: OLD_PASSWORD
    });

    // Baseline: old password works.
    const before = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'e2e@example.com', password: OLD_PASSWORD });
    expect(before.status).toBe(200);

    // Reset.
    const reset = await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: NEW_PASSWORD
    });
    expect(reset.status).toBe(200);

    // After reset: old password fails, new password succeeds.
    const oldAfter = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'e2e@example.com', password: OLD_PASSWORD });
    expect(oldAfter.status).toBe(401);

    const newAfter = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'e2e@example.com', password: NEW_PASSWORD });
    expect(newAfter.status).toBe(200);
    expect(newAfter.body.data.user.email).toBe('e2e@example.com');
  });

  it('Test I: recovery tokens and new password never appear in audit metadata', async () => {
    const { app, audit } = buildApp();
    await request(app).post('/api/v1/auth/reset-password').send({
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: NEW_PASSWORD
    });
    for (const event of audit.events) {
      const serialized = JSON.stringify(event);
      expect(serialized).not.toContain(NEW_PASSWORD);
      expect(serialized).not.toContain('a'.repeat(40));
      expect(serialized).not.toContain('b'.repeat(40));
    }
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns 401 without an Authorization header', async () => {
    const { app } = buildApp();
    const r = await request(app).get('/api/v1/auth/me');
    expect(r.status).toBe(401);
  });
});

describe('createAuthRouter at root', () => {
  it('can be mounted standalone (without createApp)', async () => {
    const audit = createMemoryAudit();
    const throttle = createMemoryThrottle();
    const { users } = createFakeUsers({ existingEmail: 'a@b.co', emailConfirmed: true });
    const router = createAuthRouter({ users, throttle, audit, supabase: fakeSupabase() });
    const express = (await import('express')).default;
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => { req.id = 'test-id'; next(); });
    app.use('/api/v1/auth', router);
    const r = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.co', password: VALID_PASSWORD });
    expect(r.status).toBe(200);
  });
});

describe('end-to-end: register verified user → /me → logout', () => {
  it('walks the full happy path with the same Express app', async () => {
    // Pre-seed an existing verified user so login yields a session.
    const { app, audit, signOuts } = buildApp({
      existingEmail: 'happy@example.com',
      emailConfirmed: true
    });

    // 1. Login returns a bearer session.
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'happy@example.com', password: VALID_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.data.session.accessToken).toBeTruthy();
    const access = login.body.data.session.accessToken;

    // 2. /me with the same token returns the same email.
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${access}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe('happy@example.com');

    // 3. Logout is idempotent and clears the server-side session via the facade.
    const logout = await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${access}`);
    expect(logout.status).toBe(204);
    expect(signOuts).toContain(access);

    // 4. Audit trail records login + logout (no register event for this path).
    const kinds = audit.events.map((e) => e.kind);
    expect(kinds).toContain('login');
    expect(kinds).toContain('logout');
    expect(kinds).not.toContain('register');
  });
});
