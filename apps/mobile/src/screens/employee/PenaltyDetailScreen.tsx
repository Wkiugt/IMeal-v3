import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { ArrowLeft, FileWarning } from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { Translate } from '../../i18n/translations';
import {
  employeeActivityAPI,
  type SelfPenalty,
} from '../../api/employeeActivityAPI';
import { ActivitySnapshot } from './ActivitySnapshot';
import {
  MobileApiError,
  getMobileErrorMessage,
} from '../../api/mobileApiError';
import {
  formatVnd,
  getActivityStatusTone,
  getPenaltyStatusTone,
} from './employeeActivityState';
import {
  formatBusinessInstant,
  formatShortDate,
  parseDateKey,
} from '../../businessDate';
import {
  ActionButton,
  AppText,
  StatusBadge,
  Surface,
} from '../../ui/components';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { designTokens } from '../../ui/designTokens';

type Props = ProfileStackScreenProps<'PenaltyDetail'>;
function canPopOwnProfileStack(
  navigation: Props['navigation'],
  routeName: 'PenaltyDetail',
): boolean {
  const state = navigation.getState();
  return (
    state.type === 'stack' &&
    state.index > 0 &&
    state.routes[state.index]?.name === routeName
  );
}

type TimestampRowProps = {
  label: string;
  value: string | null;
  locale: 'vi-VN' | 'en-US';
};

function TimestampRow({
  label,
  value,
  locale,
}: TimestampRowProps): React.JSX.Element | null {
  if (!value) return null;
  return (
    <View style={styles.detailLine}>
      <AppText variant="supporting" tone="secondary">
        {label}
      </AppText>
      <AppText variant="supporting">
        {formatBusinessInstant(value, locale)}
      </AppText>
    </View>
  );
}

function statusLabel(status: SelfPenalty['status'], t: Translate): string {
  const keys: Record<SelfPenalty['status'], Parameters<Translate>[0]> = {
    PENDING: 'activity.status.pending',
    PAID: 'activity.status.paid',
    WAIVED: 'activity.status.waived',
  };
  return t(keys[status]);
}

function registrationStatusLabel(
  status: NonNullable<SelfPenalty['registration']>['status'],
  t: Translate,
): string {
  const keys: Record<typeof status, Parameters<Translate>[0]> = {
    ACTIVE: 'activity.status.active',
    CANCELLED: 'activity.status.cancelled',
    SERVED: 'activity.status.served',
    NO_SHOW: 'activity.status.noShow',
  };
  return t(keys[status]);
}

function PenaltyContent({
  item,
  locale,
  t,
}: {
  item: SelfPenalty;
  locale: 'vi-VN' | 'en-US';
  t: Translate;
}): React.JSX.Element {
  const registration = item.registration;
  return (
    <View style={styles.content}>
      <Surface level={1} padding="xl" style={styles.detailCard}>
        <View style={styles.detailHeader}>
          <View style={styles.iconTile}>
            <FileWarning
              size={21}
              color={designTokens.color.brand.primary}
              strokeWidth={1.9}
            />
          </View>
          <View style={styles.headerCopy}>
            <AppText variant="cardTitle">{item.reason}</AppText>
            <StatusBadge
              label={statusLabel(item.status, t)}
              tone={getPenaltyStatusTone(item.status)}
            />
          </View>
        </View>
        <View style={styles.amountBlock}>
          <AppText variant="eyebrow" tone="tertiary">
            {t('activity.amount')}
          </AppText>
          <AppText variant="metric">{formatVnd(item.amount, locale)}</AppText>
        </View>
        <View style={styles.detailLines}>
          <View style={styles.detailLine}>
            <AppText variant="supporting" tone="secondary">
              {t('activity.mealDate')}
            </AppText>
            <AppText variant="supporting">
              {item.mealDate
                ? formatShortDate(parseDateKey(item.mealDate), locale)
                : t('activity.mealDateUnavailable')}
            </AppText>
          </View>
          <TimestampRow
            label={t('activity.createdAt')}
            value={item.createdAt}
            locale={locale}
          />
          <TimestampRow
            label={t('activity.paidAt')}
            value={item.paidAt}
            locale={locale}
          />
          <TimestampRow
            label={t('activity.waivedAt')}
            value={item.waivedAt}
            locale={locale}
          />
          {item.waiveReason ? (
            <View style={styles.detailLineStacked}>
              <AppText variant="supporting" tone="secondary">
                {t('activity.waiveReason')}
              </AppText>
              <AppText variant="body">{item.waiveReason}</AppText>
            </View>
          ) : null}
        </View>
      </Surface>
      <Surface level={1} padding="xl" style={styles.contextCard}>
        <AppText variant="eyebrow" tone="tertiary">
          {t('activity.registrationContext').toUpperCase()}
        </AppText>
        {registration ? (
          <>
            <StatusBadge
              label={registrationStatusLabel(registration.status, t)}
              tone={getActivityStatusTone(registration.status)}
            />
            <ActivitySnapshot item={registration} locale={locale} t={t} />
          </>
        ) : (
          <AppText variant="body" tone="secondary">
            {t('activity.contextUnavailable')}
          </AppText>
        )}
      </Surface>
    </View>
  );
}

export function PenaltyDetailScreen({ navigation, route }: Props) {
  const { token } = useSession();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const [item, setItem] = useState<SelfPenalty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [notFound, setNotFound] = useState(false);
  const requestIdRef = useRef(0);
  const localeCode = locale === 'vi-VN' ? 'vi-VN' : 'en-US';
  const detailKey = token ? `${token}:${route.params.penaltyId}` : null;
  const detailKeyRef = useRef<string | null>(detailKey);
  const [resultKey, setResultKey] = useState<string | null>(null);

  useEffect(() => {
    detailKeyRef.current = detailKey;
    requestIdRef.current += 1;
    setItem(null);
    setResultKey(null);
    setError(null);
    setNotFound(false);
    setLoading(Boolean(token));
  }, [detailKey, token]);
  const load = useCallback(async () => {
    if (!token || !detailKey) return;
    const requestId = ++requestIdRef.current;
    const requestKey = detailKey;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const response = await employeeActivityAPI.getPenaltyDetail(
        route.params.penaltyId,
        token,
      );
      if (
        requestId !== requestIdRef.current ||
        detailKeyRef.current !== requestKey
      )
        return;
      setItem(response.data);
      setResultKey(requestKey);
    } catch (loadError: unknown) {
      if (
        requestId !== requestIdRef.current ||
        detailKeyRef.current !== requestKey
      )
        return;
      setResultKey(requestKey);
      if (
        loadError instanceof MobileApiError &&
        loadError.code === 'NOT_FOUND'
      ) {
        setNotFound(true);
        setItem(null);
      } else {
        setError(loadError);
      }
    } finally {
      if (
        requestId === requestIdRef.current &&
        detailKeyRef.current === requestKey
      )
        setLoading(false);
    }
  }, [detailKey, route.params.penaltyId, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        requestIdRef.current += 1;
      };
    }, [load]),
  );

  const activeResult = resultKey === detailKey;
  const visibleItem = activeResult ? item : null;
  const visibleError = activeResult ? error : null;
  const visibleNotFound = activeResult ? notFound : false;
  const screenLoadingGate = useScreenLoadingGate(isFocused, !loading);
  const screenLoading =
    loading &&
    !visibleError &&
    !visibleNotFound &&
    !visibleItem &&
    screenLoadingGate;
  const handleBack = () => {
    if (canPopOwnProfileStack(navigation, 'PenaltyDetail')) {
      navigation.goBack();
      return;
    }
    navigation.replace('ProfileHome');
  };
  const heading = t('activity.penaltyDetailTitle');

  return (
    <AppFrame
      screenLoadingLabel={
        screenLoading ? t('activity.penaltyDetailLoading') : undefined
      }
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('activity.back')}
          onPress={handleBack}
          style={styles.back}
        >
          <ArrowLeft
            size={20}
            color={designTokens.color.text.strong}
            strokeWidth={1.9}
          />
          <AppText variant="buttonLabel" tone="information">
            {t('activity.back')}
          </AppText>
        </Pressable>
        <SectionHeader title={heading} />
      </View>
      <StateTransition
        stateKey={
          visibleError
            ? 'error'
            : visibleNotFound
              ? 'not-found'
              : visibleItem
                ? 'ready'
                : 'empty'
        }
      >
        {visibleError ? (
          <Surface style={styles.stateSurface}>
            <AppText variant="cardTitle">
              {t('activity.penaltyDetailLoadFailed')}
            </AppText>
            <AppText variant="body" tone="secondary">
              {getMobileErrorMessage(visibleError, t, 'errors.loadPenalty')}
            </AppText>
            <ActionButton
              variant="primary"
              size="md"
              label={t('common.retry')}
              onPress={() => void load()}
            />
          </Surface>
        ) : visibleNotFound ? (
          <Surface style={styles.stateSurface}>
            <FileWarning
              size={28}
              color={designTokens.color.semantic.neutral.base}
              strokeWidth={1.8}
            />
            <AppText variant="cardTitle">{t('activity.notFoundTitle')}</AppText>
            <AppText variant="body" tone="secondary">
              {t('activity.notFoundHint')}
            </AppText>
            <ActionButton
              variant="secondary"
              size="md"
              label={t('activity.notFoundRetry')}
              onPress={() => void load()}
            />
          </Surface>
        ) : visibleItem ? (
          <PenaltyContent item={visibleItem} locale={localeCode} t={t} />
        ) : null}
      </StateTransition>
    </AppFrame>
  );
}

const styles = StyleSheet.create({
  header: { gap: designTokens.space.sm },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
    minHeight: designTokens.size.touchMin,
  },
  content: { gap: designTokens.space.lg },
  detailCard: { gap: designTokens.space.lg },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.md,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: designTokens.radius.inputButton,
    backgroundColor: designTokens.color.brand.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1, minWidth: 0, gap: designTokens.space.sm },
  amountBlock: { gap: designTokens.space.xs },
  detailLines: { gap: designTokens.space.md },
  detailLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: designTokens.space.md,
  },
  detailLineStacked: { gap: designTokens.space.xs },
  contextCard: { gap: designTokens.space.md },
  contextLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  stateSurface: { gap: designTokens.space.md },
});
