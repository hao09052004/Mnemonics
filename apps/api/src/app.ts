import cors from 'cors';
import express, { type Application, type ErrorRequestHandler, type Request, type Response } from 'express';
import { authCredentialsSchema } from '@mnemonics/shared';
import type { ItemRepository } from '@mnemonics/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireDevelopmentAuth, requireSupabaseAuth, type AuthenticatedRequest } from './auth.js';
import type { ImageStorage } from './storage.js';
import type { Audit } from './auth/audit.js';
import type { Throttle } from './auth/throttle.js';
import type { SupabaseUsersFacade } from './auth/supabase-users.js';
import { createAuthRouter } from './auth/routes.js';
import { imageProxyHandler } from './routes/image-proxy.js';

export interface AuthDeps {
  users: SupabaseUsersFacade;
  throttle: Throttle;
  audit: Audit;
}

declare global {
  namespace Express {
    interface Request { id: string; }
  }
}

function createRequestId() {
  return crypto.randomUUID();
}

export function createApp(
  repository: ItemRepository,
  expectedToken = 'mnemonics-dev-token',
  developmentUserId = '00000000-0000-4000-8000-000000000001',
  imageStorage?: ImageStorage,
  supabase?: SupabaseClient,
  authDeps?: AuthDeps,
  options?: { autoConfirmRegistration?: boolean; demoMode?: boolean }
): Application {
  const demoMode = options?.demoMode === true;
  const demoUser = {
    id: developmentUserId,
    email: 'demo@mnemonics.local',
    name: 'Mnemonics Demo',
    role: 'user',
    emailVerified: true
  };
  const createDemoSession = () => ({
    accessToken: expectedToken,
    refreshToken: 'mnemonics-demo-refresh-token',
    expiresAt: Math.floor(Date.now() / 1000) + 60 * 60,
    tokenType: 'bearer' as const
  });

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use((request: Request, _response: Response, next) => {
    request.id = request.header('x-request-id') || createRequestId();
    next();
  });

  // Mount the unified auth router if dependencies were provided.
  if (supabase && authDeps) {
    app.use('/api/v1/auth', createAuthRouter({
      users: authDeps.users,
      throttle: authDeps.throttle,
      audit: authDeps.audit,
      supabase,
      autoConfirm: options?.autoConfirmRegistration === true
    }));
  }

  app.get('/', (_request, response) => response.json({
    name: 'Mnemonics API',
    status: 'ok',
    endpoints: {
      health: '/api/v1/health',
      captures: 'POST /api/v1/captures'
    }
  }));

  app.get('/api/v1/health', (_request, response) => response.json({ data: { status: 'ok' } }));

  // Image proxy for the browser extension
  app.get('/api/v1/proxy/image', imageProxyHandler);

  const authMiddleware = supabase
    ? requireSupabaseAuth(supabase)
    : requireDevelopmentAuth(expectedToken, developmentUserId);

  app.post('/api/v1/auth/register', async (request, response, next) => {
    try {
      const parsed = authCredentialsSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'INVALID_AUTH_PAYLOAD', message: 'Thông tin đăng ký không hợp lệ', requestId: request.id } });
        return;
      }
      if (!supabase && demoMode) {
        response.status(201).json({ data: { user: demoUser, session: createDemoSession() } });
        return;
      }
      if (!supabase) {
        response.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Supabase Auth chưa được cấu hình', requestId: request.id } });
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: parsed.data.email,
        password: parsed.data.password,
        options: { data: parsed.data.name ? { name: parsed.data.name } : undefined }
      });
      if (error || !data.user) {
        response.status(400).json({ error: { code: 'AUTH_SIGNUP_FAILED', message: error?.message || 'Không thể đăng ký', requestId: request.id } });
        return;
      }
      response.status(201).json({ data: { user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name, role: 'user' }, session: data.session ? { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at } : null } });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v1/auth/login', async (request, response, next) => {
    try {
      const parsed = authCredentialsSchema.pick({ email: true, password: true }).safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'INVALID_AUTH_PAYLOAD', message: 'Thông tin đăng nhập không hợp lệ', requestId: request.id } });
        return;
      }
      if (!supabase && demoMode) {
        const email = parsed.data.email.toLowerCase();
        if (email !== demoUser.email || parsed.data.password !== 'DemoPass123!') {
          response.status(401).json({ error: { code: 'AUTH_LOGIN_FAILED', message: 'Demo credentials không đúng', requestId: request.id } });
          return;
        }
        response.json({ data: { user: demoUser, session: createDemoSession() } });
        return;
      }
      if (!supabase) {
        response.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Supabase Auth chưa được cấu hình', requestId: request.id } });
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
      if (error || !data.user || !data.session) {
        response.status(401).json({ error: { code: 'AUTH_LOGIN_FAILED', message: error?.message || 'Email hoặc mật khẩu chưa đúng', requestId: request.id } });
        return;
      }
      response.json({ data: { user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name, role: 'user' }, session: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at } } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/auth/me', authMiddleware, (request: AuthenticatedRequest, response) => {
    if (demoMode && !supabase) {
      response.json({ data: { user: demoUser } });
      return;
    }
    response.json({ data: { user: { id: request.userId, email: request.user?.email, name: request.user?.user_metadata?.name, role: request.userRole || 'user' } } });
  });

  if (demoMode && !supabase) {
    app.post('/api/v1/auth/refresh', (request, response) => {
      if (request.body?.refreshToken !== 'mnemonics-demo-refresh-token') {
        response.status(401).json({ error: { code: 'AUTH_REFRESH_FAILED', message: 'Refresh token không hợp lệ', requestId: request.id } });
        return;
      }
      response.json({ data: { user: demoUser, session: createDemoSession() } });
    });

    app.post('/api/v1/auth/logout', (_request, response) => {
      response.status(204).send();
    });
  }

  // Note: /api/v1/captures and /api/v1/captures/image are mounted
  // separately in server.ts via createCaptureRouter (so they can integrate
  // with the job queue). Declaring placeholders here would shadow the
  // capture router because Express matches the first registered route
  // for an exact path; keep these paths unhandled at this layer.

  const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error({ requestId: request.id, error: errorMessage });
    response.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'development' ? errorMessage : 'Đã xảy ra lỗi máy chủ',
        requestId: request.id
      }
    });
  };
  app.use(errorHandler);
  return app;
}
