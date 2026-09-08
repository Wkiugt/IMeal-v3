import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { CheckCircle2, ChevronLeft, Clock3, ScanLine, XCircle } from 'lucide-react-native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { servingAPI, type ResolveServingResponse } from '../../api/servingAPI';
import { PrototypeFrame } from '../../ui/PrototypeShell';
import { BrandLoader, StateTransition } from '../../ui/BrandMotion';
import { Pill, PillText } from '../../ui/PrototypePrimitives';
import { useNotice } from '../../ui/BrandNotice';
import { useReducedMotion } from '../../ui/useReducedMotion';
import { theme } from '../../theme';

type Props = AppTabScreenProps<'KitchenScanner'>;
const EXPIRED_MESSAGE = 'Pickup session has expired';

export function KitchenScannerScreen({ navigation }: Props) {
  const { token, canUseEmployee } = useSession();
  const { showNotice } = useNotice();
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [servingIntent, setServingIntent] = useState<ResolveServingResponse | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const reduceMotion = useReducedMotion();

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
      showNotice({ title: 'Error resolving serving', message: error instanceof Error ? error.message : 'Unable to resolve serving', tone: 'error' });
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
      showNotice({ title: 'Success', message: 'Serving confirmed successfully!', tone: 'success' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unable to confirm serving';
      if (message === EXPIRED_MESSAGE) {
        setExpiresAt(Date.now());
        setSecondsLeft(0);
        showNotice({ title: 'Confirmation expired', message: EXPIRED_MESSAGE, tone: 'warning' });
      } else {
        showNotice({ title: 'Confirmation error', message, tone: 'error' });
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
      stateKey={!permission ? 'permission-loading' : !permission.granted ? 'permission-denied' : 'scanner-ready'}
      style={styles.screenTransition}
    >
      {!permission ? (
        <View style={styles.loadingScreen}><BrandLoader label="Preparing camera…" /></View>
      ) : !permission.granted ? (
        <PrototypeFrame animateEntrance={false}><View style={styles.permission}><ScanLine size={40} color={theme.colors.accentDeep} /><Text style={styles.permissionTitle}>Camera access required</Text><Text style={styles.permissionText}>Allow camera access to scan employee meal tickets.</Text><Pressable onPress={requestPermission} style={styles.primaryButton}><Text style={styles.primaryButtonText}>Grant permission</Text></Pressable></View></PrototypeFrame>
      ) : (
        <PrototypeFrame animateEntrance={false} scroll={false} bottomClearance={130}>
          <View style={styles.scannerScreen}>
            {isFocused && !servingIntent && <CameraView style={StyleSheet.absoluteFillObject} facing="back" onBarcodeScanned={scanned ? undefined : handleBarCodeScanned} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} />}
            <View style={styles.scrim} />
            <View style={styles.scannerContent}>
              <Pressable accessibilityLabel="Back to dashboard" onPress={goBack} style={styles.backButton}><ChevronLeft size={20} color={theme.colors.surface} /><Text style={styles.backText}>Dashboard</Text></Pressable>
              <View style={styles.scannerHead}><Text style={styles.scannerTitle}>Scan Employee Ticket</Text><Text style={styles.scannerSubtitle}>Align the dynamic QR code within the frame to verify TOTP</Text></View>
              <View style={styles.viewfinder}><View style={[styles.bracket, styles.topLeft]} /><View style={[styles.bracket, styles.topRight]} /><View style={[styles.bracket, styles.bottomLeft]} /><View style={[styles.bracket, styles.bottomRight]} />{!reduceMotion && <View style={styles.scanLine} />}<View style={styles.viewfinderHint}><Text style={styles.hintPrimary}>Camera preview</Text><Text style={styles.hintSecondary}>{loading ? 'Resolving ticket…' : scanned ? 'Ticket detected' : 'Align QR code within frame'}</Text></View></View>
              {scanned && !servingIntent && <Text style={styles.resolving}>{loading ? 'Resolving employee ticket…' : 'Scan another ticket'}</Text>}
            </View>
          </View>
          <Modal visible={Boolean(servingIntent)} animationType="slide" transparent onRequestClose={resetScan}>
            <View style={styles.modalBackdrop}><View style={styles.modalCard}><View style={styles.modalHeader}><View><Text style={styles.modalTitle}>Serving Confirmation</Text><Text style={styles.modalSubtitle}>{servingIntent?.intent.totalCount} item{servingIntent?.intent.totalCount === 1 ? '' : 's'} to serve</Text></View><Clock3 size={22} color={expired ? theme.colors.statusBadDeep : theme.colors.accentDeep} /></View>{servingIntent?.intent.isProxy && <Pill tone="warn"><PillText>Proxy pickup</PillText></Pill>}{servingIntent?.intent.items.map((item) => <View key={item.id} style={styles.itemRow}><Text style={styles.itemName}>{item.itemName}</Text><Text style={styles.itemQuantity}>×{item.quantity}</Text></View>)}<View style={[styles.expiry, expired && styles.expiryExpired]}>{expired ? <XCircle size={17} color={theme.colors.statusBadDeep} /> : <CheckCircle2 size={17} color={theme.colors.statusGoodDeep} />}<Text style={[styles.expiryText, expired && styles.expiryTextExpired]}>{expired ? EXPIRED_MESSAGE : `Session expires in ${secondsLeft}s`}</Text></View><Pressable disabled={loading || expired} onPress={() => void confirmServing()} style={[styles.confirmButton, (loading || expired) && styles.disabled]}><Text style={styles.confirmText}>{loading ? 'Processing…' : 'Confirm serving'}</Text></Pressable><Pressable onPress={resetScan} style={styles.cancelButton}><Text style={styles.cancelText}>Cancel and scan again</Text></Pressable></View></View>
          </Modal>
        </PrototypeFrame>
      )}
    </StateTransition>
  );
}

const styles = StyleSheet.create({
  screenTransition: { flex: 1 },
  loadingScreen: { flex: 1, backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center' },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 20 },
  permissionTitle: { color: theme.colors.fg, fontSize: 20, fontWeight: '700' },
  permissionText: { color: theme.colors.muted, fontSize: 14, textAlign: 'center', lineHeight: 21 },
  primaryButton: { minHeight: 48, paddingHorizontal: 20, borderRadius: theme.radii.md, backgroundColor: theme.colors.accentDeep, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryButtonText: { color: theme.colors.surface, fontSize: 14, fontWeight: '700' },
  scannerScreen: { flex: 1, overflow: 'hidden', backgroundColor: '#050b16' },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,11,22,0.45)' },
  scannerContent: { flex: 1, alignItems: 'center', paddingHorizontal: 22, paddingTop: 14 },
  backButton: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { color: theme.colors.surface, fontSize: 13, fontWeight: '600' },
  scannerHead: { alignItems: 'center', marginTop: 22, marginBottom: 24 },
  scannerTitle: { color: theme.colors.surface, fontSize: 20, fontWeight: '700' },
  scannerSubtitle: { maxWidth: 260, color: 'rgba(255,255,255,0.78)', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 5 },
  viewfinder: { width: 280, height: 280, borderRadius: 52, overflow: 'hidden', backgroundColor: 'rgba(21,32,45,0.65)', alignItems: 'center', justifyContent: 'center', ...theme.shadows.lg },
  bracket: { position: 'absolute', width: 34, height: 34, borderColor: 'rgba(255,255,255,0.88)', borderWidth: 3 },
  topLeft: { top: 22, left: 22, borderRightWidth: 0, borderBottomWidth: 0 },
  topRight: { top: 22, right: 22, borderLeftWidth: 0, borderBottomWidth: 0 },
  bottomLeft: { bottom: 22, left: 22, borderRightWidth: 0, borderTopWidth: 0 },
  bottomRight: { bottom: 22, right: 22, borderLeftWidth: 0, borderTopWidth: 0 },
  scanLine: { position: 'absolute', left: 24, right: 24, top: 138, height: 2, backgroundColor: theme.colors.accent, opacity: 0.9 },
  viewfinderHint: { alignItems: 'center', gap: 5 },
  hintPrimary: { color: theme.colors.surface, fontSize: 14, fontWeight: '700' },
  hintSecondary: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
  resolving: { color: theme.colors.surface, marginTop: 18, fontSize: 13 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.52)' },
  modalCard: { padding: 24, paddingBottom: 30, borderTopLeftRadius: theme.radii.lg, borderTopRightRadius: theme.radii.lg, backgroundColor: theme.colors.surface, gap: 14 },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  modalTitle: { color: theme.colors.fg, fontSize: 20, fontWeight: '700' },
  modalSubtitle: { color: theme.colors.muted, fontSize: 13, marginTop: 4 },
  itemRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border, flexDirection: 'row', justifyContent: 'space-between' },
  itemName: { color: theme.colors.fg, fontSize: 14, fontWeight: '600' },
  itemQuantity: { color: theme.colors.muted, fontSize: 14, fontFamily: theme.typography.fontMono },
  expiry: { minHeight: 42, paddingHorizontal: 12, borderRadius: theme.radii.sm, backgroundColor: theme.colors.statusGoodTint, flexDirection: 'row', alignItems: 'center', gap: 8 },
  expiryExpired: { backgroundColor: theme.colors.statusBadTint },
  expiryText: { color: theme.colors.statusGoodDeep, fontSize: 13, fontWeight: '600' },
  expiryTextExpired: { color: theme.colors.statusBadDeep },
  confirmButton: { minHeight: 50, borderRadius: theme.radii.md, backgroundColor: theme.colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  confirmText: { color: theme.colors.surface, fontSize: 14, fontWeight: '700' },
  cancelButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: theme.colors.muted, fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.45 },
});
