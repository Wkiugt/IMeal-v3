import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Check, Clock3, Square } from 'lucide-react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation';
import { useSession } from '../../auth/session';
import { pickupAPI, type PickupOption } from '../../api/pickupAPI';
import { initials } from '../../businessDate';
import { Avatar, Eyebrow, Pill, PillText, PrototypeCard } from '../../ui/PrototypePrimitives';
import { PrototypeFrame, employeeNav, hybridEmployeeNav, PrototypeSectionTitle } from '../../ui/PrototypeShell';
import { theme } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PickupIntent'>;

export function PickupIntentScreen({ navigation }: Props) {
  const { token, profile, canUseKitchen } = useSession();
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<PickupOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [qrValue, setQrValue] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const progressAnim = useRef(new Animated.Value(1)).current;

  const fetchOptions = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const response = await pickupAPI.getPickupOptions(token);
      setOptions(response.options);
      setSelectedIds((current) => current.size > 0 ? new Set([...current].filter((id) => response.options.some((option) => option.registrationId === id))) : new Set(response.options[0] ? [response.options[0].registrationId] : []));
    } catch (error: unknown) {
      Alert.alert('Pickup unavailable', error instanceof Error ? error.message : 'Unable to load pickup options');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { void fetchOptions(); }, [fetchOptions]));

  useEffect(() => {
    if (!isGenerating || !token) {
      setQrValue(null);
      return;
    }
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let countdownTimer: ReturnType<typeof setInterval> | undefined;
    const refresh = async () => {
      if (cancelled) return;
      const ids = Array.from(selectedIds);
      if (ids.length === 0) { setIsGenerating(false); return; }
      try {
        setQrLoading(true);
        const response = await pickupAPI.generateQr(token, ids);
        if (cancelled) return;
        const ttl = response.ttl > 0 ? response.ttl : 5;
        setQrValue(response.qr);
        setTimeLeft(ttl);
        progressAnim.setValue(1);
        Animated.timing(progressAnim, { toValue: 0, duration: ttl * 1000, useNativeDriver: false }).start();
        refreshTimer = setTimeout(() => { void refresh(); }, ttl * 1000);
      } catch (error: unknown) {
        if (!cancelled) {
          Alert.alert('QR unavailable', error instanceof Error ? error.message : 'Unable to generate QR code');
          setIsGenerating(false);
        }
      } finally {
        if (!cancelled) setQrLoading(false);
      }
    };
    void refresh();
    countdownTimer = setInterval(() => setTimeLeft((current) => Math.max(0, current - 1)), 1000);
    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (countdownTimer) clearInterval(countdownTimer);
      progressAnim.stopAnimation();
    };
  }, [isGenerating, progressAnim, selectedIds, token]);

  const toggleSelection = (registrationId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(registrationId)) next.delete(registrationId); else next.add(registrationId);
      return next;
    });
  };

  const navItems = canUseKitchen ? hybridEmployeeNav : employeeNav;
  const go = (route: keyof RootStackParamList) => navigation.navigate(route as never);
  const displayName = profile?.name || profile?.email.split('@')[0] || 'Employee';

  return (
    <PrototypeFrame activeRoute="PickupIntent" navItems={navItems} onNavigate={go}>
      <PrototypeSectionTitle title="Meal Ticket" subtitle="Show this dynamic QR code to the kitchen staff" />
      {loading ? <ActivityIndicator color={theme.colors.accentDeep} style={styles.loader} /> : options.length === 0 ? (
        <PrototypeCard style={styles.emptyCard}><Text style={styles.emptyTitle}>No meals ready to pick up</Text><Text style={styles.emptyText}>Register a meal in Calendar before generating a ticket.</Text></PrototypeCard>
      ) : (
        <>
          <PrototypeCard style={styles.selectionCard}>
            <View style={styles.selectionHeader}><Eyebrow>MEALS TO PICK UP</Eyebrow><Text style={styles.selectionHint}>Select one or more</Text></View>
            {options.map((option) => {
              const selected = selectedIds.has(option.registrationId);
              return <Pressable key={option.registrationId} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggleSelection(option.registrationId)} style={[styles.optionRow, selected && styles.optionSelected]}>{selected ? <Check size={20} color={theme.colors.accentDeep} /> : <Square size={20} color={theme.colors.muted} />}<View style={styles.optionCopy}><Text style={styles.optionTitle}>{option.type === 'OWN' ? 'My meal' : 'Delegated meal'}</Text><Text style={styles.optionDate}>{option.mealDate.slice(0, 10)}{option.owner ? ` · From ${option.owner.name}` : ''}</Text></View></Pressable>;
            })}
          </PrototypeCard>
          <PrototypeCard style={styles.ticketCard}>
            <View style={styles.ticketTop}>
              {qrValue ? <QRCode value={qrValue} size={200} color={theme.colors.fg} backgroundColor={theme.colors.surface} /> : <View style={styles.qrPlaceholder}><ActivityIndicator color={theme.colors.accentDeep} /></View>}
              <Avatar initials={initials(profile?.name, 'ME')} />
              <Text style={styles.ticketName}>{displayName}</Text>
              <Text style={styles.ticketId}>{profile?.userId || profile?.id || '—'}</Text>
            </View>
            <View style={styles.perforation} />
            <View style={styles.progressTrack}><Animated.View style={[styles.progressFill, { transform: [{ scaleX: progressAnim }] }]} /></View>
            <View style={styles.ticketBottom}><View style={styles.ticketRow}><Text style={styles.ticketKey}>Meal</Text><Text style={styles.ticketValue}>Lunch</Text></View><View style={styles.ticketRow}><Text style={styles.ticketKey}>Selected</Text><Text style={styles.ticketValue}>{selectedIds.size} meal{selectedIds.size === 1 ? '' : 's'}</Text></View><View style={styles.ticketNote}><Clock3 size={15} color={theme.colors.accentDeep} /><Text style={styles.ticketNoteText}>{qrLoading ? 'Refreshing code…' : `Code refreshes in ${timeLeft}s`}</Text></View></View>
          </PrototypeCard>
          <Pressable accessibilityRole="button" disabled={selectedIds.size === 0} onPress={() => setIsGenerating((current) => !current)} style={[styles.generateButton, selectedIds.size === 0 && styles.disabled]}><Text style={styles.generateText}>{isGenerating ? 'Pause ticket' : 'Generate ticket'}</Text></Pressable>
        </>
      )}
    </PrototypeFrame>
  );
}

const styles = StyleSheet.create({
  loader: { marginVertical: 44 },
  emptyCard: { marginTop: 20 },
  emptyTitle: { color: theme.colors.fg, fontSize: 17, fontWeight: '700' },
  emptyText: { color: theme.colors.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  selectionCard: { marginBottom: 16 },
  selectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 },
  selectionHint: { color: theme.colors.muted, fontSize: 12 },
  optionRow: { minHeight: 52, paddingVertical: 9, paddingHorizontal: 10, borderRadius: theme.radii.sm, flexDirection: 'row', alignItems: 'center', gap: 10 },
  optionSelected: { backgroundColor: theme.colors.accentTint },
  optionCopy: { flex: 1, gap: 3 },
  optionTitle: { color: theme.colors.fg, fontSize: 14, fontWeight: '700' },
  optionDate: { color: theme.colors.muted, fontSize: 12 },
  ticketCard: { padding: 0, overflow: 'hidden', marginBottom: 16 },
  ticketTop: { padding: 26, alignItems: 'center', gap: 10 },
  qrPlaceholder: { width: 200, height: 200, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentTint },
  ticketName: { color: theme.colors.fg, fontSize: 17, fontWeight: '700', marginTop: 4 },
  ticketId: { color: theme.colors.muted, fontFamily: theme.typography.fontMono, fontSize: 13 },
  perforation: { height: 1, marginHorizontal: 14, borderTopWidth: 2, borderTopColor: theme.colors.border, borderStyle: 'dashed' },
  progressTrack: { height: 4, marginHorizontal: 26, overflow: 'hidden', backgroundColor: theme.colors.accentTint },
  progressFill: { width: '100%', height: '100%', backgroundColor: theme.colors.accentDeep, transformOrigin: 'left' },
  ticketBottom: { padding: 22, gap: 14 },
  ticketRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ticketKey: { color: theme.colors.muted, fontSize: 13 },
  ticketValue: { color: theme.colors.fg, fontSize: 13, fontWeight: '600' },
  ticketNote: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  ticketNoteText: { color: theme.colors.muted, fontSize: 12 },
  generateButton: { minHeight: 48, marginBottom: 16, borderRadius: theme.radii.md, backgroundColor: theme.colors.accentDeep, alignItems: 'center', justifyContent: 'center' },
  generateText: { color: theme.colors.surface, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
