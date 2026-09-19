import type { SupabaseClient, User } from '@supabase/supabase-js';

export interface SignUpInput {
  email: string;
  password: string;
  name?: string;
}

export interface SignInInput {
  email: string;
  password: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface ResetInput {
  accessToken: string;
  refreshToken: string;
  newPassword: string;
}

/**
 * A thin, dependency-friendly facade over the auth methods we actually use.
 * The return type is a *structural* subset of Supabase's `AuthResponse` so the
 * real `client.auth.*` calls satisfy it without us having to import
 * `AuthResponse` directly (the type changes name between major versions).
 */
export interface AuthResponseLike {
  data: {
    user: User | null;
    session: { access_token: string; refresh_token: string; expires_at: number } | null;
  };
  error: { message: string } | null;
}

export interface LinkResponseLike {
  data: { properties: { action_link: string } | null } | null;
  error: { message: string } | null;
}

export interface SupabaseUsersFacade {
  signUp(input: SignUpInput): Promise<AuthResponseLike>;
  signIn(input: SignInInput): Promise<AuthResponseLike>;
  refresh(input: RefreshInput): Promise<AuthResponseLike>;
  signOut(accessToken: string): Promise<{ error: { message: string } | null }>;
  resendVerification(accessToken: string): Promise<{ error: { message: string } | null }>;
  me(accessToken: string): Promise<AuthResponseLike>;
  /**
   * Service-role only. Looks up (or creates) the user via admin and signs
   * them in. The user is auto-confirmed — does not require a verification
   * email. Used by the dev-only auto-confirm path to bypass the IP-level
   * Supabase email rate limit.
   */
  confirmAndSignIn?(email: string, password: string, name?: string): Promise<AuthResponseLike>;
  /** Service-role only. Used by forgot-password to generate a recovery link. */
  generateRecoveryLink?(email: string): Promise<LinkResponseLike>;
  /** Service-role only. Exchanges recovery tokens for a usable session. */
  exchangeRecoverySession?(accessToken: string, refreshToken: string): Promise<AuthResponseLike>;
}

function toLike<T extends { data: any; error: any }>(value: T): AuthResponseLike {
  const session = value.data?.session;
  return {
    data: {
      user: value.data?.user ?? null,
      session: session && session.access_token && session.refresh_token && typeof session.expires_at === 'number'
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

export function createSupabaseUsers(client: SupabaseClient, serviceClient?: SupabaseClient): SupabaseUsersFacade {
  return {
    async signUp({ email, password, name }) {
      const result = await client.auth.signUp({
        email,
        password,
        options: name ? { data: { name } } : undefined
      });
      return toLike(result);
    },
    confirmAndSignIn: serviceClient
      ? async (email, password, name) => {
          // Find existing user (admin.listUsers is paginated; page=1 covers
          // typical test data).
          let target = null;
          try {
            const list = await serviceClient.auth.admin.listUsers({ page: 1, perPage: 200 });
            target = list.data?.users?.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase()) ?? null;
          } catch (e) {
            // ignore — we'll fall through to createUser.
          }

          if (target && !target.email_confirmed_at) {
            const update = await serviceClient.auth.admin.updateUserById(target.id, { email_confirm: true });
            if (update.error) {
              return { data: { user: null, session: null }, error: { message: update.error.message } };
            }
          }
          if (!target) {
            // Admin create with email_confirm=true — does not require sending
            // a verification email, so it bypasses the IP rate limit.
            const created = await serviceClient.auth.admin.createUser({
              email,
              password,
              email_confirm: true,
              user_metadata: name ? { name } : undefined
            });
            if (created.error || !created.data?.user) {
              return { data: { user: null, session: null }, error: { message: created.error?.message ?? 'createUser failed' } };
            }
          }
          const signIn = await client.auth.signInWithPassword({ email, password });
          return toLike(signIn);
        }
      : undefined,
    async signIn({ email, password }) {
      const result = await client.auth.signInWithPassword({ email, password });
      return toLike(result);
    },
    async refresh({ refreshToken }) {
      const result = await client.auth.refreshSession({ refresh_token: refreshToken });
      return toLike(result);
    },
    async signOut(_accessToken) {
      const result = await client.auth.signOut({ scope: 'global' });
      return { error: result.error ? { message: result.error.message } : null };
    },
    async resendVerification() {
      return { error: null };
    },
    async me(accessToken) {
      const result = await client.auth.getUser(accessToken);
      // getUser returns { data: { user }, error } — not a session.
      return {
        data: { user: result.data?.user ?? null, session: null },
        error: result.error ? { message: result.error.message } : null
      };
    },
    generateRecoveryLink: serviceClient
      ? async (email) => {
          const result = await serviceClient.auth.admin.generateLink({ type: 'recovery', email });
          if (result.error) return { data: null, error: { message: result.error.message } };
          const props = result.data?.properties ?? null;
          return {
            data: props ? { properties: { action_link: props.action_link } } : null,
            error: null
          };
        }
      : undefined,
    exchangeRecoverySession: serviceClient
      ? async (accessToken, refreshToken) => {
          const result = await serviceClient.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          return toLike(result);
        }
      : undefined
  };
}
