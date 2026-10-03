import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_SERVER_ERROR',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
]);

export const OperationalErrorCodeSchema = z.enum([
  'OTP_REQUEST_ACCEPTED',
  'OTP_INVALID_OR_EXPIRED',
  'SESSION_REVOKED',
  'SESSION_INVALID',
  'OTP_RATE_LIMITED',
  'GPS_RETRY_REQUIRED',
  'GPS_UNAVAILABLE',
  'GPS_STALE',
  'GPS_INACCURATE',
  'INVALID_QR',
  'INACTIVE_CHECKIN_SESSION',
  'NO_REGISTRATION',
  'REGISTRATION_CANCELLED',
  'ALREADY_CHECKED_IN',
  'OUTSIDE_CHECKIN_WINDOW',
  'LOCATION_MISMATCH',
  'GPS_REQUIRED',
  'OUTSIDE_GEOFENCE',
  'IDEMPOTENCY_CONFLICT',
]);
export type OperationalErrorCode = z.infer<typeof OperationalErrorCodeSchema>;
export const GpsRecoveryActionSchema = z.enum(['RETRY', 'REFRESH']);
export type GpsRecoveryAction = z.infer<typeof GpsRecoveryActionSchema>;

export const GpsFailureDetailsSchema = z.object({
  action: GpsRecoveryActionSchema,
}).strict();
export type GpsFailureDetails = z.infer<typeof GpsFailureDetailsSchema>;
const CanonicalErrorCodeSchema = z.union([
  ErrorCodeSchema,
  OperationalErrorCodeSchema,
]);
export type ErrorCode = z.infer<typeof CanonicalErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  code: CanonicalErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
}).superRefine((value, ctx) => {
  if (!value.code.startsWith('GPS_')) return;
  const parsed = GpsFailureDetailsSchema.safeParse(value.details);
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['details'],
      message: 'GPS error details must contain only a safe recovery action',
    });
  }
});

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
