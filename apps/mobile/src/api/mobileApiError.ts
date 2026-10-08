import { v1 } from '@imeal/contracts';
import type { Translate, TranslationKey } from '../i18n/translations';
import { notifyProtectedAuthInvalid } from '../auth/authInvalidation';
import { RequestTimeoutError } from './requestWithTimeout';
export interface ProtectedRequestContext {
  readonly token: string;
}
export type MobileApiErrorCode =
  | v1.PublicErrorCode
  | 'OTP_EXPIRED'
  | 'API_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED';

export interface MobileApiErrorDetails {
  readonly statusCode?: number;
  readonly requestId?: string;
}

type ErrorPayload = {
  readonly statusCode?: unknown;
  readonly errorCode?: unknown;
  readonly requestId?: unknown;
};

const LOCAL_ERROR_CODES: Record<string, true> = {
  API_TIMEOUT: true,
  INVALID_RESPONSE: true,
  REQUEST_FAILED: true,
};
const REQUEST_ID_SCHEMA = v1.ApiErrorResponseSchema.shape.requestId;
const SUPPORT_CODE_ERROR_CODES: Partial<Record<MobileApiErrorCode, true>> = {
  REQUEST_FAILED: true,
  INTERNAL_SERVER_ERROR: true,
};

const ERROR_MESSAGE_KEYS: Partial<Record<string, TranslationKey>> = {
  API_TIMEOUT: 'errors.apiTimeout',
  INVALID_RESPONSE: 'errors.invalidResponse',
  REQUEST_FAILED: 'errors.requestFailed',
  BAD_REQUEST: 'errors.badRequest',
  UNAUTHORIZED: 'errors.sessionInvalid',
  FORBIDDEN: 'errors.forbidden',
  NOT_FOUND: 'errors.notFound',
  METHOD_NOT_ALLOWED: 'errors.methodNotAllowed',
  REQUEST_TIMEOUT: 'errors.requestTimeout',
  CONFLICT: 'errors.conflict',
  GONE: 'errors.gone',
  PAYLOAD_TOO_LARGE: 'errors.payloadTooLarge',
  UNSUPPORTED_MEDIA_TYPE: 'errors.unsupportedMediaType',
  UNPROCESSABLE_ENTITY: 'errors.unprocessableEntity',
  RATE_LIMITED: 'errors.rateLimited',
  INTERNAL_SERVER_ERROR: 'errors.internalServerError',
  NOT_IMPLEMENTED: 'errors.notImplemented',
  BAD_GATEWAY: 'errors.badGateway',
  SERVICE_UNAVAILABLE: 'errors.serviceUnavailable',
  GATEWAY_TIMEOUT: 'errors.gatewayTimeout',
  VALIDATION_ERROR: 'errors.requestFailed',
  OTP_INVALID_OR_EXPIRED: 'errors.otpInvalidOrExpired',
  OTP_EXPIRED: 'errors.otpExpired',
  SESSION_REVOKED: 'errors.sessionRevoked',
  SESSION_INVALID: 'errors.sessionInvalid',
  OTP_RATE_LIMITED: 'errors.otpRateLimited',
  GPS_RETRY_REQUIRED: 'errors.gpsRetryRequired',
  GPS_UNAVAILABLE: 'errors.gpsUnavailable',
  GPS_STALE: 'errors.gpsStale',
  GPS_INACCURATE: 'errors.gpsInaccurate',
  IDEMPOTENCY_CONFLICT: 'errors.idempotencyConflict',
  INVALID_MEAL_DATE: 'errors.invalidMealDate',
  CUTOFF_PASSED: 'errors.cutoffPassed',
  MEAL_CHOICE_UNAVAILABLE: 'errors.mealChoiceUnavailable',
  REGISTRATION_FINALIZED: 'errors.registrationFinalized',
  REGISTRATION_FAILED: 'errors.registrationFailed',
  REGISTRATION_WEEK_NOT_OPEN: 'errors.registrationWeekNotOpen',
  OUTSIDE_REGISTRATION_WINDOW: 'errors.outsideRegistrationWindow',
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

function payloadRecord(value: unknown): ErrorPayload | null {
  return typeof value === 'object' && value !== null
    ? (value as ErrorPayload)
    : null;
}

function statusCodeFrom(value: unknown): number | undefined {
  const statusCode = payloadRecord(value)?.statusCode;
  return typeof statusCode === 'number' &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode <= 599
    ? statusCode
    : undefined;
}

function requestIdFrom(value: unknown): string | undefined {
  const requestId = payloadRecord(value)?.requestId;
  return typeof requestId === 'string' &&
    REQUEST_ID_SCHEMA.safeParse(requestId).success
    ? requestId
    : undefined;
}

export class MobileApiError extends Error {
  readonly code: MobileApiErrorCode;
  readonly messageKey: TranslationKey;
  readonly cause: unknown;
  readonly statusCode: number | undefined;
  readonly requestId: string | undefined;

  constructor(
    code: MobileApiErrorCode,
    messageKey: TranslationKey,
    cause?: unknown,
    details?: MobileApiErrorDetails,
  ) {
    super(code);
    this.name = 'MobileApiError';
    this.code = code;
    this.messageKey = messageKey;
    this.cause = cause;
    this.statusCode = details?.statusCode ?? statusCodeFrom(cause);
    this.requestId =
      requestIdFrom(details) ?? requestIdFrom(cause);
  }
}

export function mobileErrorMessageKey(
  code: MobileApiErrorCode,
): TranslationKey {
  return ERROR_MESSAGE_KEYS[code] ?? 'errors.requestFailed';
}

export function isMobileApiErrorCode(
  value: unknown,
): value is MobileApiErrorCode {
  return (
    value === 'OTP_EXPIRED' ||
    (typeof value === 'string' &&
      (Object.prototype.hasOwnProperty.call(LOCAL_ERROR_CODES, value) ||
        Object.prototype.hasOwnProperty.call(ERROR_MESSAGE_KEYS, value))) ||
    v1.PublicErrorCodeSchema.safeParse(value).success
  );
}

const HTTP_FALLBACK_MESSAGE_KEYS: Partial<
  Record<number, TranslationKey>
> = {
  429: 'errors.otpRateLimited',
  500: 'errors.serverError',
  503: 'errors.serviceUnavailable',
};

const HTTP_STATUS_ERROR_CODES: Partial<Record<number, MobileApiErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'SESSION_INVALID',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_SERVER_ERROR',
  501: 'NOT_IMPLEMENTED',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

function fallbackErrorCodeForStatus(statusCode: number): MobileApiErrorCode {
  return (
    HTTP_STATUS_ERROR_CODES[statusCode] ??
    (statusCode >= 400 && statusCode < 500
      ? 'BAD_REQUEST'
      : statusCode >= 500 && statusCode < 600
        ? 'INTERNAL_SERVER_ERROR'
        : 'REQUEST_FAILED')
  );
}

function mobileErrorPresentationKey(error: MobileApiError): TranslationKey {
  const domainKey = mobileErrorMessageKey(error.code);
  const httpFallbackKey = HTTP_FALLBACK_MESSAGE_KEYS[error.statusCode ?? 0];
  if (domainKey !== 'errors.requestFailed') return domainKey;
  return (
    httpFallbackKey ??
    (error.code === 'REQUEST_FAILED'
      ? error.messageKey
      : 'errors.requestFailed')
  );
}


function appendSupportCode(
  message: string,
  error: MobileApiError,
  t: Translate,
): string {
  if (
    !SUPPORT_CODE_ERROR_CODES[error.code] ||
    !error.requestId ||
    error.statusCode === undefined ||
    error.statusCode < 500 ||
    error.statusCode > 599
  ) {
    return message;
  }
  return `${message}\n${t('errors.supportCode', { requestId: error.requestId })}`;
}

export function getMobileErrorMessage(
  error: unknown,
  t: Translate,
  fallbackKey: TranslationKey,
): string {
  if (error instanceof MobileApiError) {
    return appendSupportCode(t(mobileErrorPresentationKey(error)), error, t);
  }
  if (error instanceof RequestTimeoutError) return t('errors.apiTimeout');
  return t(fallbackKey);

}

export function getErrorPayloadCode(
  payload: unknown,
): MobileApiErrorCode | null {
  const parsed = v1.ApiErrorResponseSchema.safeParse(payload);
  if (parsed.success && isMobileApiErrorCode(parsed.data.errorCode)) {
    return parsed.data.errorCode;
  }
  const record = payloadRecord(payload);
  if (!record || !isMobileApiErrorCode(record.errorCode)) return null;
  return record.errorCode;
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
  const code =
    getErrorPayloadCode(cause) ??
    fallbackErrorCodeForStatus(response.status);
  if (
    response.status === 401 &&
    code === 'SESSION_INVALID' &&
    protectedRequest
  ) {
    notifyProtectedAuthInvalid(protectedRequest.token);
  }
  const messageKey =
    code === 'REQUEST_FAILED' ? fallbackKey : mobileErrorMessageKey(code);
  const requestId =
    requestIdFrom(cause) ??
    requestIdFrom({ requestId: response.headers.get('x-request-id') });
  throw new MobileApiError(
    code,
    messageKey,
    cause,
    { statusCode: response.status, requestId },
  );
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
