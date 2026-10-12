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

/**
 * Optional parsed page metadata sent alongside a capture.
 *
 * Added in M1 of spec 0005. The schema is permissive on shape (it
 * only constrains the keys the server reads today) and `strict()`
 * so a misspelled field is rejected at the API boundary instead
 * of being silently dropped.
 */
export const sourceMetadataSchema = z
  .object({
    ogTitle: z.string().max(2000).optional(),
    ogDescription: z.string().max(5000).optional(),
    ogImage: z.string().url().max(2048).optional(),
    canonicalUrl: z.string().url().max(2048).optional(),
    jsonLd: z.array(z.record(z.unknown())).max(20).optional(),
    article: z
      .object({
        title: z.string().max(2000).optional(),
        byline: z.string().max(500).optional(),
        excerpt: z.string().max(2000).optional(),
        contentHtml: z.string().max(500_000).optional(),
        textContent: z.string().max(100_000).optional()
      })
      .nullable()
      .optional(),
    contentHash: z.string().max(128).optional()
  })
  .strict();
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>;

export const captureInputSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('link'),
    title: z.string().trim().min(1).max(500),
    sourceUrl: sourceUrlSchema,
    selectedText: z.string().trim().max(100_000).optional(),
    capturedAt: capturedAtSchema,
    clientRequestId: z.string().uuid(),
    sourceMetadata: sourceMetadataSchema.optional()
  }).strict(),
  z.object({
    type: z.literal('text'),
    title: z.string().trim().min(1).max(500),
    sourceUrl: sourceUrlSchema,
    selectedText: z.string().trim().min(1).max(100_000),
    capturedAt: capturedAtSchema,
    clientRequestId: z.string().uuid(),
    sourceMetadata: sourceMetadataSchema.optional()
  }).strict(),
  z.object({
    type: z.literal('image'),
    title: z.string().trim().min(1).max(500),
    sourceUrl: sourceUrlSchema,
    image: imageReferenceSchema,
    selectedText: z.string().trim().max(100_000).optional(),
    capturedAt: capturedAtSchema,
    clientRequestId: z.string().uuid(),
    sourceMetadata: sourceMetadataSchema.optional()
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
    clientRequestId: z.string().uuid(),
    sourceMetadata: sourceMetadataSchema.optional()
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
    clientRequestId: z.string().uuid(),
    sourceMetadata: sourceMetadataSchema.optional()
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

/* -------------------------------------------------------------------------- */
/*  Search / Smart Spaces (spec 0005 §7)                                      */
/* -------------------------------------------------------------------------- */

/** Semantic kinds written by the classifier (spec 0005 §5.2). */
export const detectedTypeSchema = z.enum([
  'article','product','recipe','video','quote','highlight',
  'webpage','image','note','document','other'
]);

/**
 * The new "structured" filter group. Each field is an
 * any-of match against the same key on
 * `item_classifications`; distinct fields are AND-ed.
 */
export const searchFiltersStructuredSchema = z.object({
  detectedType: z.array(detectedTypeSchema).optional(),
  category: z.array(z.string().min(1).max(80)).max(16).optional(),
  brand: z.array(z.string().min(1).max(80)).max(16).optional(),
  material: z.array(z.string().min(1).max(80)).max(16).optional(),
  color: z.array(z.string().min(1).max(80)).max(16).optional(),
  merchant: z.array(z.string().min(1).max(80)).max(16).optional(),
  author: z.array(z.string().min(1).max(120)).max(16).optional()
}).strict();

/** Content kinds (storage shape, unchanged). */
export const searchKindSchema = z.enum([
  'link','text','image','screenshot','document'
]);

/**
 * The full filter object the search route and Smart Spaces
 * accept. `structured` is new in M3; everything else is
 * unchanged.
 */
export const searchFiltersSchema = z.object({
  tags: z.array(z.string().min(1).max(80)).max(32).optional(),
  kind: z.array(searchKindSchema).optional(),
  captured_after: z.string().datetime({ offset: true }).optional(),
  captured_before: z.string().datetime({ offset: true }).optional(),
  favorite: z.boolean().optional(),
  structured: searchFiltersStructuredSchema.optional()
}).strict();
export type SearchFilters = z.infer<typeof searchFiltersSchema>;

export const searchRequestSchema = z.object({
  q: z.string().max(500).optional(),
  filters: searchFiltersSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  offset: z.number().int().min(0).optional()
}).strict();
export type SearchRequest = z.infer<typeof searchRequestSchema>;

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