import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toBusinessDateKey } from '../../businessDate';

const apiMock = vi.hoisted(() => ({
  getKitchenQr: vi.fn(),
  getKitchenDashboard: vi.fn(),
}));
const sessionMock = vi.hoisted(() => ({ token: 'kitchen-token' }));
const focusState = vi.hoisted(() => ({ value: true }));
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
const appFrame = vi.hoisted(
  () =>
    (props: {
      children?: React.ReactNode;
      scrollProps?: { refreshControl?: React.ReactNode };
      [key: string]: unknown;
    }) =>
      React.createElement(
        'AppFrame',
        props,
        props.scrollProps?.refreshControl,
        props.children,
      ),
);

vi.mock('react-native', () => ({
  AppState: appStateMock,
  RefreshControl: native('RefreshControl'),
  StyleSheet: { create: (styles: unknown) => styles },
  View: native('View'),
}));
vi.mock('react-native-qrcode-svg', () => ({ default: native('QRCode') }));
vi.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  useIsFocused: () => focusState.value,
}));
vi.mock('lucide-react-native', () => ({
  CheckCircle2: native('CheckCircle2'),
  Clock3: native('Clock3'),
  Leaf: native('Leaf'),
  MapPin: native('MapPin'),
  QrCode: native('QrCode'),
  Utensils: native('Utensils'),
  WifiOff: native('WifiOff'),
  XCircle: native('XCircle'),
}));
vi.mock('../../auth/session', () => ({ useSession: () => sessionMock }));
vi.mock('../../api/checkInAPI', () => ({ checkInAPI: apiMock }));
vi.mock('../../i18n/LanguageProvider', () => ({
  useLanguage: () => ({ locale: 'en-US', t: (key: string) => key }),
}));
vi.mock('../../ui/AppShell', () => ({
  AppFrame: appFrame,
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
      text: { secondary: '#000', strong: '#000' },
      surface: { standard: '#fff' },
      semantic: {
        critical: { base: '#f00' },
        information: { base: '#00f' },
        neutral: { base: '#999', tint: '#eee' },
        success: { base: '#0f0' },
        warning: { base: '#ff0' },
      },
    },
    radius: { full: 999, card: 1, smallControl: 1 },
    size: { qr: 100, qrFrame: 200 },
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
import { KitchenDashboardScreen } from './KitchenDashboardScreen';
import { KitchenQrScreen } from './KitchenQrScreen';

const today = toBusinessDateKey(new Date().toISOString());
const location = {
  id: 'location-1',
  shortCode: 'HQ',
  displayName: 'Headquarters',
  servingPointName: 'Lunch counter',
  address: '1 Example Street',
};
const alternateLocation = { ...location, id: 'location-2', displayName: 'Branch' };
const dashboard = {
  date: today,
  location,
  window: {
    opensAt: new Date(Date.now() - 60_000).toISOString(),
    closesAt: new Date(Date.now() + 60_000).toISOString(),
    timeZone: 'Asia/Ho_Chi_Minh',
  },
  lastUpdated: new Date().toISOString(),
  counts: {
    registered: 3,
    checkedIn: 1,
    pending: 1,
    noShow: 1,
    regular: 2,
    vegetarian: 1,
  },
};
const validQr = {
  qr: 'stable-kitchen-qr',
  date: today,
  location,
  activeFrom: new Date(Date.now() - 1_000).toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
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
  vi.useFakeTimers();
  focusState.value = true;
  apiMock.getKitchenQr.mockReset();
  apiMock.getKitchenDashboard.mockReset();
});

afterEach(() => {
  appStateMock.emit('active');
  focusState.value = true;
  vi.useRealTimers();
});

describe('KitchenDashboardScreen', () => {
  it('keeps the last dashboard snapshot visible when a refresh fails', async () => {
    apiMock.getKitchenDashboard
      .mockResolvedValueOnce({ data: dashboard })
      .mockRejectedValueOnce(new MobileApiError('API_TIMEOUT', 'errors.apiTimeout'));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<KitchenDashboardScreen {...({} as React.ComponentProps<typeof KitchenDashboardScreen>)} />);
      await flushPromises();
    });

    const refreshControl = renderer.root.findByType('RefreshControl' as never);
    await act(async () => {
      refreshControl.props.onRefresh();
      await flushPromises();
    });

    expect(
      renderer.root
        .findAllByType('AppText' as never)
        .some((node) => node.props.children === 'Headquarters'),
    ).toBe(true);
    expect(renderer.root.findByType('StatusBadge' as never).props.label).toBe('kitchenDashboard.stale');
    renderer.unmount();
  });

  it('polls only while focused and foregrounded', async () => {
    apiMock.getKitchenDashboard.mockResolvedValue({ data: dashboard });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<KitchenDashboardScreen {...({} as React.ComponentProps<typeof KitchenDashboardScreen>)} />);
      await flushPromises();
    });
    expect(apiMock.getKitchenDashboard).toHaveBeenCalledTimes(1);

    appStateMock.emit('background');
    await act(async () => {
      vi.advanceTimersByTime(20_000);
      await flushPromises();
    });
    expect(apiMock.getKitchenDashboard).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });
});

describe('KitchenQrScreen', () => {
  it('renders today’s QR before the service window opens', async () => {
    vi.setSystemTime(new Date('2026-09-30T03:00:00.000Z'));
    apiMock.getKitchenQr.mockResolvedValueOnce({
      data: {
        ...validQr,
        date: '2026-09-30',
        activeFrom: '2026-09-30T03:30:00.000Z',
        expiresAt: '2026-09-30T06:30:00.000Z',
      },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <KitchenQrScreen
          {...({} as React.ComponentProps<typeof KitchenQrScreen>)}
        />,
      );
      await flushPromises();
    });

    expect(renderer.root.findByType('QRCode' as never).props.value).toBe(
      'stable-kitchen-qr',
    );
    expect(
      renderer.root
        .findAllByType('AppText' as never)
        .some((node) => node.props.children === 'kitchenQr.window'),
    ).toBe(true);
    renderer.unmount();
  });

  it('removes a cached QR at its exact expiry boundary and after', async () => {
    vi.setSystemTime(new Date('2026-09-30T06:29:59.000Z'));
    apiMock.getKitchenQr.mockResolvedValueOnce({
      data: {
        ...validQr,
        date: '2026-09-30',
        activeFrom: '2026-09-30T03:30:00.000Z',
        expiresAt: '2026-09-30T06:30:00.000Z',
      },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <KitchenQrScreen
          {...({} as React.ComponentProps<typeof KitchenQrScreen>)}
        />,
      );
      await flushPromises();
    });
    expect(renderer.root.findAllByType('QRCode' as never)).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await flushPromises();
    });
    expect(renderer.root.findAllByType('QRCode' as never)).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await flushPromises();
    });
    expect(renderer.root.findAllByType('QRCode' as never)).toHaveLength(0);
    renderer.unmount();
  });

  it('clears an expired QR instead of rendering an unsafe cached value', async () => {
    apiMock.getKitchenQr.mockResolvedValueOnce({
      data: {
        ...validQr,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <KitchenQrScreen
          {...({} as React.ComponentProps<typeof KitchenQrScreen>)}
        />,
      );
      await flushPromises();
    });

    expect(renderer.root.findByType('EmptyState' as never).props.title).toBe('kitchenQr.unavailable');
    expect(renderer.root.findAllByType('QRCode' as never)).toHaveLength(0);
    renderer.unmount();
  });

  it('clears a QR from a different business date', async () => {
    apiMock.getKitchenQr.mockResolvedValueOnce({
      data: { ...validQr, date: '2000-01-01' },
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <KitchenQrScreen
          {...({} as React.ComponentProps<typeof KitchenQrScreen>)}
        />,
      );
      await flushPromises();
    });

    expect(renderer.root.findByType('EmptyState' as never).props.title).toBe('kitchenQr.unavailable');
    expect(renderer.root.findAllByType('QRCode' as never)).toHaveLength(0);
    renderer.unmount();
  });
  it('clears a QR when the serving location changes during refresh', async () => {
    apiMock.getKitchenQr
      .mockResolvedValueOnce({ data: validQr })
      .mockResolvedValueOnce({ data: { ...validQr, location: alternateLocation } });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<KitchenQrScreen {...({} as React.ComponentProps<typeof KitchenQrScreen>)} />);
      await flushPromises();
    });
    expect(renderer.root.findAllByType('QRCode' as never)).toHaveLength(1);

    const refresh = actionFor(renderer, 'kitchenQr.refresh');
    await act(async () => {
      refresh?.props.onPress();
      await flushPromises();
    });

    expect(renderer.root.findByType('EmptyState' as never).props.title).toBe('kitchenQr.unavailable');
    expect(renderer.root.findAllByType('QRCode' as never)).toHaveLength(0);
    renderer.unmount();
  });
});
