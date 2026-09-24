import type { MobileApiError } from '../../api/mobileApiError';
import type { PickupOption } from '../../api/pickupAPI';

export function getInitialSelection(
  options: readonly PickupOption[] | readonly string[],
): string[] {
  if (options.length !== 1) return [];
  const first = options[0];
  return typeof first === 'string' ? [first] : [first.registrationId];
}

export function sortRegistrationIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

export function isGpsRecoveryError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as MobileApiError).code;
  return (
    code === 'GPS_RETRY_REQUIRED' ||
    code === 'GPS_UNAVAILABLE' ||
    code === 'GPS_STALE' ||
    code === 'GPS_INACCURATE'
  );
}
