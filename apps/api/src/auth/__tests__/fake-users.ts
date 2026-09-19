import type { Session, User } from '@supabase/supabase-js';
import type { AuthResponseLike, LinkResponseLike, SupabaseUsersFacade } from '../supabase-users.js';

export interface FakeAuthOptions {
  /** When set, signUp will return this user; otherwise a deterministic uuid. */
  existingEmail?: string;
  newUserTemplate?: Partial<User>;
  newSession?: Partial<Session> | null;
  /** Pre-existing verified (or not) emailVerified state. */
  emailConfirmed?: boolean;
}

/**
 * Build a stub SupabaseUsersFacade that returns canned responses, simulating
 * Supabase behaviour for sign-up / sign-in / refresh / sign-out.
 */
export function createFakeUsers(options: FakeAuthOptions = {}): {
  users: SupabaseUsersFacade;
  signUps: Array<unknown>;
  signIns: Array<unknown>;
  refreshes: Array<unknown>;
  signOuts: Array<unknown>;
  meEmails: string[];
} {
  const signUps: Array<unknown> = [];
  const signIns: Array<unknown> = [];
  const refreshes: Array<unknown> = [];
  const signOuts: Array<unknown> = [];

  function makeUser(email: string, confirmed: boolean): User {
    return {
      id: '00000000-0000-4000-8000-000000000001',
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: confirmed ? '2026-09-19T00:00:00Z' : null,
      phone: '',
      confirmed_at: confirmed ? '2026-09-19T00:00:00Z' : null,
      last_sign_in_at: '2026-09-19T00:00:00Z',
      app_metadata: {},
      user_metadata: { name: 'Tester' },
      identities: [],
      factors: null,
      created_at: '2026-09-19T00:00:00Z',
      updated_at: '2026-09-19T00:00:00Z'
    } as unknown as User;
  }

  function makeSession(): Session {
    return {
      access_token: 'access-token-1234567890',
      refresh_token: 'refresh-token-1234567890',
      expires_in: 3600,
      expires_at: 1_700_000_000,
      token_type: 'bearer',
      user: makeUser('a@b.co', true)
    } as unknown as Session;
  }

  function toLike(value: { data: any; error: any }): AuthResponseLike {
    const session = value.data?.session;
    return {
      data: {
        user: value.data?.user ?? null,
        session:
          session &&
          session.access_token &&
          session.refresh_token &&
          typeof session.expires_at === 'number'
            ? {
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                expires_at: session.expires_at
              }
            : null
      },
      error: value.error?.message ? { message: value.error.message } : null
    };
  }

  const meEmails: string[] = [];
  const users: SupabaseUsersFacade = {
    async signUp({ email }: { email: string; password: string; name?: string }): Promise<AuthResponseLike> {
      signUps.push({ email });
      if (options.existingEmail === email) {
        return toLike({ data: { user: null, session: null }, error: { message: 'User already registered' } });
      }
      return toLike({
        data: {
          user: makeUser(email, options.emailConfirmed ?? false),
          session: options.newSession === null ? null : makeSession()
        },
        error: null
      });
    },
    async signIn({ email }: { email: string; password: string }): Promise<AuthResponseLike> {
      signIns.push({ email });
      if (!options.existingEmail) {
        return toLike({ data: { user: null, session: null }, error: { message: 'Invalid login credentials' } });
      }
      return toLike({
        data: { user: makeUser(email, options.emailConfirmed ?? true), session: makeSession() },
        error: null
      });
    },
    async refresh({ refreshToken }: { refreshToken: string }): Promise<AuthResponseLike> {
      refreshes.push({ refreshToken });
      if (refreshToken.startsWith('bad')) {
        return toLike({ data: { user: null, session: null }, error: { message: 'invalid_grant' } });
      }
      return toLike({
        data: { user: makeUser('a@b.co', true), session: makeSession() },
        error: null
      });
    },
    async signOut(accessToken: string): Promise<{ error: { message: string } | null }> {
      signOuts.push(accessToken);
      return { error: null };
    },
    async resendVerification(_accessToken: string): Promise<{ error: { message: string } | null }> {
      return { error: null };
    },
    async me(accessToken: string): Promise<AuthResponseLike> {
      if (!accessToken) {
        return toLike({ data: { user: null, session: null }, error: { message: 'no token' } });
      }
      // Reflect the most recent login/refresh email so e2e flows are realistic.
      const lastSignIn = signIns[signIns.length - 1] as { email?: string } | undefined;
      const email = lastSignIn?.email ?? 'a@b.co';
      meEmails.push(email);
      return toLike({ data: { user: makeUser(email, true), session: null }, error: null });
    },
    async generateRecoveryLink(_email: string): Promise<LinkResponseLike> {
      return {
        data: { properties: { action_link: 'https://example.com/recover?token=foo' } },
        error: null
      };
    },
    async exchangeRecoverySession(accessToken: string, _refreshToken: string): Promise<AuthResponseLike> {
      if (accessToken.startsWith('bad')) {
        return toLike({ data: { session: null, user: null }, error: { message: 'invalid' } });
      }
      return toLike({
        data: { session: makeSession(), user: makeUser('a@b.co', true) },
        error: null
      });
    }
  };

  return { users, signUps, signIns, refreshes, signOuts, meEmails };
}
