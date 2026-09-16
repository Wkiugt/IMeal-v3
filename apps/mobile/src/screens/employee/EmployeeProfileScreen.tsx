import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Check, ChevronRight, LogOut, UsersRound } from 'lucide-react-native';
import type { ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { initials } from '../../businessDate';
import { Avatar, Eyebrow, Pill, PillText, PrototypeCard } from '../../ui/PrototypePrimitives';
import { PrototypeFrame } from '../../ui/PrototypeShell';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import { theme } from '../../theme';
type Props = ProfileStackScreenProps<'ProfileHome'>;

export function EmployeeProfileScreen({ navigation }: Props) {
  const { profile, logout } = useSession();
  const { showNotice } = useNotice();
  const { language, setLanguage, t } = useLanguage();
  const [reminders, setReminders] = useState(true);
  const displayName = profile?.name || profile?.email.split('@')[0] || t('profile.employeeAccount');
  const userCode = profile?.userId || profile?.id || '—';

  const handleLogout = () => {
    Alert.alert(t('auth.logOut'), t('profile.logOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('auth.logOut'), style: 'destructive', onPress: () => void logout() },
    ]);
  };

  const handleLanguageChange = async (nextLanguage: 'vi' | 'en') => {
    if (nextLanguage === language) return;
    try {
      await setLanguage(nextLanguage);
    } catch {
      showNotice({
        title: t('common.error'),
        message: t('profile.languagePersistenceFailed'),
        tone: 'warning',
      });
    }
  };

  return (
    <PrototypeFrame>
      <View style={styles.title}><Text style={styles.heading}>{t('profile.title')}</Text><Text style={styles.subtitle}>{t('profile.subtitle')}</Text></View>
      <PrototypeCard style={styles.identityCard}>
        <Avatar initials={initials(profile?.name, 'ME')} large />
        <View style={styles.identityInfo}><Text style={styles.identityName}>{displayName}</Text><Pill><PillText>{userCode}</PillText></Pill><Text style={styles.identityDept}>{t('profile.employeeAccount')}</Text></View>
      </PrototypeCard>
      <PrototypeCard style={styles.statsCard}>
        <Eyebrow>{t('profile.thisMonth')}</Eyebrow>
        <View style={styles.statsRow}><View style={styles.stat}><Text style={styles.statNumber}>—</Text><Text style={styles.statLabel}>{t('profile.mealsBooked')}</Text></View><View style={styles.statDivider} /><View style={styles.stat}><Text style={styles.statNumber}>—</Text><Text style={styles.statLabel}>{t('profile.mealsEnjoyed')}</Text></View></View>
      </PrototypeCard>
      <PrototypeCard style={styles.preferencesCard}>
        <View style={styles.preferenceRow}><View><Text style={styles.preferenceLabel}>{t('profile.dietaryPreferences')}</Text><Text style={styles.preferenceSub}>{t('profile.managedByAccount')}</Text></View><Pill><PillText>{t('profile.notSet')}</PillText></Pill></View>
        <View style={styles.divider} />
        <View style={styles.preferenceRow}><View style={styles.preferenceCopy}><Text style={styles.preferenceLabel}>{t('profile.bookingReminders')}</Text><Text style={styles.preferenceSub}>{t('profile.remindersHint')}</Text></View><Switch accessibilityLabel={t('profile.bookingReminders')} value={reminders} onValueChange={setReminders} trackColor={{ false: theme.colors.border, true: theme.colors.accentDeep }} thumbColor={theme.colors.surface} /></View>
        <View style={styles.divider} />
        <View style={styles.languageRow}>
          <View style={styles.preferenceCopy}><Text style={styles.preferenceLabel}>{t('profile.language')}</Text><Text style={styles.preferenceSub}>{t('profile.languageHint')}</Text></View>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('profile.language')} style={styles.languageSelector}>
            {([
              ['vi', 'profile.vietnamese'],
              ['en', 'profile.english'],
            ] as const).map(([nextLanguage, labelKey]) => {
              const selected = language === nextLanguage;
              return (
                <Pressable
                  key={nextLanguage}
                  accessibilityRole="radio"
                  accessibilityLabel={t(labelKey)}
                  accessibilityState={{ checked: selected }}
                  onPress={() => void handleLanguageChange(nextLanguage)}
                  style={[styles.languageOption, selected && styles.languageOptionSelected]}
                >
                  {selected && <Check size={14} color={theme.colors.accentDeep} strokeWidth={2.4} />}
                  <Text style={[styles.languageOptionText, selected && styles.languageOptionTextSelected]}>{t(labelKey)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </PrototypeCard>
      <Pressable accessibilityRole="button" accessibilityLabel={t('profile.delegations')} onPress={() => navigation.navigate('Delegation')} style={styles.delegationRow}><View style={styles.delegationIcon}><UsersRound size={18} color={theme.colors.accentDeep} /></View><View style={styles.delegationCopy}><Text style={styles.delegationLabel}>{t('profile.delegations')}</Text><Text style={styles.delegationSub}>{t('profile.delegationsHint')}</Text></View><ChevronRight size={18} color={theme.colors.muted} /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('auth.logOut')} onPress={handleLogout} style={styles.logout}><LogOut size={18} color={theme.colors.statusBadDeep} strokeWidth={1.6} /><Text style={styles.logoutText}>{t('auth.logOut')}</Text></Pressable>
    </PrototypeFrame>
  );
}

const styles = StyleSheet.create({
  title: { paddingVertical: 18, gap: 5 },
  heading: { color: theme.colors.fg, fontSize: 24, fontFamily: theme.typography.bold },
  subtitle: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular, lineHeight: 19 },
  identityCard: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  identityInfo: { flex: 1, gap: 7 },
  identityName: { color: theme.colors.fg, fontSize: 18, fontFamily: theme.typography.bold },
  identityDept: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular },
  statsCard: { marginBottom: 16 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  stat: { flex: 1, gap: 4 },
  statNumber: { color: theme.colors.fg, fontSize: 30, fontFamily: theme.typography.bold },
  statLabel: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular },
  statDivider: { width: 1, height: 40, backgroundColor: theme.colors.border },
  preferencesCard: { gap: 18, marginBottom: 16 },
  preferenceRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  languageRow: { gap: 8 },
  languageSelector: { flexDirection: 'row', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.sm, overflow: 'hidden' },
  languageOption: { flex: 1, minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  languageOptionSelected: { backgroundColor: theme.colors.accentTint },
  languageOptionText: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular },
  languageOptionTextSelected: { color: theme.colors.accentDeep, fontFamily: theme.typography.bold },
  preferenceCopy: { flex: 1 },
  preferenceLabel: { color: theme.colors.fg, fontSize: 14, fontFamily: theme.typography.semiBold },
  preferenceSub: { marginTop: 4, color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular },
  divider: { height: 1, backgroundColor: theme.colors.border },
  delegationRow: { minHeight: 68, paddingHorizontal: 16, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.md, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  delegationIcon: { width: 36, height: 36, borderRadius: theme.radii.sm, backgroundColor: theme.colors.accentTint, alignItems: 'center', justifyContent: 'center' },
  delegationCopy: { flex: 1 },
  delegationLabel: { color: theme.colors.fg, fontSize: 14, fontFamily: theme.typography.bold },
  delegationSub: { color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular, marginTop: 3 },
  logout: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  logoutText: { color: theme.colors.statusBadDeep, fontSize: 14, fontFamily: theme.typography.bold },
});
