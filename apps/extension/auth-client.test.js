import { describe, expect, it, vi } from 'vitest';
import {
  normalizeEmail,
  validateEmail,
  validatePasswordStrength,
  createAuthClient,
  createSessionStore
} from './auth-client.js';

describe('auth client validation', () => {
  it('normalizes email', () => {
    expect(normalizeEmail('  USER@Example.COM ')).toBe('user@example.com');
  });

  it('validates email format', () => {
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('not-an-email')).toBe(false);
  });

  it('enforces the documented password policy', () => {
    expect(validatePasswordStrength('Abcdef123!')).toBe(true);
    expect(validatePasswordStrength('abcdef123!')).toBe(false);
    expect(validatePasswordStrength('Abcdefghij')).toBe(false);
  });
});

describe('auth client API contract', () => {
  it('refreshes using the refresh token and returns the data envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          user: { id: 'u1' },
          session: {
            accessToken: 'access-2',
            refreshToken: 'refresh-2',
            expiresAt: 1900000000
          }
        }
      })
    });

    const client = createAuthClient({ baseUrl: 'http://localhost:4000', fetchImpl });
    const data = await client.refresh({ refreshToken: 'refresh-1' });

    expect(data.session.accessToken).toBe('access-2');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:4000/api/v1/auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'refresh-1' })
      })
    );
  });

  it('normalizes non-2xx responses into AuthError', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Invalid refresh token' }
      })
    });

    const client = createAuthClient({ fetchImpl });

    await expect(client.refresh({ refreshToken: 'expired' }))
      .rejects.toMatchObject({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid refresh token'
      });
  });
});

describe('session store', () => {
  it('persists and clears sessions through the storage adapter', async () => {
    const state = new Map();
    const storage = {
      get: async (key) => state.get(key) ?? null,
      set: async (key, value) => state.set(key, value),
      remove: async (key) => state.delete(key)
    };
    const store = createSessionStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);

    await store.save({ accessToken: 'a', refreshToken: 'r' });
    expect(await store.load()).toMatchObject({ accessToken: 'a' });
    expect(listener).toHaveBeenLastCalledWith(
      'login',
      expect.objectContaining({ accessToken: 'a' })
    );

    await store.clear();
    expect(await store.load()).toBeNull();
    expect(listener).toHaveBeenLastCalledWith('logout', null);
  });
});
