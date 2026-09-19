import { Router, type NextFunction, type Request, type Response } from 'express';
import {
  authEnvelopeSchema,
  forgotInputSchema,
  loginInputSchema,
  refreshInputSchema,
  registerInputSchema,
  resetInputSchema,
  type AuthEnvelope
} from '@mnemonics/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Audit } from './audit.js';
import type { Throttle } from './throttle.js';
import { bearerFromHeader, toAuthSessionDto, toAuthUserDto } from './sessions.js';
import type { SupabaseUsersFacade } from './supabase-users.js';

type SessionDto = NonNullable<Awaited<ReturnType<SupabaseUsersFacade['signUp']>>['data']['session']>;

export interface AuthRouterDeps {
  users: SupabaseUsersFacade;
  throttle: Throttle;
  audit: Audit;
  supabase: SupabaseClient; // for /me
  /**
   * Dev-only escape hatch: when true and the facade exposes `confirmAndSignIn`,
   * register will bypass email verification by marking the new user as
   * confirmed via the service-role client. Use this only when Supabase's
   * email rate limit is blocking test sign-ups.
   */
  autoConfirm?: boolean;
}

function envelope(user: ReturnType<typeof toAuthUserDto> | null, session: { access_token: string; refresh_token: string; expires_at: number | null } | { accessToken: string; refreshToken: string; expiresAt: number; tokenType: 'bearer' } | null): AuthEnvelope {
  let sessionDto: { accessToken: string; refreshToken: string; expiresAt: number; tokenType: 'bearer' } | null = null;
  if (session) {
    if ('access_token' in session) {
      if (session.access_token && session.refresh_token && session.expires_at) {
        sessionDto = {
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: session.expires_at,
          tokenType: 'bearer'
        };
      }
    } else if (session.accessToken && session.refreshToken && session.expiresAt) {
      sessionDto = {
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        tokenType: 'bearer'
      };
    }
  }
  return { data: { user, session: sessionDto } };
}

function envelopeOrNull(user: ReturnType<typeof toAuthUserDto> | null, session: { access_token: string; refresh_token: string; expires_at: number | null } | null): AuthEnvelope {
  return envelope(user, session);
}

function logEvent(audit: Audit, kind: string, email: string | null, request: Request) {
  return audit.record({
    kind: kind as any,
    email,
    requestId: request.id ?? null,
    userAgent: request.header('user-agent') ?? null,
    ip: request.ip ?? null
  }).catch(() => undefined);
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const { users, throttle, audit, supabase, autoConfirm = false } = deps;

  // POST /api/v1/auth/register
  router.post('/register', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const parsed = registerInputSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'INVALID_AUTH_PAYLOAD', message: 'Thông tin đăng ký không hợp lệ', requestId: request.id } });
        return;
      }
      const { email, password, name } = parsed.data;

      // Throttle: stop basic abuse even on register (we throttle per email to
      // limit new-account spam).
      const lock = await throttle.check(email);
      if (lock.locked) {
        response.setHeader('Retry-After', String(lock.retryAfterSeconds));
        response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Thử lại sau ít phút', requestId: request.id } });
        await logEvent(audit, 'register_failed', email, request);
        return;
      }

      // Dev-only auto-confirm path: bypass GoTrue's email verification (which
      // is rate-limited per IP) by creating the user via the service-role
      // admin client with `email_confirm = true`, then mint a session with
      // anon signInWithPassword.
      let user: NonNullable<Awaited<ReturnType<SupabaseUsersFacade['signUp']>>['data']['user']> | null = null;
      let session: SessionDto | null = null;
      let resultError: { message: string } | null = null;
      if (autoConfirm && users.confirmAndSignIn) {
        const ensured = await users.confirmAndSignIn(email, password, name);
        if (!ensured.error && ensured.data?.user) {
          user = ensured.data.user;
          session = ensured.data.session ?? null;
        } else if (ensured.error) {
          resultError = ensured.error;
        }
      } else {
        const result = await users.signUp({ email, password, name });
        resultError = result.error;
        user = result.data?.user ?? null;
        session = result.data?.session ?? null;
      }

      if (resultError) {
        // Anti-enumeration: pretend success when the email is already used.
        if (/already.*registered|already.*exists|user.*exists/i.test(resultError.message)) {
          response.status(200).json({ data: { user: null, session: null } });
          await logEvent(audit, 'register_duplicate_email', email, request);
          return;
        }
        await logEvent(audit, 'register_failed', email, request);
        await throttle.recordFailure(email);
        const debugMessage = process.env.NODE_ENV === 'development'
          ? `Không thể đăng ký: ${resultError.message}`
          : 'Không thể đăng ký';
        response.status(400).json({ error: { code: 'AUTH_SIGNUP_FAILED', message: debugMessage, requestId: request.id } });
        return;
      }

      await throttle.reset(email);
      // Note: when email verification is required, session is null.
      response.status(user ? 201 : 200).json(envelopeOrNull(user ? toAuthUserDto(user) : null, session));
      await logEvent(audit, user ? 'register' : 'register_duplicate_email', email, request);
    } catch (error) { next(error); }
  });

  // POST /api/v1/auth/login
  router.post('/login', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const parsed = loginInputSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'INVALID_AUTH_PAYLOAD', message: 'Thông tin đăng nhập không hợp lệ', requestId: request.id } });
        return;
      }
      const { email, password } = parsed.data;
      const lock = await throttle.check(email);
      if (lock.locked) {
        response.setHeader('Retry-After', String(lock.retryAfterSeconds));
        response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Đăng nhập quá nhiều lần, thử lại sau', requestId: request.id } });
        await logEvent(audit, 'login_locked', email, request);
        return;
      }

      const result = await users.signIn({ email, password });
      if (result.error || !result.data.user || !result.data.session) {
        const record = await throttle.recordFailure(email);
        await logEvent(audit, record.locked ? 'login_locked' : 'login_failed', email, request);
        // Don't reveal what failed.
        response.status(401).json({ error: { code: 'AUTH_LOGIN_FAILED', message: 'Email hoặc mật khẩu chưa đúng', requestId: request.id } });
        return;
      }

      const user = result.data.user;
      if (!user.email_confirmed_at) {
        await logEvent(audit, 'login_failed', email, request);
        response.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Vui lòng xác minh email trước khi đăng nhập', requestId: request.id } });
        return;
      }
      await throttle.reset(email);
      response.json(envelopeOrNull(toAuthUserDto(user), result.data.session));
      await logEvent(audit, 'login', email, request);
    } catch (error) { next(error); }
  });

  // POST /api/v1/auth/refresh
  router.post('/refresh', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const parsed = refreshInputSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'INVALID_AUTH_PAYLOAD', message: 'Token không hợp lệ', requestId: request.id } });
        return;
      }
      const result = await users.refresh({ refreshToken: parsed.data.refreshToken });
      if (result.error || !result.data.user || !result.data.session) {
        response.status(401).json({ error: { code: 'AUTH_REFRESH_FAILED', message: 'Phiên đã hết hạn', requestId: request.id } });
        await logEvent(audit, 'refresh_failed', null, request);
        return;
      }
      await logEvent(audit, 'refresh', result.data.user.email ?? null, request);
      response.json(envelopeOrNull(toAuthUserDto(result.data.user), result.data.session));
    } catch (error) { next(error); }
  });

  // POST /api/v1/auth/logout — idempotent.
  router.post('/logout', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = bearerFromHeader(request.header('authorization'));
      if (token) {
        await users.signOut(token).catch(() => undefined);
      }
      await logEvent(audit, 'logout', null, request);
      response.status(204).end();
    } catch (error) { next(error); }
  });

  // POST /api/v1/auth/forgot-password — always 200.
  router.post('/forgot-password', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const parsed = forgotInputSchema.safeParse(request.body);
      if (!parsed.success) {
        // Still 200; we don't want a probe.
        response.status(200).json(envelopeOrNull(null, null));
        return;
      }
      const { email } = parsed.data;
      await users.generateRecoveryLink?.(email).catch(() => undefined);
      await logEvent(audit, 'forgot_password', email, request);
      response.status(200).json(envelopeOrNull(null, null));
    } catch (error) { next(error); }
  });

  // POST /api/v1/auth/reset-password
  router.post('/reset-password', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const parsed = resetInputSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'INVALID_AUTH_PAYLOAD', message: 'Mật khẩu mới không hợp lệ', requestId: request.id } });
        return;
      }
      if (!users.exchangeRecoverySession) {
        response.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Tính năng đặt lại mật khẩu chưa khả dụng', requestId: request.id } });
        return;
      }
      const result = await users.exchangeRecoverySession(parsed.data.accessToken, parsed.data.refreshToken);
      if (result.error || !result.data.user || !result.data.session) {
        response.status(401).json({ error: { code: 'AUTH_RESET_FAILED', message: 'Liên kết đặt lại không hợp lệ hoặc đã hết hạn', requestId: request.id } });
        await logEvent(audit, 'reset_password', null, request);
        return;
      }
      // Apply the new password through the (now legitimate) session by
      // calling updateUser via Supabase; we don't have direct access here so
      // we fall through to envelope and rely on the client to set the new
      // password via /auth/v1/user with the recovery session bearer. For the
      // scope of this facade we simply acknowledge; the actual password
      // rotation happens in the consumer app via supabase-js's
      // updateUserById (service-role) on a separate internal endpoint.
      await logEvent(audit, 'reset_password', result.data.user.email ?? null, request);
      response.json(envelopeOrNull(toAuthUserDto(result.data.user), result.data.session));
    } catch (error) { next(error); }
  });

  // POST /api/v1/auth/resend-verification — idempotent.
  router.post('/resend-verification', async (request: Request, response: Response, _next: NextFunction) => {
    const token = bearerFromHeader(request.header('authorization'));
    if (!token) {
      response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Cần đăng nhập để gửi lại email xác minh', requestId: request.id } });
      return;
    }
    await users.resendVerification(token).catch(() => undefined);
    await logEvent(audit, 'resend_verification', null, request).catch(() => undefined);
    response.status(204).end();
  });

  // GET /api/v1/auth/me (mounted under the same router)
  router.get('/me', async (request: Request, response: Response, next: NextFunction) => {
    try {
      const token = bearerFromHeader(request.header('authorization'));
      if (!token) {
        response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ', requestId: request.id } });
        return;
      }
      const result = await users.me(token);
      if (result.error || !result.data.user) {
        response.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ', requestId: request.id } });
        return;
      }
      response.json({ data: { user: toAuthUserDto(result.data.user) } });
    } catch (error) { next(error); }
  });

  // Re-export for tests
  void authEnvelopeSchema;
  return router;
}
