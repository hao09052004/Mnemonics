import { describe, expect, it } from 'vitest';
import { bearerFromHeader, toAuthSessionDto, toAuthUserDto } from '../sessions.js';
import type { User } from '@supabase/supabase-js';

function userFixture(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'a@b.co',
    email_confirmed_at: '2026-09-19T00:00:00Z',
    phone: '',
    confirmed_at: '2026-09-19T00:00:00Z',
    last_sign_in_at: '2026-09-19T00:00:00Z',
    app_metadata: { role: 'admin' },
    user_metadata: { name: 'Anna' },
    identities: [],
    factors: null,
    created_at: '2026-09-19T00:00:00Z',
    updated_at: '2026-09-19T00:00:00Z',
    ...overrides
  } as unknown as User;
}

describe('toAuthUserDto', () => {
  it('maps a Supabase user into the AuthUserDto envelope', () => {
    const out = toAuthUserDto(userFixture());
    expect(out.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(out.email).toBe('a@b.co');
    expect(out.name).toBe('Anna');
    expect(out.role).toBe('admin');
    expect(out.emailVerified).toBe(true);
  });

  it('passes through unknown roles as user', () => {
    const out = toAuthUserDto(userFixture({ app_metadata: { role: 'guest' } as any }));
    expect(out.role).toBe('user');
  });

  it('returns null name when user_metadata.name is missing or empty', () => {
    expect(toAuthUserDto(userFixture({ user_metadata: {} as any })).name).toBeNull();
    expect(toAuthUserDto(userFixture({ user_metadata: { name: '' } as any })).name).toBeNull();
  });

  it('truncates the name to 80 chars', () => {
    const longName = 'A'.repeat(120);
    const out = toAuthUserDto(userFixture({ user_metadata: { name: longName } as any }));
    expect(out.name?.length).toBe(80);
  });

  it('returns emailVerified=false when email_confirmed_at is null', () => {
    const out = toAuthUserDto(userFixture({ email_confirmed_at: null }));
    expect(out.emailVerified).toBe(false);
  });

  it('falls back to empty email when Supabase omits it', () => {
    const out = toAuthUserDto(userFixture({ email: undefined as any }));
    expect(out.email).toBe('');
  });
});

describe('toAuthSessionDto', () => {
  it('returns null when session is null', () => {
    expect(toAuthSessionDto(null)).toBeNull();
  });

  it('returns null when access_token is missing', () => {
    expect(toAuthSessionDto({ access_token: '', refresh_token: 'rt', expires_at: 1 } as any)).toBeNull();
  });

  it('returns null when refresh_token is missing', () => {
    expect(toAuthSessionDto({ access_token: 'at', refresh_token: '', expires_at: 1 } as any)).toBeNull();
  });

  it('returns null when expires_at is missing', () => {
    expect(toAuthSessionDto({ access_token: 'at', refresh_token: 'rt' } as any)).toBeNull();
  });

  it('returns the DTO when all fields are present', () => {
    const dto = toAuthSessionDto({ access_token: 'at', refresh_token: 'rt', expires_at: 1700000000 } as any);
    expect(dto).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1700000000, tokenType: 'bearer' });
  });
});

describe('bearerFromHeader', () => {
  it('returns null when the header is missing', () => {
    expect(bearerFromHeader(undefined)).toBeNull();
    expect(bearerFromHeader('')).toBeNull();
  });

  it('returns null when the header does not start with Bearer ', () => {
    expect(bearerFromHeader('Token abc')).toBeNull();
  });

  it('returns the bearer token without the prefix', () => {
    expect(bearerFromHeader('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });
});
