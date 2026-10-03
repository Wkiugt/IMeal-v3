import * as Location from 'expo-location';
import { v1 } from '@imeal/contracts';
import { MobileApiError } from './mobileApiError';

export type LocationCapture = {
  promise: Promise<v1.PresenterLocationEvidence>;
  stop: () => void;
};

export class LocationCaptureCancelledError extends Error {
  constructor() {
    super('Foreground location capture cancelled');
    this.name = 'LocationCaptureCancelledError';
  }
}

export function isLocationCaptureCancelled(
  error: unknown,
): error is LocationCaptureCancelledError {
  return error instanceof LocationCaptureCancelledError;
}

const LOCATION_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.High,
  distanceInterval: 0,
  timeInterval: 1_000,
};
const LOCATION_CAPTURE_TIMEOUT_MS = 10_000;

function locationError(
  code: 'GPS_UNAVAILABLE' | 'GPS_INACCURATE',
): MobileApiError {
  const messageKey =
    code === 'GPS_INACCURATE'
      ? 'errors.gpsInaccurate'
      : 'errors.gpsUnavailable';
  return new MobileApiError(code, messageKey);
}

function toEvidence(
  location: Location.LocationObject,
): v1.PresenterLocationEvidence {
  const accuracyMeters = location.coords.accuracy;
  const capturedAt = new Date(location.timestamp);
  if (
    typeof accuracyMeters !== 'number' ||
    !Number.isFinite(accuracyMeters) ||
    accuracyMeters < 0 ||
    !Number.isFinite(capturedAt.getTime())
  ) {
    throw locationError('GPS_INACCURATE');
  }
  const parsed = v1.PresenterLocationEvidenceSchema.safeParse({
    capturedAt: capturedAt.toISOString(),
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracyMeters,
  });
  if (!parsed.success) throw locationError('GPS_INACCURATE');
  return parsed.data;
}

export function startForegroundLocationCapture(
  timeoutMs = LOCATION_CAPTURE_TIMEOUT_MS,
): LocationCapture {
  let settled = false;
  let subscription: Location.LocationSubscription | null = null;
  let timeoutId: NodeJS.Timeout | undefined;
  let resolvePromise!: (evidence: v1.PresenterLocationEvidence) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<v1.PresenterLocationEvidence>(
    (resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    },
  );

  const clearCaptureTimeout = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  const stop = () => {
    if (settled) return;
    settled = true;
    clearCaptureTimeout();
    subscription?.remove();
    subscription = null;
    rejectPromise(new LocationCaptureCancelledError());
  };

  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    clearCaptureTimeout();
    subscription?.remove();
    subscription = null;
    callback();
  };

  timeoutId = setTimeout(() => {
    finish(() => rejectPromise(locationError('GPS_UNAVAILABLE')));
  }, Math.max(1, timeoutMs));

  void (async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (settled) return;
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        finish(() => rejectPromise(locationError('GPS_UNAVAILABLE')));
        return;
      }
      subscription = await Location.watchPositionAsync(
        LOCATION_OPTIONS,
        (nextLocation) => {
          try {
            const evidence = toEvidence(nextLocation);
            finish(() => resolvePromise(evidence));
          } catch (error: unknown) {
            finish(() => rejectPromise(error));
          }
        },
      );
      if (settled) subscription.remove();
    } catch (error: unknown) {
      finish(() => rejectPromise(locationError('GPS_UNAVAILABLE')));
    }
  })();

  return { promise, stop };
}


export const locationAPI = {
  startForegroundLocationCapture,
};
