import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Clock3, MapPin, QrCode, XCircle } from 'lucide-react-native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { checkInAPI, type CheckInQr } from '../../api/checkInAPI';
import { MobileApiError, getMobileErrorMessage } from '../../api/mobileApiError';
import { toBusinessDateKey } from '../../businessDate';
import { useLanguage } from '../../i18n/LanguageProvider';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { ActionButton, AppText, EmptyState, Surface } from '../../ui/components';
import { ScreenLoading, StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { designTokens } from '../../ui/designTokens';

type Props = AppTabScreenProps<'KitchenQr'>;

function timeLabel(value: string, locale: string): string {
  return new Date(value).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

function qrDateAndExpiryAreCurrent(qr: CheckInQr, now: number): boolean {
  const expiresAt = Date.parse(qr.expiresAt);
  return (
    qr.date === toBusinessDateKey(new Date(now).toISOString()) &&
    Number.isFinite(expiresAt) &&
    expiresAt > now
  );
}


export function KitchenQrScreen(_props: Props): React.JSX.Element {
  const { token } = useSession();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const [qr, setQr] = useState<CheckInQr | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const requestIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const activeRef = useRef(appActive);
  const focusedRef = useRef(isFocused);
  const qrRef = useRef<CheckInQr | null>(qr);
  const expectedLocationIdRef = useRef<string | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  activeRef.current = appActive;
  focusedRef.current = isFocused;
  qrRef.current = qr;
  const screenLoading = useScreenLoadingGate(isFocused, !loading);

  const clearQr = useCallback(() => {
    qrRef.current = null;
    setQr(null);
  }, []);
  const previousTokenRef = useRef(token);

  useEffect(() => {
    if (previousTokenRef.current === token) return;
    previousTokenRef.current = token;
    requestIdRef.current += 1;
    inFlightRef.current = false;
    expectedLocationIdRef.current = null;
    clearQr();
    setError(null);
    setLoading(Boolean(token));
  }, [clearQr, token]);


  const fetchQr = useCallback(async () => {
    if (
      !token ||
      !isFocused ||
      !activeRef.current ||
      inFlightRef.current
    ) {
      return;
    }
    const cached = qrRef.current;
    if (cached && !qrDateAndExpiryAreCurrent(cached, Date.now())) {
      clearQr();
      expectedLocationIdRef.current = null;
    }
    const requestId = ++requestIdRef.current;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await checkInAPI.getKitchenQr(token);
      if (
        requestId !== requestIdRef.current ||
        !focusedRef.current ||
        !activeRef.current ||
        tokenRef.current !== token
      ) {
        return;
      }
      const nextQr = response.data;
      const now = Date.now();
      if (!qrDateAndExpiryAreCurrent(nextQr, now)) {
        clearQr();
        expectedLocationIdRef.current = null;
        setError(
          new MobileApiError('REQUEST_FAILED', 'errors.loadKitchenQr', nextQr),
        );
        return;
      }
      if (
        expectedLocationIdRef.current &&
        expectedLocationIdRef.current !== nextQr.location.id
      ) {
        const previousLocationId = expectedLocationIdRef.current;
        expectedLocationIdRef.current = null;
        clearQr();
        setError(
          new MobileApiError('REQUEST_FAILED', 'errors.loadKitchenQr', {
            expectedLocationId: previousLocationId,
            receivedLocationId: nextQr.location.id,
          }),
        );
        return;
      }
      expectedLocationIdRef.current = nextQr.location.id;
      qrRef.current = nextQr;
      setQr(nextQr);
      setError(null);
    } catch (nextError: unknown) {
      if (
        requestId !== requestIdRef.current ||
        !focusedRef.current ||
        !activeRef.current ||
        tokenRef.current !== token
      ) {
        return;
      }
      if (
        nextError instanceof MobileApiError &&
        nextError.code === 'SESSION_INVALID'
      ) {
        expectedLocationIdRef.current = null;
        clearQr();
      } else {
        const cachedQr = qrRef.current;
        if (cachedQr && !qrDateAndExpiryAreCurrent(cachedQr, Date.now())) {
          clearQr();
          expectedLocationIdRef.current = null;
        }
      }
      setError(nextError);
    } finally {
      if (requestId === requestIdRef.current) {
        inFlightRef.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [clearQr, isFocused, token]);

  const refreshQr = useCallback(() => {
    if (
      !token ||
      !isFocused ||
      !activeRef.current ||
      inFlightRef.current
    ) {
      return;
    }
    setRefreshing(true);
    void fetchQr();
  }, [fetchQr, isFocused, token]);

  useFocusEffect(
    useCallback(() => {
      void fetchQr();
      const interval = setInterval(() => {
        if (
          focusedRef.current &&
          activeRef.current &&
          !inFlightRef.current
        ) {
          void fetchQr();
        }
      }, 10_000);
      return () => {
        clearInterval(interval);
        requestIdRef.current += 1;
        inFlightRef.current = false;
      };
    }, [fetchQr]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active';
      setAppActive(active);
      activeRef.current = active;
      if (!active) {
        requestIdRef.current += 1;
        inFlightRef.current = false;
        setRefreshing(false);
      } else if (focusedRef.current) {
        void fetchQr();
      }
    });
    return () => subscription.remove();
  }, [fetchQr]);

  useEffect(() => {
    if (!qr) return;
    const now = Date.now();
    if (!qrDateAndExpiryAreCurrent(qr, now)) {
      clearQr();
      expectedLocationIdRef.current = null;
      return;
    }
    const expiresAt = Date.parse(qr.expiresAt);
    const expiryTimer = setTimeout(() => {
      clearQr();
      setError(null);
    }, Math.max(1, expiresAt - now));
    return () => clearTimeout(expiryTimer);
  }, [clearQr, qr]);

  const now = Date.now();
  const startsAt = qr ? Date.parse(qr.activeFrom) : Number.NaN;
  const expiresAt = qr ? Date.parse(qr.expiresAt) : Number.NaN;
  const qrActive = Boolean(
    qr &&
      qrDateAndExpiryAreCurrent(qr, now) &&
      Number.isFinite(startsAt) &&
      Number.isFinite(expiresAt) &&
      now >= startsAt &&
      now < expiresAt,
  );

  if (screenLoading) return <ScreenLoading label={t('kitchenQr.loading')} />;

  return (
    <AppFrame
      animateEntrance={false}
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refreshQr}
          />
        ),
      }}
    >
      <SectionHeader title={t('kitchenQr.title')} subtitle={t('kitchenQr.subtitle')} />
      <StateTransition stateKey={error && !qr ? 'error' : qr ? 'ready' : 'empty'}>
        {error && !qr ? (
          <EmptyState
            icon={XCircle}
            title={t('kitchenQr.unavailable')}
            description={getMobileErrorMessage(error, t, 'errors.loadKitchenQr')}
            action={{ label: t('common.retry'), onPress: refreshQr }}
          />
        ) : qr ? (
          <Surface style={styles.card}>
            <View style={styles.locationRow}>
              <MapPin size={18} color={designTokens.color.brand.primary} />
              <View style={styles.locationCopy}>
                <AppText variant="cardTitle">{qr.location.displayName}</AppText>
                <AppText variant="supporting" tone="secondary">
                  {qr.location.servingPointName} · {qr.location.address}
                </AppText>
              </View>
            </View>
            <View
              accessible
              accessibilityLabel={`${t('kitchenQr.title')}, ${qr.location.displayName}`}
              style={styles.qrFrame}
            >
              {qrActive ? (
                <QRCode
                  value={qr.qr}
                  size={Math.min(designTokens.size.qr + 40, 240)}
                  color={designTokens.color.text.strong}
                  backgroundColor={designTokens.color.surface.standard}
                />
              ) : (
                <View style={styles.inactiveQr}>
                  <QrCode size={32} color={designTokens.color.semantic.neutral.base} />
                  <AppText variant="supporting" tone="secondary">
                    {t('kitchenQr.loading')}
                  </AppText>
                </View>
              )}
            </View>
            <View style={styles.windowRow}>
              <Clock3 size={17} color={designTokens.color.text.secondary} />
              <AppText variant="supporting" tone="secondary">
                {t('kitchenQr.window', {
                  from: timeLabel(qr.activeFrom, locale),
                  to: timeLabel(qr.expiresAt, locale),
                })}
              </AppText>
            </View>
            {error ? (
              <AppText variant="supporting" tone="warning">
                {getMobileErrorMessage(error, t, 'errors.loadKitchenQr')}
              </AppText>
            ) : null}
            <ActionButton
              variant="secondary"
              size="md"
              label={t('kitchenQr.refresh')}
              loading={loading}
              onPress={refreshQr}
            />
          </Surface>
        ) : (
          <EmptyState
            icon={QrCode}
            title={t('kitchenQr.unavailable')}
            description={t('kitchenQr.loading')}
            action={{ label: t('common.retry'), onPress: refreshQr }}
          />
        )}
      </StateTransition>
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: designTokens.space.lg },
  locationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: designTokens.space.sm },
  locationCopy: { flex: 1, gap: designTokens.space.xs },
  qrFrame: {
    alignSelf: 'center',
    minWidth: designTokens.size.qrFrame,
    minHeight: designTokens.size.qrFrame,
    alignItems: 'center',
    justifyContent: 'center',
    padding: designTokens.space.md,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface.standard,
  },
  inactiveQr: { alignItems: 'center', justifyContent: 'center', gap: designTokens.space.sm },
  windowRow: { flexDirection: 'row', alignItems: 'center', gap: designTokens.space.sm },
});
