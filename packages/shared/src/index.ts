import { z } from 'zod';

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

export const captureTypes = ['link', 'text', 'image'] as const;
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