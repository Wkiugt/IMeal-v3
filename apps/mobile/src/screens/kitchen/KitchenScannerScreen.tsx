import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import {
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Flashlight,
  ScanLine,
  X,
  XCircle,
} from 'lucide-react-native';
import { formatBusinessInstant } from '../../businessDate';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import * as Crypto from 'expo-crypto';
import { pickupAPI, type ResolvePickupResponse } from '../../api/pickupAPI';
import {
  MobileApiError,
  getMobileErrorMessage,
} from '../../api/mobileApiError';
import { AppFrame } from '../../ui/AppShell';
import { ScreenLoading, StateTransition } from '../../ui/BrandMotion';
import { ActionButton, AppText, StatusBadge } from '../../ui/components';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { useLanguage } from '../../i18n/LanguageProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { designTokens, getElevationStyle } from '../../ui/designTokens';
import {
  canApplyScanOperation,
  canResetScan,
  canStartConfirm,
  getConfirmAttempt,
} from './kitchenScannerRules';

type Props = AppTabScreenProps<'KitchenScanner'>;
type ScanFeedback = {
  tone: 'success' | 'error';
  title: string;
  detail?: string;
  message: string;
  meta?: string;
  retry?: boolean;
  onRetry?: () => void;
  autoDismissMs?: number;
};

export function KitchenScannerScreen({ navigation }: Props) {
  const { token, canUseEmployee } = useSession();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [servingIntent, setServingIntent] =
    useState<ResolvePickupResponse | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const scanGeneration = useRef(0);
  const focusedRef = useRef(isFocused);
  const confirmInFlight = useRef(false);
  const reduceMotion = useReducedMotion();
  const scanProgress = useRef(new Animated.Value(0)).current;
  const feedbackTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const screenLoading = useScreenLoadingGate(isFocused, Boolean(permission));
  const viewfinderSize = Math.max(
    0,
    Math.min(
      320,
      width - 40,
      stageHeight -
        2 * designTokens.space.lg -
        28 -
        2 * designTokens.space.sm -
        designTokens.size.touchMin,
    ),
  );

  const dismissFeedback = () => {
    if (feedbackTimer.current) {
      clearTimeout(feedbackTimer.current);
      feedbackTimer.current = undefined;
    }
    setFeedback(null);
  };

  const presentFeedback = (nextFeedback: ScanFeedback) => {
    clearTimeout(feedbackTimer.current);
    setFeedback(nextFeedback);
    feedbackTimer.current = setTimeout(() => {
      feedbackTimer.current = undefined;
      setFeedback(null);
    }, nextFeedback.autoDismissMs ?? 2600);
  };

  useFocusEffect(
    useCallback(() => {
      focusedRef.current = true;
      return () => {
        focusedRef.current = false;
        scanGeneration.current += 1;
        confirmInFlight.current = false;
        clearTimeout(feedbackTimer.current);
        feedbackTimer.current = undefined;
        setFeedback(null);
        setServingIntent(null);
        setExpiresAt(null);
        setSecondsLeft(0);
        setScanned(false);
        setLoading(false);
        idempotencyKey.current = null;
      };
    }, []),
  );

  useEffect(() => {
    scanProgress.stopAnimation();
    if (
      !isFocused ||
      permission?.granted !== true ||
      servingIntent ||
      reduceMotion ||
      viewfinderSize <= 0
    ) {
      scanProgress.setValue(0.5);
      return;
    }

    scanProgress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(scanProgress, {
        toValue: 1,
        duration: designTokens.motion.duration.shimmerCycle,
        easing: designTokens.motion.easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => {
      animation.stop();
      scanProgress.stopAnimation();
    };
  }, [
    isFocused,
    permission?.granted,
    reduceMotion,
    scanProgress,
    servingIntent,
    viewfinderSize,
  ]);

  useEffect(() => {
    if (!expiresAt) return;
    const update = () =>
      setSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const expired = Boolean(expiresAt && secondsLeft === 0);
  const resetScan = () => {
    scanGeneration.current += 1;
    confirmInFlight.current = false;
    dismissFeedback();
    setServingIntent(null);
    setExpiresAt(null);
    setSecondsLeft(0);
    setScanned(false);
    setLoading(false);
    idempotencyKey.current = null;
  };
  const resolveCode = async (payload: string) => {
    if (!token || !focusedRef.current) return;
    const operationGeneration = ++scanGeneration.current;
    setLoading(true);
    try {
      idempotencyKey.current = null;
      const response = await pickupAPI.resolvePickup(token, { qr: payload });
      if (
        !canApplyScanOperation(
          focusedRef.current,
          scanGeneration.current,
          operationGeneration,
        )
      ) {
        return;
      }
      const expiry = new Date(response.session.expiresAt).getTime();
      setServingIntent(response);
      setExpiresAt(Number.isFinite(expiry) ? expiry : Date.now() + 30_000);
    } catch (error: unknown) {
      if (
        !canApplyScanOperation(
          focusedRef.current,
          scanGeneration.current,
          operationGeneration,
        )
      ) {
        return;
      }
      presentFeedback({
        title: t('scanner.verificationFailed'),
        message: getMobileErrorMessage(error, t, 'errors.resolvePickup'),
        tone: 'error',
        retry: true,
      });
      setScanned(false);
    } finally {
      if (
        canApplyScanOperation(
          focusedRef.current,
          scanGeneration.current,
          operationGeneration,
        )
      ) {
        setLoading(false);
      }
    }
  };

  const handleBarCodeScanned = ({ data }: { type: string; data: string }) => {
    if (scanned || loading || servingIntent) return;
    dismissFeedback();
    setScanned(true);
    void resolveCode(data);
  };

  const confirmServing = async () => {
    if (
      !token ||
      !servingIntent ||
      expired ||
      !focusedRef.current ||
      !canStartConfirm(confirmInFlight.current)
    ) {
      return;
    }
    const operationGeneration = ++scanGeneration.current;
    confirmInFlight.current = true;
    const confirmedIntent = servingIntent;
    const request = getConfirmAttempt(
      confirmedIntent.session.id,
      idempotencyKey.current,
      Crypto.randomUUID,
    );
    idempotencyKey.current = request.idempotencyKey;
    setLoading(true);
    try {
      await pickupAPI.confirmPickup(token, request);
      if (
        !canApplyScanOperation(
          focusedRef.current,
          scanGeneration.current,
          operationGeneration,
        )
      ) {
        return;
      }
      const delegatedItem = confirmedIntent.items.find(
        (item) => item.type === 'DELEGATED',
      );
      const employeeName =
        delegatedItem?.type === 'DELEGATED'
          ? delegatedItem.owner.name
          : t('scanner.employee');
      const firstMealChoice = confirmedIntent.intent.items[0]?.mealChoice;
      const mealType = t(
        firstMealChoice === 'VEGETARIAN'
          ? 'kitchen.vegetarian'
          : 'kitchen.regular',
      );
      resetScan();
      presentFeedback({
        title: t('scanner.verificationSuccess'),
        detail: employeeName,
        message: `${mealType} · ${t('pickup.lunch')}`,
        meta: t('scanner.servedAt', {
          time: formatBusinessInstant(new Date().toISOString(), locale),
        }),
        tone: 'success',
        autoDismissMs: 1400,
      });
    } catch (error: unknown) {
      if (
        !canApplyScanOperation(
          focusedRef.current,
          scanGeneration.current,
          operationGeneration,
        )
      ) {
        return;
      }
      const message =
        error instanceof MobileApiError &&
        error.code === 'PICKUP_SESSION_EXPIRED'
          ? t('errors.pickupSessionExpired')
          : getMobileErrorMessage(error, t, 'errors.confirmPickup');
      presentFeedback({
        title: t('scanner.verificationFailed'),
        message,
        tone: 'error',
        retry: true,
        onRetry: () => void confirmServing(),
      });
    } finally {
      if (
        canApplyScanOperation(
          focusedRef.current,
          scanGeneration.current,
          operationGeneration,
        )
      ) {
        confirmInFlight.current = false;
        setLoading(false);
      }
    }
  };

  const goBack = () => {
    navigation.navigate(
      canUseEmployee ? 'EmployeeDashboard' : 'KitchenDashboard',
    );
  };

  return (
    <StateTransition
      stateKey={
        screenLoading
          ? 'permission-loading'
          : permission?.granted !== true
            ? 'permission-denied'
            : 'scanner-ready'
      }
      style={styles.screenTransition}
    >
      {screenLoading ? (
        <ScreenLoading label={t('scanner.preparingCamera')} />
      ) : permission?.granted !== true ? (
        <AppFrame animateEntrance={false}>
          <View style={styles.permission}>
            <ScanLine size={40} color={designTokens.color.brand.primary} />
            <AppText variant="sectionTitle">
              {t('scanner.cameraRequired')}
            </AppText>
            <AppText
              variant="body"
              tone="secondary"
              style={styles.permissionText}
            >
              {t('scanner.cameraHint')}
            </AppText>
            <ActionButton
              variant="primary"
              size="lg"
              label={t('scanner.grantPermission')}
              onPress={requestPermission}
              style={styles.primaryButton}
            />
          </View>
        </AppFrame>
      ) : (
        <AppFrame animateEntrance={false} scroll={false}>
          <View style={styles.scannerScreen}>
            {isFocused && !servingIntent && (
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                enableTorch={torchEnabled}
                onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              />
            )}
            <View style={styles.scrim} />
            <View style={styles.scannerContent}>
              <View style={styles.scannerHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('scanner.backToDashboard')}
                  onPress={goBack}
                  style={styles.backButton}
                >
                  <ChevronLeft
                    size={22}
                    color={designTokens.color.text.onBrand}
                  />
                </Pressable>
                <View style={styles.scannerHead}>
                  <AppText
                    variant="cardTitle"
                    tone="onBrand"
                    style={styles.scannerTitle}
                  >
                    {t('scanner.scanEmployeeTicket')}
                  </AppText>
                </View>
              </View>
              <AppText
                variant="supporting"
                tone="onBrand"
                style={styles.helperText}
              >
                {t('scanner.helper')}
              </AppText>
              <View
                onLayout={(event) =>
                  setStageHeight(event.nativeEvent.layout.height)
                }
                style={styles.scannerStage}
              >
                <View style={styles.scannerFocusGroup}>
                  <View
                    style={[
                      styles.viewfinder,
                      { width: viewfinderSize, height: viewfinderSize },
                    ]}
                  >
                    <View
                      style={[
                        styles.bracket,
                        scanned && styles.bracketActive,
                        styles.topLeft,
                      ]}
                    />
                    <View
                      style={[
                        styles.bracket,
                        scanned && styles.bracketActive,
                        styles.topRight,
                      ]}
                    />
                    <View
                      style={[
                        styles.bracket,
                        scanned && styles.bracketActive,
                        styles.bottomLeft,
                      ]}
                    />
                    <View
                      style={[
                        styles.bracket,
                        scanned && styles.bracketActive,
                        styles.bottomRight,
                      ]}
                    />
                    {viewfinderSize > 0 && (
                      <Animated.View
                        style={[
                          styles.scanLine,
                          scanned && styles.scanLineActive,
                          {
                            transform: [
                              {
                                translateY: scanProgress.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [
                                    0,
                                    Math.max(0, viewfinderSize - 4),
                                  ],
                                }),
                              },
                            ],
                          },
                        ]}
                      />
                    )}
                  </View>
                  <View style={styles.scanStatus}>
                    {!reduceMotion && (
                      <ActivityIndicator
                        size="small"
                        color={designTokens.color.brand.secondary}
                      />
                    )}
                    <AppText variant="caption" tone="onBrand">
                      {t('scanner.searchingQr')}
                    </AppText>
                  </View>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityLabel={
                      torchEnabled
                        ? t('scanner.flashlightOff')
                        : t('scanner.flashlightOn')
                    }
                    accessibilityState={{ checked: torchEnabled }}
                    onPress={() => setTorchEnabled((current) => !current)}
                    style={({ pressed }) => [
                      styles.flashlightButton,
                      torchEnabled && styles.flashlightActive,
                      pressed && styles.flashlightPressed,
                    ]}
                  >
                    <Flashlight
                      size={18}
                      color={designTokens.color.text.onBrand}
                    />
                    <AppText
                      variant="caption"
                      tone="onBrand"
                      style={styles.flashlightLabel}
                    >
                      {torchEnabled
                        ? t('scanner.flashlightOff')
                        : t('scanner.flashlightOn')}
                    </AppText>
                  </Pressable>
                </View>
              </View>
            </View>
            {feedback && (
              <View style={styles.feedbackSheet}>
                <View
                  style={[
                    styles.feedbackIcon,
                    feedback.tone === 'success'
                      ? styles.feedbackIconSuccess
                      : styles.feedbackIconError,
                  ]}
                >
                  {feedback.tone === 'success' ? (
                    <CheckCircle2
                      size={19}
                      color={designTokens.color.semantic.success.base}
                    />
                  ) : (
                    <XCircle
                      size={19}
                      color={designTokens.color.semantic.critical.base}
                    />
                  )}
                </View>
                <View style={styles.feedbackCopy}>
                  <AppText variant="buttonLabel" tone="onBrand">
                    {feedback.title}
                  </AppText>
                  {feedback.detail && (
                    <AppText variant="cardTitle" tone="onBrand">
                      {feedback.detail}
                    </AppText>
                  )}
                  <AppText
                    variant="supporting"
                    tone="onBrand"
                    style={styles.feedbackMessage}
                  >
                    {feedback.message}
                  </AppText>
                  {feedback.meta && (
                    <AppText variant="caption" tone="onBrand">
                      {feedback.meta}
                    </AppText>
                  )}
                </View>
                <View style={styles.feedbackActions}>
                  {feedback.retry && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('scanner.retryScan')}
                      disabled={loading}
                      onPress={feedback.onRetry ?? resetScan}
                      style={styles.feedbackRetry}
                    >
                      <AppText variant="buttonLabel" tone="onBrand">
                        {t('scanner.retryScan')}
                      </AppText>
                    </Pressable>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('common.close')}
                    onPress={dismissFeedback}
                    style={styles.feedbackClose}
                  >
                    <X size={18} color={designTokens.color.text.onBrand} />
                  </Pressable>
                </View>
              </View>
            )}
          </View>
          <Modal
            visible={Boolean(servingIntent)}
            animationType="slide"
            transparent
            onRequestClose={() => {
              if (canResetScan(loading)) resetScan();
            }}
          >
            <View
              style={[styles.modalBackdrop, { paddingBottom: insets.bottom }]}
            >
              <View style={styles.modalCard}>
                <ScrollView
                  style={[styles.modalScroll, { maxHeight: height * 0.52 }]}
                  contentContainerStyle={styles.modalScrollContent}
                >
                  <View style={styles.modalHeader}>
                    <View style={styles.modalHeaderCopy}>
                      <AppText variant="sectionTitle">
                        {t('scanner.servingConfirmation')}
                      </AppText>
                      <AppText
                        variant="supporting"
                        tone="secondary"
                        style={styles.modalSubtitle}
                      >
                        {servingIntent &&
                          `${t('scanner.itemCount', { count: servingIntent.intent.totalCount })} ${t('scanner.toServe')}`}
                      </AppText>
                    </View>
                    <Clock3
                      size={22}
                      color={
                        expired
                          ? designTokens.color.semantic.critical.base
                          : designTokens.color.brand.primary
                      }
                    />
                  </View>
                  {servingIntent?.intent.isProxy && (
                    <StatusBadge
                      label={t('scanner.proxyPickup')}
                      tone="warning"
                    />
                  )}
                  {servingIntent?.intent.items.map((item) => (
                    <View key={item.id} style={styles.itemRow}>
                      <View style={styles.itemCopy}>
                        <AppText variant="body" style={styles.itemName}>
                          {item.itemName}
                        </AppText>
                        <StatusBadge
                          label={t(
                            item.mealChoice === 'VEGETARIAN'
                              ? 'kitchen.vegetarian'
                              : 'kitchen.regular',
                          )}
                          tone="information"
                          icon={null}
                        />
                      </View>
                      <AppText
                        variant="monoCaption"
                        tone="secondary"
                        style={styles.itemQuantity}
                      >
                        ×{item.quantity}
                      </AppText>
                    </View>
                  ))}
                  <View
                    style={[styles.expiry, expired && styles.expiryExpired]}
                  >
                    {expired ? (
                      <XCircle
                        size={17}
                        color={designTokens.color.semantic.critical.base}
                      />
                    ) : (
                      <CheckCircle2
                        size={17}
                        color={designTokens.color.semantic.success.base}
                      />
                    )}
                    <AppText
                      variant="supporting"
                      tone={expired ? 'critical' : 'success'}
                      style={styles.expiryText}
                    >
                      {expired
                        ? t('scanner.pickupSessionExpired')
                        : t('pickup.expires', { seconds: secondsLeft })}
                    </AppText>
                  </View>
                </ScrollView>
                <ActionButton
                  variant="primary"
                  size="lg"
                  loading={loading}
                  disabled={expired}
                  onPress={() => void confirmServing()}
                  label={t('scanner.confirmServing')}
                  style={styles.confirmButton}
                />
                <ActionButton
                  variant="ghost"
                  size="md"
                  disabled={!canResetScan(loading)}
                  onPress={resetScan}
                  label={t('scanner.cancelAndScanAgain')}
                  style={styles.cancelButton}
                />
              </View>
            </View>
          </Modal>
        </AppFrame>
      )}
    </StateTransition>
  );
}

const styles = StyleSheet.create({
  screenTransition: { flex: 1 },
  permission: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.md,
    paddingHorizontal: designTokens.space.lg,
  },
  permissionText: { textAlign: 'center', maxWidth: 320 },
  primaryButton: {
    minHeight: designTokens.size.touchMin,
    marginTop: designTokens.space.xs,
  },
  scannerScreen: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: designTokens.camera.background,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: designTokens.camera.scrim,
  },
  scannerContent: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: designTokens.space.lg,
    paddingTop: designTokens.space.md,
  },
  scannerHeader: {
    width: '100%',
    minHeight: designTokens.size.touchMin,
    paddingHorizontal: designTokens.space.xs,
    borderRadius: designTokens.radius.floating,
    borderWidth: designTokens.border.glass.width,
    borderColor: designTokens.color.border.glassHighlight,
    backgroundColor: 'rgba(5,11,22,0.62)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.xs,
  },
  backButton: {
    width: designTokens.size.touchMin,
    height: designTokens.size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scannerHead: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  scannerTitle: { textAlign: 'left', flexShrink: 1 },
  flashlightButton: {
    minWidth: 88,
    minHeight: designTokens.size.touchMin,
    marginTop: designTokens.space.sm,
    paddingHorizontal: designTokens.space.sm,
    borderRadius: designTokens.radius.full,
    borderWidth: designTokens.border.glass.width,
    borderColor: designTokens.color.border.glassHighlight,
    backgroundColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.xs,
  },
  flashlightActive: {
    borderColor: designTokens.color.brand.secondary,
    backgroundColor: 'rgba(120,189,242,0.16)',
  },
  flashlightPressed: { opacity: 0.72 },
  flashlightLabel: { flexShrink: 1 },
  scannerStage: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  scannerFocusGroup: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  viewfinder: {
    borderRadius: designTokens.radius.floating,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  bracket: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderColor: designTokens.camera.guide,
    borderWidth: 3,
  },
  bracketActive: { borderColor: designTokens.color.brand.secondary },
  topLeft: { top: 20, left: 20, borderRightWidth: 0, borderBottomWidth: 0 },
  topRight: { top: 20, right: 20, borderLeftWidth: 0, borderBottomWidth: 0 },
  bottomLeft: { bottom: 20, left: 20, borderRightWidth: 0, borderTopWidth: 0 },
  bottomRight: { bottom: 20, right: 20, borderLeftWidth: 0, borderTopWidth: 0 },
  scanLine: {
    position: 'absolute',
    left: 28,
    right: 28,
    height: 3,
    backgroundColor: designTokens.color.brand.secondary,
    opacity: 0.95,
    shadowColor: designTokens.color.brand.secondary,
    shadowOpacity: 0.24,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  },
  scanLineActive: { backgroundColor: designTokens.color.brand.secondary },
  scanStatus: {
    minHeight: 28,
    marginTop: designTokens.space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.xs,
  },
  helperText: {
    maxWidth: 310,
    marginTop: designTokens.space.md,
    textAlign: 'center',
  },
  feedbackSheet: {
    position: 'absolute',
    left: designTokens.space.lg,
    right: designTokens.space.lg,
    bottom: designTokens.space.lg,
    padding: designTokens.space.md,
    borderRadius: designTokens.radius.floating,
    borderWidth: designTokens.border.glass.width,
    borderColor: designTokens.color.border.glassHighlight,
    backgroundColor: 'rgba(5,11,22,0.84)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.sm,
    ...getElevationStyle(3),
  },
  feedbackIcon: {
    width: 34,
    height: 34,
    borderRadius: designTokens.radius.smallControl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackIconSuccess: {
    backgroundColor: designTokens.color.semantic.success.tint,
  },
  feedbackIconError: {
    backgroundColor: designTokens.color.semantic.critical.tint,
  },
  feedbackCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  feedbackMessage: { flexShrink: 1 },
  feedbackActions: {
    alignItems: 'flex-end',
    gap: designTokens.space.xs,
  },
  feedbackRetry: {
    minHeight: designTokens.size.touchMin,
    minWidth: 88,
    paddingHorizontal: designTokens.space.sm,
    borderRadius: designTokens.radius.smallControl,
    borderWidth: designTokens.border.glass.width,
    borderColor: designTokens.color.border.glassHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  feedbackClose: {
    width: designTokens.size.touchMin,
    height: designTokens.size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: designTokens.color.scrim,
  },
  modalCard: {
    width: '100%',
    maxWidth: 390,
    alignSelf: 'center',
    padding: designTokens.space.xl,
    borderTopLeftRadius: designTokens.radius.floating,
    borderTopRightRadius: designTokens.radius.floating,
    backgroundColor: designTokens.color.surface.standard,
    gap: designTokens.space.md,
  },
  modalScroll: { flexGrow: 0 },
  modalScrollContent: {
    gap: designTokens.space.md,
    paddingBottom: designTokens.space.xs,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
  modalSubtitle: { marginTop: designTokens.space.xs },
  itemRow: {
    paddingVertical: designTokens.space.sm,
    borderBottomWidth: 1,
    borderBottomColor: designTokens.color.border.standard,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  itemCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  itemName: { flexShrink: 1, minWidth: 0 },
  itemQuantity: { flexShrink: 0 },
  expiry: {
    minHeight: designTokens.size.touchMin,
    paddingHorizontal: designTokens.space.md,
    borderRadius: designTokens.radius.smallControl,
    backgroundColor: designTokens.color.semantic.success.tint,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  expiryExpired: { backgroundColor: designTokens.color.semantic.critical.tint },
  expiryText: { flexShrink: 1, minWidth: 0 },
  confirmButton: { minHeight: designTokens.size.touchMin },
  cancelButton: {
    minHeight: designTokens.size.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
