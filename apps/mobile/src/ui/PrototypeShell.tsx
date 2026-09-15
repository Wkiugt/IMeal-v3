import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ScrollViewProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarDays, Home, QrCode, ScanLine, UserRound } from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import type { TranslationKey } from '../i18n/translations';
import { theme } from '../theme';
import type { AppTabParamList } from '../navigation';
import type { PrototypeIcon } from './PrototypePrimitives';
import { ScreenEntrance } from './BrandMotion';
import { useLanguage } from '../i18n/LanguageProvider';

export type PrototypeNavItem = {
  labelKey: TranslationKey;
  route: keyof AppTabParamList;
  icon: PrototypeIcon;
};

export const employeeNav: PrototypeNavItem[] = [
  { labelKey: 'nav.dashboard', route: 'EmployeeDashboard', icon: Home },
  { labelKey: 'nav.calendar', route: 'EmployeeCalendar', icon: CalendarDays },
  { labelKey: 'nav.ticket', route: 'PickupIntent', icon: QrCode },
  { labelKey: 'nav.profile', route: 'EmployeeProfile', icon: UserRound },
];

export const hybridEmployeeNav: PrototypeNavItem[] = [
  ...employeeNav.slice(0, 3),
  { labelKey: 'nav.checkIn', route: 'KitchenScanner', icon: ScanLine },
  employeeNav[3],
];

export const kitchenNav: PrototypeNavItem[] = [
  { labelKey: 'nav.dashboard', route: 'KitchenDashboard', icon: Home },
  { labelKey: 'nav.scanner', route: 'KitchenScanner', icon: QrCode },
];
export function PrototypeTabBar({
  state,
  descriptors,
  navigation,
  navItems,
  insets,
}: BottomTabBarProps & { navItems: PrototypeNavItem[] }) {
  const { t } = useLanguage();
  return (
    <View
      style={[
        styles.tabBar,
        { paddingBottom: Math.max(insets.bottom, theme.spacing.navInset) },
      ]}
      pointerEvents="box-none"
    >
      <View style={styles.bottomNav} accessibilityRole="tablist">
        {navItems.map((item) => {
          const routeIndex = state.routes.findIndex(
            (route) => route.name === item.route,
          );
          if (routeIndex < 0) return null;
          const route = state.routes[routeIndex];
          const focused = state.index === routeIndex;
          const options = descriptors[route.key]?.options;
          const Icon = item.icon;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options?.tabBarAccessibilityLabel || t(item.labelKey)}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!event.defaultPrevented) {
                  if (item.route === 'EmployeeProfile') {
                    navigation.navigate('EmployeeProfile', { screen: 'ProfileHome' });
                  } else if (!focused) {
                    navigation.navigate(route.name);
                  }
                }
              }}
              style={[styles.navItem, focused && styles.navItemActive]}
            >
              <Icon
                size={22}
                color={focused ? theme.colors.accentDeep : theme.colors.muted}
                strokeWidth={1.8}
              />
              {focused && (
                <Text style={[styles.navLabel, styles.navLabelActive]}>
                  {t(item.labelKey)}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function PrototypeFrame({
  children,
  bottomClearance = 104,
  scroll = true,
  scrollProps,
  animateEntrance = true,
}: {
  children: React.ReactNode;
  bottomClearance?: number;
  scroll?: boolean;
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle'>;
  animateEntrance?: boolean;
}) {
  const { width } = useWindowDimensions();
  const isFocused = useIsFocused();
  const deviceStyle = width > 480 ? styles.deviceWide : styles.device;
  const device = (
    <View style={deviceStyle}>
      {scroll ? (
        <ScrollView
          {...scrollProps}
          style={styles.body}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: bottomClearance },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={styles.body}>{children}</View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.canvas}>
        {animateEntrance ? (
          <ScreenEntrance active={isFocused} style={styles.screenEntrance}>
            {device}
          </ScreenEntrance>
        ) : (
          device
        )}
      </View>
    </SafeAreaView>
  );
}

export function PrototypeSectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sectionTitle}>
      <Text style={styles.sectionHeading}>{title}</Text>
      {subtitle && <Text style={styles.sectionSubtitle}>{subtitle}</Text>}
    </View>
  );
}

export const prototypeStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: theme.colors.border },
  title: { color: theme.colors.fg, fontSize: 20, fontFamily: theme.typography.bold, letterSpacing: -0.2 },
  body: { color: theme.colors.fg, fontSize: 14, fontFamily: theme.typography.regular, lineHeight: 21 },
  muted: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.canvas },
  canvas: { flex: 1, width: '100%', alignItems: 'center', backgroundColor: theme.colors.canvas },
  screenEntrance: { flex: 1, width: '100%', alignItems: 'center' },
  device: { flex: 1, width: '100%', backgroundColor: theme.colors.bg, overflow: 'hidden' },
  deviceWide: { flex: 1, width: 390, maxWidth: '100%', backgroundColor: theme.colors.bg, overflow: 'hidden', borderRadius: 52 },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: theme.spacing.gutter, paddingTop: 4, minHeight: '100%' },
  tabBar: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.navInset,
    paddingTop: 6,
    backgroundColor: theme.colors.bg,
  },
  bottomNav: {
    width: 390,
    maxWidth: '100%',
    padding: 6,
    minHeight: 60,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    backgroundColor: 'rgba(255,255,255,0.96)',
    flexDirection: 'row',
    gap: 4,
    ...theme.shadows.md,
  },
  navItem: { flexGrow: 1, flexBasis: 0, minWidth: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: theme.radii.md },
  navItemActive: { flexGrow: 1.65, flexDirection: 'row', gap: 7, backgroundColor: theme.colors.accentSoft },
  navLabel: { color: theme.colors.muted, fontSize: 11, fontFamily: theme.typography.semiBold },
  navLabelActive: { color: theme.colors.accentDeep },
  sectionTitle: { paddingVertical: 18, gap: 5 },
  sectionHeading: { color: theme.colors.fg, fontSize: 20, fontFamily: theme.typography.bold, letterSpacing: -0.2 },
  sectionSubtitle: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular, lineHeight: 19 },
});
