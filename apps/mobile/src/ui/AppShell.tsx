import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ScrollViewProps,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  CalendarDays,
  Home,
  QrCode,
  ScanLine,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import type { TranslationKey } from '../i18n/translations';
import { designTokens } from './designTokens';
import type { AppTabParamList } from '../navigation';
import { AppText, FloatingSurface } from './components';
import { ScreenEntrance, ScreenLoading } from './BrandMotion';
import { useReducedMotion } from './useReducedMotion';
import { useLanguage } from '../i18n/LanguageProvider';
import { useNotifications } from '../notifications/NotificationProvider';

export type AppNavItem = {
  labelKey: TranslationKey;
  route: keyof AppTabParamList;
  icon: LucideIcon;
};

export const employeeNav: AppNavItem[] = [
  { labelKey: 'nav.dashboard', route: 'EmployeeDashboard', icon: Home },
  { labelKey: 'nav.calendar', route: 'EmployeeCalendar', icon: CalendarDays },
  { labelKey: 'nav.checkIn', route: 'SelfCheckIn', icon: ScanLine },
  { labelKey: 'nav.notifications', route: 'Notifications', icon: Bell },
  { labelKey: 'nav.profile', route: 'EmployeeProfile', icon: UserRound },
];

export const hybridEmployeeNav: AppNavItem[] = employeeNav;

export const kitchenNav: AppNavItem[] = [
  { labelKey: 'nav.dashboard', route: 'KitchenDashboard', icon: Home },
  { labelKey: 'nav.kitchenQr', route: 'KitchenQr', icon: QrCode },
  { labelKey: 'nav.profile', route: 'KitchenProfile', icon: UserRound },
];

type SelectedLensProps = {
  focusedVisibleIndex: number;
  visibleCount: number;
};

function SelectedLens({ focusedVisibleIndex, visibleCount }: SelectedLensProps) {
  const [dockWidth, setDockWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const segmentWidth = visibleCount > 0 ? dockWidth / visibleCount : 0;
  const targetX = segmentWidth * focusedVisibleIndex;

  useEffect(() => {
    const visible =
      focusedVisibleIndex >= 0 && visibleCount > 0 && dockWidth > 0;

    if (reduceMotion) {
      translateX.setValue(visible ? targetX : 0);
      opacity.setValue(visible ? 1 : 0);
      return;
    }

    if (!visible) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: designTokens.motion.duration.fast,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.parallel([
      Animated.spring(translateX, {
        ...designTokens.motion.spring,
        toValue: targetX,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: designTokens.motion.duration.fast,
        easing: designTokens.motion.easing.standard,
        useNativeDriver: true,
      }),
    ]).start();

    return () => {
      translateX.stopAnimation();
      opacity.stopAnimation();
    };
  }, [
    dockWidth,
    focusedVisibleIndex,
    opacity,
    reduceMotion,
    targetX,
    translateX,
    visibleCount,
  ]);

  return (
    <View
      pointerEvents="none"
      onLayout={(event: LayoutChangeEvent) => {
        const nextWidth = event.nativeEvent.layout.width;
        if (nextWidth !== dockWidth) setDockWidth(nextWidth);
      }}
      style={appStyles.lensMeasure}
    >
      <Animated.View
        style={[
          appStyles.selectedLens,
          {
            opacity,
            transform: [{ translateX }],
            width: segmentWidth,
          },
        ]}
      />
    </View>
  );
}

export function getDockFootprint(bottomInset: number): number {
  return (
    designTokens.size.navMinHeight
    + Math.max(bottomInset, designTokens.space.lg)
    + designTokens.space.sm
  );
}

export function AppTabBar({
  state,
  descriptors,
  navigation,
  navItems,
  insets,
}: BottomTabBarProps & { navItems: AppNavItem[] }) {
  const { t } = useLanguage();
  const { unreadCount } = useNotifications();
  const activeRouteName = state.routes[state.index]?.name;
  const visibleItems = navItems.flatMap((item) => {
    const route = state.routes.find((candidate) => candidate.name === item.route);
    return route ? [{ item, route }] : [];
  });
  const focusedVisibleIndex = visibleItems.findIndex(
    ({ route }) => route.name === activeRouteName,
  );

  return (
    <View
      style={[
        appStyles.tabBar,
        { paddingBottom: Math.max(insets.bottom, designTokens.space.lg) },
      ]}
      pointerEvents="box-none"
    >
      <FloatingSurface style={appStyles.bottomNav}>
        <View style={appStyles.bottomNavInner} accessibilityRole="tablist">
          <SelectedLens
            focusedVisibleIndex={focusedVisibleIndex}
            visibleCount={visibleItems.length}
          />
          {visibleItems.map(({ item, route }, index) => {
            const focused = focusedVisibleIndex === index;
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
                style={appStyles.navItem}
              >
                <View style={appStyles.iconWrap}>
                  <Icon
                    size={22}
                    color={
                      focused
                        ? designTokens.color.brand.primary
                        : designTokens.color.text.tertiary
                    }
                    strokeWidth={focused ? 2.1 : 1.8}
                  />
                  {item.route === 'Notifications' && unreadCount > 0 && (
                    <View style={appStyles.badge}>
                      <AppText variant="badgeLabel" tone="onBrand" style={appStyles.badgeText}>
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </AppText>
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      </FloatingSurface>
    </View>
  );
}

export function AppFrame({
  children,
  bottomClearance = 104,
  scroll = true,
  scrollProps,
  animateEntrance = true,
  screenLoadingLabel,
}: {
  children: React.ReactNode;
  bottomClearance?: number;
  scroll?: boolean;
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle'>;
  animateEntrance?: boolean;
  screenLoadingLabel?: string;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const resolvedBottomClearance = Math.max(
    bottomClearance,
    getDockFootprint(insets.bottom) + designTokens.space.lg,
  );
  const deviceStyle = width > 480 ? appStyles.deviceWide : appStyles.device;
  const device = (
    <View style={deviceStyle}>
      {screenLoadingLabel ? (
        <ScreenLoading label={screenLoadingLabel} />
      ) : scroll ? (
        <ScrollView
          {...scrollProps}
          style={appStyles.body}
          contentContainerStyle={[
            appStyles.scrollContent,
            { paddingBottom: resolvedBottomClearance },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[appStyles.body, { paddingBottom: resolvedBottomClearance }]}>
          {children}
        </View>
      )}
    </View>
  );

  return (
    <SafeAreaView style={appStyles.safeArea} edges={['top', 'bottom']}>
      <View style={appStyles.canvas}>
        {animateEntrance ? (
          <ScreenEntrance active={isFocused} style={appStyles.screenEntrance}>
            {device}
          </ScreenEntrance>
        ) : (
          device
        )}
      </View>
    </SafeAreaView>
  );
}

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={appStyles.sectionTitle}>
      <AppText variant="sectionTitle">{title}</AppText>
      {subtitle && (
        <AppText variant="supporting" tone="secondary">
          {subtitle}
        </AppText>
      )}
    </View>
  );
}

export const appStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  divider: { height: 1, backgroundColor: designTokens.color.border.standard },
  title: {
    color: designTokens.color.text.strong,
    ...designTokens.typography.sectionTitle,
  },
  body: {
    flex: 1,
    color: designTokens.color.text.strong,
    ...designTokens.typography.body,
  },
  muted: {
    color: designTokens.color.text.secondary,
    ...designTokens.typography.supporting,
  },
  safeArea: {
    flex: 1,
    backgroundColor: designTokens.color.background.page,
  },
  canvas: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    backgroundColor: designTokens.color.background.page,
  },
  screenEntrance: { flex: 1, width: '100%', alignItems: 'center' },
  device: {
    flex: 1,
    width: '100%',
    backgroundColor: designTokens.color.background.page,
    overflow: 'hidden',
  },
  deviceWide: {
    flex: 1,
    width: 390,
    maxWidth: '100%',
    backgroundColor: designTokens.color.background.page,
    overflow: 'hidden',
    borderRadius: 52,
  },
  scrollContent: {
    paddingHorizontal: designTokens.space['2xl'],
    paddingTop: designTokens.space.xs,
    minHeight: '100%',
  },
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingHorizontal: designTokens.space.lg,
    paddingTop: 6,
  },
  bottomNav: {
    width: 390,
    maxWidth: '100%',
    padding: designTokens.space.xs + 2,
    minHeight: designTokens.size.navMinHeight,
  },
  bottomNavInner: {
    width: '100%',
    minHeight: 48,
    position: 'relative',
    flexDirection: 'row',
  },
  navItem: {
    flex: 1,
    minWidth: designTokens.size.touchMin,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: designTokens.radius.heroCard,
    zIndex: 1,
  },
  selectedLens: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: designTokens.radius.heroCard,
    backgroundColor: 'rgba(255,255,255,0.68)',
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
    borderTopColor: designTokens.color.border.glassHighlight,
  },
  lensMeasure: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -8,
    right: -12,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 3,
    borderRadius: designTokens.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: designTokens.color.semantic.critical.base,
  },
  badgeText: {
    textAlign: 'center',
    includeFontPadding: false,
  },
  sectionTitle: {
    paddingVertical: designTokens.space.lg + 2,
    gap: designTokens.space.xs,
  },
});
