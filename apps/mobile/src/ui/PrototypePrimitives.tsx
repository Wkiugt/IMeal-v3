import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import { theme } from '../theme';

export type PrototypeIcon = LucideIcon;

export function PrototypeCard({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function Pill({ children, tone = 'soft' }: { children: React.ReactNode; tone?: 'soft' | 'good' | 'warn' | 'bad' | 'outline' }) {
  return <View style={[styles.pill, styles[`pill_${tone}`]]}>{children}</View>;
}

export function PillText({ children }: { children: React.ReactNode }) {
  return <Text style={styles.pillText}>{children}</Text>;
}

export function Avatar({ initials, large = false }: { initials: string; large?: boolean }) {
  return <View style={[styles.avatar, large && styles.avatarLarge]}><Text style={styles.avatarText}>{initials}</Text></View>;
}

export function PrototypeButton({ children, icon: Icon, onPress, variant = 'primary', disabled = false, style }: { children: React.ReactNode; icon?: PrototypeIcon; onPress?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, styles[`button_${variant}`], pressed && styles.buttonPressed, disabled && styles.buttonDisabled, style]}>{Icon && <Icon size={18} color={variant === 'primary' ? theme.colors.surface : theme.colors.fg} strokeWidth={1.8} />}<Text style={[styles.buttonText, variant === 'primary' && styles.buttonTextPrimary]}>{children}</Text></Pressable>;
}

export function PrototypeField({ label, icon: Icon, style, ...props }: TextInputProps & { label?: string; icon?: PrototypeIcon; style?: StyleProp<ViewStyle> }) {
  return <View style={style}>{label && <Text style={styles.fieldLabel}>{label}</Text>}<View style={styles.fieldInputWrap}>{Icon && <Icon size={17} color={theme.colors.muted} strokeWidth={1.7} />}<TextInput {...props} placeholderTextColor={theme.colors.muted} style={styles.fieldInput} /></View></View>;
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.lg, padding: theme.spacing.card, ...theme.shadows.sm },
  eyebrow: { color: theme.colors.muted, fontSize: 11, fontFamily: theme.typography.bold, letterSpacing: 1.2 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radii.pill },
  pill_soft: { backgroundColor: theme.colors.accentSoft },
  pill_good: { backgroundColor: theme.colors.statusGoodTint },
  pill_warn: { backgroundColor: theme.colors.statusWarnTint },
  pill_bad: { backgroundColor: theme.colors.statusBadTint },
  pill_outline: { borderWidth: 1, borderColor: theme.colors.border },
  pillText: { color: theme.colors.fg, fontSize: 12, fontFamily: theme.typography.semiBold },
  avatar: { width: 40, height: 40, borderRadius: theme.radii.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.accentSoft },
  avatarLarge: { width: 64, height: 64 },
  avatarText: { color: theme.colors.accentDeep, fontSize: 14, fontFamily: theme.typography.bold },
  button: { minHeight: 48, paddingHorizontal: 18, borderRadius: theme.radii.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  button_primary: { backgroundColor: theme.colors.accentDeep, ...theme.shadows.md },
  button_secondary: { backgroundColor: theme.colors.accentTint, borderWidth: 1, borderColor: theme.colors.accentSoft },
  button_ghost: { backgroundColor: 'transparent' },
  button_danger: { backgroundColor: theme.colors.statusBadTint },
  buttonPressed: { transform: [{ scale: 0.98 }] },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: theme.colors.fg, fontSize: 14, fontFamily: theme.typography.bold },
  buttonTextPrimary: { color: theme.colors.surface },
  fieldLabel: { color: theme.colors.fg, fontSize: 13, fontFamily: theme.typography.bold, marginBottom: 8 },
  fieldInputWrap: { minHeight: 48, paddingHorizontal: 14, gap: 9, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.sm, backgroundColor: theme.colors.surface },
  fieldInput: { flex: 1, color: theme.colors.fg, fontFamily: theme.typography.regular, fontSize: 14, paddingVertical: 0 },
});
