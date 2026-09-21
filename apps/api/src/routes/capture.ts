/**
 * Capture Routes with Job Queue Integration
 *
 * Handles capture creation and automatically enqueues processing jobs.
 */

import express, { type Application, type Response } from 'express';
import multer from 'multer';
import { captureInputSchema } from '@mnemonics/shared';
import type { ItemRepository } from '@mnemonics/database';
import type { ImageStorage } from '../storage.js';
import type { AuthenticatedRequest } from '../auth.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface CaptureRouterDeps {
  repository: ItemRepository;
  imageStorage?: ImageStorage;
  createJob?: (type: 'ocr' | 'tag' | 'embed', itemId: string, userId: string) => Promise<unknown>;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
});

export function createCaptureRouter(deps: CaptureRouterDeps): Application {
  const { repository, imageStorage, createJob, supabase, expectedToken, developmentUserId } = deps;
  const router = express.Router() as Application;

  // Simple auth middleware
  const requireAuth = async (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing authorization header' } });
        return;
      }

      const token = authHeader.slice(7);

      if (supabase) {
        // Real Supabase auth validation
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
          res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
          return;
        }
        req.userId = user.id;
        req.user = user;
      } else {
        // Development auth
        if (token !== (expectedToken || 'mnemonics-dev-token')) {
          res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
          return;
        }
        req.userId = developmentUserId || '00000000-0000-4000-8000-000000000001';
      }
      next();
    } catch (error) {
      next(error);
    }
  };

  // POST /api/v1/captures - Create text/link capture
  router.post(
    '/captures',
    requireAuth,
    async (request: AuthenticatedRequest, response: Response, next: (error: unknown) => void) => {
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

        if (existing) {
          response.status(200).json({ data: { id: existing.id, status: existing.status } });
          return;
        }

        const item = await repository.createPendingItem({ userId, capture });

        // Enqueue jobs based on capture type
        if (createJob) {
          // For text/link: enqueue tag and embed jobs directly
          await createJob('tag', item.id, userId);
          await createJob('embed', item.id, userId);
        }

        response.status(201).json({ data: { id: item.id, status: item.status } });
      } catch (error) {
        next(error);
      }
    }
  );

  // POST /api/v1/captures/image - Create image capture
  router.post(
    '/captures/image',
    requireAuth,
    imageUpload.single('file'),
    async (request: AuthenticatedRequest, response: Response, next: (error: unknown) => void) => {
      let storageKey: string | undefined;

      try {
        if (!imageStorage) {
          response.status(503).json({
            error: { code: 'IMAGE_STORAGE_NOT_CONFIGURED', message: 'Image storage chưa được cấu hình', requestId: request.id }
          });
          return;
        }

        if (!request.file) {
          response.status(400).json({
            error: { code: 'IMAGE_FILE_REQUIRED', message: 'Cần gửi file ảnh', requestId: request.id }
          });
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
          response.status(400).json({
            error: { code: 'INVALID_IMAGE_CAPTURE_PAYLOAD', message: 'Thông tin ảnh không hợp lệ', requestId: request.id }
          });
          return;
        }

        const userId = request.userId!;
        const itemId = crypto.randomUUID();
        storageKey = `${userId}/${itemId}/${request.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

        if (parsed.data.type !== 'image') {
          response.status(400).json({
            error: { code: 'INVALID_IMAGE_CAPTURE_PAYLOAD', message: 'Thông tin ảnh không hợp lệ', requestId: request.id }
          });
          return;
        }

        const capture = { ...parsed.data, image: { ...parsed.data.image, storageKey } };

        // Upload to storage
        await imageStorage.upload({
          storageKey,
          buffer: request.file.buffer,
          mimeType: request.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp'
        });

        // Create item
        const item = await repository.createPendingImageItem({ userId, itemId, capture });

        // Enqueue jobs for images: OCR -> tag -> embed
        if (createJob) {
          await createJob('ocr', item.id, userId);
          await createJob('tag', item.id, userId);
          await createJob('embed', item.id, userId);
        }

        // Generate signed URL for image
        let signedUrl: string | undefined;
        if (typeof imageStorage.createSignedUrl === 'function') {
          signedUrl = (await imageStorage.createSignedUrl(storageKey, 60 * 60 * 24 * 30).catch(() => null)) ?? undefined;
        }

        response.status(201).json({ data: { id: item.id, status: item.status, storageKey, signedUrl } });
      } catch (error) {
        if (storageKey && imageStorage) {
          await imageStorage.remove(storageKey).catch(() => undefined);
        }
        next(error);
      }
    }
  );

  return router;
}
