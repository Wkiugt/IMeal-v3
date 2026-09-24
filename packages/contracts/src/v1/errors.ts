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
  'PICKUP_INTENT_CONFLICT',
  'PICKUP_SESSION_EXPIRED',
  'IDEMPOTENCY_CONFLICT',
  'GPS_SESSION_REQUIRED',
  'GPS_FIX_TOO_OLD',
  'GPS_ACCURACY_TOO_LOW',
  'SERVING_WINDOW_CLOSED',
  'QR_EXPIRED',
  'QR_INVALID',
  'EXACT_INTENT_REQUIRED',
  'SESSION_INVALID',
  'OTP_RATE_LIMITED',
]);
export type PickupErrorCode = z.infer<typeof PickupErrorCodeSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});

export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
