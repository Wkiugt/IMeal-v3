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
export function canStartQrGeneration(
  registrationIds: readonly string[],
): boolean {
  return registrationIds.length > 0;
}

export function isCurrentCapture<T>(
  currentCapture: T | null,
  expectedCapture: T,
): boolean {
  return currentCapture === expectedCapture;
}

export function getSelectionAfterEligibilityRefresh(
  options: readonly PickupOption[] | readonly string[],
  currentSelection: readonly string[],
  hasLoadedOptions: boolean,
): string[] {
  const available = new Set(
    options.map((option) =>
      typeof option === 'string' ? option : option.registrationId,
    ),
  );
  const preserved = sortRegistrationIds(
    currentSelection.filter((id) => available.has(id)),
  );
  if (preserved.length > 0 || hasLoadedOptions) return preserved;
  return getInitialSelection(options);
}

export function getPresentableQrValue(
  currentQr: {
    value: string;
    expiresAt: number;
    selectionKey: string;
  } | null,
  qrValue: string | null,
  selectedSelectionKey: string,
  isFocused: boolean,
  hasError: boolean,
  now = Date.now(),
): string | null {
  if (
    !isFocused ||
    hasError ||
    !currentQr ||
    currentQr.value !== qrValue ||
    currentQr.selectionKey !== selectedSelectionKey ||
    currentQr.expiresAt <= now
  ) {
    return null;
  }
  return qrValue;
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
