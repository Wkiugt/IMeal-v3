import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Crypto from 'expo-crypto';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import {
  CheckCircle2,
  Clock3,
  Flashlight,
  MapPin,
  ScanLine,
  Utensils,
  XCircle,
  type LucideIcon,
} from 'lucide-react-native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import {
  checkInAPI,
  type CheckInStatus,
  type ConfirmCheckInInput,
  type ResolveCheckInData,
} from '../../api/checkInAPI';
import {
  MobileApiError,
  getMobileErrorMessage,
  mobileErrorMessageKey,
  type MobileApiErrorCode,
} from '../../api/mobileApiError';
import {
  isLocationCaptureCancelled,
  locationAPI,
  type LocationCapture,
} from '../../api/locationAPI';
import { formatBusinessInstant, formatShortDate, parseDateKey } from '../../businessDate';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { Translate, TranslationKey } from '../../i18n/translations';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import {
  ActionButton,
  AppText,
  EmptyState,
  StatusBadge,
  Surface,
} from '../../ui/components';
import { ScreenLoading, StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { designTokens } from '../../ui/designTokens';
import { useNotice } from '../../ui/BrandNotice';
import {
  canStartCheckInConfirm,
  canStartCheckInScan,
  createCheckInAttempt,
  isCheckInSessionExpired,
  needsFreshCheckInGps,
} from '../checkInRules';

type Props = AppTabScreenProps<'SelfCheckIn'>;

type FlowError = {
  error: unknown;
  retry?: () => void;
  messageKey?: TranslationKey;
};

function isAmbiguousConfirmFailure(
  code: MobileApiErrorCode | null,
): boolean {
  return (
    code === null ||
    code === 'API_TIMEOUT' ||
    code === 'REQUEST_FAILED' ||
    code === 'INVALID_RESPONSE' ||
    code === 'INTERNAL_SERVER_ERROR'
  );
}
function statusTitle(status: CheckInStatus | null, t: Translate): string {
  if (!status) return t('checkIn.statusUnavailable');
  switch (status.state) {
    case 'CHECKED_IN':
      return t('checkIn.alreadyCheckedIn');
    case 'CANCELLED':
      return t('checkIn.cancelled');
    case 'NO_SHOW':
      return t('checkIn.noShow');
    case 'OUTSIDE_WINDOW':
      return t('checkIn.outsideWindow');
    case 'UNREGISTERED':
      return t('checkIn.noRegistration');
    default:
      return t('checkIn.title');
  }
}

function formatWindowTime(value: string, locale: string): string {
  return new Date(value).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Ho_Chi_Minh',
  });
}

export function SelfCheckInScreen(_props: Props): React.JSX.Element {
  const { token } = useSession();
  const { locale, t } = useLanguage();
  const { showNotice } = useNotice();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<CheckInStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<unknown>(null);
  const [cameraError, setCameraError] = useState<unknown>(null);
  const [resolved, setResolved] = useState<ResolveCheckInData | null>(null);
  const [scanned, setScanned] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [scanError, setScanError] = useState<FlowError | null>(null);
  const [confirmError, setConfirmError] = useState<FlowError | null>(null);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const operationGeneration = useRef(0);
  const focusedRef = useRef(isFocused);
  const appActiveRef = useRef(AppState.currentState === 'active');
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const resolvingRef = useRef(false);
  const confirmingRef = useRef(false);
  const locationCaptureRef = useRef<LocationCapture | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const confirmInputRef = useRef<ConfirmCheckInInput | null>(null);
  const confirmCheckInRef = useRef<() => void>(() => undefined);
  const statusRequestRef = useRef(0);
  const { width } = useWindowDimensions();
  const screenLoading = useScreenLoadingGate(isFocused, !statusLoading && permission !== null);

  const isActive = useCallback(
    (generation: number) =>
      Boolean(token) &&
      tokenRef.current === token &&
      focusedRef.current &&
      appActiveRef.current &&
      operationGeneration.current === generation,
    [token],
  );

  const stopLocationCapture = useCallback(() => {
    locationCaptureRef.current?.stop();
    locationCaptureRef.current = null;
  }, []);

  const captureFreshLocation = useCallback(async () => {
    stopLocationCapture();
    const capture = locationAPI.startForegroundLocationCapture();
    locationCaptureRef.current = capture;
    try {
      return await capture.promise;
    } finally {
      if (locationCaptureRef.current === capture) locationCaptureRef.current = null;
    }
  }, [stopLocationCapture]);
  const requestCameraAccess = useCallback(async () => {
    setCameraError(null);
    try {
      const nextPermission = await requestPermission();
      if (!nextPermission.granted) {
        setCameraError(
          new MobileApiError('REQUEST_FAILED', 'errors.requestFailed'),
        );
      }
    } catch (error: unknown) {
      setCameraError(error);
    }
  }, [requestPermission]);


  const loadStatus = useCallback(async () => {
    if (!token || !focusedRef.current || !appActiveRef.current) return;
    const requestId = ++statusRequestRef.current;
    setStatusLoading(true);
    setStatus(null);
    setStatusError(null);
    try {
      const nextStatus = await checkInAPI.getStatus(token);
      if (
        requestId !== statusRequestRef.current ||
        !focusedRef.current ||
        !appActiveRef.current ||
        tokenRef.current !== token
      ) {
        return;
      }
      setStatus(nextStatus.data);
    } catch (error: unknown) {
      if (
        requestId !== statusRequestRef.current ||
        !focusedRef.current ||
        !appActiveRef.current ||
        tokenRef.current !== token
      ) {
        return;
      }
      setStatus(null);
      setStatusError(error);
    } finally {
      if (requestId === statusRequestRef.current) setStatusLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      void loadStatus();
      return () => {
        focusedRef.current = false;
        operationGeneration.current += 1;
        statusRequestRef.current += 1;
        resolvingRef.current = false;
        confirmingRef.current = false;
        stopLocationCapture();
        setResolved(null);
        setScanned(false);
        setResolving(false);
        setConfirming(false);
        setScanError(null);
        setConfirmError(null);
        setCameraError(null);
        idempotencyKeyRef.current = null;
        confirmInputRef.current = null;
      };
    }, [loadStatus, stopLocationCapture]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const active = nextState === 'active';
      appActiveRef.current = active;
      if (!active) {
        operationGeneration.current += 1;
        statusRequestRef.current += 1;
        resolvingRef.current = false;
        confirmingRef.current = false;
        stopLocationCapture();
        setResolved(null);
        setScanned(false);
        setResolving(false);
        setConfirming(false);
        setScanError(null);
        setConfirmError(null);
        setCameraError(null);
        setStatus(null);
        setStatusLoading(true);
        idempotencyKeyRef.current = null;
        confirmInputRef.current = null;
      } else if (focusedRef.current) {
        void loadStatus();
      }
    });
    return () => subscription.remove();
  }, [loadStatus, stopLocationCapture]);

  useEffect(() => {
    if (!resolved) {
      setSecondsLeft(0);
      return;
    }
    const update = () => {
      setSecondsLeft(
        Math.max(0, Math.ceil((Date.parse(resolved.expiresAt) - Date.now()) / 1000)),
      );
    };
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [resolved]);

  const resetFlow = useCallback(() => {
    operationGeneration.current += 1;
    resolvingRef.current = false;
    confirmingRef.current = false;
    stopLocationCapture();
    idempotencyKeyRef.current = null;
    confirmInputRef.current = null;
    setResolved(null);
    setScanned(false);
    setResolving(false);
    setConfirming(false);
    setScanError(null);
    setConfirmError(null);
  }, [stopLocationCapture]);

  const resolveQr = useCallback(
    async (qr: string) => {
      if (
        !token ||
        !qr.trim() ||
        !canStartCheckInScan(focusedRef.current && appActiveRef.current, resolvingRef.current, Boolean(resolved))
      ) {
        return;
      }
      const generation = ++operationGeneration.current;
      resolvingRef.current = true;
      setResolving(true);
      setScanError(null);
      setConfirmError(null);
      try {
        const gps = await captureFreshLocation();
        if (!isActive(generation)) return;
        const response = await checkInAPI.resolve(token, { qr: qr.trim(), gps });
        if (!isActive(generation)) return;
        const registrationReason = response.data.eligibility.reasons.find(
          (reason) =>
            reason === 'ALREADY_CHECKED_IN' ||
            reason === 'NO_REGISTRATION' ||
            reason === 'REGISTRATION_CANCELLED',
        );
        if (!response.data.eligibility.eligible && registrationReason) {
          const reasonError = new MobileApiError(
            registrationReason,
            mobileErrorMessageKey(registrationReason),
          );
          setResolved(null);
          setScanned(false);
          setScanError({
            error: reasonError,
            retry: () => {
              setScanned(false);
              setScanError(null);
            },
          });
          try {
            const authoritative = await checkInAPI.getStatus(token);
            if (!isActive(generation)) return;
            setStatus(authoritative.data);
            setStatusError(null);
            if (
              authoritative.data.state === 'CHECKED_IN' ||
              authoritative.data.state === 'CANCELLED' ||
              authoritative.data.state === 'UNREGISTERED'
            ) {
              setScanError(null);
            }
          } catch (statusLoadError: unknown) {
            if (!isActive(generation)) return;
            if (
              statusLoadError instanceof MobileApiError &&
              statusLoadError.code === 'SESSION_INVALID'
            ) {
              resetFlow();
              setStatus(null);
              setStatusError(statusLoadError);
            }
          }
          return;
        }
        setResolved(response.data);
        if (!response.data.eligibility.eligible) {
          const reason = response.data.eligibility.reasons[0] ?? 'INVALID_QR';
          setScanError({
            error: new MobileApiError(reason, mobileErrorMessageKey(reason)),
          });
        }
      } catch (error: unknown) {
        if (!isActive(generation) || isLocationCaptureCancelled(error)) return;
        if (
          error instanceof MobileApiError &&
          error.code === 'SESSION_INVALID'
        ) {
          resetFlow();
          setStatus(null);
          setStatusError(error);
          return;
        }
        setScanError({
          error,
          retry: () => {
            setScanned(false);
            setScanError(null);
          },
        });
        setScanned(false);
      } finally {
        if (isActive(generation)) {
          resolvingRef.current = false;
          setResolving(false);
        }
      }
    },
    [captureFreshLocation, isActive, resetFlow, resolved, token],
  );

  const handleBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (
        !canStartCheckInScan(
          focusedRef.current && appActiveRef.current,
          resolvingRef.current,
          Boolean(resolved),
        )
      ) {
        return;
      }
      setScanned(true);
      void resolveQr(data);
    },
    [resolveQr, resolved],
  );

  const reconcileAuthoritativeStatus = useCallback(
    async (generation: number) => {
      if (!token || operationGeneration.current !== generation) return null;
      const requestId = ++statusRequestRef.current;
      try {
        const response = await checkInAPI.getStatus(token);
        if (
          requestId === statusRequestRef.current &&
          operationGeneration.current === generation &&
          focusedRef.current &&
          appActiveRef.current &&
          tokenRef.current === token
        ) {
          setStatus(response.data);
        }
        return response.data;
      } catch (error: unknown) {
        if (error instanceof MobileApiError && error.code === 'SESSION_INVALID') throw error;
        return null;
      }
    },
    [token],
  );

  const confirmCheckIn = useCallback(async () => {
    const currentResolved = resolved;
    if (
      !token ||
      !currentResolved?.eligibility.eligible ||
      !currentResolved.intentNonce ||
      !canStartCheckInConfirm(
        focusedRef.current && appActiveRef.current,
        confirmingRef.current,
        isCheckInSessionExpired(currentResolved.expiresAt),
      )
    ) {
      return;
    }
    const intentNonce = currentResolved.intentNonce;
    const generation = ++operationGeneration.current;
    confirmingRef.current = true;
    setConfirming(true);
    setConfirmError(null);
    try {
      const attempt = createCheckInAttempt(
        currentResolved.sessionId,
        idempotencyKeyRef.current,
        Crypto.randomUUID,
      );
      idempotencyKeyRef.current = attempt.idempotencyKey;
      let input = confirmInputRef.current;
      if (
        !input ||
        input.sessionId !== attempt.sessionId ||
        input.idempotencyKey !== attempt.idempotencyKey ||
        input.intentNonce !== intentNonce
      ) {
        const gps = await captureFreshLocation();
        if (!isActive(generation)) return;
        input = { ...attempt, intentNonce, gps };
        confirmInputRef.current = input;
      }
      const response = await checkInAPI.confirm(token, input);
      if (!isActive(generation)) return;
      const authoritative = await reconcileAuthoritativeStatus(generation);
      if (!isActive(generation)) return;
      setResolved(null);
      setScanned(false);
      setConfirmError(null);
      setStatusError(null);
      setStatus(authoritative);
      if (!authoritative) setStatus(null);
      idempotencyKeyRef.current = null;
      confirmInputRef.current = null;
      showNotice({
        title: t('checkIn.checkedIn'),
        message: t('checkIn.checkedInAt', {
          time: formatBusinessInstant(response.data.servedAt, locale),
        }),
        tone: 'success',
      });
    } catch (error: unknown) {
      if (!isActive(generation) || isLocationCaptureCancelled(error)) return;
      const code = error instanceof MobileApiError ? error.code : null;
      const markAuthoritativeCheckedIn = (
        authoritative: CheckInStatus,
        titleKey: 'checkIn.checkedIn' | 'checkIn.alreadyCheckedIn',
      ) => {
        setResolved(null);
        setScanned(false);
        setConfirmError(null);
        setStatus(authoritative);
        setStatusError(null);
        idempotencyKeyRef.current = null;
        confirmInputRef.current = null;
        showNotice({
          title: t(titleKey),
          message: authoritative.registration?.servedAt
            ? t('checkIn.checkedInAt', {
                time: formatBusinessInstant(authoritative.registration.servedAt, locale),
              })
            : t(titleKey),
          tone: 'success',
        });
      };
      if (code === 'SESSION_INVALID') {
        resetFlow();
        setStatus(null);
        setStatusError(error);
        return;
      }
      if (isAmbiguousConfirmFailure(code)) {
        const uncertainError = new MobileApiError(
          'REQUEST_FAILED',
          'checkIn.confirmOutcomeUnknown',
          error,
        );
        const retryAfterReconcile = async () => {
          const retryGeneration = ++operationGeneration.current;
          let authoritative: CheckInStatus | null;
          try {
            authoritative = await reconcileAuthoritativeStatus(retryGeneration);
          } catch (reconcileError: unknown) {
            if (!isActive(retryGeneration)) return;
            if (
              reconcileError instanceof MobileApiError &&
              reconcileError.code === 'SESSION_INVALID'
            ) {
              resetFlow();
              setStatus(null);
              setStatusError(reconcileError);
            } else {
              setConfirmError({
                error: uncertainError,
                retry: () => void retryAfterReconcile(),
              });
            }
            return;
          }
          if (!isActive(retryGeneration)) return;
          if (authoritative?.state === 'CHECKED_IN') {
            markAuthoritativeCheckedIn(authoritative, 'checkIn.checkedIn');
            return;
          }
          if (isCheckInSessionExpired(currentResolved.expiresAt)) {
            setConfirmError({
              error: uncertainError,
              retry: () => void retryAfterReconcile(),
            });
            return;
          }
          setConfirmError(null);
          confirmCheckInRef.current();
        };
        let authoritative: CheckInStatus | null;
        try {
          authoritative = await reconcileAuthoritativeStatus(generation);
        } catch (reconcileError: unknown) {
          if (!isActive(generation)) return;
          if (
            reconcileError instanceof MobileApiError &&
            reconcileError.code === 'SESSION_INVALID'
          ) {
            resetFlow();
            setStatus(null);
            setStatusError(reconcileError);
          } else {
            setConfirmError({
              error: uncertainError,
              retry: () => void retryAfterReconcile(),
            });
          }
          return;
        }
        if (!isActive(generation)) return;
        if (authoritative?.state === 'CHECKED_IN') {
          markAuthoritativeCheckedIn(authoritative, 'checkIn.checkedIn');
        } else {
          setConfirmError({
            error: uncertainError,
            retry: () => void retryAfterReconcile(),
          });
        }
        return;
      }
      if (code === 'ALREADY_CHECKED_IN') {
        let authoritative: CheckInStatus | null;
        try {
          authoritative = await reconcileAuthoritativeStatus(generation);
        } catch (reconcileError: unknown) {
          if (
            reconcileError instanceof MobileApiError &&
            reconcileError.code === 'SESSION_INVALID'
          ) {
            resetFlow();
            setStatus(null);
            setStatusError(reconcileError);
          } else {
            setConfirmError({
              error: reconcileError,
              retry: () => void confirmCheckIn(),
            });
          }
          return;
        }
        if (!isActive(generation)) return;
        if (authoritative?.state === 'CHECKED_IN') {
          markAuthoritativeCheckedIn(authoritative, 'checkIn.alreadyCheckedIn');
          return;
        }
      }
      if (
        code === 'INACTIVE_CHECKIN_SESSION' ||
        code === 'IDEMPOTENCY_CONFLICT' ||
        code === 'INVALID_QR' ||
        code === 'NO_REGISTRATION' ||
        code === 'REGISTRATION_CANCELLED' ||
        code === 'OUTSIDE_CHECKIN_WINDOW'
      ) {
        confirmInputRef.current = null;
        setConfirmError({ error, retry: resetFlow });
      } else if (code && needsFreshCheckInGps(code)) {
        confirmInputRef.current = null;
        setConfirmError({ error, retry: () => void confirmCheckIn() });
      } else {
        setConfirmError({ error, retry: () => void confirmCheckIn() });
      }
    } finally {
      if (isActive(generation)) {
        confirmingRef.current = false;
        setConfirming(false);
      }
    }
  }, [captureFreshLocation, isActive, locale, reconcileAuthoritativeStatus, resetFlow, resolved, showNotice, t, token]);

  confirmCheckInRef.current = () => {
    void confirmCheckIn();
  };
  const expired = Boolean(resolved && isCheckInSessionExpired(resolved.expiresAt));
  const cameraReady =
    permission?.granted === true &&
    isFocused &&
    appActiveRef.current &&
    cameraError === null;
  const statusCanScan = status?.state === 'ACTIVE' && status.canResolve;
  const screenWidth = Math.min(width - designTokens.space.xl * 2, 420);
  const statusMessage = statusTitle(status, t);

  if (screenLoading) {
    return <ScreenLoading label={t('checkIn.preparingCamera')} />;
  }

  if (permission?.granted !== true && (!status || status.state === 'ACTIVE')) {
    return (
      <AppFrame animateEntrance={false}>
        <SectionHeader title={t('checkIn.title')} subtitle={t('checkIn.subtitle')} />
        <EmptyState
          icon={ScanLine}
          title={t('checkIn.cameraRequired')}
          description={
            cameraError
              ? getMobileErrorMessage(cameraError, t, 'errors.requestFailed')
              : t('checkIn.cameraHint')
          }
          action={
            permission?.canAskAgain === false
              ? undefined
              : {
                  label: t('checkIn.grantCamera'),
                  onPress: () => void requestCameraAccess(),
                }
          }
        />
      </AppFrame>
    );
  }

  if (statusError && !status) {
    return (
      <AppFrame animateEntrance={false}>
        <SectionHeader title={t('checkIn.title')} subtitle={t('checkIn.subtitle')} />
        <EmptyState
          icon={XCircle}
          title={t('checkIn.statusUnavailable')}
          description={getMobileErrorMessage(statusError, t, 'errors.loadCheckIn')}
          action={{ label: t('common.retry'), onPress: () => void loadStatus() }}
        />
      </AppFrame>
    );
  }

  return (
    <AppFrame animateEntrance={false}>
      <SectionHeader title={t('checkIn.title')} subtitle={t('checkIn.subtitle')} />
      <StateTransition stateKey={resolved ? 'review' : statusCanScan ? 'scan' : status?.state ?? 'loading'}>
        {resolved ? (
          <View style={styles.content}>
            <Surface style={styles.reviewCard}>
              <View style={styles.reviewHeader}>
                <View style={styles.reviewHeaderCopy}>
                  <AppText variant="sectionTitle">{t('checkIn.reviewTitle')}</AppText>
                  <AppText variant="supporting" tone="secondary">
                    {resolved.employee.name}
                  </AppText>
                </View>
                <Clock3 size={22} color={expired ? designTokens.color.semantic.critical.base : designTokens.color.brand.primary} />
              </View>
              <View style={styles.detailList}>
                <DetailRow icon={Clock3} label={t('checkIn.mealDate')} value={formatShortDate(parseDateKey(resolved.date), locale)} />
                <DetailRow icon={Utensils} label={t('checkIn.menu')} value={resolved.menu.name} />
                <DetailRow icon={MapPin} label={t('checkIn.location')} value={resolved.location.displayName} />
                <DetailRow icon={ScanLine} label={t('checkIn.employeeCode')} value={resolved.employee.employeeCode} />
                <DetailRow
                  icon={CheckCircle2}
                  label={t('checkIn.mealChoice')}
                  value={t(resolved.registration.mealChoice === 'VEGETARIAN' ? 'kitchen.vegetarian' : 'kitchen.regular')}
                />
              </View>
              <AppText variant="caption" tone="secondary" style={styles.gpsPurpose}>
                {t('checkIn.gpsPurpose')}
              </AppText>
              {!resolved.eligibility.eligible ? (
                <View style={styles.eligibilityError}>
                  <XCircle size={18} color={designTokens.color.semantic.critical.base} />
                  <View style={styles.eligibilityCopy}>
                    <AppText variant="supporting" tone="critical">
                      {t('checkIn.eligibilityUnavailable')}
                    </AppText>
                    {resolved.eligibility.reasons.map((reason) => (
                      <AppText key={reason} variant="caption" tone="secondary">
                        {t(mobileErrorMessageKey(reason))}
                      </AppText>
                    ))}
                  </View>
                </View>
              ) : null}
              <View style={[styles.expiry, expired && styles.expiryExpired]}>
                {expired ? <XCircle size={17} color={designTokens.color.semantic.critical.base} /> : <CheckCircle2 size={17} color={designTokens.color.semantic.success.base} />}
                <AppText variant="supporting" tone={expired ? 'critical' : 'success'}>
                  {expired ? t('checkIn.sessionExpired') : t('checkIn.expires', { seconds: secondsLeft })}
                </AppText>
              </View>
              {confirmError ? (
                <View style={styles.errorBlock}>
                  <AppText variant="supporting" tone="critical">
                    {getMobileErrorMessage(confirmError.error, t, 'errors.confirmCheckIn')}
                  </AppText>
                  {confirmError.retry ? <ActionButton variant="secondary" size="md" label={t('common.retry')} onPress={confirmError.retry} /> : null}
                </View>
              ) : null}
              <ActionButton
                variant="primary"
                size="lg"
                loading={confirming}
                disabled={expired || !resolved.eligibility.eligible || confirming}
                label={confirming ? t('checkIn.confirming') : t('checkIn.confirm')}
                onPress={() => void confirmCheckIn()}
                style={styles.confirmButton}
              />
              <ActionButton
                variant="ghost"
                size="md"
                disabled={confirming}
                label={t('checkIn.cancelAndScanAgain')}
                onPress={resetFlow}
              />
            </Surface>
          </View>
        ) : statusCanScan ? (
          <View style={styles.content}>
            <Surface style={styles.scanCard}>
              <View style={[styles.cameraFrame, { width: screenWidth }]}>
                {cameraReady ? (
                  <CameraView
                    style={StyleSheet.absoluteFillObject}
                    facing="back"
                    enableTorch={torchEnabled}
                    onMountError={(event) =>
                      setCameraError(
                        new MobileApiError(
                          'REQUEST_FAILED',
                          'errors.requestFailed',
                          event,
                        ),
                      )
                    }
                    onBarcodeScanned={scanned || resolving ? undefined : handleBarcodeScanned}
                    barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  />
                ) : null}
                <View style={styles.cameraScrim} pointerEvents="none" />
                <View style={styles.viewfinder} pointerEvents="none">
                  <View style={[styles.corner, styles.cornerTopLeft]} />
                  <View style={[styles.corner, styles.cornerTopRight]} />
                  <View style={[styles.corner, styles.cornerBottomLeft]} />
                  <View style={[styles.corner, styles.cornerBottomRight]} />
                </View>
                <View style={styles.scanStatus} pointerEvents="none">
                  {resolving ? <ActivityIndicator color={designTokens.color.text.onBrand} /> : <ScanLine size={18} color={designTokens.color.text.onBrand} />}
                  <AppText variant="caption" tone="onBrand">
                    {resolving ? t('checkIn.resolving') : t('checkIn.scanHelper')}
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="switch"
                  accessibilityLabel={torchEnabled ? t('checkIn.flashlightOff') : t('checkIn.flashlightOn')}
                  accessibilityState={{ checked: torchEnabled }}
                  onPress={() => setTorchEnabled((current) => !current)}
                  style={styles.torchButton}
                >
                  <Flashlight size={18} color={designTokens.color.text.onBrand} />
                  <AppText variant="caption" tone="onBrand">
                    {torchEnabled ? t('checkIn.flashlightOff') : t('checkIn.flashlightOn')}
                  </AppText>
                </Pressable>
              </View>
              <AppText variant="caption" tone="secondary" style={styles.gpsPurpose}>
                {t('checkIn.gpsPurpose')}
              </AppText>
              {cameraError ? (
                <View style={styles.errorBlock}>
                  <AppText variant="supporting" tone="critical">
                    {getMobileErrorMessage(cameraError, t, 'errors.requestFailed')}
                  </AppText>
                  <ActionButton
                    variant="secondary"
                    size="md"
                    label={t('common.retry')}
                    onPress={() => void requestCameraAccess()}
                  />
                </View>
              ) : null}
              {scanError ? (
                <View style={styles.errorBlock}>
                  <AppText variant="supporting" tone="critical">
                    {getMobileErrorMessage(scanError.error, t, 'errors.resolveCheckIn')}
                  </AppText>
                  {scanError.retry ? <ActionButton variant="secondary" size="md" label={t('common.retry')} onPress={scanError.retry} /> : null}
                </View>
              ) : null}
            </Surface>
          </View>
        ) : (
          <View style={styles.content}>
            <EmptyState
              icon={status?.state === 'CHECKED_IN' ? CheckCircle2 : status?.state === 'NO_SHOW' ? XCircle : Clock3}
              title={statusMessage}
              description={
                status?.registration?.servedAt
                  ? t('checkIn.checkedInAt', { time: formatBusinessInstant(status.registration.servedAt, locale) })
                  : status?.window
                    ? t('kitchenQr.window', {
                        from: formatWindowTime(status.window.opensAt, locale),
                        to: formatWindowTime(status.window.closesAt, locale),
                      })
                    : undefined
              }
              action={
                status?.state === 'OUTSIDE_WINDOW' || status?.state === 'CHECKED_IN'
                  ? undefined
                  : { label: t('common.retry'), onPress: () => void loadStatus() }
              }
            />
            {status?.state === 'CHECKED_IN' && status.registration && status.menu ? (
              <Surface style={styles.reviewCard}>
                <View style={styles.reviewHeaderCopy}>
                  <AppText variant="sectionTitle">{status.employee.name}</AppText>
                  <AppText variant="supporting" tone="secondary">
                    {t('checkIn.alreadyCheckedIn')}
                  </AppText>
                </View>
                <View style={styles.detailList}>
                  <DetailRow
                    icon={Clock3}
                    label={t('checkIn.mealDate')}
                    value={formatShortDate(parseDateKey(status.date), locale)}
                  />
                  <DetailRow icon={Utensils} label={t('checkIn.menu')} value={status.menu.name} />
                  <DetailRow
                    icon={ScanLine}
                    label={t('checkIn.employeeCode')}
                    value={status.employee.employeeCode}
                  />
                </View>
              </Surface>
            ) : null}
            {status?.location ? (
              <StatusBadge label={status.location.displayName} tone="information" icon={MapPin} style={styles.statusBadge} />
            ) : null}
          </View>
        )}
      </StateTransition>
    </AppFrame>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <View style={styles.detailRow}>
      <Icon size={17} color={designTokens.color.brand.primary} />
      <AppText variant="supporting" tone="secondary" style={styles.detailLabel}>
        {label}
      </AppText>
      <AppText variant="supporting" tone="strong" style={styles.detailValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: designTokens.space.md },
  scanCard: { padding: designTokens.space.md, gap: designTokens.space.md },
  cameraFrame: {
    alignSelf: 'center',
    height: 340,
    maxWidth: 420,
    overflow: 'hidden',
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface.brand,
  },
  cameraScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.26)',
  },
  viewfinder: {
    position: 'absolute',
    alignSelf: 'center',
    top: 70,
    width: 220,
    height: 220,
  },
  corner: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderColor: designTokens.color.text.onBrand,
  },
  cornerTopLeft: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3 },
  cornerTopRight: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3 },
  cornerBottomLeft: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3 },
  cornerBottomRight: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3 },
  scanStatus: {
    position: 'absolute',
    left: designTokens.space.md,
    right: designTokens.space.md,
    bottom: designTokens.space.md,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: designTokens.space.sm,
  },
  torchButton: {
    position: 'absolute',
    top: designTokens.space.md,
    right: designTokens.space.md,
    minHeight: designTokens.size.touchMin,
    paddingHorizontal: designTokens.space.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: designTokens.space.xs,
  },
  reviewCard: { padding: designTokens.space.lg, gap: designTokens.space.md },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: designTokens.space.md },
  reviewHeaderCopy: { flex: 1, gap: designTokens.space.xs },
  detailList: { gap: designTokens.space.sm },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: designTokens.space.sm },
  detailLabel: { width: 96 },
  detailValue: { flex: 1, textAlign: 'right' },
  gpsPurpose: { marginTop: designTokens.space.xs },
  expiry: { flexDirection: 'row', alignItems: 'center', gap: designTokens.space.xs },
  expiryExpired: { opacity: 0.85 },
  eligibilityError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.sm,
    padding: designTokens.space.sm,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.semantic.critical.tint,
  },
  eligibilityCopy: { flex: 1, gap: designTokens.space.xs },
  errorBlock: { gap: designTokens.space.sm },
  confirmButton: { marginTop: designTokens.space.sm },
  statusBadge: { alignSelf: 'center' },
});
