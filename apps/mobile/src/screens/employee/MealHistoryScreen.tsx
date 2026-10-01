import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  ReceiptText,
} from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { Translate } from '../../i18n/translations';
import {
  employeeActivityAPI,
  type EmployeeRegistrationActivity,
} from '../../api/employeeActivityAPI';
import { ActivitySnapshot } from './ActivitySnapshot';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import {
  appendActivityPage,
  replaceActivityPage,
  createActivityPageState,
  formatVnd,
  getActivityStatusTone,
  getPenaltyStatusTone,
  type ActivityPageState,
} from './employeeActivityState';
import { formatShortDate, parseDateKey } from '../../businessDate';
import {
  ActionButton,
  AppText,
  EmptyState,
  StatusBadge,
  Surface,
} from '../../ui/components';
import { AppFrame, SectionHeader } from '../../ui/AppShell';
import { StateTransition } from '../../ui/BrandMotion';
import { useScreenLoadingGate } from '../../ui/useScreenLoadingGate';
import { designTokens } from '../../ui/designTokens';

type Props = ProfileStackScreenProps<'MealHistory'>;
function canPopOwnProfileStack(
  navigation: Props['navigation'],
  routeName: 'MealHistory',
): boolean {
  const state = navigation.getState();
  return (
    state.type === 'stack' &&
    state.index > 0 &&
    state.routes[state.index]?.name === routeName
  );
}

type ActivityStatus = EmployeeRegistrationActivity['status'];
function statusLabel(status: ActivityStatus, t: Translate): string {
  const keys: Record<ActivityStatus, Parameters<typeof t>[0]> = {
    ACTIVE: 'activity.status.active',
    CANCELLED: 'activity.status.cancelled',
    SERVED: 'activity.status.served',
    NO_SHOW: 'activity.status.noShow',
  };
  return t(keys[status]);
}

function MealHistoryRow({
  item,
  locale,
  t,
  onPenaltyPress,
}: {
  item: EmployeeRegistrationActivity;
  locale: string;
  t: Translate;
  onPenaltyPress: (id: string) => void;
}): React.JSX.Element {
  const mealDate = formatShortDate(
    parseDateKey(item.mealDate),
    locale === 'vi-VN' ? 'vi-VN' : 'en-US',
  );
  const choice =
    item.mealChoice === 'VEGETARIAN'
      ? t('calendar.mealChoice.vegetarian')
      : t('calendar.mealChoice.regular');

  return (
    <Surface level={1} padding="lg" style={styles.rowSurface}>
      <View style={styles.rowHeader}>
        <View style={styles.rowDateCopy}>
          <AppText variant="cardTitle">{mealDate}</AppText>
        </View>
        <StatusBadge
          label={statusLabel(item.status, t)}
          tone={getActivityStatusTone(item.status)}
        />
      </View>
      <View style={styles.metadata}>
        <View style={styles.metadataLine}>
          <CalendarDays
            size={16}
            color={designTokens.color.text.secondary}
            strokeWidth={1.9}
          />
          <AppText variant="supporting" tone="secondary">
            {choice}
          </AppText>
        </View>
      </View>
      <ActivitySnapshot
        item={item}
        locale={locale === 'vi-VN' ? 'vi-VN' : 'en-US'}
        t={t}
      />
      {item.penalties.length > 0 ? (
        <View style={styles.penalties}>
          <AppText variant="eyebrow" tone="tertiary">
            {t('profile.penalties')}
          </AppText>
          {item.penalties.map((penalty) => (
            <Pressable
              key={penalty.id}
              accessibilityRole="button"
              accessibilityLabel={`${formatVnd(penalty.amount, locale)} · ${t(('activity.status.' + penalty.status.toLowerCase()) as Parameters<typeof t>[0])}`}
              onPress={() => onPenaltyPress(penalty.id)}
              style={({ pressed }) => [
                styles.penaltyLink,
                pressed && styles.pressed,
              ]}
            >
              <ReceiptText
                size={16}
                color={designTokens.color.brand.primary}
                strokeWidth={1.9}
              />
              <AppText
                variant="supporting"
                tone="information"
                style={styles.penaltyText}
              >
                {formatVnd(penalty.amount, locale)}
              </AppText>
              <StatusBadge
                label={t(
                  `activity.status.${penalty.status.toLowerCase()}` as Parameters<
                    typeof t
                  >[0],
                )}
                tone={getPenaltyStatusTone(penalty.status)}
              />
              <ChevronRight
                size={16}
                color={designTokens.color.text.secondary}
                strokeWidth={1.9}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
    </Surface>
  );
}

export function MealHistoryScreen({ navigation }: Props) {
  const { token } = useSession();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const [pageState, setPageState] = useState<
    ActivityPageState<EmployeeRegistrationActivity>
  >(() => createActivityPageState());
  const pageStateRef = useRef(pageState);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const requestIdRef = useRef(0);
  const principalKeyRef = useRef<string | null>(token);
  const loadingMoreRef = useRef(false);

  const updatePageState = (
    next: ActivityPageState<EmployeeRegistrationActivity>,
  ) => {
    pageStateRef.current = next;
    setPageState(next);
  };
  useEffect(() => {
    principalKeyRef.current = token;
    requestIdRef.current += 1;
    loadingMoreRef.current = false;
    const reset = createActivityPageState<EmployeeRegistrationActivity>();
    pageStateRef.current = reset;
    setPageState(reset);
    setInitialLoading(Boolean(token));
    setRefreshing(false);
    setLoadingMore(false);
    setLoadError(null);
    setLoadMoreError(null);
  }, [token]);

  const load = useCallback(
    async (reset: boolean) => {
      if (!token) return;
      if (
        !reset &&
        (loadingMoreRef.current || !pageStateRef.current.hasNextPage)
      )
        return;
      const requestId = ++requestIdRef.current;
      const requestPrincipal = token;
      if (reset) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
        setLoadError(null);
        setLoadMoreError(null);
        if (pageStateRef.current.items.length === 0) setInitialLoading(true);
        else setRefreshing(true);
      } else {
        loadingMoreRef.current = true;
        setLoadingMore(true);
        setLoadMoreError(null);
      }
      try {
        const response = await employeeActivityAPI.getHistory(token, {
          page: reset ? 1 : pageStateRef.current.page + 1,
          limit: 20,
        });
        if (
          requestId === requestIdRef.current &&
          principalKeyRef.current === requestPrincipal
        ) {
          const next = reset
            ? replaceActivityPage(response)
            : appendActivityPage(pageStateRef.current, response);
          updatePageState(next);
          setLoadError(null);
          if (!reset && next.page !== response.meta.pagination.page) {
            setLoadMoreError(null);
          }
        }
      } catch (error: unknown) {
        if (
          requestId === requestIdRef.current &&
          principalKeyRef.current === requestPrincipal
        ) {
          if (reset) setLoadError(error);
          else setLoadMoreError(error);
        }
      } finally {
        if (
          requestId === requestIdRef.current &&
          principalKeyRef.current === requestPrincipal
        ) {
          if (reset) {
            setInitialLoading(false);
            setRefreshing(false);
          } else {
            loadingMoreRef.current = false;
            setLoadingMore(false);
          }
        }
      }
    },
    [token],
  );

  useFocusEffect(
    useCallback(() => {
      if (pageStateRef.current.page === 0) void load(true);
      return () => {
        requestIdRef.current += 1;
        loadingMoreRef.current = false;
        setLoadingMore(false);
        setRefreshing(false);
      };
    }, [load]),
  );

  const visiblePageState =
    principalKeyRef.current === token
      ? pageState
      : createActivityPageState<EmployeeRegistrationActivity>();
  const hasItems = visiblePageState.items.length > 0;
  const initialError = loadError !== null && !hasItems && !initialLoading;
  const screenLoadingGate = useScreenLoadingGate(isFocused, !initialLoading);
  const screenLoading =
    !initialError &&
    initialLoading &&
    visiblePageState.items.length === 0 &&
    screenLoadingGate;
  const handleBack = () => {
    if (canPopOwnProfileStack(navigation, 'MealHistory')) {
      navigation.goBack();
      return;
    }
    navigation.replace('ProfileHome');
  };

  return (
    <AppFrame
      screenLoadingLabel={
        screenLoading ? t('activity.historyLoading') : undefined
      }
      scrollProps={{
        refreshControl: (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load(true)}
          />
        ),
      }}
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
        <SectionHeader
          title={t('activity.historyTitle')}
          subtitle={t('activity.historySubtitle')}
        />
      </View>
      {refreshing && hasItems ? (
        <AppText variant="caption" tone="secondary" style={styles.refreshing}>
          {t('activity.historyRefreshing')}
        </AppText>
      ) : null}
      {loadError && hasItems ? (
        <Surface style={styles.warningSurface}>
          <AppText variant="supporting" tone="warning">
            {getMobileErrorMessage(loadError, t, 'errors.loadMealHistory')}
          </AppText>
          <ActionButton
            variant="secondary"
            size="md"
            label={t('common.retry')}
            onPress={() => void load(true)}
          />
        </Surface>
      ) : null}
      <StateTransition
        stateKey={
          initialError
            ? 'error'
            : !hasItems && !initialLoading
              ? 'empty'
              : 'ready'
        }
      >
        {initialError ? (
          <Surface style={styles.stateSurface}>
            <AppText variant="cardTitle">
              {t('activity.historyLoadFailed')}
            </AppText>
            <AppText variant="body" tone="secondary">
              {getMobileErrorMessage(loadError, t, 'errors.loadMealHistory')}
            </AppText>
            <ActionButton
              variant="primary"
              size="md"
              label={t('common.retry')}
              onPress={() => void load(true)}
            />
          </Surface>
        ) : !hasItems && !initialLoading ? (
          <EmptyState
            icon={CalendarDays}
            title={t('activity.historyEmpty')}
            description={t('activity.historyEmptyHint')}
          />
        ) : (
          <View style={[styles.list, compactLayout && styles.listCompact]}>
            {visiblePageState.items.map((item) => (
              <MealHistoryRow
                key={item.id}
                item={item}
                locale={locale}
                t={t}
                onPenaltyPress={(penaltyId) =>
                  navigation.navigate('PenaltyDetail', { penaltyId })
                }
              />
            ))}
          </View>
        )}
      </StateTransition>
      {loadMoreError ? (
        <Surface style={styles.loadMoreError}>
          <AppText variant="supporting" tone="warning">
            {getMobileErrorMessage(loadMoreError, t, 'errors.loadMealHistory')}
          </AppText>
          <ActionButton
            variant="secondary"
            size="md"
            label={t('common.retry')}
            onPress={() => void load(false)}
          />
        </Surface>
      ) : null}
      {visiblePageState.hasNextPage && !loadMoreError ? (
        <ActionButton
          variant="secondary"
          size="md"
          disabled={loadingMore}
          label={
            loadingMore
              ? t('activity.historyLoadingMore')
              : t('activity.historyLoadMore')
          }
          onPress={() => void load(false)}
          style={styles.loadMore}
        />
      ) : null}
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
  refreshing: { marginBottom: designTokens.space.md },
  list: { gap: designTokens.space.md },
  listCompact: { gap: designTokens.space.sm },
  rowSurface: { gap: designTokens.space.md },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.sm,
  },
  rowDateCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  metadata: { gap: designTokens.space.sm },
  metadataLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  penalties: { gap: designTokens.space.sm },
  penaltyLink: {
    minHeight: designTokens.size.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
  penaltyText: { flex: 1 },
  pressed: { opacity: 0.72 },
  stateSurface: { gap: designTokens.space.md },
  warningSurface: {
    gap: designTokens.space.sm,
    marginBottom: designTokens.space.md,
  },
  loadMoreError: {
    gap: designTokens.space.sm,
    marginTop: designTokens.space.md,
  },
  loadMore: { marginTop: designTokens.space.lg },
});
