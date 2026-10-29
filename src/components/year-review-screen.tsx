import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { CATEGORY_BAR_COLOR } from '@/components/category-accomplishments-screen';
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
import { PieChart, type PieSlice } from '@/components/pie-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getAllCompletedEntries } from '@/utils/category-accomplishments';
import { getReflections, subscribeToJournal, type Reflection } from '@/utils/journal';
import { MOODS } from '@/utils/mood';
import { getMoodLog, subscribeToMoodLog, type MoodEntry } from '@/utils/mood-log';
import {
  MONTH_SHORT_NAMES,
  MOOD_COLORS,
  countByMood,
  entriesInYear,
  monthlyCounts,
  mostFrequentMood,
} from '@/utils/mood-stats';
import { getPetLabel } from '@/utils/pet-family';
import { getActiveDays, getYearStreakFacts } from '@/utils/streaks';
import {
  getTokenHistory,
  getTokenMonthBuckets,
  subscribeToTokenHistory,
  sumTokens,
  tokensInYear,
  type TokenEvent,
} from '@/utils/token-history';
import { ensureFamilyLoaded, subscribeToFamily, type FamilyState } from '@/utils/pet-family';
import { ALL_CATEGORIES } from '@/utils/stats';
import { getCachedTasks } from '@/utils/task-storage';
import { dateToISO, todayISO, type Task } from '@/utils/tasks';
import { buildYearRecap, hasAnyYearData, snippet } from '@/utils/year-review';

// My Year in Review — a personal look back at one year, built only from what
// the app actually recorded: completed tasks (with real completion dates),
// mood check-ins, journal reflections, and pet dates. Read-only. Nothing is
// guessed, and nothing leaves the device.

const PAGE_BACKGROUND = '#FBF3DC';
const MONTH_BAR_COLOR = '#F3D77A';

// 'YYYY-MM-DD' of a stored ISO timestamp in the player's local time zone
// (daylight saving and year boundaries included, since it uses the local
// year/month/day of that exact instant). null if the timestamp is unreadable.
function localDateOf(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dateToISO(date);
}

function formatPetDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function YearReviewScreen() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [moods, setMoods] = useState<MoodEntry[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [tokenEvents, setTokenEvents] = useState<TokenEvent[]>([]);
  const [tokensStartedAt, setTokensStartedAt] = useState<string | null>(null);
  // Every pet's recorded dates (egg arrival, hatching, passing away, coming
  // back), from the pet family store — one entry per recorded event.
  const [milestoneSources, setMilestoneSources] = useState<
    { kind: 'arrived' | 'born' | 'died' | 'returned'; iso: string; petLabel: string }[]
  >([]);

  useEffect(() => {
    let cancelled = false;
    getCachedTasks().then((list) => !cancelled && setTasks(list)).catch(() => {});
    getMoodLog().then((list) => !cancelled && setMoods(list)).catch(() => {});
    getReflections().then((list) => !cancelled && setReflections(list)).catch(() => {});
    const loadMilestones = (family: FamilyState) => {
      const found: typeof milestoneSources = [];
      for (const pet of family.pets) {
        const petLabel = getPetLabel(pet, family.pets);
        for (const event of pet.events) {
          if (event.type === 'adopted') found.push({ kind: 'arrived', iso: event.at, petLabel });
          else if (event.type === 'hatched') found.push({ kind: 'born', iso: event.at, petLabel });
          else if (event.type === 'died') found.push({ kind: 'died', iso: event.at, petLabel });
          else if (event.type === 'resurrected') found.push({ kind: 'returned', iso: event.at, petLabel });
        }
      }
      if (!cancelled) setMilestoneSources(found);
    };
    ensureFamilyLoaded().then(loadMilestones).catch(() => {});
    const offFamily = subscribeToFamily(loadMilestones);
    getTokenHistory()
      .then((h) => {
        if (cancelled) return;
        setTokenEvents(h.events);
        setTokensStartedAt(h.startedAt);
      })
      .catch(() => {});
    const offMood = subscribeToMoodLog(setMoods);
    const offJournal = subscribeToJournal(setReflections);
    const offTokens = subscribeToTokenHistory((h) => {
      setTokenEvents(h.events);
      setTokensStartedAt(h.startedAt);
    });
    return () => {
      cancelled = true;
      offMood();
      offJournal();
      offTokens();
      offFamily();
    };
  }, []);

  // The current year is shown as "Your Year So Far" and covers January 1
  // through today only; any other year is the complete "Your Year in Review".
  // Future dates are never counted, and months that haven't happened yet are
  // left off the monthly charts rather than shown as empty.
  const isCurrentYear = year === currentYear;
  const today = todayISO();
  const upToToday = (dateISO: string | null): boolean => dateISO !== null && (!isCurrentYear || dateISO <= today);
  const lastMonthShown = isCurrentYear ? new Date().getMonth() + 1 : 12;

  // ----- Which years have any data (so the year picker has somewhere to go) -----
  const yearPrefix = `${year}-`;
  const taskEntries = getAllCompletedEntries(tasks);
  const taskYears = taskEntries.flatMap((e) => (e.dateISO ? [Number(e.dateISO.slice(0, 4))] : []));
  const moodYears = moods.map((e) => Number(e.dateISO.slice(0, 4)));
  const reflectionYears = reflections.map((r) => Number(r.dateISO.slice(0, 4)));
  const petYears = milestoneSources.map((m) => new Date(m.iso).getFullYear());
  const tokenYears = tokenEvents.map((e) => Number(e.dateISO.slice(0, 4)));
  const allYears = [...taskYears, ...moodYears, ...reflectionYears, ...petYears, ...tokenYears, currentYear].filter(Number.isFinite);
  const minYear = Math.min(...allYears);

  // ----- This year's facts -----
  const yearTasks = taskEntries.filter((e) => e.dateISO?.startsWith(yearPrefix) && upToToday(e.dateISO));
  const undatedTaskCount = taskEntries.filter((e) => e.dateISO === null).length;
  const categoryCounts = ALL_CATEGORIES.map((category) => ({
    category,
    count: yearTasks.filter((e) => e.category === category).length,
  }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  const maxCategory = Math.max(1, ...categoryCounts.map((c) => c.count));
  const taskMonthBuckets = MONTH_SHORT_NAMES.map((label, i) => ({
    dateISO: `${year}-${String(i + 1).padStart(2, '0')}`,
    weekdayLabel: label,
    count: yearTasks.filter((e) => e.dateISO?.slice(5, 7) === String(i + 1).padStart(2, '0')).length,
  })).slice(0, lastMonthShown);

  const yearMoods = entriesInYear(moods, year).filter((e) => upToToday(e.dateISO));
  const moodCounts = countByMood(yearMoods);
  const topMood = mostFrequentMood(yearMoods);
  const moodSlices: PieSlice[] = MOODS.map((mood) => ({
    key: mood,
    label: mood,
    value: moodCounts[mood],
    color: MOOD_COLORS[mood],
  }));
  const moodMonthBuckets = monthlyCounts(yearMoods, year)
    .map((count, i) => ({
      dateISO: `${year}-${String(i + 1).padStart(2, '0')}`,
      weekdayLabel: MONTH_SHORT_NAMES[i],
      count,
    }))
    .slice(0, lastMonthShown);

  const yearReflections = reflections
    .filter((r) => r.dateISO.startsWith(yearPrefix) && upToToday(r.dateISO))
    .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));

  const petMilestones = milestoneSources
    // Group by the player's LOCAL calendar date (not the UTC date in the ISO
    // string, which can be a day ahead/behind late in the evening). The stored
    // timestamp itself is unchanged.
    .filter((m) => localDateOf(m.iso)?.startsWith(yearPrefix) && upToToday(localDateOf(m.iso)))
    .sort((a, b) => (a.iso < b.iso ? -1 : 1))
    .map((m) => {
      const date = formatPetDate(m.iso);
      if (m.kind === 'arrived') return `${m.petLabel}’s egg arrived on ${date}`;
      if (m.kind === 'born') return `${m.petLabel} was born on ${date}`;
      if (m.kind === 'returned') return `${m.petLabel} came back on ${date}`;
      return `${m.petLabel} passed away on ${date}`;
    });

  // Paw Tokens earned this year (recorded history only) and streak facts.
  const yearTokenEvents = tokensInYear(tokenEvents, year).filter((e) => upToToday(e.dateISO));
  const tokensEarned = sumTokens(yearTokenEvents);
  const tokenMonthBuckets = getTokenMonthBuckets(yearTokenEvents, year, MONTH_SHORT_NAMES).slice(0, lastMonthShown);
  const trackingStartedLabel = tokensStartedAt
    ? new Date(tokensStartedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const { days: activeDaysAll, undatedCount: undatedForStreaks } = getActiveDays(tasks, today);
  const streakFacts = getYearStreakFacts(activeDaysAll, year);

  const facts = {
    year,
    isCurrentYear,
    tokensEarned,
    activeDays: streakFacts.activeDayCount,
    longestStreak: streakFacts.longest,
    taskCount: yearTasks.length,
    topCategories: categoryCounts,
    moodCount: yearMoods.length,
    topMood,
    reflectionCount: yearReflections.length,
    highlights: yearReflections.slice(0, 2).map((r) => snippet(r.text, 80)),
    petMilestones,
  };
  const recap = buildYearRecap(facts);

  return (
    <DetailPageShell>
      <DetailTitleCard
        icon={<ThemedText style={styles.titleEmoji}>🎉</ThemedText>}
        title="My Year in Review"
        backgroundColor={PAGE_BACKGROUND}
      />

      <View style={styles.yearNav}>
        <Pressable
          disabled={year <= minYear}
          onPress={() => setYear(year - 1)}
          accessibilityRole="button"
          accessibilityLabel="Previous year"
          style={({ pressed }) => [pressed && styles.pressed, year <= minYear && styles.disabled]}>
          <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
            <ThemedText type="smallBold">‹</ThemedText>
          </ThemedView>
        </Pressable>
        <ThemedText style={styles.yearLabel}>{year}</ThemedText>
        <Pressable
          disabled={year >= currentYear}
          onPress={() => setYear(year + 1)}
          accessibilityRole="button"
          accessibilityLabel="Next year"
          style={({ pressed }) => [pressed && styles.pressed, year >= currentYear && styles.disabled]}>
          <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
            <ThemedText type="smallBold">›</ThemedText>
          </ThemedView>
        </Pressable>
      </View>

      <View style={styles.headingBlock}>
        <ThemedText style={styles.heading}>{isCurrentYear ? 'Your Year So Far' : 'Your Year in Review'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {isCurrentYear
            ? `January 1 – ${new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}, ${year}`
            : `January 1 – December 31, ${year}`}
        </ThemedText>
      </View>

      <DetailPanel title={isCurrentYear ? '💌 Your year so far, in words' : '💌 Your year, in words'}>
        <ThemedText style={styles.recap}>{recap}</ThemedText>
        <DetailNote>Written on your device from what you&apos;ve recorded — nothing is sent anywhere.</DetailNote>
      </DetailPanel>

      {hasAnyYearData(facts) ? (
        <>
          <SummaryRow>
            <SummaryCard value={yearTasks.length} label="tasks completed" backgroundColor={PAGE_BACKGROUND} />
            <SummaryCard value={yearMoods.length} label="mood check-ins" backgroundColor={PAGE_BACKGROUND} />
            <SummaryCard value={yearReflections.length} label="reflections saved" backgroundColor={PAGE_BACKGROUND} />
          </SummaryRow>

          <DetailPanel title="✅ Tasks this year">
            {yearTasks.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No completed tasks with a recorded date in {year}.
              </ThemedText>
            ) : (
              <>
                {categoryCounts.map(({ category, count }) => (
                  <View key={category} style={styles.breakdownRow}>
                    <ThemedText type="smallBold" style={styles.breakdownName}>
                      {category}
                    </ThemedText>
                    <View style={styles.breakdownTrack}>
                      <View
                        style={[
                          styles.breakdownFill,
                          { width: `${(count / maxCategory) * 100}%`, backgroundColor: CATEGORY_BAR_COLOR[category] },
                        ]}
                      />
                    </View>
                    <ThemedText type="smallBold" style={styles.breakdownCount}>
                      {count}
                    </ThemedText>
                  </View>
                ))}
                <ThemedText type="smallBold" style={styles.subTitle}>
                  Tasks by month
                </ThemedText>
                <CompletedBarChart buckets={taskMonthBuckets} color={MONTH_BAR_COLOR} />
              </>
            )}
            {undatedTaskCount > 0 ? (
              <DetailNote>
                {undatedTaskCount} earlier {undatedTaskCount === 1 ? 'task was' : 'tasks were'} completed before
                completion dates were recorded, so {undatedTaskCount === 1 ? 'it isn’t' : 'they aren’t'}{' '}
                included in any year.
              </DetailNote>
            ) : null}
          </DetailPanel>

          <DetailPanel title="🌈 Moods this year">
            {yearMoods.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No mood check-ins recorded in {year}.
              </ThemedText>
            ) : (
              <>
                <PieChart slices={moodSlices} />
                <ThemedText type="smallBold" style={styles.subTitle}>
                  Check-ins by month
                </ThemedText>
                <CompletedBarChart buckets={moodMonthBuckets} color="#B9A3E6" />
              </>
            )}
          </DetailPanel>

          <DetailPanel title="🪙 Paw Tokens earned">
            {tokensEarned === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No token earnings recorded in {year}.
              </ThemedText>
            ) : (
              <>
                <ThemedText type="smallBold">{tokensEarned.toLocaleString()} tokens earned</ThemedText>
                <ThemedText type="smallBold" style={styles.subTitle}>
                  Tokens by month
                </ThemedText>
                <CompletedBarChart buckets={tokenMonthBuckets} color="#F3D77A" />
              </>
            )}
            {trackingStartedLabel ? (
              <DetailNote>
                Token earnings are recorded from {trackingStartedLabel}; earlier earnings weren&apos;t logged, so they
                aren&apos;t counted here.
              </DetailNote>
            ) : null}
          </DetailPanel>

          <DetailPanel title="🔥 Consistency">
            {streakFacts.activeDayCount === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No days with a completed task recorded in {year}.
              </ThemedText>
            ) : (
              <>
                <ThemedText type="small">
                  Days with a completed task: <ThemedText type="smallBold">{streakFacts.activeDayCount}</ThemedText>
                </ThemedText>
                <ThemedText type="small">
                  Longest streak {isCurrentYear ? 'so far' : 'that year'}:{' '}
                  <ThemedText type="smallBold">
                    {streakFacts.longest} {streakFacts.longest === 1 ? 'day' : 'days'}
                  </ThemedText>
                </ThemedText>
                {streakFacts.milestones.length > 0 ? (
                  <ThemedText type="small">
                    Milestones reached: {streakFacts.milestones.map((m) => `${m}-day streak`).join(' · ')}
                  </ThemedText>
                ) : null}
              </>
            )}
            {undatedForStreaks > 0 ? (
              <DetailNote>
                {undatedForStreaks} earlier {undatedForStreaks === 1 ? 'task was' : 'tasks were'} completed before
                completion dates were recorded, so they can&apos;t be placed on a day.
              </DetailNote>
            ) : null}
          </DetailPanel>

          <DetailPanel title="📝 Reflections you saved">
            {yearReflections.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No reflections saved in {year}.
              </ThemedText>
            ) : (
              yearReflections.slice(0, 5).map((r) => (
                <View key={r.id} style={styles.quoteRow}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {new Date(`${r.dateISO}T00:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}
                  </ThemedText>
                  <ThemedText type="small">&ldquo;{snippet(r.text, 160)}&rdquo;</ThemedText>
                </View>
              ))
            )}
          </DetailPanel>

          <DetailPanel title="🐱 Kitty milestones">
            {petMilestones.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No kitty dates were recorded in {year}.
              </ThemedText>
            ) : (
              petMilestones.map((text) => (
                <ThemedText key={text} type="small">
                  • {text.charAt(0).toUpperCase() + text.slice(1)}
                </ThemedText>
              ))
            )}
          </DetailPanel>

        </>
      ) : (
        <DetailPanel title="🌱 Nothing here yet">
          <DetailEmptyState
            icon={<ThemedText style={styles.titleEmoji}>🌱</ThemedText>}
            title={`No activity recorded in ${year}`}
            text="Try another year, or come back after completing tasks, checking in with your mood, or writing a reflection."
          />
        </DetailPanel>
      )}
    </DetailPageShell>
  );
}

const styles = StyleSheet.create({
  titleEmoji: { fontSize: 48, lineHeight: 56 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.35 },
  pointer: { cursor: 'pointer' },
  yearNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  navButton: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.one, borderRadius: Spacing.five },
  headingBlock: { alignItems: 'center', gap: 2 },
  heading: { fontSize: 24, lineHeight: 32, fontWeight: '800', textAlign: 'center' },
  yearLabel: { fontSize: 32, lineHeight: 40, fontWeight: '800' },
  recap: { fontSize: 16, lineHeight: 26 },
  subTitle: { marginTop: Spacing.two },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  breakdownName: { width: 84 },
  breakdownTrack: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: 'rgba(150, 130, 160, 0.14)',
  },
  breakdownFill: { height: '100%', borderRadius: 7 },
  breakdownCount: { width: 36, textAlign: 'right' },
  quoteRow: { gap: 2, paddingVertical: Spacing.one },
});
