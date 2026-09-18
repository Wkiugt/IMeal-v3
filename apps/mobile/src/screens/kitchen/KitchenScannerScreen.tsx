import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { CheckCircle2, ChevronLeft, Clock3, ScanLine, XCircle } from 'lucide-react-native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { servingAPI, type ResolveServingResponse } from '../../api/servingAPI';
import { MobileApiError, getMobileErrorMessage } from '../../api/mobileApiError';
import { PrototypeFrame } from '../../ui/PrototypeShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { useInitialLoadingGate } from '../../ui/useInitialLoadingGate';
import { Pill, PillText } from '../../ui/PrototypePrimitives';
import { useNotice } from '../../ui/BrandNotice';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { useLanguage } from '../../i18n/LanguageProvider';
import { theme } from '../../theme';

type Props = AppTabScreenProps<'KitchenScanner'>;

export function KitchenScannerScreen({ navigation }: Props) {
  const { token, canUseEmployee } = useSession();
  const { showNotice } = useNotice();
  const { t } = useLanguage();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [servingIntent, setServingIntent] = useState<ResolveServingResponse | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const screenLoading = useScreenLoadingGate(isFocused, Boolean(permission));
  const viewfinderSize = Math.min(280, Math.max(0, width - 44));
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
        <PrototypeFrame animateEntrance={false}><View style={styles.permission}><ScanLine size={40} color={theme.colors.accentDeep} /><Text style={styles.permissionTitle}>{t('scanner.cameraRequired')}</Text><Text style={styles.permissionText}>{t('scanner.cameraHint')}</Text><Pressable accessibilityRole="button" onPress={requestPermission} style={styles.primaryButton}><Text style={styles.primaryButtonText}>{t('scanner.grantPermission')}</Text></Pressable></View></PrototypeFrame>
      ) : (
        <PrototypeFrame animateEntrance={false} scroll={false} bottomClearance={114}>
          <View style={styles.scannerScreen}>
            {isFocused && !servingIntent && <CameraView style={StyleSheet.absoluteFillObject} facing="back" onBarcodeScanned={scanned ? undefined : handleBarCodeScanned} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} />}
            <View style={styles.scrim} />
            <View style={styles.scannerContent}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('scanner.backToDashboard')} onPress={goBack} style={styles.backButton}><ChevronLeft size={20} color={theme.colors.surface} /><Text style={styles.backText}>{t('common.dashboard')}</Text></Pressable>
              <View style={styles.scannerHead}><Text style={styles.scannerTitle}>{t('scanner.scanEmployeeTicket')}</Text><Text style={styles.scannerSubtitle}>{t('scanner.scanHint')}</Text></View>
              <View style={styles.scannerStage}>
                <View style={[styles.viewfinder, { width: viewfinderSize, height: viewfinderSize }]}><View style={[styles.bracket, styles.topLeft]} /><View style={[styles.bracket, styles.topRight]} /><View style={[styles.bracket, styles.bottomLeft]} /><View style={[styles.bracket, styles.bottomRight]} />{!reduceMotion && <View style={[styles.scanLine, { top: (viewfinderSize - 2) / 2 }]} />}<View style={styles.viewfinderHint}><Text style={styles.hintPrimary}>{t('scanner.cameraPreview')}</Text><Text style={styles.hintSecondary}>{loading ? t('scanner.resolvingTicket') : scanned ? t('scanner.ticketDetected') : t('scanner.alignQr')}</Text></View></View>
                {scanned && !servingIntent && <Text style={[styles.resolving, { top: viewfinderSize + 18 }]}>{loading ? t('scanner.resolveEmployeeTicket') : t('scanner.scanAnotherTicket')}</Text>}
              </View>
            </View>
          </View>
          <Modal visible={Boolean(servingIntent)} animationType="slide" transparent onRequestClose={resetScan}>
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <View style={styles.modalHeader}>
                  <View style={styles.modalHeaderCopy}>
                    <Text style={styles.modalTitle}>{t('scanner.servingConfirmation')}</Text>
                    <Text style={styles.modalSubtitle}>{servingIntent && `${t('scanner.itemCount', { count: servingIntent.intent.totalCount })} ${t('scanner.toServe')}`}</Text>
                  </View>
                  <Clock3 size={22} color={expired ? theme.colors.statusBadDeep : theme.colors.accentDeep} />
                </View>
                {servingIntent?.intent.isProxy && <Pill tone="warn"><PillText>{t('scanner.proxyPickup')}</PillText></Pill>}
                {servingIntent?.intent.items.map((item) => (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={styles.itemCopy}>
                      <Text style={styles.itemName}>{item.itemName}</Text>
                      <Pill tone="outline"><PillText>{t(item.mealChoice === 'VEGETARIAN' ? 'kitchen.vegetarian' : 'kitchen.regular')}</PillText></Pill>
                    </View>
                    <Text style={styles.itemQuantity}>×{item.quantity}</Text>
                  </View>
                ))}
                <View style={[styles.expiry, expired && styles.expiryExpired]}>
                  {expired ? <XCircle size={17} color={theme.colors.statusBadDeep} /> : <CheckCircle2 size={17} color={theme.colors.statusGoodDeep} />}
                  <Text style={[styles.expiryText, expired && styles.expiryTextExpired]}>{expired ? t('scanner.pickupSessionExpired') : t('pickup.expires', { seconds: secondsLeft })}</Text>
                </View>
                <Pressable accessibilityRole="button" disabled={loading || expired} onPress={() => void confirmServing()} style={[styles.confirmButton, (loading || expired) && styles.disabled]}>
                  <Text style={styles.confirmText}>{loading ? t('scanner.processing') : t('scanner.confirmServing')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={resetScan} style={styles.cancelButton}>
                  <Text style={styles.cancelText}>{t('scanner.cancelAndScanAgain')}</Text>
                </Pressable>
              </View>
            </View>
          </Modal>
        </PrototypeFrame>
      )}
    </StateTransition>
  );
}

const styles = StyleSheet.create({
  screenTransition: { flex: 1 },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 20 },
  permissionTitle: { color: theme.colors.fg, fontSize: 20, fontFamily: theme.typography.bold },
  permissionText: { color: theme.colors.muted, fontSize: 14, fontFamily: theme.typography.regular, textAlign: 'center', lineHeight: 21 },
  primaryButton: { minHeight: 48, paddingHorizontal: 20, borderRadius: theme.radii.md, backgroundColor: theme.colors.accentDeep, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryButtonText: { color: theme.colors.surface, fontSize: 14, fontFamily: theme.typography.bold },
  scannerScreen: { flex: 1, width: '100%', overflow: 'hidden', backgroundColor: '#050b16' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,11,22,0.45)' },
  scannerContent: { flex: 1, width: '100%', alignItems: 'center', paddingHorizontal: 22, paddingTop: 14 },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { color: theme.colors.surface, fontSize: 13, fontFamily: theme.typography.semiBold },
  scannerHead: { alignItems: 'center', marginTop: 22, marginBottom: 24 },
  scannerTitle: { color: theme.colors.surface, fontSize: 20, fontFamily: theme.typography.bold },
  scannerSubtitle: { maxWidth: 260, color: 'rgba(255,255,255,0.78)', fontSize: 13, fontFamily: theme.typography.regular, lineHeight: 19, textAlign: 'center', marginTop: 5 },
  scannerStage: { flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  viewfinder: { width: 280, height: 280, borderRadius: 52, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', ...theme.shadows.lg },
  bracket: { position: 'absolute', width: 34, height: 34, borderColor: 'rgba(255,255,255,0.88)', borderWidth: 3 },
  topLeft: { top: 22, left: 22, borderRightWidth: 0, borderBottomWidth: 0 },
  topRight: { top: 22, right: 22, borderLeftWidth: 0, borderBottomWidth: 0 },
  bottomLeft: { bottom: 22, left: 22, borderRightWidth: 0, borderTopWidth: 0 },
  bottomRight: { bottom: 22, right: 22, borderLeftWidth: 0, borderTopWidth: 0 },
  scanLine: { position: 'absolute', left: 24, right: 24, top: 138, height: 2, backgroundColor: theme.colors.accent, opacity: 0.9 },
  viewfinderHint: { alignItems: 'center', gap: 5 },
  hintPrimary: { color: theme.colors.surface, fontSize: 14, fontFamily: theme.typography.bold },
  hintSecondary: { color: 'rgba(255,255,255,0.72)', fontSize: 12, fontFamily: theme.typography.regular },
  resolving: { position: 'absolute', left: 0, right: 0, color: theme.colors.surface, fontSize: 13, fontFamily: theme.typography.regular, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.52)' },
  modalCard: { width: '100%', maxWidth: 390, alignSelf: 'center', padding: 24, paddingBottom: 30, borderTopLeftRadius: theme.radii.lg, borderTopRightRadius: theme.radii.lg, backgroundColor: theme.colors.surface, gap: 14 },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalHeaderCopy: { flex: 1, minWidth: 0 },
  modalTitle: { color: theme.colors.fg, fontSize: 20, fontFamily: theme.typography.bold },
  modalSubtitle: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular, marginTop: 4 },
  itemRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  itemCopy: { flex: 1, minWidth: 0, gap: 5 },
  itemName: { color: theme.colors.fg, fontSize: 14, fontFamily: theme.typography.semiBold },
  itemQuantity: { color: theme.colors.muted, fontSize: 14, fontFamily: theme.typography.fontMono },
  expiry: { minHeight: 42, paddingHorizontal: 12, borderRadius: theme.radii.sm, backgroundColor: theme.colors.statusGoodTint, flexDirection: 'row', alignItems: 'center', gap: 8 },
  expiryExpired: { backgroundColor: theme.colors.statusBadTint },
  expiryText: { color: theme.colors.statusGoodDeep, fontSize: 13, fontFamily: theme.typography.semiBold },
  expiryTextExpired: { color: theme.colors.statusBadDeep },
  confirmButton: { minHeight: 50, borderRadius: theme.radii.md, backgroundColor: theme.colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: theme.colors.surface, fontSize: 14, fontFamily: theme.typography.bold },
  cancelButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.semiBold },
  disabled: { opacity: 0.45 },
});
