import type { v1 } from '@imeal/contracts';
import type { Translate, TranslationKey } from '../i18n/translations';
import { RequestTimeoutError } from './requestWithTimeout';

export type MobileApiErrorCode =
  | 'API_TIMEOUT'
  | 'INVALID_RESPONSE'
  | 'REQUEST_FAILED'
  | 'DUPLICATE_SERVING'
  | 'PICKUP_SESSION_EXPIRED'
  | v1.RegistrationFailureCode
  | v1.PickupAvailabilityCode;

const ERROR_MESSAGE_KEYS: Record<MobileApiErrorCode, TranslationKey> = {
  API_TIMEOUT: 'errors.apiTimeout',
  INVALID_RESPONSE: 'errors.invalidResponse',
  REQUEST_FAILED: 'errors.requestFailed',
  DUPLICATE_SERVING: 'errors.duplicateServing',
  PICKUP_SESSION_EXPIRED: 'errors.pickupSessionExpired',
  INVALID_MEAL_DATE: 'errors.invalidMealDate',
  CUTOFF_PASSED: 'errors.cutoffPassed',
  MEAL_CHOICE_UNAVAILABLE: 'errors.mealChoiceUnavailable',
  REGISTRATION_FINALIZED: 'errors.registrationFinalized',
  REGISTRATION_FAILED: 'errors.registrationFailed',
  PICKUP_WINDOW_CLOSED: 'errors.pickupWindowClosed',
  PICKUP_NOT_READY: 'errors.pickupNotReady',
};

export class MobileApiError extends Error {
  readonly code: MobileApiErrorCode;
  readonly messageKey: TranslationKey;
  readonly cause: unknown;

  constructor(code: MobileApiErrorCode, messageKey: TranslationKey, cause?: unknown) {
    super(code);
    this.name = 'MobileApiError';
    this.code = code;
    this.messageKey = messageKey;
    this.cause = cause;
  }
}

export function mobileErrorMessageKey(code: MobileApiErrorCode): TranslationKey {
  return ERROR_MESSAGE_KEYS[code];
}

export function isMobileApiErrorCode(value: unknown): value is MobileApiErrorCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ERROR_MESSAGE_KEYS, value);
}

export function getMobileErrorMessage(
  error: unknown,
  t: Translate,
  fallbackKey: TranslationKey,
): string {
  if (error instanceof MobileApiError) return t(error.messageKey);
  return t(fallbackKey);
}

export function getErrorPayloadCode(payload: unknown): MobileApiErrorCode | null {
  if (payload === null || typeof payload !== 'object' || !('code' in payload)) return null;
  return isMobileApiErrorCode(payload.code) ? payload.code : null;
}

function getNestedErrorPayloadCode(payload: unknown): MobileApiErrorCode | null {
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
  return getNestedErrorPayloadCode(record.error) ?? getNestedErrorPayloadCode(record.message);
}


export function toMobileApiError(
  error: unknown,
  fallbackKey: TranslationKey,
): MobileApiError {
  if (error instanceof MobileApiError) return error;
  const code: MobileApiErrorCode = error instanceof RequestTimeoutError
    ? 'API_TIMEOUT'
    : 'REQUEST_FAILED';
  const messageKey = code === 'REQUEST_FAILED' ? fallbackKey : mobileErrorMessageKey(code);
  return new MobileApiError(code, messageKey, error);
}

export async function throwMobileResponseError(
  response: Response,
  fallbackKey: TranslationKey,
): Promise<never> {
  let cause: unknown;
  try {
    cause = await response.json();
  } catch (error: unknown) {
    cause = error;
  }
  const code = getNestedErrorPayloadCode(cause) ?? 'REQUEST_FAILED';
  const messageKey = code === 'REQUEST_FAILED' ? fallbackKey : mobileErrorMessageKey(code);
  throw new MobileApiError(code, messageKey, cause);
}

export async function readMobileResponseJson(response: Response, fallbackKey: TranslationKey): Promise<unknown> {
  try {
    return await response.json();
  } catch (error: unknown) {
    throw new MobileApiError('INVALID_RESPONSE', mobileErrorMessageKey('INVALID_RESPONSE') || fallbackKey, error);
  }
}
