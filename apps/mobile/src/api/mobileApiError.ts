import type { v1 } from '@imeal/contracts';
import type { Translate, TranslationKey } from '../i18n/translations';
import { notifyProtectedAuthInvalid } from '../auth/authInvalidation';
import { RequestTimeoutError } from './requestWithTimeout';
export interface ProtectedRequestContext {
  readonly token: string;
}
type MobileHttpErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INTERNAL_SERVER_ERROR'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED';

type MobileLegacyErrorCode =
  | 'OTP_REQUEST_ACCEPTED'
  | 'OTP_INVALID_OR_EXPIRED'
  | 'SESSION_REVOKED'
  | 'GPS_RETRY_REQUIRED'
  | 'GPS_UNAVAILABLE'
  | 'PICKUP_INTENT_REQUIRED'
  | 'PICKUP_INTENT_CONFLICT'
  | 'PICKUP_SESSION_EXPIRED'
  | 'GPS_SESSION_REQUIRED'
  | 'SERVING_WINDOW_CLOSED'
  | 'QR_EXPIRED'
  | 'QR_INVALID'
  | 'SESSION_INVALID'
  | 'OTP_RATE_LIMITED'
  | 'PICKUP_WINDOW_CLOSED'
  | 'PICKUP_NOT_READY';

export type MobileApiErrorCode =
  | MobileHttpErrorCode
  | MobileLegacyErrorCode
  | 'API_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED'
  | 'DUPLICATE_SERVING'
  | v1.RegistrationFailureCode
  | v1.CheckInErrorCode;

const ERROR_MESSAGE_KEYS: Record<MobileApiErrorCode, TranslationKey> = {
  API_TIMEOUT: 'errors.apiTimeout',
  INVALID_RESPONSE: 'errors.invalidResponse',
  REQUEST_FAILED: 'errors.requestFailed',
  DUPLICATE_SERVING: 'errors.duplicateServing',
  BAD_REQUEST: 'errors.requestFailed',
  UNAUTHORIZED: 'errors.sessionInvalid',
  FORBIDDEN: 'errors.requestFailed',
  NOT_FOUND: 'errors.requestFailed',
  CONFLICT: 'errors.requestFailed',
  INTERNAL_SERVER_ERROR: 'errors.requestFailed',
  VALIDATION_ERROR: 'errors.requestFailed',
  RATE_LIMITED: 'errors.otpRateLimited',
  OTP_REQUEST_ACCEPTED: 'errors.requestOtp',
  OTP_INVALID_OR_EXPIRED: 'errors.otpInvalidOrExpired',
  SESSION_REVOKED: 'errors.sessionRevoked',
  GPS_RETRY_REQUIRED: 'errors.gpsRetryRequired',
  GPS_UNAVAILABLE: 'errors.gpsUnavailable',
  GPS_STALE: 'errors.gpsStale',
  GPS_INACCURATE: 'errors.gpsInaccurate',
  PICKUP_INTENT_REQUIRED: 'errors.pickupIntentRequired',
  PICKUP_INTENT_CONFLICT: 'errors.pickupIntentConflict',
  PICKUP_SESSION_EXPIRED: 'errors.pickupSessionExpired',
  IDEMPOTENCY_CONFLICT: 'errors.idempotencyConflict',
  GPS_SESSION_REQUIRED: 'errors.gpsRetryRequired',
  SERVING_WINDOW_CLOSED: 'errors.pickupWindowClosed',
  QR_EXPIRED: 'errors.qrExpired',
  QR_INVALID: 'errors.qrInvalid',
  SESSION_INVALID: 'errors.sessionInvalid',
  OTP_RATE_LIMITED: 'errors.otpRateLimited',
  INVALID_MEAL_DATE: 'errors.invalidMealDate',
  CUTOFF_PASSED: 'errors.cutoffPassed',
  MEAL_CHOICE_UNAVAILABLE: 'errors.mealChoiceUnavailable',
  REGISTRATION_FINALIZED: 'errors.registrationFinalized',
  REGISTRATION_FAILED: 'errors.registrationFailed',
  REGISTRATION_WEEK_NOT_OPEN: 'errors.registrationWeekNotOpen',
  OUTSIDE_REGISTRATION_WINDOW: 'errors.outsideRegistrationWindow',
  PICKUP_WINDOW_CLOSED: 'errors.pickupWindowClosed',
  PICKUP_NOT_READY: 'errors.pickupNotReady',
  INVALID_QR: 'errors.checkInInvalidQr',
  INACTIVE_CHECKIN_SESSION: 'errors.checkInSessionInactive',
  NO_REGISTRATION: 'errors.checkInNoRegistration',
  REGISTRATION_CANCELLED: 'errors.checkInRegistrationCancelled',
  ALREADY_CHECKED_IN: 'errors.checkInAlreadyCheckedIn',
  OUTSIDE_CHECKIN_WINDOW: 'errors.checkInOutsideWindow',
  LOCATION_MISMATCH: 'errors.checkInLocationMismatch',
  GPS_REQUIRED: 'errors.checkInGpsRequired',
  OUTSIDE_GEOFENCE: 'errors.checkInOutsideGeofence',
};

export class MobileApiError extends Error {
  readonly code: MobileApiErrorCode;
  readonly messageKey: TranslationKey;
  readonly cause: unknown;

  constructor(
    code: MobileApiErrorCode,
    messageKey: TranslationKey,
    cause?: unknown,
  ) {
    super(code);
    this.name = 'MobileApiError';
    this.code = code;
    this.messageKey = messageKey;
    this.cause = cause;
  }
}

export function mobileErrorMessageKey(
  code: MobileApiErrorCode,
): TranslationKey {
  return ERROR_MESSAGE_KEYS[code];
}

export function isMobileApiErrorCode(
  value: unknown,
): value is MobileApiErrorCode {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(ERROR_MESSAGE_KEYS, value)
  );
}

export function getMobileErrorMessage(
  error: unknown,
  t: Translate,
  fallbackKey: TranslationKey,
): string {
  if (error instanceof MobileApiError) return t(error.messageKey);
  return t(fallbackKey);
}

export function getErrorPayloadCode(
  payload: unknown,
): MobileApiErrorCode | null {
  if (payload === null || typeof payload !== 'object' || !('code' in payload))
    return null;
  return isMobileApiErrorCode(payload.code) ? payload.code : null;
}

function getNestedErrorPayloadCode(
  payload: unknown,
): MobileApiErrorCode | null {
  if (isMobileApiErrorCode(payload)) return payload;
  const directCode = getErrorPayloadCode(payload);
  if (directCode) return directCode;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nestedCode = getNestedErrorPayloadCode(item);
      if (nestedCode) return nestedCode;
    }
    return null;
  }
  if (payload === null || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  return (
    getNestedErrorPayloadCode(record.error) ??
    getNestedErrorPayloadCode(record.message)
  );
}

export function toMobileApiError(
  error: unknown,
  fallbackKey: TranslationKey,
): MobileApiError {
  if (error instanceof MobileApiError) return error;
  const code: MobileApiErrorCode =
    error instanceof RequestTimeoutError ? 'API_TIMEOUT' : 'REQUEST_FAILED';
  const messageKey =
    code === 'REQUEST_FAILED' ? fallbackKey : mobileErrorMessageKey(code);
  return new MobileApiError(code, messageKey, error);
}

export async function throwMobileResponseError(
  response: Response,
  fallbackKey: TranslationKey,
  protectedRequest?: ProtectedRequestContext,
): Promise<never> {
  let cause: unknown;
  try {
    cause = await response.json();
  } catch (error: unknown) {
    cause = error;
  }
  const code = getNestedErrorPayloadCode(cause) ?? 'REQUEST_FAILED';
  const messageKey =
    code === 'REQUEST_FAILED' ? fallbackKey : mobileErrorMessageKey(code);
  if (
    response.status === 401 &&
    code === 'SESSION_INVALID' &&
    protectedRequest
  ) {
    notifyProtectedAuthInvalid(protectedRequest.token);
  }
  throw new MobileApiError(code, messageKey, cause);
}

export async function readMobileResponseJson(
  response: Response,
  fallbackKey: TranslationKey,
): Promise<unknown> {
  try {
    return await response.json();
  } catch (error: unknown) {
    throw new MobileApiError(
      'INVALID_RESPONSE',
      mobileErrorMessageKey('INVALID_RESPONSE') || fallbackKey,
      error,
    );
  }
}
