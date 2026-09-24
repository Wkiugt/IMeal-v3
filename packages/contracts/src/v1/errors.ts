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

export const PickupErrorCodeSchema = z.enum([
  'OTP_REQUEST_ACCEPTED',
  'OTP_INVALID_OR_EXPIRED',
  'SESSION_REVOKED',
  'GPS_RETRY_REQUIRED',
  'GPS_UNAVAILABLE',
  'GPS_STALE',
  'GPS_INACCURATE',
  'PICKUP_INTENT_REQUIRED',
  'PICKUP_INTENT_CONFLICT',
  'PICKUP_SESSION_EXPIRED',
  'IDEMPOTENCY_CONFLICT',
  'GPS_SESSION_REQUIRED',
  'SERVING_WINDOW_CLOSED',
  'QR_EXPIRED',
  'QR_INVALID',
  'SESSION_INVALID',
  'OTP_RATE_LIMITED',
]);
export type PickupErrorCode = z.infer<typeof PickupErrorCodeSchema>;
export const GpsRecoveryActionSchema = z.enum(['RETRY', 'REFRESH']);
export type GpsRecoveryAction = z.infer<typeof GpsRecoveryActionSchema>;

export const GpsFailureDetailsSchema = z.object({
  action: GpsRecoveryActionSchema,
}).strict();
export type GpsFailureDetails = z.infer<typeof GpsFailureDetailsSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
