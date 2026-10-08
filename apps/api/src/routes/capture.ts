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
  createJob?: (type: 'ocr' | 'tag' | 'embed' | 'enrich' | 'extract_document', itemId: string, userId: string) => Promise<unknown>;
  supabase?: SupabaseClient;
  expectedToken?: string;
  developmentUserId?: string;
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
});

/**
 * Document capture upload. 20 MiB cap (matches the `assets.size_bytes`
 * CHECK added in migration 019) and a closed MIME list so the file
 * filter rejects anything that isn't an actual PDF/TXT/Markdown file.
 *
 * We deliberately do NOT trust the browser-reported MIME alone — the
 * route handler re-derives the canonical MIME from the declared value AND
 * the filename extension. A browser that sent `application/octet-stream`
 * for a `.pdf` is still accepted when the extension matches; the inverse
 * (claimed `text/plain` for `.pdf`) is rejected.
 */
const DOCUMENT_MIME_TYPES = ['application/pdf', 'text/plain', 'text/markdown'] as const;
const DOCUMENT_EXT_BY_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/markdown': '.md'
};
const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: DOCUMENT_MAX_BYTES },
  fileFilter: (_request, file, callback) => {
    const lower = String(file.originalname || '').toLowerCase();
    const m = (file.mimetype || '').toLowerCase();
    // Browsers sometimes emit `application/octet-stream` for a `.pdf`
    // we just dragged in; fall back to the extension in that case.
    const effectiveMime = (DOCUMENT_MIME_TYPES as readonly string[]).includes(m)
      ? m
      : lower.endsWith('.pdf') ? 'application/pdf'
      : lower.endsWith('.txt') ? 'text/plain'
      : lower.endsWith('.md') || lower.endsWith('.markdown') ? 'text/markdown'
      : '';
    if (!effectiveMime) {
      callback(new Error('UNSUPPORTED_DOCUMENT_MIME'));
      return;
    }
    callback(null, true);
  }
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
          // Tag is the first stage. TagHandler enqueues embedding after success.
          await createJob('tag', item.id, userId);
          // Memory Understanding is enrichment, not a save boundary.
          // It runs after tagging so the caption + tldr can use the
          // generated tags.
          try {
            await createJob('enrich', item.id, userId);
          } catch {
            // queue might not have 'enrich' registered; that's fine.
          }
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
          type: request.body.type === 'image' ? 'image' : 'screenshot',
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
        const existing = await repository.findByClientRequestId(userId, parsed.data.clientRequestId);
        if (existing) {
          response.status(200).json({ data: { id: existing.id, status: existing.status } });
          return;
        }

        const itemId = crypto.randomUUID();
        // Build a safe, deterministic storage key. We MUST keep the
        // MIME-derived extension so Supabase can serve the bytes back
        // with the right `Content-Type`; otherwise the signed URL hands
        // the browser `application/octet-stream` and Chrome refuses to
        // render it as an image.
        const safeBaseName = request.file.originalname
          .replace(/[^a-zA-Z0-9._-]/g, '_')
          .replace(/^\.+/, '')
          .slice(0, 100) || 'image';
        const mimeExt = (() => {
          switch (request.file.mimetype) {
            case 'image/jpeg': return 'jpg';
            case 'image/png': return 'png';
            case 'image/webp': return 'webp';
            case 'image/gif': return 'gif';
            default: return '';
          }
        })();
        const hasExt = /\.(jpe?g|png|webp|gif)$/i.test(safeBaseName);
        const finalName = hasExt ? safeBaseName : `${safeBaseName}.${mimeExt || 'jpg'}`;
        storageKey = `${userId}/${itemId}/${finalName}`;

        if (parsed.data.type !== 'image' && parsed.data.type !== 'screenshot') {
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

        // Images are ordered: OCR -> tag -> embed.
        // Each successful handler enqueues the next stage.
        if (createJob) {
          await createJob('ocr', item.id, userId);
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

  // POST /api/v1/captures/document - Create document capture (PDF / TXT / Markdown)
  router.post(
    '/captures/document',
    requireAuth,
    documentUpload.single('file'),
    // Translate multer's fileFilter / fileSize errors (thrown synchronously
    // by the middleware above) into the canonical 413 / 415. Without
    // this shim, the global error handler returns 500 and the
    // user-facing message is the multer default. Express invokes a
    // 4-argument middleware as an error handler in the order it is
    // mounted, regardless of how many middleware preceded it.
    (err: unknown, _req: AuthenticatedRequest, res: Response, nextFn: (err?: unknown) => void) => {
      const msg = err instanceof Error ? err.message : String(err ?? '');
      if (/UNSUPPORTED_DOCUMENT_MIME/.test(msg)) {
        res.status(415).json({
          error: { code: 'UNSUPPORTED_DOCUMENT_MIME', message: 'Định dạng tài liệu không được hỗ trợ', requestId: (_req as { id?: string }).id }
        });
        return;
      }
      if (/File too large/i.test(msg)) {
        res.status(413).json({
          error: { code: 'DOCUMENT_TOO_LARGE', message: 'Tệp vượt quá 20MB', requestId: (_req as { id?: string }).id }
        });
        return;
      }
      nextFn(err);
    },
    async (request: AuthenticatedRequest, response: Response, next: (error: unknown) => void) => {
      let storageKey: string | undefined;
      try {
        if (!imageStorage) {
          response.status(503).json({
            error: { code: 'DOCUMENT_STORAGE_NOT_CONFIGURED', message: 'Document storage chưa được cấu hình', requestId: request.id }
          });
          return;
        }

        if (!request.file) {
          response.status(400).json({
            error: { code: 'DOCUMENT_FILE_REQUIRED', message: 'Cần gửi file tài liệu', requestId: request.id }
          });
          return;
        }

        // Re-derive the MIME from the extension when the browser
        // reported a generic `application/octet-stream` (Chrome does
        // this for some PDFs). The multer filter above rejects
        // anything genuinely unsupported, so by the time we get here
        // `request.file.mimetype` is one of the supported values OR a
        // generic octet-stream with a supported extension.
        const rawMime = String(request.file.mimetype || '').toLowerCase();
        const lowerName = String(request.file.originalname || '').toLowerCase();
        const mimeType = (DOCUMENT_MIME_TYPES as readonly string[]).includes(rawMime)
          ? (rawMime as typeof DOCUMENT_MIME_TYPES[number])
          : lowerName.endsWith('.pdf') ? 'application/pdf'
          : lowerName.endsWith('.txt') ? 'text/plain'
          : (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) ? 'text/markdown'
          : null;

        if (!mimeType) {
          response.status(415).json({
            error: { code: 'UNSUPPORTED_DOCUMENT_MIME', message: 'Định dạng tài liệu không được hỗ trợ', requestId: request.id }
          });
          return;
        }

        const parsed = captureInputSchema.safeParse({
          type: 'document',
          title: request.body.title,
          sourceUrl: request.body.sourceUrl || undefined,
          document: {
            storageKey: 'pending-upload',
            mimeType,
            sizeBytes: request.file.size,
            originalFilename: request.file.originalname
          },
          capturedAt: request.body.capturedAt || undefined,
          clientRequestId: request.body.clientRequestId
        });

        if (!parsed.success) {
          response.status(400).json({
            error: { code: 'INVALID_DOCUMENT_CAPTURE_PAYLOAD', message: 'Thông tin tài liệu không hợp lệ', requestId: request.id }
          });
          return;
        }

        const userId = request.userId!;
        const existing = await repository.findByClientRequestId(userId, parsed.data.clientRequestId);
        if (existing) {
          response.status(200).json({ data: { id: existing.id, status: existing.status } });
          return;
        }

        const itemId = crypto.randomUUID();

        // Sanitize the filename: strip path traversal, control chars,
        // and any leading dots (we never want a `.env` key in the
        // bucket). The output is a single safe basename that we pair
        // with the canonical extension so the served bytes come back
        // with the right Content-Type.
        const safeBaseName = sanitizeFilename(request.file.originalname) || 'document';
        const requiredExt = DOCUMENT_EXT_BY_MIME[mimeType] ?? '';
        const hasExt = requiredExt && lowerName.endsWith(requiredExt);
        const finalName = hasExt ? safeBaseName : `${safeBaseName}${requiredExt}`;
        storageKey = `${userId}/${itemId}/${finalName}`;

        // `parsed.data` is the discriminated union — only the `document`
        // branch has a `document` field, so the cast is safe after the
        // schema validated `type === 'document'`.
        if (parsed.data.type !== 'document') {
          response.status(400).json({
            error: { code: 'INVALID_DOCUMENT_CAPTURE_PAYLOAD', message: 'Thông tin tài liệu không hợp lệ', requestId: request.id }
          });
          return;
        }
        const capture = {
          ...parsed.data,
          document: { ...parsed.data.document, storageKey }
        };

        // Upload to storage FIRST. If the upload succeeds and the DB
        // insert fails, the orphan cleanup below removes the object.
        // If the upload itself fails, no DB row exists and we surface
        // the failure to the caller (no item, no object).
        await imageStorage.uploadDocument({
          storageKey,
          buffer: request.file.buffer,
          mimeType,
          sizeBytes: request.file.size,
          originalFilename: request.file.originalname
        });

        let item;
        try {
          item = await repository.createPendingDocumentItem({ userId, itemId, capture });
        } catch (dbErr) {
          // Storage is uploaded but the DB insert failed. Remove the
          // orphan object so a retry doesn't accumulate duplicates.
          // Mark the rethrown error with a private code so the outer
          // catch below does not attempt to remove the same key again.
          await imageStorage.remove(storageKey).catch(() => undefined);
          const tagged = new Error('DB_ROLLBACKS_OBJECT');
          tagged.cause = dbErr;
          throw tagged;
        }

        // Enqueue the extraction job. Document pipeline:
        //   extract_document → tag → embed → (enrich, best-effort)
        // The extract handler is responsible for kicking off the rest
        // of the chain; we do NOT enqueue them here. If the queue is
        // not configured (test pools), we keep the item durably
        // accepted and the user can manually retry via the existing
        // `/api/v1/items/:id/jobs/:type` endpoint.
        if (createJob) {
          try {
            await createJob('extract_document', item.id, userId);
          } catch (err) {
            console.warn(
              `[capture/document] extract enqueue failed (item=${item.id}):`,
              err instanceof Error ? err.message : err
            );
          }
        }

        let signedUrl: string | undefined;
        if (typeof imageStorage.createSignedUrl === 'function') {
          signedUrl = (await imageStorage.createSignedUrl(storageKey, 60 * 60 * 24 * 30).catch(() => null)) ?? undefined;
        }

        response.status(201).json({
          data: {
            id: item.id,
            status: item.status,
            storageKey,
            signedUrl,
            mimeType,
            sizeBytes: request.file.size,
            originalFilename: request.file.originalname
          }
        });
      } catch (error) {
        // Storage upload failed mid-route. The DB-failure path was
        // handled inside the inner catch and surfaces as
        // `DB_ROLLBACKS_OBJECT`; the outer catch must NOT attempt a
        // second `remove()` on the same key (it would be a no-op but
        // confusing in tests).
        const inner = error instanceof Error ? error : new Error(String(error));
        if (inner.message === 'DB_ROLLBACKS_OBJECT') {
          const cause = (inner.cause as Error | undefined) ?? inner;
          next(cause);
          return;
        }
        if (storageKey && imageStorage) {
          await imageStorage.remove(storageKey).catch(() => undefined);
        }
        next(error);
      }
    }
  );

  return router;
}

/**
 * Strip a filename down to a single safe basename. Path separators
 * are collapsed into a single `_`, control characters and dots at the
 * start of the name are stripped, and the result is truncated to fit
 * Supabase's recommended filename length. We always keep at least one
 * printable character (defaults to `document`) so a 1-character name
 * like `.` doesn't end up as an empty string.
 */
function sanitizeFilename(name: string): string {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '';
  // Take the basename only — slashes and backslashes are path separators.
  const basename = trimmed.split(/[\\/]/).pop() || '';
  // Replace any character outside [A-Za-z0-9._-] with `_`. Unicode is
  // folded to `_` so the result is always ASCII (Supabase object
  // names are happiest with ASCII).
  const ascii = basename.replace(/[^A-Za-z0-9._-]/g, '_');
  // Collapse runs of underscores.
  const collapsed = ascii.replace(/_+/g, '_').replace(/^\.+/, '');
  // Strip trailing dots and underscores.
  const cleaned = collapsed.replace(/[._]+$/, '');
  return cleaned.slice(0, 100);
}
