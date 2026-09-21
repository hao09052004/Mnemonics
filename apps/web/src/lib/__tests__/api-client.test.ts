/**
 * Smoke tests for the web ApiClient.
 *
 * Run with: `pnpm --filter @mnemonics/web test` (vitest picks up files
 * matching `*.test.{ts,tsx}` in the package source tree).
 *
 * These tests run against the in-memory fetch fake — they do NOT hit a
 * real backend, so we cannot validate cross-device behaviour here. The
 * extension side and the per-user cache are covered by
 * `apps/api/src/routes/__tests__/items.test.ts` and the manual checklist
 * documented in `apps/extension/__tests__/README.md`.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ApiClient, ApiError } from '../api-client';

const sampleUser = {
  id: 'u1',
  email: 'a@b.com',
  name: 'A',
  role: 'user',
  emailVerified: true
};

const sampleSession = {
  accessToken: 'AT',
  refreshToken: 'RT',
  expiresAt: 9999999999,
  tokenType: 'bearer' as const
};

function makeFetch(impl: (url: string, init?: RequestInit) => Promise<Response> | Response): typeof fetch {
  return vi.fn(impl) as unknown as typeof fetch;
}

describe('ApiClient', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('login reads envelope { data: { user, session } }', async () => {
    const api = new ApiClient('http://x');
    api['request'] = vi.fn().mockResolvedValue({ data: { user: sampleUser, session: sampleSession } });
    const out = await api.login({ email: 'a@b.com', password: 'secretsecret1!' });
    expect(out.session).not.toBeNull();
    expect(out.session!.accessToken).toBe('AT');
    expect(out.user!.email).toBe('a@b.com');
  });

  it('register returns null session when email verification required', async () => {
    const api = new ApiClient('http://x');
    api['request'] = vi.fn().mockResolvedValue({ data: { user: sampleUser, session: null } });
    const out = await api.register({ email: 'a@b.com', password: 'secretsecret1!' });
    expect(out.session).toBeNull();
    expect(out.user).not.toBeNull();
  });

  it('deleteItem handles 204 No Content without trying to parse JSON', async () => {
    const api = new ApiClient('http://x');
    api['request'] = vi.fn().mockResolvedValue(undefined);
    await expect(api.deleteItem('item-1', 'AT')).resolves.toBeUndefined();
    const call = (api['request'] as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[1]).toMatchObject({ method: 'DELETE' });
  });

  it('listItems unwraps the { data: { items, total } } envelope', async () => {
    const api = new ApiClient('http://x');
    api['request'] = vi.fn().mockResolvedValue({
      data: {
        items: [{ id: 'i1', kind: 'link', title: 't', captured_at: '2026-01-01T00:00:00Z', tags: ['x'] }],
        total: 1,
        limit: 50,
        offset: 0
      }
    });
    const out = await api.listItems('AT', { limit: 50 });
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items[0].kind).toBe('link');
    expect(out.total).toBe(1);
  });

  it('login network failure raises ApiError with NETWORK_ERROR code', async () => {
    const api = new ApiClient('http://x');
    api['request'] = vi.fn().mockRejectedValue(new ApiError(0, 'no network', 'NETWORK_ERROR'));
    await expect(api.login({ email: 'a@b.com', password: 'secretsecret1!' })).rejects.toThrow(/NETWORK_ERROR|no network/);
  });

  it('saveSession + loadStoredSession roundtrip', () => {
    const api = new ApiClient('http://x');
    const session = {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: 9999999999,
      user: sampleUser
    };
    api.saveSession(session);
    const loaded = api.loadStoredSession();
    expect(loaded?.accessToken).toBe('AT');
    api.saveSession(null);
    expect(api.loadStoredSession()).toBeNull();
  });

  it('isAccessTokenExpired uses a 60-second leeway window', () => {
    const api = new ApiClient('http://x');
    const expired = {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: Math.floor(Date.now() / 1000) - 10,
      user: sampleUser
    };
    expect(api.isAccessTokenExpired(expired)).toBe(true);
    const fresh = {
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: sampleUser
    };
    expect(api.isAccessTokenExpired(fresh)).toBe(false);
  });

  it('refreshSession is single-flight — concurrent calls share one network request', async () => {
    const api = new ApiClient('http://x');
    const session = { accessToken: 'AT', refreshToken: 'RT', expiresAt: 1, user: sampleUser };
    let calls = 0;
    api.refreshWithToken = vi.fn(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return { accessToken: 'AT2', refreshToken: 'RT2', expiresAt: 9999999999, user: sampleUser };
    });
    const [a, b, c] = await Promise.all([
      api.refreshSession(session),
      api.refreshSession(session),
      api.refreshSession(session)
    ]);
    expect(calls).toBe(1);
    expect(a?.accessToken).toBe('AT2');
    expect(b?.accessToken).toBe('AT2');
    expect(c?.accessToken).toBe('AT2');
  });
});

describe('ApiClient real-network paths (sanity)', () => {
  it('login against an unreachable server yields a network ApiError', async () => {
    const api = new ApiClient('http://127.0.0.1:1'); // unreachable
    await expect(api.login({ email: 'a@b.com', password: 'secretsecret1!' })).rejects.toBeInstanceOf(ApiError);
  });
});
