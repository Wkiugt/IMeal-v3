import { z } from 'zod';

const EmailSchema = z.string().email();
const UtcDateTimeSchema = z.string().datetime({ offset: false }).refine((value) => value.endsWith('Z'), {
  message: 'Timestamp must be an ISO-8601 UTC instant ending in Z',
});

export const OtpPurposeSchema = z.literal('SESSION_LOGIN');
export type OtpPurpose = z.infer<typeof OtpPurposeSchema>;

export const RequestOtpSchema = z.object({ email: EmailSchema, purpose: OtpPurposeSchema }).strict();
export type RequestOtpInput = z.infer<typeof RequestOtpSchema>;

export const RequestOtpResponseSchema = z.object({
  accepted: z.literal(true),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
}).strict();
export type RequestOtpResponse = z.infer<typeof RequestOtpResponseSchema>;

export const VerifyOtpSchema = z.object({
  email: EmailSchema,
  purpose: OtpPurposeSchema,
  code: z.string().min(1),
}).strict();
export type VerifyOtpInput = z.infer<typeof VerifyOtpSchema>;

export const VerifyOtpResponseSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: UtcDateTimeSchema,
  user: z.object({ id: z.string().min(1), email: EmailSchema, name: z.string().nullable() }).strict(),
}).strict();
export type VerifyOtpResponse = z.infer<typeof VerifyOtpResponseSchema>;

export const LogoutResponseSchema = z.object({ revoked: z.literal(true) }).strict();
export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;
