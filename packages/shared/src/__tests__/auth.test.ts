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
  it('requires a refresh token (>= 20 chars)', () => {
    expect(refreshInputSchema.safeParse({ refreshToken: 'short' }).success).toBe(false);
    expect(refreshInputSchema.safeParse({ refreshToken: 'a'.repeat(30) }).success).toBe(true);
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
    expect(resetInputSchema.safeParse({ ...ok, accessToken: 'short' }).success).toBe(false);
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
