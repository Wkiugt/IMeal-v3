import type { NavigatorScreenParams } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type ProfileStackParamList = {
  ProfileHome: undefined;
  Delegation: undefined;
};

export type AppTabParamList = {
  EmployeeDashboard: undefined;
  EmployeeCalendar: undefined;
  PickupIntent: undefined;
  EmployeeProfile: NavigatorScreenParams<ProfileStackParamList> | undefined;
  KitchenDashboard: undefined;
  KitchenScanner: undefined;
  KitchenProfile: undefined;
};

export type RootStackParamList = {
  Auth: undefined;
  AppTabs: NavigatorScreenParams<AppTabParamList> | undefined;
};

export type AuthScreenProps = NativeStackScreenProps<RootStackParamList, 'Auth'>;
export type AppTabScreenProps<RouteName extends keyof AppTabParamList> =
  BottomTabScreenProps<AppTabParamList, RouteName>;
export type ProfileStackScreenProps<
  RouteName extends keyof ProfileStackParamList,
> = NativeStackScreenProps<ProfileStackParamList, RouteName>;
