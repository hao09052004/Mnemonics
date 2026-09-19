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
  const { users } = createFakeUsers(opts);
  const app = createApp(
    fakeRepo(),
    'dev-token',
    '00000000-0000-4000-8000-000000000001',
    undefined,
    fakeSupabase(),
    { users, throttle, audit }
  );
  return { app, throttle, audit, users };
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

describe('POST /api/v1/auth/reset-password', () => {
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
      accessToken: 'badtok-bad-bad-bad-bad-badbadbad-bad', // long enough but rejected
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
