import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { AppState, Linking, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { isRunningInExpoGo } from 'expo';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { v1 } from '@imeal/contracts';
import { useLanguage } from '../i18n/LanguageProvider';
import { useSession } from '../auth/session';
import { notificationAPI } from '../api/notificationAPI';
import { navigateToNotification } from '../navigation';
import { designTokens, getElevationStyle } from '../ui/designTokens';
import { ActionButton } from '../ui/components';
import {
  loadNotificationModule,
  supportsNotificationModule,
} from './notificationRuntime';

const EXPLAINER_KEY = 'imeal.notification-explainer-seen.v1';
const FOREGROUND_NOTIFICATION_BEHAVIOR = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: true,
};

type PermissionStatus = 'undetermined' | 'granted' | 'denied' | 'simulator' | 'unavailable';

type NotificationContextValue = {
  unreadCount: number;
  permissionStatus: PermissionStatus;
  expoPushToken: string | null;
  isPhysicalDevice: boolean;
  configurationError: string | null;
  lastNotificationId: string | null;
  refreshUnread: () => Promise<void>;
  revokeCurrentDevice: () => Promise<void>;
  enableNotifications: () => Promise<void>;
  openSettings: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function projectId(): string | undefined {
  const configured = Constants.expoConfig?.extra?.eas?.projectId;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const environment = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  return environment || undefined;
}

async function readExplainerSeen(): Promise<boolean> {
  try {
    const value = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(EXPLAINER_KEY)
      : await SecureStore.getItemAsync(EXPLAINER_KEY);
    return value === '1';
  } catch {
    return false;
  }
}

async function writeExplainerSeen(): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(EXPLAINER_KEY, '1');
    return;
  }
  await SecureStore.setItemAsync(EXPLAINER_KEY, '1');
}

const NotificationResponseSchema = z.object({
  notification: z.object({
    request: z.object({
      content: z.object({ data: z.unknown() }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

const NotificationResponseDataSchema = z.object({
  notificationId: v1.NotificationIdSchema,
  url: z.string(),
}).strict();

function responseNotificationId(response: unknown): string | null {
  const envelope = NotificationResponseSchema.safeParse(response);
  if (!envelope.success) return null;
  const payload = NotificationResponseDataSchema.safeParse(
    envelope.data.notification.request.content.data,
  );
  if (!payload.success) return null;
  const expectedUrl = `imeal://notifications/${payload.data.notificationId}`;
  return payload.data.url === expectedUrl ? payload.data.notificationId : null;
}

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const { token } = useSession();
  const native = Platform.OS !== 'web';
  const runningInExpoGo = isRunningInExpoGo();
  const notificationsAvailable = supportsNotificationModule(
    Platform.OS,
    runningInExpoGo,
  );
  const physicalDevice = native && Device.isDevice;
  const easProjectId = projectId();
  const [unreadCount, setUnreadCount] = useState(0);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>(
    notificationsAvailable && native ? 'undetermined' : 'unavailable',
  );
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const [lastNotificationId, setLastNotificationId] = useState<string | null>(null);
  const [explainerVisible, setExplainerVisible] = useState(false);
  const registeredTokenRef = useRef<string | null>(null);
  const previousAuthTokenRef = useRef<string | null>(null);
  const currentAuthTokenRef = useRef<string | null>(token);
  const registrationInFlightRef = useRef(false);
  const registrationRetryRef = useRef(false);
  const [registrationKick, setRegistrationKick] = useState(0);
  const lastResponseRef = useRef<{ id: string; at: number } | null>(null);
  const pendingResponseIdRef = useRef<string | null>(null);
  currentAuthTokenRef.current = token;

  const refreshUnread = useCallback(async () => {
    if (!token) {
      setUnreadCount(0);
      return;
    }
    try {
      const response = await notificationAPI.getList(token, { limit: 1 });
      setUnreadCount(response.meta.unreadCount);
    } catch {
      // Inbox remains usable when a background badge refresh fails.
    }
  }, [token]);

  const openSettings = useCallback(async () => {
    try {
      await Linking.openSettings();
    } catch {
      // Some web and simulator environments do not expose an OS settings target.
    }
  }, []);

  const refreshPermissionStatus = useCallback(async (): Promise<PermissionStatus> => {
    if (!notificationsAvailable) {
      setPermissionStatus('unavailable');
      return 'unavailable';
    }
    if (!physicalDevice) {
      setPermissionStatus('simulator');
      return 'simulator';
    }
    try {
      const Notifications = await loadNotificationModule(
        Platform.OS,
        runningInExpoGo,
      );
      if (!Notifications) {
        setPermissionStatus('unavailable');
        return 'unavailable';
      }
      const permissions = await Notifications.getPermissionsAsync();
      const nextStatus = permissions.status === 'granted' ? 'granted' : permissions.status === 'denied' ? 'denied' : 'undetermined';
      setPermissionStatus(nextStatus);
      return nextStatus;
    } catch {
      setPermissionStatus('undetermined');
      return 'undetermined';
    }
  }, [notificationsAvailable, physicalDevice, runningInExpoGo]);

  const revokeRegisteredToken = useCallback(async (accessToken: string, pushToken: string) => {
    try {
      await notificationAPI.revokePushDevice(pushToken, accessToken);
    } catch {
      // Revocation is best effort during logout; the server can expire stale devices.
    } finally {
      if (registeredTokenRef.current === pushToken) registeredTokenRef.current = null;
    }
  }, []);

  const revokeCurrentDevice = useCallback(async () => {
    const accessToken = token;
    const pushToken = registeredTokenRef.current;
    if (!accessToken || !pushToken) return;
    await revokeRegisteredToken(accessToken, pushToken);
    setExpoPushToken(null);
  }, [revokeRegisteredToken, token]);

  const registerCurrentDevice = useCallback(async (permissionOverride?: PermissionStatus) => {
    const accessToken = token;
    const effectivePermissionStatus = permissionOverride ?? permissionStatus;
    if (!accessToken || !notificationsAvailable || !physicalDevice || effectivePermissionStatus !== 'granted') return;
    if (registrationInFlightRef.current) {
      registrationRetryRef.current = true;
      return;
    }
    if (!easProjectId) {
      setConfigurationError(t('notifications.projectConfigurationError'));
      return;
    }
    registrationInFlightRef.current = true;
    try {
      const Notifications = await loadNotificationModule(
        Platform.OS,
        runningInExpoGo,
      );
      if (!Notifications) return;
      const response = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId });
      const nextToken = response.data;
      const parsed = v1.ExpoPushTokenSchema.safeParse(nextToken);
      if (!parsed.success) {
        setConfigurationError(t('notifications.tokenConfigurationError'));
        return;
      }
      const previousToken = registeredTokenRef.current;
      if (previousToken && previousToken !== parsed.data) {
        await revokeRegisteredToken(accessToken, previousToken);
      }
      await notificationAPI.registerPushDevice({
        token: parsed.data,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      }, accessToken);
      if (currentAuthTokenRef.current !== accessToken) {
        await notificationAPI.revokePushDevice(parsed.data, accessToken).catch(() => undefined);
        return;
      }
      registeredTokenRef.current = parsed.data;
      setExpoPushToken(parsed.data);
      setConfigurationError(null);
    } catch {
      setConfigurationError(t('notifications.registrationError'));
    } finally {
      registrationInFlightRef.current = false;
      if (registrationRetryRef.current) {
        registrationRetryRef.current = false;
        setRegistrationKick((current) => current + 1);
      }
    }
  }, [easProjectId, notificationsAvailable, permissionStatus, physicalDevice, revokeRegisteredToken, runningInExpoGo, t, token]);

  const enableNotifications = useCallback(async () => {
    await writeExplainerSeen().catch(() => undefined);
    setExplainerVisible(false);
    if (!notificationsAvailable || !physicalDevice) {
      setPermissionStatus(notificationsAvailable ? 'simulator' : 'unavailable');
      return;
    }
    if (permissionStatus === 'denied') {
      await openSettings();
      return;
    }
    try {
      const Notifications = await loadNotificationModule(
        Platform.OS,
        runningInExpoGo,
      );
      if (!Notifications) {
        setPermissionStatus('unavailable');
        return;
      }
      const permissions = await Notifications.requestPermissionsAsync();

      const nextStatus = permissions.status === 'granted' ? 'granted' : permissions.status === 'denied' ? 'denied' : 'undetermined';
      setPermissionStatus(nextStatus);
      if (nextStatus === 'granted') await registerCurrentDevice(nextStatus);
    } catch {
      setPermissionStatus('denied');
    }
  }, [notificationsAvailable, openSettings, permissionStatus, physicalDevice, registerCurrentDevice, runningInExpoGo]);

  useEffect(() => {
    if (!notificationsAvailable) return;
    void loadNotificationModule(Platform.OS, runningInExpoGo)
      .then((Notifications) => {
        if (!Notifications) return;
        Notifications.setNotificationHandler({
          handleNotification: async () => FOREGROUND_NOTIFICATION_BEHAVIOR,
        });
      })
      .catch(() => undefined);
  }, [notificationsAvailable, runningInExpoGo]);
  useEffect(() => {
    if (!notificationsAvailable || Platform.OS !== 'android') return;
    void loadNotificationModule(Platform.OS, runningInExpoGo)
      .then((Notifications) => {
        if (!Notifications) return;
        return Notifications.setNotificationChannelAsync('imeal-default', {
          name: 'IMeal',
          importance: Notifications.AndroidImportance.HIGH,
          sound: 'default',
        });
      })
      .catch(() => undefined);
  }, [notificationsAvailable, runningInExpoGo]);


  useEffect(() => {
    if (!token) {
      setUnreadCount(0);
      setExpoPushToken(null);
      const accessToken = previousAuthTokenRef.current;
      const pushToken = registeredTokenRef.current;
      if (accessToken && pushToken) void revokeRegisteredToken(accessToken, pushToken);
      previousAuthTokenRef.current = null;
      return;
    }
    previousAuthTokenRef.current = token;
    void refreshUnread();
    const pendingResponseId = pendingResponseIdRef.current;
    if (pendingResponseId) {
      pendingResponseIdRef.current = null;
      navigateToNotification(pendingResponseId);
    }
  }, [refreshUnread, revokeRegisteredToken, token]);

  useEffect(() => {
    if (token) void refreshPermissionStatus();
  }, [refreshPermissionStatus, token]);
  useEffect(() => {
    if (!token || !notificationsAvailable) return;
    let mounted = true;
    void readExplainerSeen().then((seen) => {
      if (mounted && !seen) setExplainerVisible(true);
    });
    return () => {
      mounted = false;
    };
  }, [notificationsAvailable, token]);

  useEffect(() => {
    void registerCurrentDevice();
  }, [registerCurrentDevice, registrationKick]);

  useEffect(() => {
    if (!notificationsAvailable) return;
    let mounted = true;
    let receivedSubscription: { remove: () => void } | null = null;
    let responseSubscription: { remove: () => void } | null = null;
    const handleResponse = (response: unknown) => {
      const notificationId = responseNotificationId(response);
      const previousResponse = lastResponseRef.current;
      const duplicate = previousResponse
        && previousResponse.id === notificationId
        && Date.now() - previousResponse.at < 1_000;
      if (!notificationId || duplicate) return;
      lastResponseRef.current = { id: notificationId, at: Date.now() };
      setLastNotificationId(notificationId);
      if (token) navigateToNotification(notificationId);
      else pendingResponseIdRef.current = notificationId;
      void refreshUnread();
    };
    void loadNotificationModule(Platform.OS, runningInExpoGo)
      .then((Notifications) => {
        if (!mounted || !Notifications) return;
        receivedSubscription = Notifications.addNotificationReceivedListener(() => {
          void refreshUnread();
        });
        responseSubscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
        return Notifications.getLastNotificationResponseAsync().then((lastResponse) => {
          if (mounted && lastResponse) handleResponse(lastResponse);
        });
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      receivedSubscription?.remove();
      responseSubscription?.remove();
    };
  }, [notificationsAvailable, refreshUnread, runningInExpoGo, token]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        void (async () => {
          const status = await refreshPermissionStatus();
          await refreshUnread();
          await registerCurrentDevice(status);
        })();
      }
    });
    return () => subscription.remove();
  }, [refreshPermissionStatus, refreshUnread, registerCurrentDevice]);

  const value = useMemo<NotificationContextValue>(() => ({
    unreadCount,
    permissionStatus: physicalDevice ? permissionStatus : native ? 'simulator' : 'unavailable',
    expoPushToken,
    isPhysicalDevice: physicalDevice,
    configurationError,
    lastNotificationId,
    refreshUnread,
    revokeCurrentDevice,
    enableNotifications,
    openSettings,
  }), [configurationError, enableNotifications, expoPushToken, lastNotificationId, native, openSettings, permissionStatus, physicalDevice, refreshUnread, revokeCurrentDevice, unreadCount]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <Modal visible={explainerVisible} transparent animationType="fade" onRequestClose={() => { void writeExplainerSeen().catch(() => undefined); setExplainerVisible(false); }}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.heading}>{t('notifications.explainerTitle')}</Text>
            <Text style={styles.copy}>{t('notifications.explainerBody')}</Text>
            {!physicalDevice && <Text style={styles.warning}>{t('notifications.physicalDeviceRequired')}</Text>}
            <ActionButton
              variant="primary"
              size="lg"
              label={t('notifications.enable')}
              onPress={() => void enableNotifications()}
              style={styles.primaryButton}
            />
            <ActionButton
              variant="ghost"
              size="md"
              label={t('notifications.notNow')}
              onPress={() => { void writeExplainerSeen().catch(() => undefined); setExplainerVisible(false); }}
              style={styles.secondaryButton}
            />
          </View>
        </View>
      </Modal>
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used inside NotificationProvider');
  return context;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, padding: designTokens.space['2xl'], justifyContent: 'center', backgroundColor: 'rgba(17, 30, 24, 0.45)' },
  dialog: { padding: designTokens.space['2xl'], borderRadius: designTokens.radius.floating, backgroundColor: designTokens.color.surface.standard, gap: 14, ...getElevationStyle(2) },
  heading: { color: designTokens.color.text.strong, fontSize: 20, fontFamily: designTokens.typography.family.bold },
  copy: { color: designTokens.color.text.secondary, fontSize: 14, fontFamily: designTokens.typography.family.regular, lineHeight: 21 },
  warning: { color: designTokens.color.semantic.warning.base, fontSize: 13, fontFamily: designTokens.typography.family.semiBold },
  primaryButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: designTokens.radius.heroCard, backgroundColor: designTokens.color.brand.primary },
  secondaryButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
});
