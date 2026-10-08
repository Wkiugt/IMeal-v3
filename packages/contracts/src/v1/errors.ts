import { z } from 'zod';

export const PUBLIC_ERROR_CODE_VALUES = [
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'REQUEST_TIMEOUT',
  'CONFLICT',
  'GONE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UNPROCESSABLE_ENTITY',
  'INTERNAL_SERVER_ERROR',
  'NOT_IMPLEMENTED',
  'BAD_GATEWAY',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_TIMEOUT',
  'VALIDATION_ERROR',
  'RATE_LIMITED',
  'OTP_PROVIDER_UNAVAILABLE',
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
  'INVALID_MEAL_DATE',
  'CUTOFF_PASSED',
  'REGISTRATION_WEEK_NOT_OPEN',
  'OUTSIDE_REGISTRATION_WINDOW',
  'MEAL_CHOICE_UNAVAILABLE',
  'REGISTRATION_FINALIZED',
  'REGISTRATION_FAILED',
  'MENU_NOT_FOUND',
  'INVALID_EFFECTIVE_RANGE',
  'ROSTER_BATCH_NOT_FOUND',
  'ROSTER_IMPORT_REJECTED',
  'ADMIN_MANAGED_ROLES_UNAVAILABLE',
  'ADMIN_SELF_DISABLE_FORBIDDEN',
  'ADMIN_LAST_ACTIVE_ADMIN',
  'UNKNOWN_SERVICE_LOCATION',
  'INVALID_LOCATION_POLICY',
  'LOCATION_COORDINATES_REQUIRED',
  'INVALID_NOTIFICATION_CURSOR',
  'INVALID_NOTIFICATION_PREFERENCE',
  'INVALID_PUSH_TOKEN',
  'INVALID_NOTIFICATION_KIND',
  'NOTIFICATION_NOT_FOUND',
] as const;
export const PublicErrorCodeSchema = z.enum(PUBLIC_ERROR_CODE_VALUES);
export type PublicErrorCode = z.infer<typeof PublicErrorCodeSchema>;
export const PUBLIC_ERROR_CODES: Record<PublicErrorCode, true> =
  Object.fromEntries(
    PUBLIC_ERROR_CODE_VALUES.map((code) => [code, true]),
  ) as Record<PublicErrorCode, true>;

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
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  path: z.array(z.union([z.string(), z.number()])).optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;
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
export const ApiErrorResponseSchema = z
  .object({
    statusCode: z.number().int().min(400).max(599),
    errorCode: PublicErrorCodeSchema,
    message: z.string(),
    requestId: z.string().uuid(),
  })
  .strict();
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
