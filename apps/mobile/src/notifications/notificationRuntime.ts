import type * as ExpoNotifications from 'expo-notifications';

export type ExpoNotificationsModule = typeof ExpoNotifications;

export function supportsNotificationModule(
  platform: string,
  runningInExpoGo: boolean,
): boolean {
  return platform !== 'web' && !runningInExpoGo;
}

export async function loadNotificationModule<T = ExpoNotificationsModule>(
  platform: string,
  runningInExpoGo: boolean,
  loader: () => Promise<T> = (() =>
    import('expo-notifications')) as () => Promise<T>,
): Promise<T | null> {
  if (!supportsNotificationModule(platform, runningInExpoGo)) return null;
  return loader();
}
