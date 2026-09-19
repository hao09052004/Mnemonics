import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

// Strong password rule: at least 10 chars, with at least one lowercase, one
// uppercase, one digit, one symbol (any non-alphanumeric Unicode).
const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128)
  .refine((v) => /[a-z]/.test(v), 'Password must include a lowercase letter')
  .refine((v) => /[A-Z]/.test(v), 'Password must include an uppercase letter')
  .refine((v) => /\d/.test(v),    'Password must include a digit')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Password must include a symbol');

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Name must not contain control characters')
  .optional();

export const registerInputSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: nameSchema
  })
  .strict();
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128)
  })
  .strict();
export type LoginInput = z.infer<typeof loginInputSchema>;

export const refreshInputSchema = z
  .object({
    refreshToken: z.string().min(20).max(8192)
  })
  .strict();
export type RefreshInput = z.infer<typeof refreshInputSchema>;

export const forgotInputSchema = z
  .object({ email: emailSchema })
  .strict();
export type ForgotInput = z.infer<typeof forgotInputSchema>;

export const resetInputSchema = z
  .object({
    accessToken: z.string().min(20).max(8192),
    refreshToken: z.string().min(20).max(8192),
    newPassword: passwordSchema
  })
  .strict();
export type ResetInput = z.infer<typeof resetInputSchema>;

export const authUserDtoSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().trim().max(80).nullable(),
  role: z.enum(['user', 'admin']),
  emailVerified: z.boolean()
});
export type AuthUserDto = z.infer<typeof authUserDtoSchema>;

export const authSessionDtoSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.number().int().positive(),
  tokenType: z.literal('bearer')
});
export type AuthSessionDto = z.infer<typeof authSessionDtoSchema>;

export const authEnvelopeSchema = z.object({
  data: z.object({
    user: authUserDtoSchema.nullable(),
    session: authSessionDtoSchema.nullable()
  })
});
export type AuthEnvelope = z.infer<typeof authEnvelopeSchema>;
