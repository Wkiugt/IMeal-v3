import React from 'react';
import { Alert, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Check, LogOut } from 'lucide-react-native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { initials } from '../../businessDate';
import {
  ActionButton,
  AppText,
  Divider,
  IdentityCard,
  StatisticsCard,
  Surface,
} from '../../ui/components';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import { designTokens } from '../../ui/designTokens';

type Props = AppTabScreenProps<'KitchenProfile'>;

export function KitchenProfileScreen(_props: Props) {
  const { profile, logout } = useSession();
  const { showNotice } = useNotice();
  const { language, setLanguage, t } = useLanguage();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
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
    <AppFrame>
      <SectionHeader title={t('profile.title')} subtitle={t('profile.kitchenSubtitle')} />

      <IdentityCard
        initials={initials(profile?.name, 'ME')}
        name={displayName}
        roleLabel={t('profile.kitchenAccount')}
        identifier={userCode}
        style={styles.identityCard}
      />

      <StatisticsCard
        eyebrow={t('profile.thisMonth')}
        metrics={[
          { label: t('profile.mealsBooked'), value: '—', tone: 'neutral' },
          { label: t('profile.mealsEnjoyed'), value: '—', tone: 'neutral' },
        ]}
        style={styles.statsCard}
      />

      <Surface level={1} padding="xl" style={styles.preferencesCard}>
        <View style={styles.languageSection}>
          <View style={styles.preferenceCopy}>
            <AppText variant="body">{t('profile.language')}</AppText>
            <AppText variant="supporting" tone="secondary" style={styles.preferenceHint}>
              {t('profile.languageHint')}
            </AppText>
          </View>
          <View
            style={[styles.languageSelector, compactLayout && styles.languageSelectorCompact]}
            accessibilityLabel={t('profile.language')}
          >
            {([
              ['vi', 'profile.vietnamese'],
              ['en', 'profile.english'],
            ] as const).map(([nextLanguage, labelKey]) => {
              const selected = language === nextLanguage;
              return (
                <Pressable
                  key={nextLanguage}
                  accessibilityRole="radio"
                  style={[styles.languageOption, compactLayout && styles.languageOptionCompact, selected && styles.languageOptionSelected]}
                  accessibilityState={{ checked: selected }}
                  onPress={() => void handleLanguageChange(nextLanguage)}
                >
                  {selected ? <Check size={16} color={designTokens.color.brand.primary} strokeWidth={2.4} /> : null}
                  <AppText variant="buttonLabel" tone={selected ? 'information' : 'secondary'}>
                    {t(labelKey)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      </Surface>

      <Divider style={styles.logoutDivider} />
      <ActionButton
        variant="critical"
        size="md"
        label={t('auth.logOut')}
        icon={LogOut}
        onPress={handleLogout}
        style={styles.logout}
      />
    </AppFrame>
  );
}
const styles = StyleSheet.create({
  identityCard: { marginBottom: designTokens.space.lg },
  statsCard: { marginBottom: designTokens.space.lg },
  preferencesCard: { gap: designTokens.space.lg },
  languageSection: { gap: designTokens.space.sm },
  preferenceCopy: { flex: 1, minWidth: 0 },
  preferenceHint: { marginTop: designTokens.space.xs },
  languageSelector: {
    flexDirection: 'row',
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    borderRadius: designTokens.radius.smallControl,
    overflow: 'hidden',
  },
  languageSelectorCompact: { flexDirection: 'column' },
  languageOption: {
    flex: 1,
    minHeight: designTokens.size.touchMin,
    paddingHorizontal: designTokens.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: designTokens.space.xs,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.surface.standard,
  },
  languageOptionCompact: { width: '100%', flex: 0 },
  languageOptionSelected: {
    backgroundColor: designTokens.color.brand.tint,
    borderWidth: designTokens.border.selected.width,
    borderColor: designTokens.color.border.selected,
  },
  logoutDivider: { marginTop: designTokens.space.lg },
  logout: { marginBottom: designTokens.space.lg },
});
