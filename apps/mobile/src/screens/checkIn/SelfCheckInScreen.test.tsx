import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TestPermission = {
  granted: boolean;
  canAskAgain: boolean;
  expires: string;
  status: string;
};

const apiMock = vi.hoisted(() => ({
  getStatus: vi.fn(),
  resolve: vi.fn(),
  confirm: vi.fn(),
}));
const locationMock = vi.hoisted(() => ({
  startForegroundLocationCapture: vi.fn(),
}));
const sessionMock = vi.hoisted(() => ({ token: 'staff-token' }));
const permissionMock = vi.hoisted(() => ({
  permission: {
    granted: true,
    canAskAgain: true,
    expires: 'never',
    status: 'granted',
  } as TestPermission,
  requestPermission: vi.fn(),
}));
const noticeMock = vi.hoisted(() => ({ showNotice: vi.fn() }));
const appStateMock = vi.hoisted(() => {
  const listeners = new Set<(state: string) => void>();
  return {
    currentState: 'active',
    addEventListener: vi.fn((_event: string, listener: (state: string) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    }),
    emit(state: string) {
      listeners.forEach((listener) => listener(state));
    },
  };
});

const native = vi.hoisted(
  () =>
    (name: string) =>
      function Native({
        children,
        ...props
      }: {
        children?: React.ReactNode;
        [key: string]: unknown;
      }) {
        return React.createElement(name, props, children);
      },
);
const actionButton = vi.hoisted(
  () => (props: Record<string, unknown>) =>
    React.createElement('ActionButton', props, props.label as string),
);

vi.mock('react-native', () => ({
  ActivityIndicator: native('ActivityIndicator'),
  AppState: appStateMock,
  Pressable: native('Pressable'),
  StyleSheet: {
    absoluteFillObject: {},
    create: (styles: unknown) => styles,
  },
  View: native('View'),
  useWindowDimensions: () => ({ width: 420, height: 900, scale: 1, fontScale: 1 }),
}));
vi.mock('expo-camera', () => ({
  CameraView: native('CameraView'),
  useCameraPermissions: () => [permissionMock.permission, permissionMock.requestPermission],
}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn(() => 'idempotency-1') }));
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  useIsFocused: () => true,
}));
vi.mock('lucide-react-native', () => ({
  CheckCircle2: native('CheckCircle2'),
  Clock3: native('Clock3'),
  Flashlight: native('Flashlight'),
  MapPin: native('MapPin'),
  ScanLine: native('ScanLine'),
  Utensils: native('Utensils'),
  XCircle: native('XCircle'),
}));
vi.mock('../../auth/session', () => ({ useSession: () => sessionMock }));
vi.mock('../../api/checkInAPI', () => ({ checkInAPI: apiMock }));
vi.mock('../../api/locationAPI', () => ({
  locationAPI: locationMock,
  isLocationCaptureCancelled: () => false,
}));
vi.mock('../../i18n/LanguageProvider', () => ({
  useLanguage: () => ({ locale: 'en-US', t: (key: string) => key }),
}));
vi.mock('../../ui/BrandNotice', () => ({ useNotice: () => noticeMock }));
vi.mock('../../ui/AppShell', () => ({
  AppFrame: native('AppFrame'),
  SectionHeader: native('SectionHeader'),
}));
vi.mock('../../ui/BrandMotion', () => ({
  ScreenLoading: native('ScreenLoading'),
  StateTransition: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../ui/useScreenLoadingGate', () => ({ useScreenLoadingGate: () => false }));
vi.mock('../../ui/designTokens', () => ({
  designTokens: {
    color: {
      brand: { primary: '#000' },
      text: { onBrand: '#fff', secondary: '#000', strong: '#000' },
      semantic: {
        critical: { base: '#f00' },
        success: { base: '#0f0' },
      },
      surface: { standard: '#fff' },
    },
    radius: { full: 999, card: 1, smallControl: 1 },
    size: { qr: 100 },
    space: { xs: 1, sm: 2, md: 4, lg: 8, xl: 12 },
  },
}));
vi.mock('../../ui/components', () => ({
  ActionButton: actionButton,
  AppText: native('AppText'),
  EmptyState: ({ action, ...props }: { action?: { label: string; onPress: () => void }; [key: string]: unknown }) =>
    React.createElement(
      'EmptyState',
      { ...props, action },
      action ? actionButton(action) : null,
    ),
  StatusBadge: native('StatusBadge'),
  Surface: native('Surface'),
}));

import { MobileApiError } from '../../api/mobileApiError';
import { SelfCheckInScreen } from './SelfCheckInScreen';

const gps = {
  capturedAt: '2026-10-03T04:00:00.000Z',
  latitude: 10.77,
  longitude: 106.69,
  accuracyMeters: 12,
};
const location = {
  id: 'location-1',
  shortCode: 'HQ',
  displayName: 'Headquarters',
  servingPointName: 'Lunch counter',
  address: '1 Example Street',
};
const activeStatus = {
  date: '2026-10-03',
  window: {
    opensAt: '2026-10-03T03:30:00.000Z',
    closesAt: '2026-10-03T06:30:00.000Z',
    timeZone: 'Asia/Ho_Chi_Minh',
  },
  employee: { id: 'employee-1', name: 'Nguyen A', employeeCode: 'E001' },
  location,
  menu: { name: 'Chicken rice', description: null, imageUrl: null },
  registration: {
    id: 'registration-1',
    mealDate: '2026-10-03',
    mealChoice: 'REGULAR',
    status: 'ACTIVE',
    servedAt: null,
  },
  state: 'ACTIVE',
  canResolve: true,
  canConfirm: true,
};
const resolved = {
  sessionId: 'check-in-session-1',
  intentNonce: 'intent-nonce-1',
  date: '2026-10-03',
  expiresAt: '2099-10-03T06:30:00.000Z',
  employee: activeStatus.employee,
  menu: activeStatus.menu,
  location,
  registration: activeStatus.registration,
  eligibility: { eligible: true, reasons: [] },
};

function flushPromises(): Promise<void> {
  return Promise.resolve().then(() => Promise.resolve());
}
function actionFor(renderer: ReactTestRenderer, label: string) {
  return renderer.root
    .findAllByType('ActionButton' as never)
    .find((node) => node.props.label === label);
}

beforeEach(() => {
  apiMock.getStatus.mockReset();
  apiMock.resolve.mockReset();
  apiMock.confirm.mockReset();
  locationMock.startForegroundLocationCapture.mockReset();
  permissionMock.requestPermission.mockReset();
  permissionMock.permission = {
    granted: true,
    canAskAgain: true,
    expires: 'never',
    status: 'granted',
  } satisfies TestPermission;
  apiMock.getStatus.mockResolvedValue({ data: activeStatus });
  apiMock.resolve.mockResolvedValue({ data: resolved });
  locationMock.startForegroundLocationCapture.mockReturnValue({
    promise: Promise.resolve(gps),
    stop: vi.fn(),
  });
  permissionMock.requestPermission.mockResolvedValue(permissionMock.permission);
});

afterEach(() => {
  appStateMock.emit('active');
});

describe('SelfCheckInScreen', () => {
  it('reconciles an ambiguous confirm before showing the checked-in result without a second confirm', async () => {
    apiMock.getStatus
      .mockResolvedValueOnce({ data: activeStatus })
      .mockResolvedValueOnce({ data: { ...activeStatus, state: 'CHECKED_IN', canResolve: false, canConfirm: false } });
    apiMock.confirm.mockRejectedValueOnce(
      new MobileApiError('API_TIMEOUT', 'errors.apiTimeout'),
    );
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <SelfCheckInScreen
          {...({} as React.ComponentProps<typeof SelfCheckInScreen>)}
        />,
      );
      await flushPromises();
    });
    const camera = renderer.root.findByType('CameraView' as never);
    await act(async () => {
      camera.props.onBarcodeScanned({ data: 'stable-kitchen-qr' });
      camera.props.onBarcodeScanned({ data: 'stable-kitchen-qr' });
      await flushPromises();
    });

    expect(apiMock.resolve).toHaveBeenCalledTimes(1);
    const confirm = actionFor(renderer, 'checkIn.confirm');
    expect(confirm).toBeDefined();
    await act(async () => {
      confirm?.props.onPress();
      confirm?.props.onPress();
      await flushPromises();
    });
    expect(apiMock.confirm).toHaveBeenCalledTimes(1);

    expect(apiMock.getStatus).toHaveBeenCalledTimes(2);
    expect(apiMock.confirm).toHaveBeenCalledTimes(1);
    expect(apiMock.confirm.mock.calls[0][1]).toMatchObject({
      sessionId: 'check-in-session-1',
      intentNonce: 'intent-nonce-1',
      idempotencyKey: 'idempotency-1',
      gps,
    });
    renderer.unmount();
  });

  it('does not let a deferred old reconciliation overwrite newer checked-in status', async () => {
    let releaseOlderReconcile!: (response: { data: typeof activeStatus }) => void;
    const olderReconcile = new Promise<{ data: typeof activeStatus }>((resolve) => {
      releaseOlderReconcile = resolve;
    });
    const checkedInStatus = {
      ...activeStatus,
      state: 'CHECKED_IN' as const,
      canResolve: false,
      canConfirm: false,
      registration: {
        ...activeStatus.registration,
        status: 'CHECKED_IN' as const,
        servedAt: '2026-10-03T04:01:00.000Z',
      },
    };
    apiMock.getStatus
      .mockResolvedValueOnce({ data: activeStatus })
      .mockImplementationOnce(() => olderReconcile)
      .mockResolvedValueOnce({ data: checkedInStatus });
    apiMock.confirm.mockRejectedValueOnce(
      new MobileApiError('API_TIMEOUT', 'errors.apiTimeout'),
    );
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <SelfCheckInScreen
          {...({} as React.ComponentProps<typeof SelfCheckInScreen>)}
        />,
      );
      await flushPromises();
    });
    const camera = renderer.root.findByType('CameraView' as never);
    await act(async () => {
      camera.props.onBarcodeScanned({ data: 'stable-kitchen-qr' });
      await flushPromises();
    });
    await act(async () => {
      actionFor(renderer, 'checkIn.confirm')?.props.onPress();
      await flushPromises();
    });
    expect(apiMock.getStatus).toHaveBeenCalledTimes(2);

    await act(async () => {
      appStateMock.emit('background');
      appStateMock.emit('active');
      await flushPromises();
    });
    expect(renderer.root.findByType('EmptyState' as never).props.title).toBe(
      'checkIn.alreadyCheckedIn',
    );

    await act(async () => {
      releaseOlderReconcile({ data: activeStatus });
      await flushPromises();
    });
    expect(renderer.root.findByType('EmptyState' as never).props.title).toBe(
      'checkIn.alreadyCheckedIn',
    );
    expect(renderer.root.findAllByType('CameraView' as never)).toHaveLength(0);
    renderer.unmount();
  });

  it('reconciles again after an ambiguous retry even when the intent has expired', async () => {
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
    let rejectConfirm!: (error: unknown) => void;
    apiMock.getStatus
      .mockResolvedValueOnce({ data: activeStatus })
      .mockResolvedValueOnce({ data: activeStatus })
      .mockResolvedValueOnce({
        data: {
          ...activeStatus,
          state: 'CHECKED_IN',
          canResolve: false,
          canConfirm: false,
        },
      });
    apiMock.resolve.mockResolvedValueOnce({
      data: {
        ...resolved,
        expiresAt: new Date(now + 30_000).toISOString(),
      },
    });
    apiMock.confirm.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectConfirm = reject;
        }),
    );
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <SelfCheckInScreen
          {...({} as React.ComponentProps<typeof SelfCheckInScreen>)}
        />,
      );
      await flushPromises();
    });
    const camera = renderer.root.findByType('CameraView' as never);
    await act(async () => {
      camera.props.onBarcodeScanned({ data: 'stable-kitchen-qr' });
      await flushPromises();
    });
    const confirm = actionFor(renderer, 'checkIn.confirm');
    await act(async () => {
      confirm?.props.onPress();
      await flushPromises();
    });
    nowSpy.mockReturnValue(now + 60_000);
    await act(async () => {
      rejectConfirm(new MobileApiError('API_TIMEOUT', 'errors.apiTimeout'));
      await flushPromises();
    });
    expect(actionFor(renderer, 'checkIn.confirm')?.props.disabled).toBe(true);
    const retry = actionFor(renderer, 'common.retry');
    expect(retry).toBeDefined();
    await act(async () => {
      retry?.props.onPress();
      await flushPromises();
    });
    expect(apiMock.confirm).toHaveBeenCalledTimes(1);
    expect(apiMock.getStatus).toHaveBeenCalledTimes(3);
    nowSpy.mockRestore();
    renderer.unmount();
  });

  it.each([
    ['ALREADY_CHECKED_IN', 'CHECKED_IN', 'checkIn.alreadyCheckedIn'],
    ['REGISTRATION_CANCELLED', 'CANCELLED', 'checkIn.cancelled'],
    ['NO_REGISTRATION', 'UNREGISTERED', 'checkIn.noRegistration'],
  ] as const)(
    'renders the authoritative %s state for an ineligible resolve response',
    async (reason, state, title) => {
      apiMock.getStatus
        .mockResolvedValueOnce({ data: activeStatus })
        .mockResolvedValueOnce({
          data: {
            ...activeStatus,
            state,
            canResolve: false,
            canConfirm: false,
            registration:
              state === 'UNREGISTERED'
                ? null
                : {
                    ...activeStatus.registration,
                    status: state === 'CHECKED_IN' ? 'CHECKED_IN' : 'CANCELLED',
                    servedAt:
                      state === 'CHECKED_IN'
                        ? '2026-10-03T04:01:00.000Z'
                        : null,
                  },
          },
        });
      apiMock.resolve.mockResolvedValueOnce({
        data: {
          ...resolved,
          intentNonce: null,
          eligibility: { eligible: false, reasons: [reason] },
        },
      });
      let renderer!: ReactTestRenderer;
      await act(async () => {
        renderer = create(
          <SelfCheckInScreen
            {...({} as React.ComponentProps<typeof SelfCheckInScreen>)}
          />,
        );
        await flushPromises();
      });
      const camera = renderer.root.findByType('CameraView' as never);
      await act(async () => {
        camera.props.onBarcodeScanned({ data: 'stable-kitchen-qr' });
        await flushPromises();
      });
      expect(apiMock.getStatus).toHaveBeenCalledTimes(2);
      expect(renderer.root.findByType('EmptyState' as never).props.title).toBe(title);
      renderer.unmount();
    },
  );

  it('does not offer a retry action after the camera permission is permanently denied', async () => {
    permissionMock.permission = {
      granted: false,
      canAskAgain: false,
      expires: 'never',
      status: 'denied',
    } satisfies TestPermission;
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <SelfCheckInScreen
          {...({} as React.ComponentProps<typeof SelfCheckInScreen>)}
        />,
      );
      await flushPromises();
    });
    const empty = renderer.root.findByType('EmptyState' as never);
    expect(empty.props.title).toBe('checkIn.cameraRequired');
    expect(empty.props.action).toBeUndefined();
    renderer.unmount();
  });
});
