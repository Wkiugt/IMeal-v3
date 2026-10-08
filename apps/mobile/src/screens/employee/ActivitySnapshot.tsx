import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { CalendarDays, MapPin } from 'lucide-react-native';
import type { v1 } from '@imeal/contracts';
import type { Translate } from '../../i18n/translations';
import { formatBusinessInstant } from '../../businessDate';
import { AppText } from '../../ui/components';
import { designTokens } from '../../ui/designTokens';
import { getSnapshotValue } from './employeeActivityState';

type Props = {
  item: v1.EmployeeRegistrationActivityBase;
  locale: 'vi-VN' | 'en-US';
  t: Translate;
};

type SnapshotLineProps = {
  label: string;
  value: string | null | undefined;
  fallback: string;
};

function SnapshotLine({
  label,
  value,
  fallback,
}: SnapshotLineProps): React.JSX.Element {
  return (
    <View style={styles.line}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText variant="supporting">
        {getSnapshotValue(value, fallback)}
      </AppText>
    </View>
  );
}

type TimestampLineProps = {
  label: string;
  value: string | null;
  locale: 'vi-VN' | 'en-US';
  fallback: string;
};

function TimestampLine({
  label,
  value,
  locale,
  fallback,
}: TimestampLineProps): React.JSX.Element {
  return (
    <View style={styles.line}>
      <AppText variant="caption" tone="secondary">
        {label}
      </AppText>
      <AppText variant="supporting">
        {value ? formatBusinessInstant(value, locale) : fallback}
      </AppText>
    </View>
  );
}

export function ActivitySnapshot({
  item,
  locale,
  t,
}: Props): React.JSX.Element {
  const imageUri = item.menuImageSnapshot?.trim();
  const [imageErrorUri, setImageErrorUri] = useState<string | null>(null);
  const imageFailed = imageUri !== null && imageErrorUri === imageUri;
  useEffect(() => {
    setImageErrorUri((current) => (current === imageUri ? current : null));
  }, [imageUri]);
  const unavailable = t('activity.snapshotUnavailable');
  return (
    <View style={styles.container} accessibilityRole="summary">
      <View style={styles.headingLine}>
        <CalendarDays
          size={16}
          color={designTokens.color.text.secondary}
          strokeWidth={1.9}
        />
        <AppText variant="supporting">
          {getSnapshotValue(
            item.menuNameSnapshot,
            t('activity.menuUnavailable'),
          )}
        </AppText>
      </View>
      <SnapshotLine
        label={t('activity.menuDescription')}
        value={item.menuDescriptionSnapshot}
        fallback={unavailable}
      />
      {imageUri && !imageFailed ? (
        <Image
          source={{ uri: imageUri }}
          accessibilityLabel={t('activity.menuImage')}
          onError={() => setImageErrorUri(imageUri)}
          style={styles.menuImage}
        />
      ) : (
        <SnapshotLine
          label={t('activity.menuImage')}
          value={null}
          fallback={unavailable}
        />
      )}
      <View style={styles.headingLine}>
        <MapPin
          size={16}
          color={designTokens.color.text.secondary}
          strokeWidth={1.9}
        />
        <AppText variant="supporting">{t('activity.locationSnapshot')}</AppText>
      </View>
      <SnapshotLine
        label={t('activity.locationName')}
        value={item.serviceLocationName}
        fallback={t('activity.locationUnavailable')}
      />
      <SnapshotLine
        label={t('activity.locationAddress')}
        value={item.serviceLocationAddress}
        fallback={t('activity.locationUnavailable')}
      />
      <SnapshotLine
        label={t('activity.locationCode')}
        value={item.serviceLocationCode}
        fallback={unavailable}
      />
      <TimestampLine
        label={t('activity.locationEffectiveFrom')}
        value={item.serviceLocationEffectiveFrom}
        locale={locale}
        fallback={unavailable}
      />
      <TimestampLine
        label={t('activity.locationSnapshotAt')}
        value={item.serviceLocationSnapshotAt}
        locale={locale}
        fallback={unavailable}
      />
      <TimestampLine
        label={t('activity.registeredAt')}
        value={item.registeredAt}
        locale={locale}
        fallback={unavailable}
      />
      <TimestampLine
        label={t('activity.cancelledAt')}
        value={item.cancelledAt}
        locale={locale}
        fallback={unavailable}
      />
      <TimestampLine
        label={t('activity.noShowAt')}
        value={item.noShowAt}
        locale={locale}
        fallback={unavailable}
      />
      <TimestampLine
        label={t('activity.servedAt')}
        value={item.servedAt}
        locale={locale}
        fallback={unavailable}
      />
      <TimestampLine
        label={t('activity.createdAt')}
        value={item.createdAt}
        locale={locale}
        fallback={unavailable}
      />
      <TimestampLine
        label={t('activity.updatedAt')}
        value={item.updatedAt}
        locale={locale}
        fallback={unavailable}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: designTokens.space.sm },
  headingLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  line: { gap: designTokens.space.xs },
  menuImage: {
    width: '100%',
    height: 132,
    borderRadius: designTokens.radius.card,
    backgroundColor: designTokens.color.surface.elevated,
  },
});
