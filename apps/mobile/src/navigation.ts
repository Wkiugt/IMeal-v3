import { createNavigationContainerRef, type NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type ProfileStackParamList = {
  ProfileHome: undefined;
  Delegation: undefined;
};

export type NotificationStackParamList = {
  NotificationList: undefined;
  NotificationDetail: { notificationId: string };
};

export type AppTabParamList = {
  EmployeeDashboard: undefined;
  EmployeeCalendar: { mealDate?: string } | undefined;
  PickupIntent: undefined;
  Notifications: NavigatorScreenParams<NotificationStackParamList> | undefined;
  EmployeeProfile: NavigatorScreenParams<ProfileStackParamList> | undefined;
  KitchenDashboard: undefined;
  KitchenScanner: undefined;
  KitchenProfile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  AppTabs: NavigatorScreenParams<AppTabParamList> | undefined;
};

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pendingNotificationId: string | null = null;

export function navigateToNotification(notificationId: string): void {
  if (!navigationRef.isReady()) {
    pendingNotificationId = notificationId;
    return;
  }
  navigationRef.navigate('AppTabs', {
    screen: 'Notifications',
    params: {
      screen: 'NotificationDetail',
      params: { notificationId },
    },
  });
}

export function flushPendingNotificationNavigation(): void {
  if (!pendingNotificationId || !navigationRef.isReady()) return;
  const notificationId = pendingNotificationId;
  pendingNotificationId = null;
  navigateToNotification(notificationId);
}

export type AuthScreenProps = NativeStackScreenProps<RootStackParamList, 'Auth'>;
export type AppTabScreenProps<RouteName extends keyof AppTabParamList> =
  BottomTabScreenProps<AppTabParamList, RouteName>;
export type ProfileStackScreenProps<
  RouteName extends keyof ProfileStackParamList,
> = NativeStackScreenProps<ProfileStackParamList, RouteName>;
