import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CalendarDays, Home, QrCode, ScanLine, UserRound } from 'lucide-react-native';
import { theme } from '../theme';
import type { RootStackParamList } from '../navigation';
import type { PrototypeIcon } from './PrototypePrimitives';

type RouteName = keyof RootStackParamList;
export type PrototypeNavItem = { label: string; route: RouteName; icon: PrototypeIcon };

export const employeeNav: PrototypeNavItem[] = [
  { label: 'Dashboard', route: 'EmployeeDashboard', icon: Home },
  { label: 'Calendar', route: 'EmployeeCalendar', icon: CalendarDays },
  { label: 'Ticket', route: 'PickupIntent', icon: QrCode },
  { label: 'Profile', route: 'EmployeeProfile', icon: UserRound },
];

export const hybridEmployeeNav: PrototypeNavItem[] = [
  ...employeeNav.slice(0, 3),
  { label: 'Check-in', route: 'KitchenScanner', icon: ScanLine },
  employeeNav[3],
];

export const kitchenNav: PrototypeNavItem[] = [
  { label: 'Dashboard', route: 'KitchenDashboard', icon: Home },
  { label: 'Scanner', route: 'KitchenScanner', icon: QrCode },
];

export function PrototypeFrame({
  children,
  activeRoute,
  navItems,
  onNavigate,
  bottomClearance = 120,
  scroll = true,
  scrollProps,
}: {
  children: React.ReactNode;
  activeRoute: RouteName;
  navItems: PrototypeNavItem[];
  onNavigate: (route: RouteName) => void;
  bottomClearance?: number;
  scroll?: boolean;
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle'>;
}) {
  const { width } = useWindowDimensions();
  const deviceStyle = width > 480 ? styles.deviceWide : styles.device;
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.canvas}>
        <View style={deviceStyle}>
          {scroll ? (
            <ScrollView
              {...scrollProps}
              style={styles.body}
              contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomClearance }]}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.body}>{children}</View>
          )}
          <View style={styles.bottomNav} accessibilityRole="tablist">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = item.route === activeRoute;
              return (
                <Pressable
                  key={item.route}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={item.label}
                  onPress={() => onNavigate(item.route)}
                  style={[styles.navItem, active && styles.navItemActive]}
                >
                  <Icon size={22} color={active ? theme.colors.accentDeep : theme.colors.muted} strokeWidth={1.8} />
                  <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
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
  title: { color: theme.colors.fg, fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  body: { color: theme.colors.fg, fontSize: 14, lineHeight: 21 },
  muted: { color: theme.colors.muted, fontSize: 13 },
});

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: theme.colors.canvas },
  canvas: { flex: 1, width: '100%', alignItems: 'center', backgroundColor: theme.colors.canvas },
  device: { flex: 1, width: '100%', backgroundColor: theme.colors.bg, overflow: 'hidden' },
  deviceWide: { flex: 1, width: 390, maxWidth: '100%', backgroundColor: theme.colors.bg, overflow: 'hidden', borderRadius: 52 },
  body: { flex: 1 },
  scrollContent: { paddingHorizontal: theme.spacing.gutter, paddingTop: 4, minHeight: '100%' },
  bottomNav: {
    position: 'absolute',
    left: theme.spacing.navInset,
    right: theme.spacing.navInset,
    bottom: 8,
    padding: 8,
    minHeight: 72,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radii.lg,
    backgroundColor: 'rgba(255,255,255,0.96)',
    flexDirection: 'row',
    gap: 4,
    ...theme.shadows.md,
  },
  navItem: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: theme.radii.md },
  navItemActive: { backgroundColor: theme.colors.accentSoft },
  navLabel: { color: theme.colors.muted, fontSize: 11, fontWeight: '600' },
  navLabelActive: { color: theme.colors.accentDeep },
  sectionTitle: { paddingVertical: 18, gap: 5 },
  sectionHeading: { color: theme.colors.fg, fontSize: 20, fontWeight: '700', letterSpacing: -0.2 },
  sectionSubtitle: { color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
});
