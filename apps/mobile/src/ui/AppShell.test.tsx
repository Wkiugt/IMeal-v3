import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const languageMock = vi.hoisted(() => ({ language: 'vi' as 'vi' | 'en' }));
const notificationMock = vi.hoisted(() => ({ unreadCount: 0 }));
const safeAreaMock = vi.hoisted(() => ({ bottom: 0 }));
const labels = {
  vi: {
    'nav.dashboard': 'Bảng điều khiển',
    'nav.calendar': 'Lịch',
    'nav.checkIn': 'Nhận suất',
    'nav.notifications': 'Thông báo',
    'nav.profile': 'Hồ sơ',
    'nav.kitchenQr': 'Mã QR bếp',
  },
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.calendar': 'Calendar',
    'nav.checkIn': 'Check-in',
    'nav.notifications': 'Notifications',
    'nav.profile': 'Profile',
    'nav.kitchenQr': 'Kitchen QR',
  },
} as const;
function nativeComponent(name: string) {
  function Component({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) {
    return React.createElement(name, props, children);
  }
  Component.displayName = name;
  return Component;
}

vi.mock('react-native', () => ({
  Animated: {
    Value: class {
      setValue() {}
      stopAnimation() {}
    },
  },
  Easing: {
    bezier: () => 'bezier',
    linear: 'linear',
  },
  Pressable: nativeComponent('Pressable'),
  ScrollView: nativeComponent('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: nativeComponent('Text'),
  View: nativeComponent('View'),
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
}));

vi.mock('react-native-safe-area-context', () => ({
  SafeAreaView: nativeComponent('SafeAreaView'),
  useSafeAreaInsets: () => ({ bottom: safeAreaMock.bottom, top: 0, left: 0, right: 0 }),
}));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('./BrandMotion', () => ({ ScreenEntrance: nativeComponent('ScreenEntrance') }));
vi.mock('./components', () => ({
  AppText: nativeComponent('AppText'),
  FloatingSurface: nativeComponent('FloatingSurface'),
}));
vi.mock('lucide-react-native', () => {
  const icon = (name: string) => nativeComponent(name);
  return {
    Bell: icon('Bell'),
    CalendarDays: icon('CalendarDays'),
    Home: icon('Home'),
    QrCode: icon('QrCode'),
    ScanLine: icon('ScanLine'),
    UserRound: icon('UserRound'),
  };
});
vi.mock('../i18n/LanguageProvider', () => ({
  useLanguage: () => ({
    t: (key: keyof typeof labels.vi) => labels[languageMock.language][key],
  }),
}));

vi.mock('../notifications/NotificationProvider', () => ({
  useNotifications: () => notificationMock,
}));

import { designTokens } from './designTokens';
import {
  employeeNav,
  hybridEmployeeNav,
  kitchenNav,
  AppFrame,
  getDockFootprint,
  AppTabBar,
  type AppNavItem,
} from './AppShell';

type TestElementProps = {
  accessibilityLabel?: string;
  accessibilityRole?: string;
  accessibilityState: { selected?: boolean };
  children?: React.ReactNode;
  color?: string;
  contentContainerStyle?: unknown;
  onPress: () => void;
  strokeWidth?: number;
  style?: unknown;
};
function elementsOfType(
  node: React.ReactNode,
  displayName: string,
): Array<React.ReactElement<TestElementProps>> {
  if (!React.isValidElement<TestElementProps>(node)) return [];
  const componentType = node.type;
  const typeDisplayName =
    typeof componentType === 'function' && 'displayName' in componentType
      ? componentType.displayName
      : undefined;
  const matches = typeDisplayName === displayName
    ? [node]
    : [];
  return matches.concat(
    React.Children.toArray(node.props.children as React.ReactNode).flatMap((child) => elementsOfType(child, displayName)),
  );
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!Array.isArray(style)) return (style ?? {}) as Record<string, unknown>;
  return style.reduce<Record<string, unknown>>((result, value) => ({
    ...result,
    ...flattenStyle(value),
  }), {});
}

function renderTabBar(
  navItems: AppNavItem[] = employeeNav,
  focusedIndex = 0,
  routeNames: AppNavItem[] = navItems,
) {
  const navigation = {
    emit: vi.fn(() => ({ defaultPrevented: false })),
    navigate: vi.fn(),
  };
  const routes = routeNames.map((item) => ({ key: `${item.route}-key`, name: item.route }));
  const tree = AppTabBar({
    state: { index: focusedIndex, routes } as never,
    descriptors: Object.fromEntries(routes.map((route) => [route.key, { options: {} }])) as never,
    navigation: navigation as never,
    navItems,
    insets: { bottom: 0, top: 0, left: 0, right: 0 },
  });
  return { navigation, tree, pressables: elementsOfType(tree, 'Pressable') };
}

describe('AppTabBar', () => {
  it('renders icon-only equal-footprint targets while keeping active accessibility state', () => {
    const { pressables } = renderTabBar();
    for (const [navItems, expectedCount] of [
      [employeeNav, 5],
      [hybridEmployeeNav, 5],
      [kitchenNav, 3],
    ] as const) {
      expect(renderTabBar(navItems).pressables).toHaveLength(expectedCount);
    }

    expect(pressables).toHaveLength(5);
    expect(pressables.every((pressable) => elementsOfType(pressable, 'Text').length === 0)).toBe(true);

    const styles = pressables.map((pressable) => flattenStyle(pressable.props.style));
    expect(styles.every((style) => style.flex === 1)).toBe(true);
    expect(styles.every((style) => style.minWidth === designTokens.size.touchMin && style.minHeight === 48)).toBe(true);
    expect(styles.every((style) => style.backgroundColor === undefined)).toBe(true);
    expect(styles[0]).not.toHaveProperty('flexGrow');
    expect(styles[0]).not.toHaveProperty('flexDirection');
    expect(styles[0]).not.toHaveProperty('gap');

    expect(elementsOfType(pressables[0], 'Home')[0].props.color).toBe(designTokens.color.brand.primary);
    expect(elementsOfType(pressables[1], 'CalendarDays')[0].props.color).toBe(designTokens.color.text.tertiary);
    expect(elementsOfType(pressables[0], 'Home')[0].props.strokeWidth).toBe(2.1);
    expect(elementsOfType(pressables[1], 'CalendarDays')[0].props.strokeWidth).toBe(1.8);
    expect(pressables[0].props.accessibilityRole).toBe('tab');
    expect(pressables[0].props.accessibilityState).toEqual({ selected: true });
    expect(pressables[1].props.accessibilityState).toEqual({ selected: false });
  });

  it.each([
    ['vi', ['Bảng điều khiển', 'Lịch', 'Nhận suất', 'Thông báo', 'Hồ sơ']],
    ['en', ['Dashboard', 'Calendar', 'Check-in', 'Notifications', 'Profile']],
  ] as const)('resolves %s accessibility labels and preserves profile nesting', (language, expectedLabels) => {
    languageMock.language = language;
    const { navigation, pressables } = renderTabBar();

    expect(pressables.map((pressable) => pressable.props.accessibilityLabel)).toEqual(expectedLabels);
    pressables[1].props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('EmployeeCalendar');
    pressables[4].props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('EmployeeProfile', { screen: 'ProfileHome' });
  });

  it.each([
    ['vi', ['Bảng điều khiển', 'Mã QR bếp', 'Hồ sơ']],
    ['en', ['Dashboard', 'Kitchen QR', 'Profile']],
  ] as const)('resolves %s kitchen-only labels and direct profile navigation', (language, expectedLabels) => {
    languageMock.language = language;
    const { navigation, pressables } = renderTabBar(kitchenNav);

    expect(pressables.map((pressable) => pressable.props.accessibilityLabel)).toEqual(expectedLabels);
    pressables[1].props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('KitchenQr');
    pressables[2].props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('KitchenProfile');
  });

  it('does not show a false selected tab when the active route is hidden from the dock', () => {
    const hiddenRoute: AppNavItem = { ...kitchenNav[1], route: 'KitchenQr' };
    const { pressables } = renderTabBar(employeeNav, 5, [...employeeNav, hiddenRoute]);

    expect(pressables.every((pressable) => pressable.props.accessibilityState.selected === false)).toBe(true);
    expect(elementsOfType(pressables[0], 'Home')[0].props.color).toBe(designTokens.color.text.tertiary);
  });

  it('keeps the unread notification badge in the visible route item', () => {
    notificationMock.unreadCount = 7;
    const { pressables } = renderTabBar();

    expect(elementsOfType(pressables[3], 'AppText')[0].props.children).toBe(7);
    notificationMock.unreadCount = 0;
  });
});

describe('AppFrame clearance', () => {
  it('computes dock footprint from the safe-area inset', () => {
    expect(getDockFootprint(0)).toBe(
      designTokens.size.navMinHeight + designTokens.space.lg + designTokens.space.sm,
    );
    expect(getDockFootprint(24)).toBe(
      designTokens.size.navMinHeight + 24 + designTokens.space.sm,
    );
  });

  it.each([
    [0, 104],
    [24, 108],
  ] as const)('uses safe-area dock clearance for scroll content at inset %d', (bottom, expected) => {
    safeAreaMock.bottom = bottom;
    const tree = AppFrame({ children: React.createElement('Content') });
    const scrollView = elementsOfType(tree, 'ScrollView')[0];

    expect(flattenStyle(scrollView.props.contentContainerStyle).paddingBottom).toBe(expected);
  });

  it('applies the same clearance to non-scroll content', () => {
    safeAreaMock.bottom = 24;
    const tree = AppFrame({ children: React.createElement('Content'), scroll: false, bottomClearance: 0 });
    const body = elementsOfType(tree, 'View').find((element) => {
      const style = flattenStyle(element.props.style);
      return style.paddingBottom === 108;
    });

    expect(body).toBeDefined();
    expect(flattenStyle(body?.props.style).paddingBottom).toBe(108);
  });
});
