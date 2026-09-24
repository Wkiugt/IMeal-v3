import { afterEach, describe, expect, it, vi } from 'vitest';

const locationModule = vi.hoisted(() => ({
  Accuracy: { High: 4 },
  PermissionStatus: { GRANTED: 'granted' },
  requestForegroundPermissionsAsync: vi.fn(),
  watchPositionAsync: vi.fn(),
}));

vi.mock('expo-location', () => locationModule);

import {
  LocationCaptureCancelledError,
  startForegroundLocationCapture,
} from './locationAPI';

afterEach(() => {
  vi.clearAllMocks();
});

describe('locationAPI foreground capture', () => {
  it('removes the foreground watcher after the first valid fix', async () => {
    const remove = vi.fn();
    let onUpdate: ((location: unknown) => void) | undefined;
    locationModule.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
    });
    locationModule.watchPositionAsync.mockImplementation(
      async (_options, callback: (location: unknown) => void) => {
        onUpdate = callback;
        return { remove };
      },
    );

    const capture = startForegroundLocationCapture();
    await vi.waitFor(() => expect(onUpdate).toBeTypeOf('function'));
    onUpdate?.({
      timestamp: Date.parse('2026-09-24T03:00:00.000Z'),
      coords: {
        latitude: 10.77,
        longitude: 106.69,
        accuracy: 12,
      },
    });

    await expect(capture.promise).resolves.toMatchObject({
      capturedAt: '2026-09-24T03:00:00.000Z',
      latitude: 10.77,
      longitude: 106.69,
      accuracyMeters: 12,
    });
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('settles cancellation and removes a watcher that resolves after stop', async () => {
    const remove = vi.fn();
    let resolveWatch!: (subscription: { remove: () => void }) => void;
    locationModule.requestForegroundPermissionsAsync.mockResolvedValue({
      status: 'granted',
    });
    locationModule.watchPositionAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveWatch = resolve;
        }),
    );

    const capture = startForegroundLocationCapture();
    await vi.waitFor(() => expect(resolveWatch).toBeTypeOf('function'));
    capture.stop();

    await expect(capture.promise).rejects.toBeInstanceOf(
      LocationCaptureCancelledError,
    );
    resolveWatch({ remove });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });
});
