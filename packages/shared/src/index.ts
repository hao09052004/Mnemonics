import { z } from 'zod';
export * from './auth.js';

export const userRoles = ['user', 'admin'] as const;
export type UserRole = (typeof userRoles)[number];

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(userRoles)
});
export type User = z.infer<typeof userSchema>;

export const sessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  expiresAt: z.number().int().positive().optional(),
  user: userSchema
});
export type AuthSession = z.infer<typeof sessionSchema>;

export const authCredentialsSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(6).max(128),
  name: z.string().trim().min(1).max(200).optional()
}).strict();
export type AuthCredentials = z.infer<typeof authCredentialsSchema>;

export const dashboardSummarySchema = z.object({
  totalCaptures: z.number().int().nonnegative(),
  pendingCaptures: z.number().int().nonnegative(),
  readyCaptures: z.number().int().nonnegative(),
  totalUsers: z.number().int().nonnegative().optional()
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;

export const captureTypes = ['link', 'text', 'image', 'screenshot', 'document'] as const;
export type CaptureType = (typeof captureTypes)[number];

export const itemStatuses = ['pending', 'processing', 'ready', 'failed'] as const;
export type ItemStatus = (typeof itemStatuses)[number];

const sourceUrlSchema = z.string().trim().url().max(2048).optional();
const capturedAtSchema = z.string().datetime({ offset: true }).optional();

const imageReferenceSchema = z.object({
  storageKey: z.string().trim().min(1).max(512).refine((value) => !value.startsWith('data:'), {
    message: 'Image data URLs are not accepted; upload the asset to storage first'
  }),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().positive().max(10 * 1024 * 1024)
}).strict();

/**
 * Document reference for the `document` capture shape. Like the image
 * reference, the storage key is a placeholder at validation time and is
 * rewritten by the multipart route after the bytes are uploaded to object
 * storage. The MIME type is locked to a closed list of supported document
 * kinds so the route does not have to second-guess the client.
 */
export const documentMimeTypes = [
  'application/pdf',
  'text/plain',
  'text/markdown'
] as const;
export type DocumentMimeType = (typeof documentMimeTypes)[number];

export const documentReferenceSchema = z.object({
  storageKey: z.string().trim().min(1).max(512),
  mimeType: z.enum(documentMimeTypes),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  originalFilename: z.string().trim().min(1).max(255).optional()
}).strict();

export const captureInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('link'),
    title: z.string().trim().min(1).max(500),
    sourceUrl: sourceUrlSchema,
    selectedText: z.string().trim().max(100_000).optional(),
    capturedAt: capturedAtSchema,
    clientRequestId: z.string().uuid()
  }).strict(),
  z.object({
    type: z.literal('text'),
    title: z.string().trim().min(1).max(500),
    sourceUrl: sourceUrlSchema,
    selectedText: z.string().trim().min(1).max(100_000),
    capturedAt: capturedAtSchema,
    clientRequestId: z.string().uuid()
  }).strict(),
  z.object({
    type: z.literal('image'),
    title: z.string().trim().min(1).max(500),
    sourceUrl: sourceUrlSchema,
    image: imageReferenceSchema,
    selectedText: z.string().trim().max(100_000).optional(),
    capturedAt: capturedAtSchema,
    clientRequestId: z.string().uuid()
  }).strict(),
  // `screenshot` is the extension's screenshot flow. The capture
  // shape is identical to `image`; we keep them as separate types
  // so the OCR + visual-similarity pipeline can prefer the right
  // side of the same code path without forcing the schema to grow
  // a discriminator field.
  z.object({
    type: z.literal('screenshot'),
    title: z.string().trim().min(1).max(500),
    sourceUrl: sourceUrlSchema,
    image: imageReferenceSchema,
    selectedText: z.string().trim().max(100_000).optional(),
    capturedAt: capturedAtSchema,
    clientRequestId: z.string().uuid()
  }).strict(),
  // `document` captures an uploaded PDF / TXT / Markdown file. The
  // route is multipart-only, so the storage key is a placeholder at
  // schema-validation time and gets rewritten before the item is
  // inserted (mirrors how `image` / `screenshot` work).
  z.object({
    type: z.literal('document'),
    title: z.string().trim().min(1).max(500),
    sourceUrl: sourceUrlSchema,
    document: documentReferenceSchema,
    selectedText: z.string().trim().max(100_000).optional(),
    capturedAt: capturedAtSchema,
    clientRequestId: z.string().uuid()
  }).strict()
]);

export type CaptureInput = z.infer<typeof captureInputSchema>;

export const captureResponseSchema = z.object({
  data: z.object({
    id: z.string().uuid(),
    status: z.enum(itemStatuses)
  })
});
export type CaptureResponse = z.infer<typeof captureResponseSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1)
  })
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export function normalizeCapture(input: CaptureInput) {
  return {
    type: input.type,
    title: input.title,
    sourceUrl: input.sourceUrl ?? null,
    rawText: input.type === 'text' || input.type === 'link'
      ? input.selectedText ?? null
      : input.selectedText ?? null,
    capturedAt: input.capturedAt ? new Date(input.capturedAt) : new Date(),
    clientRequestId: input.clientRequestId
  };
}