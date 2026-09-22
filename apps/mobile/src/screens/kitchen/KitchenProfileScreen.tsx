import React, { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { Languages } from 'lucide-react-native';
import type { AppTabScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { initials } from '../../businessDate';
import { StatisticsCard } from '../../ui/components';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { useNotice } from '../../ui/BrandNotice';
import { useLanguage } from '../../i18n/LanguageProvider';
import {
  ProfileIdentity,
  ProfileLanguageSheet,
  ProfileLogoutModal,
  ProfileNavigationSettingRow,
  ProfileSettingsGroup,
  ProfileSignOutEntry,
} from '../profile/ProfileComposition';

type Props = AppTabScreenProps<'KitchenProfile'>;

export function KitchenProfileScreen(_props: Props) {
  const { profile, logout } = useSession();
  const { showNotice } = useNotice();
  const { language, setLanguage, t } = useLanguage();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const [languageSheetVisible, setLanguageSheetVisible] = useState(false);
  const [signOutModalVisible, setSignOutModalVisible] = useState(false);
  const displayName = profile?.name || profile?.email.split('@')[0] || t('profile.kitchenAccount');
  const userCode = profile?.userId || profile?.id || '—';

  const handleLogout = () => {
    setSignOutModalVisible(true);
  };

  const handleConfirmLogout = () => {
    setSignOutModalVisible(false);
    void logout();
  };

  const handleLanguageChange = async (nextLanguage: 'vi' | 'en') => {
    if (nextLanguage === language) {
      setLanguageSheetVisible(false);
      return;
    }
    try {
      await setLanguage(nextLanguage);
    } catch {
      showNotice({
        title: t('common.error'),
        message: t('profile.languagePersistenceFailed'),
        tone: 'warning',
      });
      return;
    }
    setLanguageSheetVisible(false);
  };

  return (
    <AppFrame>
      <SectionHeader title={t('profile.title')} subtitle={t('profile.kitchenSubtitle')} />

      <ProfileIdentity
        initials={initials(profile?.name, 'ME')}
        name={displayName}
        roleLabel={t('profile.kitchenAccount')}
        identifier={userCode}
      />

      <ProfileSettingsGroup label={t('profile.groupStatistics')} surface={false}>
        <StatisticsCard
          eyebrow={t('profile.thisMonth')}
          metrics={[
            { label: t('profile.mealsBooked'), value: '—', tone: 'neutral' },
            { label: t('profile.mealsEnjoyed'), value: '—', tone: 'neutral' },
          ]}
        />
      </ProfileSettingsGroup>

      <ProfileSettingsGroup label={t('profile.groupApp')}>
        <ProfileNavigationSettingRow
          icon={Languages}
          title={t('profile.language')}
          currentValue={language === 'vi' ? t('profile.vietnamese') : t('profile.english')}
          onPress={() => setLanguageSheetVisible(true)}
          compactLayout={compactLayout}
        />
      </ProfileSettingsGroup>

      <ProfileSignOutEntry
        label={t('profile.signOut')}
        accessibilityHint={t('profile.signOutHint')}
        onPress={handleLogout}
      />

      <ProfileLanguageSheet
        visible={languageSheetVisible}
        language={language}
        title={t('profile.language')}
        closeLabel={t('profile.closeLanguage')}
        labels={{ vi: t('profile.vietnamese'), en: t('profile.english') }}
        onClose={() => setLanguageSheetVisible(false)}
        onSelect={(nextLanguage) => void handleLanguageChange(nextLanguage)}
      />

      <ProfileLogoutModal
        visible={signOutModalVisible}
        title={t('profile.signOut')}
        message={t('profile.signOutConfirm')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('profile.signOut')}
        processingLabel={t('common.processing')}
        processing={false}
        onClose={() => setSignOutModalVisible(false)}
        onConfirm={handleConfirmLogout}
      />
    </AppFrame>
  );
}
