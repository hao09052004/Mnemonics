import cors from 'cors';
import express, { type Application, type ErrorRequestHandler, type Request, type Response } from 'express';
import multer from 'multer';
import { authCredentialsSchema, captureInputSchema } from '@mnemonics/shared';
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
  options?: { autoConfirmRegistration?: boolean }
): Application {
  const app = express();
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_request, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
  });
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use((request: Request, _response: Response, next) => {
    request.id = request.header('x-request-id') || createRequestId();
    next();
  });

  // Mount the unified auth router if dependencies were provided. The
  // pre-existing /auth/me, /register, /login routes in this file are kept
  // for backwards compatibility but will be shadowed by the router when it
  // is mounted (Express's `app.use` order matters: we mount the router
  // before the legacy inline handlers, so the router wins).
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

  // Image proxy for the browser extension. Extension background fetch gets
  // blocked by CORS for cross-origin images (Facebook CDN, Instagram, etc.),
  // so the extension sends the image URL here and we fetch server-to-server
  // (no CORS) and stream the bytes back. Allow-listed by hostname to avoid
  // SSRF. Intentionally NOT auth-gated because the extension only proxies
  // images already visible on the user's current page.
  app.get('/api/v1/proxy/image', imageProxyHandler);

  const authMiddleware = supabase
    ? requireSupabaseAuth(supabase)
    : requireDevelopmentAuth(expectedToken, developmentUserId);

  app.post('/api/v1/auth/register', async (request, response, next) => {
    try {
      if (!supabase) {
        response.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Supabase Auth chưa được cấu hình', requestId: request.id } });
        return;
      }
      const parsed = authCredentialsSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'INVALID_AUTH_PAYLOAD', message: 'Thông tin đăng ký không hợp lệ', requestId: request.id } });
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
      if (!supabase) {
        response.status(503).json({ error: { code: 'AUTH_NOT_CONFIGURED', message: 'Supabase Auth chưa được cấu hình', requestId: request.id } });
        return;
      }
      const parsed = authCredentialsSchema.pick({ email: true, password: true }).safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: { code: 'INVALID_AUTH_PAYLOAD', message: 'Thông tin đăng nhập không hợp lệ', requestId: request.id } });
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
    response.json({ data: { user: { id: request.userId, email: request.user?.email, name: request.user?.user_metadata?.name, role: request.userRole || 'user' } } });
  });

  app.post(
    '/api/v1/captures',
    authMiddleware,
    async (request: AuthenticatedRequest, response: Response, next) => {
      try {
        const parsed = captureInputSchema.safeParse(request.body);
        if (!parsed.success) {
          response.status(400).json({
            error: { code: 'INVALID_CAPTURE_PAYLOAD', message: 'Dữ liệu lưu không hợp lệ', requestId: request.id }
          });
          return;
        }

        const userId = request.userId;
        if (!userId) {
          response.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Xác thực không hợp lệ', requestId: request.id }
          });
          return;
        }

        const capture = parsed.data;
        const existing = await repository.findByClientRequestId(userId, capture.clientRequestId);
        const item = existing ?? await repository.createPendingItem({ userId, capture });
        response.status(existing ? 200 : 201).json({ data: { id: item.id, status: item.status } });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/api/v1/captures/image',
    authMiddleware,
    imageUpload.single('file'),
    async (request: AuthenticatedRequest, response: Response, next) => {
      let storageKey: string | undefined;
      try {
        if (!imageStorage) {
          response.status(503).json({ error: { code: 'IMAGE_STORAGE_NOT_CONFIGURED', message: 'Image storage chưa được cấu hình', requestId: request.id } });
          return;
        }
        if (!request.file) {
          response.status(400).json({ error: { code: 'IMAGE_FILE_REQUIRED', message: 'Cần gửi file ảnh', requestId: request.id } });
          return;
        }

        const parsed = captureInputSchema.safeParse({
          type: 'image',
          title: request.body.title,
          sourceUrl: request.body.sourceUrl || undefined,
          selectedText: request.body.note || undefined,
          capturedAt: request.body.capturedAt || undefined,
          clientRequestId: request.body.clientRequestId,
          image: {
            storageKey: 'pending-upload',
            mimeType: request.file.mimetype,
            sizeBytes: request.file.size
          }
        });
        if (!parsed.success) {
          response.status(400).json({ error: { code: 'INVALID_IMAGE_CAPTURE_PAYLOAD', message: 'Thông tin ảnh không hợp lệ', requestId: request.id } });
          return;
        }

        const itemId = crypto.randomUUID();
        storageKey = `${request.userId}/${itemId}/${request.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        if (parsed.data.type !== 'image') {
          response.status(400).json({ error: { code: 'INVALID_IMAGE_CAPTURE_PAYLOAD', message: 'Thông tin ảnh không hợp lệ', requestId: request.id } });
          return;
        }
        const capture = { ...parsed.data, image: { ...parsed.data.image, storageKey } };
        await imageStorage.upload({ storageKey, buffer: request.file.buffer, mimeType: request.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp' });
        const item = await repository.createPendingImageItem({ userId: request.userId!, itemId, capture });
        response.status(201).json({ data: { id: item.id, status: item.status, storageKey } });
      } catch (error) {
        if (storageKey && imageStorage) await imageStorage.remove(storageKey).catch(() => undefined);
        next(error);
      }
    }
  );

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