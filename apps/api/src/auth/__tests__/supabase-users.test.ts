import { describe, expect, it } from 'vitest';
import { createSupabaseUsers } from '../supabase-users.js';
import type { SupabaseClient, User } from '@supabase/supabase-js';

function makeFakeSupabase(impls: Partial<{
  signUp: any;
  signInWithPassword: any;
  refreshSession: any;
  signOut: any;
  getUser: any;
  adminGenerateLink: any;
  setSession: any;
  resetPasswordForEmail: any;
}> = {}) {
  return {
    auth: {
      signUp: impls.signUp ?? (async () => ({ data: { user: null, session: null }, error: null })),
      signInWithPassword: impls.signInWithPassword ?? (async () => ({ data: { user: null, session: null }, error: null })),
      refreshSession: impls.refreshSession ?? (async () => ({ data: { user: null, session: null }, error: null })),
      signOut: impls.signOut ?? (async () => ({ error: null })),
      getUser: impls.getUser ?? (async () => ({ data: { user: null }, error: null })),
      admin: {
        generateLink: impls.adminGenerateLink ?? (async () => ({ data: { properties: null }, error: null }))
      },
      setSession: impls.setSession ?? (async () => ({ data: { user: null, session: null }, error: null })),
      resetPasswordForEmail: impls.resetPasswordForEmail ?? (async () => ({ data: {}, error: null }))
    }
  } as unknown as SupabaseClient;
}

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'a@b.co',
    email_confirmed_at: null,
    phone: '',
    confirmed_at: null,
    last_sign_in_at: null,
    app_metadata: {},
    user_metadata: {},
    identities: [],
    factors: null,
    created_at: '2026-09-19T00:00:00Z',
    updated_at: '2026-09-19T00:00:00Z',
    ...overrides
  } as unknown as User;
}

describe('createSupabaseUsers', () => {
  it('wraps signUp and uses options.data when name is provided', async () => {
    const calls: any[] = [];
    const client = makeFakeSupabase({
      signUp: async (args: any) => {
        calls.push(['signUp', args]);
        return { data: { user: fakeUser(), session: { access_token: 'a', refresh_token: 'b', expires_at: 1, expires_in: 3600, token_type: 'bearer', user: {} as any } }, error: null };
      }
    });
    const u = createSupabaseUsers(client);
    const result = await u.signUp({ email: 'a@b.co', password: 'Password1!ok', name: 'Anna' });
    expect(result.data?.user?.email).toBe('a@b.co');
    expect(calls).toHaveLength(1);
    expect(calls[0][1].options).toEqual({ data: { name: 'Anna' } });
  });

  it('signUp omits options when name absent', async () => {
    const calls: any[] = [];
    const client = makeFakeSupabase({ signUp: async (args: any) => { calls.push(args); return { data: { user: null, session: null }, error: null }; } });
    await createSupabaseUsers(client).signUp({ email: 'a@b.co', password: 'Password1!ok' });
    expect(calls[0].options).toBeUndefined();
  });

  it('signIn delegates to signInWithPassword', async () => {
    const calls: any[] = [];
    const client = makeFakeSupabase({ signInWithPassword: async (a: any) => { calls.push(a); return { data: { user: fakeUser(), session: { access_token: 'x', refresh_token: 'y', expires_at: 1, expires_in: 1, token_type: 'bearer' } }, error: null }; } });
    const result = await createSupabaseUsers(client).signIn({ email: 'a@b.co', password: 'pw' });
    expect(calls[0]).toEqual({ email: 'a@b.co', password: 'pw' });
    expect(result.data?.user?.email).toBe('a@b.co');
  });

  it('refresh passes refresh_token into refreshSession', async () => {
    const calls: any[] = [];
    const client = makeFakeSupabase({ refreshSession: async (a: any) => { calls.push(a); return { data: { user: fakeUser(), session: { access_token: 'x', refresh_token: 'y', expires_at: 1, expires_in: 1, token_type: 'bearer' } }, error: null }; } });
    const result = await createSupabaseUsers(client).refresh({ refreshToken: 'rt-token-1234567890' });
    expect(calls[0]).toEqual({ refresh_token: 'rt-token-1234567890' });
    expect(result.data?.session?.refresh_token).toBe('y');
  });

  it('signOut returns null error when the underlying call succeeds', async () => {
    const client = makeFakeSupabase();
    const u = createSupabaseUsers(client);
    expect((await u.signOut('token'))).toEqual({ error: null });
  });

  it('resendVerification returns null error by default', async () => {
    expect((await createSupabaseUsers(makeFakeSupabase()).resendVerification('token'))).toEqual({ error: null });
  });

  it('me delegates to getUser and only carries user', async () => {
    const calls: any[] = [];
    const client = makeFakeSupabase({ getUser: async (a: any) => { calls.push(a); return { data: { user: fakeUser() }, error: null }; } });
    const result = await createSupabaseUsers(client).me('abc');
    expect(calls[0]).toBe('abc');
    expect(result.data?.user?.email).toBe('a@b.co');
    expect(result.data?.session).toBeNull();
  });

  it('me returns null user when underlying returns null', async () => {
    const client = makeFakeSupabase({ getUser: async () => ({ data: { user: null }, error: null }) });
    const result = await createSupabaseUsers(client).me('abc');
    expect(result.data?.user).toBeNull();
  });

  it('forwards errors from signUp', async () => {
    const client = makeFakeSupabase({ signUp: async () => ({ data: { user: null, session: null }, error: { message: 'duplicate' } }) });
    const u = createSupabaseUsers(client);
    const r = await u.signUp({ email: 'a@b.co', password: 'Password1!ok' });
    expect(r.error?.message).toBe('duplicate');
  });

  it('forwards errors from signInWithPassword', async () => {
    const client = makeFakeSupabase({ signInWithPassword: async () => ({ data: { user: null, session: null }, error: { message: 'invalid' } }) });
    const u = createSupabaseUsers(client);
    const r = await u.signIn({ email: 'a@b.co', password: 'pw' });
    expect(r.error?.message).toBe('invalid');
  });

  it('generateRecoveryLink is omitted when no service client is provided', async () => {
    const u = createSupabaseUsers(makeFakeSupabase());
    expect(u.generateRecoveryLink).toBeUndefined();
  });

  it('exchangeRecoverySession is omitted when no service client is provided', async () => {
    const u = createSupabaseUsers(makeFakeSupabase());
    expect(u.exchangeRecoverySession).toBeUndefined();
  });

  it('forwards generateRecoveryLink with the recovery link payload', async () => {
    const calls: any[] = [];
    const service = makeFakeSupabase({ adminGenerateLink: async (args: any) => { calls.push(args); return { data: { properties: { action_link: 'https://example.com/r' } }, error: null }; } });
    const u = createSupabaseUsers(makeFakeSupabase(), service);
    const result = await u.generateRecoveryLink!('a@b.co');
    expect(calls[0]).toEqual({ type: 'recovery', email: 'a@b.co' });
    expect(result.data?.properties.action_link).toBe('https://example.com/r');
  });

  it('forwards exchangeRecoverySession to setSession', async () => {
    const calls: any[] = [];
    const service = makeFakeSupabase({ setSession: async (args: any) => { calls.push(args); return { data: { user: fakeUser(), session: { access_token: 'new', refresh_token: 'newr', expires_at: 1, expires_in: 1, token_type: 'bearer' } }, error: null }; } });
    const u = createSupabaseUsers(makeFakeSupabase(), service);
    const result = await u.exchangeRecoverySession!('at-len-40-xxxxxxxxxxxxxxxxxxxxxxxxxx', 'rt-len-40-xxxxxxxxxxxxxxxxxxxxxxxxxx');
    expect(calls[0]).toEqual({ access_token: 'at-len-40-xxxxxxxxxxxxxxxxxxxxxxxxxx', refresh_token: 'rt-len-40-xxxxxxxxxxxxxxxxxxxxxxxxxx' });
    expect(result.data?.session?.access_token).toBe('new');
  });

  it('requestPasswordRecovery calls resetPasswordForEmail on the anon client with redirectTo', async () => {
    const calls: any[] = [];
    const client = makeFakeSupabase({
      resetPasswordForEmail: async (args: any, options: any) => { calls.push([args, options]); return { data: {}, error: null }; }
    });
    const u = createSupabaseUsers(client);
    const result = await u.requestPasswordRecovery!('a@b.co', 'http://localhost:3000/reset-password');
    expect(calls[0]).toEqual(['a@b.co', { redirectTo: 'http://localhost:3000/reset-password' }]);
    expect(result.error).toBeNull();
    expect(result.data).toEqual({});
  });

  it('requestPasswordRecovery omits options when no redirectTo is supplied', async () => {
    const calls: any[] = [];
    const client = makeFakeSupabase({
      resetPasswordForEmail: async (args: any, options: any) => { calls.push([args, options]); return { data: {}, error: null }; }
    });
    await createSupabaseUsers(client).requestPasswordRecovery!('a@b.co');
    expect(calls[0][1]).toBeUndefined();
  });

  it('requestPasswordRecovery forwards provider errors', async () => {
    const client = makeFakeSupabase({ resetPasswordForEmail: async () => ({ data: null, error: { message: 'rate_limited' } }) });
    const u = createSupabaseUsers(client);
    const r = await u.requestPasswordRecovery!('a@b.co', 'http://localhost:3000/reset-password');
    expect(r.error?.message).toBe('rate_limited');
  });

  it('requestPasswordRecovery uses the anon client, not the service-role client', async () => {
    // Both clients are wired up; ensure only the anon `client` receives the
    // resetPasswordForEmail call. The service client would expose the
    // SUPABASE_SERVICE_ROLE_KEY in any error path, so we MUST NOT use it
    // here.
    const anonCalls: any[] = [];
    const serviceCalls: any[] = [];
    const anon = makeFakeSupabase({
      resetPasswordForEmail: async (...args: any[]) => { anonCalls.push(args); return { data: {}, error: null }; }
    });
    const service = makeFakeSupabase({
      resetPasswordForEmail: async (...args: any[]) => { serviceCalls.push(args); return { data: {}, error: null }; }
    });
    await createSupabaseUsers(anon, service).requestPasswordRecovery!('a@b.co');
    expect(anonCalls).toHaveLength(1);
    expect(serviceCalls).toHaveLength(0);
  });
});
