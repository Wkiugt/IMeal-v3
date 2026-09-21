import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { CheckCircle2, ChevronLeft, Clock3, ScanLine, XCircle } from 'lucide-react-native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { servingAPI, type ResolveServingResponse } from '../../api/servingAPI';
import { MobileApiError, getMobileErrorMessage } from '../../api/mobileApiError';
import { AppFrame } from '../../ui/AppShell';
import { ScreenLoading, StateTransition } from '../../ui/BrandMotion';
import { ActionButton, AppText, StatusBadge } from '../../ui/components';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { useNotice } from '../../ui/BrandNotice';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { useLanguage } from '../../i18n/LanguageProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { designTokens, getElevationStyle } from '../../ui/designTokens';

type Props = AppTabScreenProps<'KitchenScanner'>;

export function KitchenScannerScreen({ navigation }: Props) {
  const { token, canUseEmployee } = useSession();
  const { t } = useLanguage();
  const { showNotice } = useNotice();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [servingIntent, setServingIntent] = useState<ResolveServingResponse | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);
  const reduceMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const screenLoading = useScreenLoadingGate(isFocused, Boolean(permission));
  const viewfinderSize = Math.max(0, Math.min(280, width - 44, stageHeight - 2 * designTokens.space.lg));
  useEffect(() => {
    if (!expiresAt) return;
    const update = () => setSecondsLeft(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  const expired = Boolean(expiresAt && secondsLeft === 0);
  const resetScan = () => {
    setServingIntent(null);
    setExpiresAt(null);
    setSecondsLeft(0);
    setScanned(false);
    setLoading(false);
  };

  const resolveCode = async (payload: string) => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await servingAPI.resolveServing({ qrPayload: payload }, token);
      const expiry = new Date(response.session.expiresAt).getTime();
      setServingIntent(response);
      setExpiresAt(Number.isFinite(expiry) ? expiry : Date.now() + 30_000);
    } catch (error: unknown) {
      showNotice({
        title: t('scanner.errorResolving'),
        message: getMobileErrorMessage(error, t, 'errors.resolveServing'),
        tone: 'error',
      });
      setScanned(false);
    } finally {
      setLoading(false);
    }
  };

  const handleBarCodeScanned = ({ data }: { type: string; data: string }) => {
    if (scanned || loading || servingIntent) return;
    setScanned(true);
    void resolveCode(data);
  };

  const confirmServing = async () => {
    if (!token || !servingIntent || expired) return;
    setLoading(true);
    try {
      await servingAPI.confirmServing({ pickupSessionToken: servingIntent.pickupSessionToken }, token);
      resetScan();
      showNotice({ title: t('common.success'), message: t('scanner.servingConfirmed'), tone: 'success' });
    } catch (error: unknown) {
      if (error instanceof MobileApiError && error.code === 'PICKUP_SESSION_EXPIRED') {
        setExpiresAt(Date.now());
        setSecondsLeft(0);
        showNotice({
          title: t('scanner.confirmationExpired'),
          message: t('errors.pickupSessionExpired'),
          tone: 'warning',
        });
      } else {
        const message = getMobileErrorMessage(error, t, 'errors.confirmServing');
        showNotice({ title: t('scanner.confirmationError'), message, tone: 'error' });
      }
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    navigation.navigate(canUseEmployee ? 'EmployeeDashboard' : 'KitchenDashboard');
  };

  return (
    <StateTransition
      stateKey={screenLoading ? 'permission-loading' : permission?.granted !== true ? 'permission-denied' : 'scanner-ready'}
      style={styles.screenTransition}
    >
      {screenLoading ? (
        <ScreenLoading label={t('scanner.preparingCamera')} />
      ) : permission?.granted !== true ? (
        <AppFrame animateEntrance={false}><View style={styles.permission}><ScanLine size={40} color={designTokens.color.brand.primary} /><AppText variant="sectionTitle">{t('scanner.cameraRequired')}</AppText><AppText variant="body" tone="secondary" style={styles.permissionText}>{t('scanner.cameraHint')}</AppText><ActionButton variant="primary" size="lg" label={t('scanner.grantPermission')} onPress={requestPermission} style={styles.primaryButton} /></View></AppFrame>
      ) : (
        <AppFrame animateEntrance={false} scroll={false}>
          <View style={styles.scannerScreen}>
            {isFocused && !servingIntent && <CameraView style={StyleSheet.absoluteFillObject} facing="back" onBarcodeScanned={scanned ? undefined : handleBarCodeScanned} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} />}
            <View style={styles.scrim} />
            <View style={styles.scannerContent}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('scanner.backToDashboard')} onPress={goBack} style={styles.backButton}><ChevronLeft size={20} color={designTokens.color.text.onBrand} /><AppText variant="buttonLabel" tone="onBrand" style={styles.backText}>{t('common.dashboard')}</AppText></Pressable>
              <View style={styles.scannerHead}><AppText variant="sectionTitle" tone="onBrand" style={styles.scannerTitle}>{t('scanner.scanEmployeeTicket')}</AppText><AppText variant="supporting" tone="onBrand" style={styles.scannerSubtitle}>{t('scanner.scanHint')}</AppText></View>
              <View onLayout={(event) => setStageHeight(event.nativeEvent.layout.height)} style={styles.scannerStage}>
                <View style={[styles.viewfinder, { width: viewfinderSize, height: viewfinderSize }]}><View style={[styles.bracket, styles.topLeft]} /><View style={[styles.bracket, styles.topRight]} /><View style={[styles.bracket, styles.bottomLeft]} /><View style={[styles.bracket, styles.bottomRight]} />{!reduceMotion && viewfinderSize > 0 && <View style={[styles.scanLine, { top: (viewfinderSize - 2) / 2 }]} />}<View style={styles.viewfinderHint}><AppText variant="buttonLabel" tone="onBrand">{t('scanner.cameraPreview')}</AppText><AppText variant="caption" tone="tertiary">{loading ? t('scanner.resolvingTicket') : scanned ? t('scanner.ticketDetected') : t('scanner.alignQr')}</AppText></View></View>
                {scanned && !servingIntent && <AppText variant="supporting" tone="onBrand" style={[styles.resolving, { top: viewfinderSize + designTokens.space.md }]}>{loading ? t('scanner.resolveEmployeeTicket') : t('scanner.scanAnotherTicket')}</AppText>}
              </View>
            </View>
          </View>
          <Modal visible={Boolean(servingIntent)} animationType="slide" transparent onRequestClose={resetScan}>
            <View style={[styles.modalBackdrop, { paddingBottom: insets.bottom }]}>
              <View style={styles.modalCard}>
                <ScrollView style={[styles.modalScroll, { maxHeight: height * 0.52 }]} contentContainerStyle={styles.modalScrollContent}>
                  <View style={styles.modalHeader}>
                    <View style={styles.modalHeaderCopy}>
                      <AppText variant="sectionTitle">{t('scanner.servingConfirmation')}</AppText>
                      <AppText variant="supporting" tone="secondary" style={styles.modalSubtitle}>{servingIntent && `${t('scanner.itemCount', { count: servingIntent.intent.totalCount })} ${t('scanner.toServe')}`}</AppText>
                    </View>
                    <Clock3 size={22} color={expired ? designTokens.color.semantic.critical.base : designTokens.color.brand.primary} />
                  </View>
                  {servingIntent?.intent.isProxy && <StatusBadge label={t('scanner.proxyPickup')} tone="warning" />}
                  {servingIntent?.intent.items.map((item) => (
                    <View key={item.id} style={styles.itemRow}>
                      <View style={styles.itemCopy}>
                        <AppText variant="body" style={styles.itemName}>{item.itemName}</AppText>
                        <StatusBadge label={t(item.mealChoice === 'VEGETARIAN' ? 'kitchen.vegetarian' : 'kitchen.regular')} tone="information" icon={null} />
                      </View>
                      <AppText variant="monoCaption" tone="secondary" style={styles.itemQuantity}>×{item.quantity}</AppText>
                    </View>
                  ))}
                  <View style={[styles.expiry, expired && styles.expiryExpired]}>
                    {expired ? <XCircle size={17} color={designTokens.color.semantic.critical.base} /> : <CheckCircle2 size={17} color={designTokens.color.semantic.success.base} />}
                    <AppText variant="supporting" tone={expired ? 'critical' : 'success'} style={styles.expiryText}>{expired ? t('scanner.pickupSessionExpired') : t('pickup.expires', { seconds: secondsLeft })}</AppText>
                  </View>
                </ScrollView>
                <ActionButton variant="primary" size="lg" loading={loading} disabled={expired} onPress={() => void confirmServing()} label={t('scanner.confirmServing')} style={styles.confirmButton} />
                <ActionButton variant="ghost" size="md" onPress={resetScan} label={t('scanner.cancelAndScanAgain')} style={styles.cancelButton} />
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
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: designTokens.space.md, paddingHorizontal: designTokens.space.lg },
  permissionText: { textAlign: 'center', maxWidth: 320 },
  primaryButton: { minHeight: designTokens.size.touchMin, marginTop: designTokens.space.xs },
  scannerScreen: { flex: 1, width: '100%', overflow: 'hidden', backgroundColor: designTokens.camera.background },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: designTokens.camera.scrim },
  scannerContent: { flex: 1, width: '100%', alignItems: 'center', paddingHorizontal: designTokens.space.lg, paddingTop: designTokens.space.md },
  backButton: { minHeight: designTokens.size.touchMin, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: designTokens.space.xs },
  backText: { flexShrink: 1, minWidth: 0 },
  scannerHead: { alignItems: 'center', marginTop: designTokens.space.lg, marginBottom: designTokens.space.xl, maxWidth: 320 },
  scannerTitle: { textAlign: 'center' },
  scannerSubtitle: { maxWidth: 280, textAlign: 'center', marginTop: designTokens.space.xs },
  scannerStage: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  viewfinder: { borderRadius: 52, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', ...getElevationStyle(3) },
  bracket: { position: 'absolute', width: 34, height: 34, borderColor: designTokens.camera.guide, borderWidth: 3 },
  topLeft: { top: 22, left: 22, borderRightWidth: 0, borderBottomWidth: 0 },
  topRight: { top: 22, right: 22, borderLeftWidth: 0, borderBottomWidth: 0 },
  bottomLeft: { bottom: 22, left: 22, borderRightWidth: 0, borderTopWidth: 0 },
  bottomRight: { bottom: 22, right: 22, borderLeftWidth: 0, borderTopWidth: 0 },
  scanLine: { position: 'absolute', left: 24, right: 24, height: 2, backgroundColor: designTokens.color.brand.secondary, opacity: 0.9 },
  viewfinderHint: { alignItems: 'center', gap: designTokens.space.xs, paddingHorizontal: designTokens.space.md },
  resolving: { position: 'absolute', left: 0, right: 0, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: designTokens.color.scrim },
  modalCard: { width: '100%', maxWidth: 390, alignSelf: 'center', padding: designTokens.space.xl, borderTopLeftRadius: designTokens.radius.floating, borderTopRightRadius: designTokens.radius.floating, backgroundColor: designTokens.color.surface.standard, gap: designTokens.space.md },
  modalScroll: { flexGrow: 0 },
  modalScrollContent: { gap: designTokens.space.md, paddingBottom: designTokens.space.xs },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: designTokens.space.md },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
  modalSubtitle: { marginTop: designTokens.space.xs },
  itemRow: { paddingVertical: designTokens.space.sm, borderBottomWidth: 1, borderBottomColor: designTokens.color.border.standard, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: designTokens.space.sm },
  itemCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  itemName: { flexShrink: 1, minWidth: 0 },
  itemQuantity: { flexShrink: 0 },
  expiry: { minHeight: designTokens.size.touchMin, paddingHorizontal: designTokens.space.md, borderRadius: designTokens.radius.smallControl, backgroundColor: designTokens.color.semantic.success.tint, flexDirection: 'row', alignItems: 'center', gap: designTokens.space.sm },
  expiryExpired: { backgroundColor: designTokens.color.semantic.critical.tint },
  expiryText: { flexShrink: 1, minWidth: 0 },
  confirmButton: { minHeight: designTokens.size.touchMin },
  cancelButton: { minHeight: designTokens.size.touchMin, alignItems: 'center', justifyContent: 'center' },
});
