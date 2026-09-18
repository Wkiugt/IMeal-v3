import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, LogOut } from 'lucide-react-native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { initials } from '../../businessDate';
import { Avatar, Pill, PillText, PrototypeCard } from '../../ui/PrototypePrimitives';
import { PrototypeFrame } from '../../ui/PrototypeShell';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import { theme } from '../../theme';

type Props = AppTabScreenProps<'KitchenProfile'>;

export function KitchenProfileScreen(_props: Props) {
  const { profile, logout } = useSession();
  const { showNotice } = useNotice();
  const { language, setLanguage, t } = useLanguage();
  const displayName = profile?.name || profile?.email.split('@')[0] || t('profile.kitchenAccount');
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
      <View style={styles.title}>
        <Text style={styles.heading}>{t('profile.title')}</Text>
        <Text style={styles.subtitle}>{t('profile.kitchenSubtitle')}</Text>
      </View>
      <PrototypeCard style={styles.identityCard}>
        <Avatar initials={initials(profile?.name, 'ME')} large />
        <View style={styles.identityInfo}>
          <Text style={styles.identityName}>{displayName}</Text>
          <Pill><PillText>{userCode}</PillText></Pill>
          <Text style={styles.identityDept}>{t('profile.kitchenAccount')}</Text>
        </View>
      </PrototypeCard>
      <PrototypeCard style={styles.preferencesCard}>
        <View style={styles.languageRow}>
          <View style={styles.preferenceCopy}>
            <Text style={styles.preferenceLabel}>{t('profile.language')}</Text>
            <Text style={styles.preferenceSub}>{t('profile.languageHint')}</Text>
          </View>
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
      <Pressable accessibilityRole="button" accessibilityLabel={t('auth.logOut')} onPress={handleLogout} style={styles.logout}>
        <LogOut size={18} color={theme.colors.statusBadDeep} strokeWidth={1.6} />
        <Text style={styles.logoutText}>{t('auth.logOut')}</Text>
      </Pressable>
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
  preferencesCard: { gap: 18, marginBottom: 16 },
  languageRow: { gap: 8 },
  languageSelector: { flexDirection: 'row', borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.sm, overflow: 'hidden' },
  languageOption: { flex: 1, minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  languageOptionSelected: { backgroundColor: theme.colors.accentTint },
  languageOptionText: { color: theme.colors.muted, fontSize: 13, fontFamily: theme.typography.regular },
  languageOptionTextSelected: { color: theme.colors.accentDeep, fontFamily: theme.typography.bold },
  preferenceCopy: { flex: 1 },
  preferenceLabel: { color: theme.colors.fg, fontSize: 14, fontFamily: theme.typography.semiBold },
  preferenceSub: { marginTop: 4, color: theme.colors.muted, fontSize: 12, fontFamily: theme.typography.regular },
  logout: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  logoutText: { color: theme.colors.statusBadDeep, fontSize: 14, fontFamily: theme.typography.bold },
});
