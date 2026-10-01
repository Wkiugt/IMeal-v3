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
  ChevronRight,
  CircleDollarSign,
  FileWarning,
} from 'lucide-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { ProfileStackScreenProps } from '../../navigation';
import { useSession } from '../../auth/session';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { Translate } from '../../i18n/translations';
import {
  employeeActivityAPI,
  type SelfPenalty,
} from '../../api/employeeActivityAPI';
import { getMobileErrorMessage } from '../../api/mobileApiError';
import {
  appendActivityPage,
  createActivityPageState,
  formatVnd,
  getPenaltyStatusTone,
  isCurrentActivityRequest,
  nextActivityRequestToken,
  replaceActivityPage,
  type ActivityPageState,
  type ActivityRequestToken,
} from './employeeActivityState';
import {
  formatBusinessInstant,
  formatShortDate,
  parseDateKey,
} from '../../businessDate';
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

type Props = ProfileStackScreenProps<'PenaltyList'>;
function canPopOwnProfileStack(
  navigation: Props['navigation'],
  routeName: 'PenaltyList',
): boolean {
  const state = navigation.getState();
  return (
    state.type === 'stack' &&
    state.index > 0 &&
    state.routes[state.index]?.name === routeName
  );
}

type PenaltyStatus = SelfPenalty['status'];
type PenaltyFilter = 'ALL' | PenaltyStatus;

function filterLabel(filter: PenaltyFilter, t: Translate): string {
  return filter === 'ALL' ? t('common.all') : statusLabel(filter, t);
}

function statusLabel(status: PenaltyStatus, t: Translate): string {
  const keys: Record<PenaltyStatus, Parameters<Translate>[0]> = {
    PENDING: 'activity.status.pending',
    PAID: 'activity.status.paid',
    WAIVED: 'activity.status.waived',
  };
  return t(keys[status]);
}

function PenaltyRow({
  item,
  locale,
  t,
  onPress,
}: {
  item: SelfPenalty;
  locale: string;
  t: Translate;
  onPress: () => void;
}): React.JSX.Element {
  const mealDate = item.mealDate
    ? formatShortDate(
        parseDateKey(item.mealDate),
        locale === 'vi-VN' ? 'vi-VN' : 'en-US',
      )
    : t('activity.mealDateUnavailable');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.reason}, ${formatVnd(item.amount, locale)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.rowPressable, pressed && styles.pressed]}
    >
      <Surface level={1} padding="lg" style={styles.rowSurface}>
        <View style={styles.rowHeader}>
          <View style={styles.rowCopy}>
            <AppText variant="cardTitle">{item.reason}</AppText>
            <AppText variant="supporting" tone="secondary">
              {mealDate}
            </AppText>
          </View>
          <ChevronRight
            size={18}
            color={designTokens.color.text.secondary}
            strokeWidth={1.9}
          />
        </View>
        <View style={styles.rowFooter}>
          <View style={styles.amount}>
            <CircleDollarSign
              size={17}
              color={designTokens.color.text.secondary}
              strokeWidth={1.9}
            />
            <AppText variant="buttonLabel">
              {formatVnd(item.amount, locale)}
            </AppText>
          </View>
          <StatusBadge
            label={statusLabel(item.status, t)}
            tone={getPenaltyStatusTone(item.status)}
          />
        </View>
        <AppText variant="caption" tone="tertiary">
          {t('activity.createdAt')}:{' '}
          {formatBusinessInstant(
            item.createdAt,
            locale === 'vi-VN' ? 'vi-VN' : 'en-US',
          )}
        </AppText>
      </Surface>
    </Pressable>
  );
}

export function PenaltyListScreen({ navigation }: Props) {
  const { token } = useSession();
  const { locale, t } = useLanguage();
  const isFocused = useIsFocused();
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 350 || fontScale > 1.2;
  const [pageState, setPageState] = useState<ActivityPageState<SelfPenalty>>(
    () => createActivityPageState(),
  );
  const pageStateRef = useRef(pageState);
  const [filter, setFilter] = useState<PenaltyFilter>('ALL');
  const filterRef = useRef<PenaltyFilter>('ALL');
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const requestIdRef = useRef(0);
  const requestTokenRef = useRef<ActivityRequestToken>({
    generation: 0,
    filter: 'ALL',
  });
  const principalKeyRef = useRef<string | null>(token);
  const loadingMoreRef = useRef(false);

  const updatePageState = (next: ActivityPageState<SelfPenalty>) => {
    pageStateRef.current = next;
    setPageState(next);
  };
  useEffect(() => {
    principalKeyRef.current = token;
    requestIdRef.current += 1;
    requestTokenRef.current = nextActivityRequestToken(
      requestTokenRef.current,
      filterRef.current,
    );
    loadingMoreRef.current = false;
    const reset = createActivityPageState<SelfPenalty>();
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
      const requestToken = requestTokenRef.current;
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
        const response = await employeeActivityAPI.getPenaltyList(token, {
          page: reset ? 1 : pageStateRef.current.page + 1,
          limit: 20,
          status: filterRef.current === 'ALL' ? undefined : filterRef.current,
        });
        if (
          requestId === requestIdRef.current &&
          principalKeyRef.current === requestPrincipal &&
          isCurrentActivityRequest(requestToken, requestTokenRef.current)
        ) {
          const next = reset
            ? replaceActivityPage(response)
            : appendActivityPage(pageStateRef.current, response);
          updatePageState(next);
          setLoadError(null);
        }
      } catch (error: unknown) {
        if (
          requestId === requestIdRef.current &&
          principalKeyRef.current === requestPrincipal &&
          isCurrentActivityRequest(requestToken, requestTokenRef.current)
        ) {
          if (reset) setLoadError(error);
          else setLoadMoreError(error);
        }
      } finally {
        if (
          requestId === requestIdRef.current &&
          principalKeyRef.current === requestPrincipal &&
          isCurrentActivityRequest(requestToken, requestTokenRef.current)
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
  const selectFilter = (nextFilter: PenaltyFilter) => {
    if (nextFilter === filterRef.current) return;
    filterRef.current = nextFilter;
    requestTokenRef.current = nextActivityRequestToken(
      requestTokenRef.current,
      nextFilter,
    );
    requestIdRef.current += 1;
    loadingMoreRef.current = false;
    updatePageState(createActivityPageState());
    setFilter(nextFilter);
    setInitialLoading(true);
    setRefreshing(false);
    setLoadingMore(false);
    setLoadError(null);
    setLoadMoreError(null);
    void load(true);
  };

  const filterOptions: PenaltyFilter[] = ['ALL', 'PENDING', 'PAID', 'WAIVED'];

  const filterTone = (option: PenaltyFilter) =>
    option === 'ALL' ? 'neutral' : getPenaltyStatusTone(option);

  const visiblePageState =
    principalKeyRef.current === token
      ? pageState
      : createActivityPageState<SelfPenalty>();
  const hasItems = visiblePageState.items.length > 0;
  const initialError = loadError !== null && !hasItems && !initialLoading;
  const screenLoadingGate = useScreenLoadingGate(isFocused, !initialLoading);
  const screenLoading =
    !initialError &&
    initialLoading &&
    visiblePageState.items.length === 0 &&
    screenLoadingGate;
  const handleBack = () => {
    if (canPopOwnProfileStack(navigation, 'PenaltyList')) {
      navigation.goBack();
      return;
    }
    navigation.replace('ProfileHome');
  };

  return (
    <AppFrame
      screenLoadingLabel={
        screenLoading ? t('activity.penaltyLoading') : undefined
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
          title={t('activity.penaltyListTitle')}
          subtitle={t('activity.penaltyListSubtitle')}
        />
      </View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('activity.penaltyListTitle')}
        style={styles.filters}
      >
        {filterOptions.map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityLabel={filterLabel(option, t)}
            accessibilityState={{ selected: filter === option }}
            onPress={() => selectFilter(option)}
            style={({ pressed }) => [
              styles.filterPressable,
              filter === option && styles.filterSelected,
              pressed && styles.pressed,
            ]}
          >
            <StatusBadge
              label={filterLabel(option, t)}
              tone={filterTone(option)}
              icon={null}
              size="md"
            />
          </Pressable>
        ))}
      </View>
      {refreshing && hasItems ? (
        <AppText variant="caption" tone="secondary" style={styles.refreshing}>
          {t('activity.penaltyRefreshing')}
        </AppText>
      ) : null}
      {loadError && hasItems ? (
        <Surface style={styles.warningSurface}>
          <AppText variant="supporting" tone="warning">
            {getMobileErrorMessage(loadError, t, 'errors.loadPenalties')}
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
              {t('activity.penaltyLoadFailed')}
            </AppText>
            <AppText variant="body" tone="secondary">
              {getMobileErrorMessage(loadError, t, 'errors.loadPenalties')}
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
            icon={FileWarning}
            title={t('activity.penaltyEmpty')}
            description={t('activity.penaltyEmptyHint')}
          />
        ) : (
          <View style={[styles.list, compactLayout && styles.listCompact]}>
            {visiblePageState.items.map((item) => (
              <PenaltyRow
                key={item.id}
                item={item}
                locale={locale}
                t={t}
                onPress={() =>
                  navigation.navigate('PenaltyDetail', { penaltyId: item.id })
                }
              />
            ))}
          </View>
        )}
      </StateTransition>
      {loadMoreError ? (
        <Surface style={styles.loadMoreError}>
          <AppText variant="supporting" tone="warning">
            {getMobileErrorMessage(loadMoreError, t, 'errors.loadPenalties')}
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
              ? t('activity.penaltyLoadingMore')
              : t('activity.penaltyLoadMore')
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
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: designTokens.space.sm,
    marginTop: designTokens.space.md,
    marginBottom: designTokens.space.md,
  },
  filterPressable: {
    minHeight: designTokens.size.touchMin,
    borderRadius: designTokens.radius.chip,
    borderWidth: designTokens.border.standard.width,
    borderColor: designTokens.color.border.standard,
    overflow: 'hidden',
  },
  filterSelected: {
    borderColor: designTokens.color.border.selected,
    backgroundColor: designTokens.color.brand.tint,
  },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
    minHeight: designTokens.size.touchMin,
  },
  refreshing: { marginBottom: designTokens.space.md },
  list: { gap: designTokens.space.md },
  listCompact: { gap: designTokens.space.sm },
  rowPressable: { minHeight: designTokens.size.touchMin },
  rowSurface: { gap: designTokens.space.md },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: designTokens.space.sm,
  },
  rowCopy: { flex: 1, minWidth: 0, gap: designTokens.space.xs },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: designTokens.space.sm,
  },
  amount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: designTokens.space.sm,
  },
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
