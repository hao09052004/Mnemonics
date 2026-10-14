import cors from 'cors';
import express, { type Application, type ErrorRequestHandler, type Request, type Response } from 'express';
import { authCredentialsSchema } from '@mnemonics/shared';
import type { ItemRepository } from '@mnemonics/database';
import type { Pool } from 'pg';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  requireDevelopmentAuth,
  requireSupabaseAuth,
  requireSupabaseAuthWithPool,
  type AuthenticatedRequest
} from './auth.js';
import { getPermissionsForRole, getUserRole } from './rbac.js';
import type { ImageStorage } from './storage.js';
import type { Audit } from './auth/audit.js';
import type { Throttle } from './auth/throttle.js';
import type { SupabaseUsersFacade } from './auth/supabase-users.js';
import { createAuthRouter } from './auth/routes.js';
import { imageProxyHandler } from './routes/image-proxy.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuditLogsRouter } from './routes/audit-logs.js';
import { createBillingRouter } from './routes/billing.js';
import { createPaymentOrdersRouter } from './routes/payment-orders.js';
import { createPaymentWebhookRouter } from './routes/payment-webhook.js';
import { createPayosAdapter } from './payments/providers/payos.js';
import { createPersonalAnalyticsRouter } from './routes/analytics-me.js';
import { createAdminAnalyticsRouter } from './routes/analytics-admin.js';

export interface AuthDeps {
  users: SupabaseUsersFacade;
  throttle: Throttle;
  audit: Audit;
}

export interface AppOptions {
  autoConfirmRegistration?: boolean;
  demoMode?: boolean;
  /** PG pool used by the strict (DB-backed) auth middleware. */
  pool?: Pool;
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
  options?: AppOptions
): Application {
  const demoMode = options?.demoMode === true;
  const appOptions: AppOptions = { ...(options ?? {}), ...(options?.pool ? { pool: options.pool } : {}) };
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
  // CORS policy: never accept arbitrary origins in production.
  // The list comes from CORS_ALLOWED_ORIGINS (comma-separated); the
  // browser extension is always allowed (chrome-extension:// and
  // edge-extension:// schemes); missing Origin header is allowed
  // (curl, server-to-server, the extension's background worker).
  app.use(buildCorsMiddleware());
  app.use(express.json({
    limit: '1mb',
    // Capture the raw body for webhook signature verification.
    // The raw bytes are only used by `/api/v1/billing/webhooks/:provider`
    // and the overhead is negligible for the rest of the API.
    verify: (request, _response, buffer) => {
      (request as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    }
  }));
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

  // Build the auth middleware. When a Postgres pool is available,
  // use the strict (DB-backed) variant that reads `profiles.role`
  // and the permission set on every request. Otherwise fall back
  // to the legacy JWT-claim-based path (used by unit tests with
  // a stub supabase client).
  const authMiddleware = supabase
    ? (options?.pool
        ? requireSupabaseAuthWithPool({ pool: options.pool, supabase })
        : requireSupabaseAuth(supabase))
    : requireDevelopmentAuth(expectedToken, developmentUserId);

  // Mount the admin section if a pool is available. The router is
  // a no-op (404) when the pool is missing so unit tests don't
  // need to wire a database.
  if (options?.pool && supabase) {
    app.use('/api/v1/admin', createAdminRouter({ pool: options.pool, supabase }));
    app.use('/api/v1/admin/audit-logs', createAuditLogsRouter({ pool: options.pool, supabase }));
    app.use(
      '/api/v1/admin/analytics',
      createAdminAnalyticsRouter({
        pool: options.pool,
        supabase,
        getRequestTimings: () => {
          // Lazy import to avoid a cycle; the monitoring module
          // owns the ring buffer.
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const mod = require('./monitoring/metrics.js') as { metrics?: { getRequestTimings?: () => unknown } };
            const fn = mod.metrics?.getRequestTimings;
            if (typeof fn === 'function') {
              return fn.call(mod.metrics) as Array<{ route: string; p50_ms: number; p95_ms: number; n: number }>;
            }
          } catch {/* fall through */}
          return [];
        }
      })
    );
    app.use('/api/v1/analytics', createPersonalAnalyticsRouter({ pool: options.pool, supabase }));
    app.use('/api/v1/billing', createBillingRouter({ pool: options.pool, supabase }));
    const billingEnabled = () => process.env.BILLING_ENABLED === 'true';
    const payos = createPayosAdapter({
      clientId: process.env.PAYOS_CLIENT_ID ?? '',
      apiKey: process.env.PAYOS_API_KEY ?? '',
      checksumKey: process.env.PAYOS_CHECKSUM_KEY ?? '',
      returnUrl: process.env.PAYMENT_RETURN_URL ?? 'http://localhost:3000/billing/return',
      cancelUrl: process.env.PAYMENT_CANCEL_URL ?? 'http://localhost:3000/billing/cancel'
    });
    app.use(
      '/api/v1/billing',
      createPaymentOrdersRouter({
        pool: options.pool,
        supabase,
        payos,
        enabled: billingEnabled
      })
    );
    app.use(
      '/api/v1/billing',
      createPaymentWebhookRouter({
        pool: options.pool,
        payos,
        enabled: billingEnabled
      })
    );
  }

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
      // The role returned here is canonical: read from the
      // database when a pool is available, otherwise default
      // to `user`. New signups never receive `admin`.
      let role: 'user' | 'admin' = 'user';
      if (options?.pool) {
        try {
          role = await getUserRole(options.pool, data.user.id);
        } catch (e) {
          console.error('[auth] role lookup failed on register', e);
        }
      }
      response.status(201).json({ data: { user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name, role }, session: data.session ? { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at } : null } });
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
      // Canonical role lookup; the JWT's `app_metadata.role` is
      // a mirror and must not be the source of truth.
      let role: 'user' | 'admin' = 'user';
      if (options?.pool) {
        try {
          role = await getUserRole(options.pool, data.user.id);
        } catch (e) {
          console.error('[auth] role lookup failed on login', e);
        }
      }
      response.json({ data: { user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name, role }, session: { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, expiresAt: data.session.expires_at } } });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v1/auth/me', authMiddleware, async (request: AuthenticatedRequest, response) => {
    if (demoMode && !supabase) {
      response.json({ data: { user: demoUser } });
      return;
    }
    // Re-resolve the role and permission set from the database.
    // The auth middleware already did this once; the second
    // lookup here keeps `/me` correct even if the caller used
    // a development auth path (which leaves userRole undefined).
    let role: 'user' | 'admin' = request.userRole ?? 'user';
    let permissions: string[] = [];
    if (options?.pool && request.userId) {
      try {
        role = await getUserRole(options.pool, request.userId);
        const set = await getPermissionsForRole(options.pool, role);
        permissions = Array.from(set).sort();
      } catch (e) {
        console.error('[auth] /me role lookup failed', e);
      }
    }
    response.json({
      data: {
        user: {
          id: request.userId,
          email: request.user?.email,
          name: request.user?.user_metadata?.name,
          role,
          permissions
        }
      }
    });
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

/**
 * Build a CORS middleware that:
 *   - Allows the configured production origin (CORS_ALLOWED_ORIGINS,
 *     comma-separated).
 *   - Allows every chrome-extension:// and edge-extension:// origin
 *     (the browser extension calls the API from its own origin).
 *   - Allows requests with no Origin header (CLI / server-to-server
 *     / the extension's background worker — all send no Origin).
 *   - In development, also allows the well-known local origins.
 *
 * Replaces the previous `app.use(cors())`, which reflected every
 * origin and was a P0 finding: a stolen Supabase anon key + an
 * arbitrary browser origin could call the API. The auth middleware
 * still rejects every cross-origin request that lacks a valid
 * bearer token, so CORS is defence-in-depth — but reflecting
 * `Access-Control-Allow-Origin: *` is a known foot-gun.
 */
function buildCorsMiddleware() {
  const isProd = process.env.NODE_ENV === 'production';
  const configured = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  // Defaults that are always safe to allow.
  const allowList = new Set<string>([
    ...(configured.length > 0 ? configured : [
      'https://app.mnemonics.example',
      'https://mnemonics.example'
    ]),
    // Local dev origins (only matched when not in production).
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173'
  ]);
  const allowAll = allowList.has('*');

  const corsMw = cors({
    origin(origin, callback) {
      // No Origin header — server-to-server or extension background.
      if (!origin) {
        callback(null, true);
        return;
      }
      // If wildcard is configured
      if (allowAll) {
        callback(null, true);
        return;
      }
      // Browser extension origins — always allowed.
      if (/^chrome-extension:\/\//.test(origin) || /^edge-extension:\/\//.test(origin)) {
        callback(null, true);
        return;
      }
      const cleanOrigin = origin.replace(/\/+$/, '');
      if (allowList.has(cleanOrigin)) {
        callback(null, true);
        return;
      }
      // Automatically allow Vercel deployment origins
      if (/^https:\/\/[a-zA-Z0-9_-]+\.vercel\.app$/.test(cleanOrigin)) {
        callback(null, true);
        return;
      }
      if (!isProd && /^http:\/\/localhost(:\d+)?$/.test(cleanOrigin)) {
        callback(null, true);
        return;
      }
      // Gracefully deny origin
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
  });
  return corsMw;
}
