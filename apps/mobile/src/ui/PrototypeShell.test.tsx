import React from 'react';
import { describe, expect, it, vi } from 'vitest';

const languageMock = vi.hoisted(() => ({ language: 'vi' as 'vi' | 'en' }));

const labels = {
  vi: {
    'nav.dashboard': 'Bảng điều khiển',
    'nav.calendar': 'Lịch',
    'nav.ticket': 'Vé suất ăn',
    'nav.profile': 'Hồ sơ',
    'nav.scanner': 'Máy quét',
  },
  en: {
    'nav.dashboard': 'Dashboard',
    'nav.calendar': 'Calendar',
    'nav.ticket': 'Meal ticket',
    'nav.profile': 'Profile',
    'nav.scanner': 'Scanner',
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
  Pressable: nativeComponent('Pressable'),
  ScrollView: nativeComponent('ScrollView'),
  StyleSheet: { create: <T,>(styles: T) => styles },
  Text: nativeComponent('Text'),
  View: nativeComponent('View'),
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 1, fontScale: 1 }),
}));

vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: nativeComponent('SafeAreaView') }));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('./BrandMotion', () => ({ ScreenEntrance: nativeComponent('ScreenEntrance') }));
vi.mock('lucide-react-native', () => {
  const icon = (name: string) => nativeComponent(name);
  return {
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

import { theme } from '../theme';
import {
  employeeNav,
  hybridEmployeeNav,
  kitchenNav,
  PrototypeTabBar,
  type PrototypeNavItem,
} from './PrototypeShell';

function elementsOfType(node: React.ReactNode, displayName: string): React.ReactElement[] {
  if (!React.isValidElement(node)) return [];
  const matches = node.type && (node.type as { displayName?: string }).displayName === displayName
    ? [node]
    : [];
  return matches.concat(
    React.Children.toArray(node.props.children).flatMap((child) => elementsOfType(child, displayName)),
  );
}

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!Array.isArray(style)) return (style ?? {}) as Record<string, unknown>;
  return style.reduce<Record<string, unknown>>((result, value) => ({
    ...result,
    ...flattenStyle(value),
  }), {});
}
function renderTabBar(navItems: PrototypeNavItem[] = employeeNav, focusedIndex = 0) {
  const navigation = {
    emit: vi.fn(() => ({ defaultPrevented: false })),
    navigate: vi.fn(),
  };
  const routes = navItems.map((item) => ({ key: `${item.route}-key`, name: item.route }));
  const tree = PrototypeTabBar({
    state: { index: focusedIndex, routes } as never,
    descriptors: Object.fromEntries(routes.map((route) => [route.key, { options: {} }])) as never,
    navigation: navigation as never,
    navItems,
    insets: { bottom: 0, top: 0, left: 0, right: 0 },
  });
  return { navigation, pressables: elementsOfType(tree, 'Pressable') };
}

describe('PrototypeTabBar', () => {
  it('renders icon-only equal-footprint targets while keeping active accessibility state', () => {
    const { pressables } = renderTabBar();
    for (const [navItems, expectedCount] of [
      [employeeNav, 4],
      [hybridEmployeeNav, 5],
      [kitchenNav, 3],
    ] as const) {
      expect(renderTabBar(navItems).pressables).toHaveLength(expectedCount);
    }

    expect(pressables).toHaveLength(4);
    expect(pressables.every((pressable) => elementsOfType(pressable, 'Text').length === 0)).toBe(true);

    const styles = pressables.map((pressable) => flattenStyle(pressable.props.style));
    expect(styles.every((style) => style.flex === 1)).toBe(true);
    expect(styles.every((style) => style.minWidth === 44 && style.minHeight === 48)).toBe(true);
    expect(styles[0]).toMatchObject({ backgroundColor: theme.colors.accentSoft });
    expect(styles.slice(1).every((style) => style.backgroundColor === undefined)).toBe(true);
    expect(styles[0]).not.toHaveProperty('flexGrow');
    expect(styles[0]).not.toHaveProperty('flexDirection');
    expect(styles[0]).not.toHaveProperty('gap');

    expect(elementsOfType(pressables[0], 'Home')[0].props.color).toBe(theme.colors.accentDeep);
    expect(elementsOfType(pressables[1], 'CalendarDays')[0].props.color).toBe(theme.colors.muted);
    expect(pressables[0].props.accessibilityRole).toBe('tab');
    expect(pressables[0].props.accessibilityState).toEqual({ selected: true });
    expect(pressables[1].props.accessibilityState).toEqual({ selected: false });
  });

  it.each([
    ['vi', ['Bảng điều khiển', 'Lịch', 'Vé suất ăn', 'Hồ sơ']],
    ['en', ['Dashboard', 'Calendar', 'Meal ticket', 'Profile']],
  ] as const)('resolves %s accessibility labels and preserves profile nesting', (language, expectedLabels) => {
    languageMock.language = language;
    const { navigation, pressables } = renderTabBar();

    expect(pressables.map((pressable) => pressable.props.accessibilityLabel)).toEqual(expectedLabels);
    pressables[1].props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('EmployeeCalendar');
    pressables[3].props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('EmployeeProfile', { screen: 'ProfileHome' });
  });

  it.each([
    ['vi', ['Bảng điều khiển', 'Máy quét', 'Hồ sơ']],
    ['en', ['Dashboard', 'Scanner', 'Profile']],
  ] as const)('resolves %s kitchen-only labels and direct profile navigation', (language, expectedLabels) => {
    languageMock.language = language;
    const { navigation, pressables } = renderTabBar(kitchenNav);

    expect(pressables.map((pressable) => pressable.props.accessibilityLabel)).toEqual(expectedLabels);
    pressables[1].props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('KitchenScanner');
    pressables[2].props.onPress();
    expect(navigation.navigate).toHaveBeenCalledWith('KitchenProfile');
  });
});
