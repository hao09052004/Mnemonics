import { describe, expect, it } from 'vitest';
import {
  authSessionDtoSchema,
  authUserDtoSchema,
  forgotInputSchema,
  loginInputSchema,
  refreshInputSchema,
  registerInputSchema,
  resetInputSchema
} from '../auth.js';

const VALID_PASSWORD = 'Password1!ok';

describe('registerInputSchema', () => {
  it('accepts a valid payload (lowercase normalisation, optional name)', () => {
    const result = registerInputSchema.safeParse({
      email: '  ANNA@Example.COM  ',
      password: VALID_PASSWORD,
      name: '  Anna  '
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('anna@example.com');
      expect(result.data.name).toBe('Anna');
    }
  });

  it('rejects a weak password', () => {
    const result = registerInputSchema.safeParse({ email: 'a@b.co', password: 'short' });
    expect(result.success).toBe(false);
  });
});

describe('loginInputSchema', () => {
  it('accepts valid creds', () => {
    const r = loginInputSchema.safeParse({ email: 'a@b.co', password: 'whatever' });
    expect(r.success).toBe(true);
  });

  it('rejects missing fields', () => {
    expect(loginInputSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
  });
});

describe('refreshInputSchema', () => {
  // Regression (2026-10-04): the schema used to require min(20) chars.
  // Supabase issues short opaque refresh tokens (observed 12 chars, e.g.
  // "3dvpovfjldcp"), so *every* real refresh request was rejected with
  // 400 INVALID_AUTH_PAYLOAD. Users could never rotate a session and
  // were logged out as soon as the access token expired. The spec says
  // the token is opaque and must not be parsed, so the bound only has to
  // reject empty input.
  it('accepts a real Supabase short refresh token (12 chars)', () => {
    expect(refreshInputSchema.safeParse({ refreshToken: '3dvpovfjldcp' }).success).toBe(true);
  });

  it('accepts a long JWT-shaped refresh token', () => {
    expect(refreshInputSchema.safeParse({ refreshToken: 'a'.repeat(30) }).success).toBe(true);
  });

  it('still rejects an empty or missing refresh token', () => {
    expect(refreshInputSchema.safeParse({ refreshToken: '' }).success).toBe(false);
    expect(refreshInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('forgotInputSchema', () => {
  it('accepts any valid email; rejects non-email', () => {
    expect(forgotInputSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    expect(forgotInputSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});

describe('resetInputSchema', () => {
  it('requires both tokens and a strong new password', () => {
    const ok = {
      accessToken: 'a'.repeat(40),
      refreshToken: 'b'.repeat(40),
      newPassword: VALID_PASSWORD
    };
    expect(resetInputSchema.safeParse(ok).success).toBe(true);
    expect(resetInputSchema.safeParse({ ...ok, newPassword: 'weak' }).success).toBe(false);
    // Tokens are opaque (specs/api/auth.md §2): only empty is rejected.
    // Supabase refresh tokens are ~12 chars, so a min-length guard here
    // would block the whole recovery flow.
    expect(resetInputSchema.safeParse({ ...ok, accessToken: '' }).success).toBe(false);
    expect(resetInputSchema.safeParse({ ...ok, refreshToken: '' }).success).toBe(false);
    expect(resetInputSchema.safeParse({ ...ok, accessToken: 'short' }).success).toBe(true);
  });
});

describe('auth DTO schemas', () => {
  it('round-trips user + session', () => {
    const user = {
      id: '00000000-0000-4000-8000-000000000001',
      email: 'a@b.co',
      name: 'Anna',
      role: 'user' as const,
      emailVerified: true
    };
    expect(authUserDtoSchema.safeParse(user).success).toBe(true);

    const session = {
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 1700000000,
      tokenType: 'bearer' as const
    };
    expect(authSessionDtoSchema.safeParse(session).success).toBe(true);
  });
});
