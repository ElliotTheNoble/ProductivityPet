import { getLocale, tr, useT } from '@/i18n';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { HoverPressable as Pressable } from '@/components/hover-pressable';

import {
  CompletedBarChart,
  DetailEmptyState,
  DetailNote,
  DetailPageShell,
  DetailPanel,
  DetailTitleCard,
  SummaryCard,
  SummaryRow,
} from '@/components/detail-page-parts';
import { PawTokenCoin } from '@/components/paw-token-coin';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { monthShortNames } from '@/utils/mood-stats';
import { getPetProfile, subscribeToPetProfile } from '@/utils/pet-profile';
import {
  TOKEN_SOURCE_LABELS,
  getTokenDailyBuckets,
  getTokenHistory,
  getTokenMonthBuckets,
  subscribeToTokenHistory,
  sumTokens,
  tokensInYear,
  type TokenEvent,
  type TokenSource,
} from '@/utils/token-history';
import { addDaysISO, todayISO } from '@/utils/tasks';

// Token Earnings History — real recorded earning events only (see
// @/utils/token-history.ts). Lifetime EARNED and the current BALANCE are two
// different numbers and are shown separately: spending lowers the balance but
// never the earnings. Earnings from before tracking began were never logged,
// so they aren't in these totals — the page says so.

const PAGE_BACKGROUND = '#FBF3DC';
const BAR_COLOR = '#F3D77A';
const MAX_LIST = 100;

const RANGES = [
  { id: 'week', labelKey: 'thWeekly' },
  { id: 'month', labelKey: 'thMonthly' },
  { id: 'year', labelKey: 'thYearly' },
] as const;
type RangeId = (typeof RANGES)[number]['id'];

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' })} · ${date.toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' })}`;
}

function sourceLabel(event: TokenEvent): string {
  const base = TOKEN_SOURCE_LABELS[event.source];
  if (event.refId === 'high-score-bonus') return tr('thHighScore', { base });
  if (event.refId === 'new-best-bonus') return tr('thNewBest', { base });
  if (event.refId === 'round-reward') return tr('thRound', { base });
  if (event.refId === 'completion-reward') return tr('thGame', { base });
  return base;
}

export function TokenHistoryScreen() {
  const { t } = useT();
  const [events, setEvents] = useState<TokenEvent[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [range, setRange] = useState<RangeId>('week');

  useEffect(() => {
    let cancelled = false;
    getTokenHistory()
      .then((h) => {
        if (cancelled) return;
        setEvents(h.events);
        setStartedAt(h.startedAt);
      })
      .catch(() => {});
    getPetProfile().then((p) => !cancelled && setBalance(p.pawTokens)).catch(() => {});
    const offHistory = subscribeToTokenHistory((h) => {
      setEvents(h.events);
      setStartedAt(h.startedAt);
    });
    const offProfile = subscribeToPetProfile((p) => setBalance(p.pawTokens));
    return () => {
      cancelled = true;
      offHistory();
      offProfile();
    };
  }, []);

  const today = todayISO();
  const year = new Date().getFullYear();
  const weekStart = addDaysISO(today, -6);
  const total = sumTokens(events);
  const week = sumTokens(events.filter((e) => e.dateISO >= weekStart && e.dateISO <= today));
  const month = sumTokens(events.filter((e) => e.dateISO.startsWith(today.slice(0, 7))));
  const thisYear = sumTokens(tokensInYear(events, year));

  const buckets =
    range === 'week'
      ? getTokenDailyBuckets(events, 7)
      : range === 'month'
        ? getTokenDailyBuckets(events, 30)
        : getTokenMonthBuckets(events, year, monthShortNames());

  const bySource = (Object.keys(TOKEN_SOURCE_LABELS) as TokenSource[])
    .map((source) => ({ source, amount: sumTokens(events.filter((e) => e.source === source)) }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const maxSource = Math.max(1, ...bySource.map((row) => row.amount));
  const newestFirst = [...events].sort((a, b) => (a.at < b.at ? 1 : -1));
  const startedLabel = startedAt
    ? new Date(startedAt).toLocaleDateString(getLocale(), { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <DetailPageShell>
      <DetailTitleCard
        icon={<PawTokenCoin size={64} />}
        title={t('thTitle')}
        backgroundColor={PAGE_BACKGROUND}
      />

      <SummaryRow>
        <SummaryCard value={total} label={t('thTotal')} backgroundColor={PAGE_BACKGROUND} />
        <SummaryCard value={balance ?? 0} label={t('thBalance')} backgroundColor={PAGE_BACKGROUND} />
      </SummaryRow>
      <SummaryRow>
        <SummaryCard value={week} label={t('thWeek')} backgroundColor={PAGE_BACKGROUND} />
        <SummaryCard value={month} label={t('thMonth')} backgroundColor={PAGE_BACKGROUND} />
        <SummaryCard value={thisYear} label={t('thYear', { year })} backgroundColor={PAGE_BACKGROUND} />
      </SummaryRow>

      <DetailPanel title={t('histWhatMeasures')}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('thExplain')}
        </ThemedText>
        {startedLabel ? (
          <DetailNote>{t('thStarted', { date: startedLabel })}</DetailNote>
        ) : null}
      </DetailPanel>

      <DetailPanel title={t('thOverTime')}>
        <View style={styles.rangeRow}>
          {RANGES.map((option) => {
            const selected = range === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setRange(option.id)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type={selected ? 'purple' : 'backgroundElement'} style={[styles.rangePill, styles.pointer]}>
                  <ThemedText type="smallBold" style={selected ? styles.rangePillTextActive : undefined}>
                    {t(option.labelKey)}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            );
          })}
        </View>
        {events.length === 0 ? (
          <DetailEmptyState
            icon={<PawTokenCoin size={56} />}
            title={t('thNone')}
            text={t('thNoneText')}
          />
        ) : (
          <CompletedBarChart buckets={buckets} color={BAR_COLOR} labelEvery={range === 'month' ? 5 : 1} />
        )}
      </DetailPanel>

      <DetailPanel title={t('thBySource')}>
        {bySource.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('thNoSources')}
          </ThemedText>
        ) : (
          bySource.map(({ source, amount }) => (
            <View key={source} style={styles.sourceRow}>
              <ThemedText type="smallBold" style={styles.sourceName}>
                {TOKEN_SOURCE_LABELS[source]}
              </ThemedText>
              <View style={styles.sourceTrack}>
                <View style={[styles.sourceFill, { width: `${(amount / maxSource) * 100}%` }]} />
              </View>
              <ThemedText type="smallBold" style={styles.sourceAmount}>
                {amount}
              </ThemedText>
            </View>
          ))
        )}
      </DetailPanel>

      <DetailPanel title={t('thRecorded')}>
        {newestFirst.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('thNothing')}
          </ThemedText>
        ) : (
          <>
            {newestFirst.slice(0, MAX_LIST).map((event) => (
              <View key={event.id} style={styles.eventRow}>
                <View style={styles.eventText}>
                  <ThemedText type="smallBold">{sourceLabel(event)}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatWhen(event.at)}
                  </ThemedText>
                </View>
                <ThemedText type="smallBold">+{event.amount}</ThemedText>
              </View>
            ))}
            {newestFirst.length > MAX_LIST ? (
              <DetailNote>{t('thShowing', { max: MAX_LIST, total: newestFirst.length })}</DetailNote>
            ) : null}
          </>
        )}
      </DetailPanel>
    </DetailPageShell>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8 },
  pointer: { cursor: 'pointer' },
  rangeRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  rangePill: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.five },
  rangePillTextActive: { color: '#FFFFFF' },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sourceName: { width: 150 },
  sourceTrack: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: 'rgba(150, 130, 160, 0.14)',
  },
  sourceFill: { height: '100%', borderRadius: 7, backgroundColor: BAR_COLOR },
  sourceAmount: { width: 48, textAlign: 'right' },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
    borderColor: 'rgba(150, 130, 160, 0.2)',
  },
  eventText: { flex: 1, gap: 2 },
});
