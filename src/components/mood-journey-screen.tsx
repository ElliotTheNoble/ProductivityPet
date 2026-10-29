import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

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
import { MoodIcon } from '@/components/mood-icon';
import { PieChart, type PieSlice } from '@/components/pie-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  MAX_REFLECTION_LENGTH,
  deleteReflection,
  getReflections,
  saveReflection,
  subscribeToJournal,
  type Reflection,
} from '@/utils/journal';
import { MOODS, type Mood } from '@/utils/mood';
import { getMoodLog, subscribeToMoodLog, type MoodEntry } from '@/utils/mood-log';
import {
  MONTH_NAMES,
  MONTH_SHORT_NAMES,
  MOOD_COLORS,
  NO_ENTRY_COLOR,
  countByMood,
  daysInMonth,
  describeMoodPattern,
  distinctDays,
  entriesInMonth,
  entriesInYear,
  entriesOnDate,
  isLeapYear,
  latestMoodByDate,
  monthlyCounts,
  mostFrequentMood,
  toISO,
} from '@/utils/mood-stats';
import { addDaysISO, formatFullDate, todayISO } from '@/utils/tasks';

// My Mood Journey — the player's own mood check-ins (recorded from Home's
// Today's Mood picker, see @/utils/mood-log.ts) and short daily reflections
// (@/utils/journal.ts), viewed by day, month or year. Entirely separate from
// the kitty's meters. Days with no check-in are just "no entry", never a mood.

type View_ = 'day' | 'month' | 'year';

const PAGE_BACKGROUND = '#EFE9FA';
const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function parseISO(dateISO: string): { year: number; month0: number; day: number } {
  const [y, m, d] = dateISO.split('-').map(Number);
  return { year: y, month0: m - 1, day: d };
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function moodSlices(entries: MoodEntry[]): PieSlice[] {
  const counts = countByMood(entries);
  return MOODS.map((mood) => ({ key: mood, label: mood, value: counts[mood], color: MOOD_COLORS[mood] }));
}

export function MoodJourneyScreen() {
  const theme = useTheme();
  const [view, setView] = useState<View_>('day');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [entries, setEntries] = useState<MoodEntry[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [draft, setDraft] = useState('');
  // 'saved' only after a save really reached storage; 'error' if it didn't.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const selectedDateRef = useRef(selectedDate);

  // Load once, then stay live: a check-in made on Home or a reflection saved
  // here shows up immediately.
  useEffect(() => {
    let cancelled = false;
    getMoodLog().then((log) => !cancelled && setEntries(log)).catch(() => {});
    getReflections().then((list) => !cancelled && setReflections(list)).catch(() => {});
    const offMood = subscribeToMoodLog(setEntries);
    const offJournal = subscribeToJournal(setReflections);
    return () => {
      cancelled = true;
      offMood();
      offJournal();
    };
  }, []);

  const { year, month0 } = parseISO(selectedDate);
  const reflectionForDay = reflections.find((r) => r.dateISO === selectedDate) ?? null;

  selectedDateRef.current = selectedDate;

  // Showing a different day clears any old status message. (This used to be
  // one effect that ALSO depended on the saved text, so saving — which changes
  // that text — immediately wiped the "Saved ✓" message it had just set.)
  useEffect(() => {
    setSaveStatus('idle');
  }, [selectedDate]);

  // Keep the editor showing the stored text for the day (on a day change, and
  // after a save/edit/delete). Does not touch the status message.
  useEffect(() => {
    setDraft(reflectionForDay?.text ?? '');
  }, [selectedDate, reflectionForDay?.text]);

  const topMood = mostFrequentMood(entries);
  const dayByDate = latestMoodByDate(entries);
  const reflectionDates = new Set(reflections.map((r) => r.dateISO));

  function shiftMonth(delta: number) {
    const total = year * 12 + month0 + delta;
    setSelectedDate(toISO(Math.floor(total / 12), total % 12, 1));
  }
  function shiftYear(delta: number) {
    const target = year + delta;
    const day = Math.min(parseISO(selectedDate).day, daysInMonth(target, month0));
    setSelectedDate(toISO(target, month0, day));
  }

  async function handleSave() {
    const date = selectedDate;
    const hasText = draft.trim().length > 0;
    const ok = await saveReflection(date, draft);
    // Ignore the result if the player has since moved to another day.
    if (selectedDateRef.current !== date) return;
    // Saving empty text just clears the day, so there is nothing to confirm.
    setSaveStatus(!ok ? 'error' : hasText ? 'saved' : 'idle');
  }
  async function handleDelete() {
    const date = selectedDate;
    const ok = await deleteReflection(date);
    if (selectedDateRef.current !== date) return;
    if (ok) setDraft('');
    setSaveStatus(ok ? 'idle' : 'error');
  }

  function MoodList({ dateISO }: { dateISO: string }) {
    const dayEntries = entriesOnDate(entries, dateISO);
    if (dayEntries.length === 0) {
      return (
        <ThemedText type="small" themeColor="textSecondary">
          No check-in recorded for this day — and that&apos;s perfectly okay.
        </ThemedText>
      );
    }
    return (
      <>
        {dayEntries.map((entry) => (
          <View key={entry.id} style={styles.moodRow}>
            <MoodIcon mood={entry.mood} size={40} />
            <View style={styles.moodRowText}>
              <ThemedText type="smallBold">{entry.mood}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatTime(entry.at)}
              </ThemedText>
            </View>
          </View>
        ))}
      </>
    );
  }

  function Nav({ label, onPrev, onNext, extra }: { label: string; onPrev: () => void; onNext: () => void; extra?: React.ReactNode }) {
    return (
      <View style={styles.navRow}>
        <Pressable onPress={onPrev} accessibilityRole="button" accessibilityLabel="Previous" style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
            <ThemedText type="smallBold">‹</ThemedText>
          </ThemedView>
        </Pressable>
        <ThemedText type="smallBold" style={styles.navLabel}>
          {label}
        </ThemedText>
        <Pressable onPress={onNext} accessibilityRole="button" accessibilityLabel="Next" style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
            <ThemedText type="smallBold">›</ThemedText>
          </ThemedView>
        </Pressable>
        {extra}
      </View>
    );
  }

  const tabs: { id: View_; label: string }[] = [
    { id: 'day', label: 'Day' },
    { id: 'month', label: 'Month' },
    { id: 'year', label: 'Year' },
  ];

  // ----- Month view data -----
  const monthEntries = entriesInMonth(entries, year, month0);
  const monthDayCount = daysInMonth(year, month0);
  const firstWeekday = new Date(year, month0, 1).getDay();
  const monthBuckets = Array.from({ length: monthDayCount }, (_, i) => {
    const dateISO = toISO(year, month0, i + 1);
    return {
      dateISO,
      weekdayLabel: String(i + 1),
      count: monthEntries.filter((e) => e.dateISO === dateISO).length,
    };
  });

  // ----- Year view data -----
  const yearEntries = entriesInYear(entries, year);
  const yearBuckets = monthlyCounts(entries, year).map((count, i) => ({
    dateISO: `${year}-${String(i + 1).padStart(2, '0')}`,
    weekdayLabel: MONTH_SHORT_NAMES[i],
    count,
  }));
  const yearDays = isLeapYear(year) ? 366 : 365;

  return (
    <DetailPageShell>
      <DetailTitleCard
        icon={<MoodIcon mood="Happy" size={64} />}
        title="My Mood Journey"
        backgroundColor={PAGE_BACKGROUND}
      />

      <SummaryRow>
        <SummaryCard value={entries.length} label="mood check-ins" backgroundColor={PAGE_BACKGROUND} />
        <SummaryCard value={distinctDays(entries)} label="days with a check-in" backgroundColor={PAGE_BACKGROUND} />
        <View style={[styles.topMoodCard, { backgroundColor: PAGE_BACKGROUND }]}>
          {topMood ? <MoodIcon mood={topMood} size={44} /> : <ThemedText style={styles.dash}>–</ThemedText>}
          <ThemedText type="smallBold">{topMood ?? 'No check-ins yet'}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            most recorded mood
          </ThemedText>
        </View>
      </SummaryRow>

      <DetailPanel title="🌈 Your mood pattern">
        <ThemedText type="small" themeColor="textSecondary">
          {describeMoodPattern(entries)}
        </ThemedText>
        <DetailNote>Your moods and reflections are saved only on this device.</DetailNote>
      </DetailPanel>

      <View style={styles.tabRow}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => setView(tab.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: view === tab.id }}
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type={view === tab.id ? 'purple' : 'backgroundElement'} style={[styles.tab, styles.pointer]}>
              <ThemedText type="smallBold" style={view === tab.id ? styles.tabTextActive : undefined}>
                {tab.label}
              </ThemedText>
            </ThemedView>
          </Pressable>
        ))}
      </View>

      {view === 'day' ? (
        <>
          <DetailPanel title="📅 Daily view">
            <Nav
              label={formatFullDate(selectedDate)}
              onPrev={() => setSelectedDate(addDaysISO(selectedDate, -1))}
              onNext={() => setSelectedDate(addDaysISO(selectedDate, 1))}
              extra={
                selectedDate !== todayISO() ? (
                  <Pressable onPress={() => setSelectedDate(todayISO())} style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
                      <ThemedText type="smallBold">Today</ThemedText>
                    </ThemedView>
                  </Pressable>
                ) : null
              }
            />
            <ThemedText type="smallBold">How you felt</ThemedText>
            <MoodList dateISO={selectedDate} />
          </DetailPanel>

          <DetailPanel title="📝 Daily reflection">
            <ThemedText type="small" themeColor="textSecondary">
              What&apos;s something you&apos;d like to remember about today?
            </ThemedText>
            <TextInput
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                setSaveStatus('idle');
              }}
              multiline
              maxLength={MAX_REFLECTION_LENGTH}
              placeholder="A feeling, something you're proud of, a little memory…"
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
              ]}
            />
            <View style={styles.buttonRow}>
              <Pressable onPress={handleSave} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="accent" style={[styles.actionButton, styles.pointer]}>
                  <ThemedText type="smallBold" style={styles.actionButtonText}>
                    {reflectionForDay ? 'Update' : 'Save'}
                  </ThemedText>
                </ThemedView>
              </Pressable>
              {reflectionForDay ? (
                <Pressable onPress={handleDelete} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundElement" style={[styles.actionButton, styles.pointer]}>
                    <ThemedText type="smallBold">Delete</ThemedText>
                  </ThemedView>
                </Pressable>
              ) : null}
              {saveStatus === 'saved' ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Saved ✓
                </ThemedText>
              ) : null}
              {saveStatus === 'error' ? (
                <ThemedText type="small" themeColor="accent">
                  Couldn&apos;t save on this device — please try again.
                </ThemedText>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {draft.length}/{MAX_REFLECTION_LENGTH} · writing is always optional
            </ThemedText>
          </DetailPanel>

          <DetailPanel title="📖 Journal history">
            {reflections.length === 0 ? (
              <DetailEmptyState
                icon={<ThemedText style={styles.emoji}>📖</ThemedText>}
                title="No reflections yet"
                text="Whenever you'd like to remember a day, write a few words above."
              />
            ) : (
              [...reflections]
                .sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1))
                .map((r) => (
                  <Pressable
                    key={r.id}
                    onPress={() => setSelectedDate(r.dateISO)}
                    style={({ pressed }) => [styles.historyRow, { borderColor: theme.backgroundSelected }, pressed && styles.pressed]}>
                    <ThemedText type="smallBold">{formatFullDate(r.dateISO)}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                      {r.text}
                    </ThemedText>
                  </Pressable>
                ))
            )}
          </DetailPanel>
        </>
      ) : null}

      {view === 'month' ? (
        <>
          <DetailPanel title="🗓️ Monthly view">
            <Nav label={`${MONTH_NAMES[month0]} ${year}`} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} />
            <View style={styles.weekdayRow}>
              {WEEKDAY_INITIALS.map((letter, i) => (
                <ThemedText key={i} type="small" themeColor="textSecondary" style={styles.weekdayCell}>
                  {letter}
                </ThemedText>
              ))}
            </View>
            <View style={styles.calendarGrid}>
              {Array.from({ length: firstWeekday }, (_, i) => (
                <View key={`blank-${i}`} style={styles.calendarCell} />
              ))}
              {Array.from({ length: monthDayCount }, (_, i) => {
                const dateISO = toISO(year, month0, i + 1);
                const mood = dayByDate.get(dateISO);
                return (
                  <Pressable
                    key={dateISO}
                    onPress={() => {
                      setSelectedDate(dateISO);
                      setView('day');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${formatFullDate(dateISO)}${mood ? `, ${mood}` : ', no check-in'}`}
                    style={styles.calendarCell}>
                    <View
                      style={[
                        styles.calendarDay,
                        styles.pointer,
                        { backgroundColor: mood ? MOOD_COLORS[mood] : NO_ENTRY_COLOR },
                        dateISO === todayISO() && { borderColor: theme.accent, borderWidth: 2 },
                      ]}>
                      <ThemedText type="small" style={styles.calendarDayText}>
                        {i + 1}
                      </ThemedText>
                      {reflectionDates.has(dateISO) ? <ThemedText style={styles.calendarNote}>📝</ThemedText> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <MoodLegend />
            <DetailNote>If you checked in more than once on a day, the calendar shows the latest one. Tap a day to see all of them.</DetailNote>
          </DetailPanel>

          <DetailPanel title="📊 Check-ins this month">
            {monthEntries.length === 0 ? (
              <DetailEmptyState icon={<ThemedText style={styles.emoji}>🌱</ThemedText>} title="No check-ins this month" text="Pick a mood on the Home page to start your month." />
            ) : (
              <CompletedBarChart buckets={monthBuckets} color="#B9A3E6" labelEvery={5} />
            )}
          </DetailPanel>

          <DetailPanel title="🥧 Mood mix this month">
            {monthEntries.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">Nothing recorded yet this month.</ThemedText>
            ) : (
              <PieChart slices={moodSlices(monthEntries)} />
            )}
          </DetailPanel>
        </>
      ) : null}

      {view === 'year' ? (
        <>
          <DetailPanel title="🌸 Yearly view">
            <Nav label={`${year}`} onPrev={() => shiftYear(-1)} onNext={() => shiftYear(1)} />
            <ThemedText type="small" themeColor="textSecondary">
              {yearDays} days{isLeapYear(year) ? ' (leap year)' : ''} · {distinctDays(yearEntries)} with a check-in
            </ThemedText>
            <MoodLegend />
            <View style={styles.yearGrid}>
              {Array.from({ length: 12 }, (_, m) => (
                <View key={m} style={styles.yearRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.yearMonthLabel}>
                    {MONTH_SHORT_NAMES[m]}
                  </ThemedText>
                  {Array.from({ length: 31 }, (_, d) => {
                    if (d + 1 > daysInMonth(year, m)) return <View key={d} style={styles.yearCell} />;
                    const dateISO = toISO(year, m, d + 1);
                    const mood = dayByDate.get(dateISO);
                    return (
                      <Pressable
                        key={d}
                        onPress={() => setSelectedDate(dateISO)}
                        accessibilityRole="button"
                        accessibilityLabel={`${formatFullDate(dateISO)}${mood ? `, ${mood}` : ', no check-in'}`}
                        style={styles.yearCell}>
                        <View
                          style={[
                            styles.yearSquare,
                            styles.pointer,
                            { backgroundColor: mood ? MOOD_COLORS[mood] : NO_ENTRY_COLOR },
                            dateISO === selectedDate && { borderColor: theme.accent, borderWidth: 2 },
                          ]}
                        />
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
            <DetailNote>Each square is one day (the latest mood that day). Grey squares just mean no check-in.</DetailNote>
          </DetailPanel>

          <DetailPanel title={`📍 ${formatFullDate(selectedDate)}`}>
            <MoodList dateISO={selectedDate} />
            {reflectionForDay ? (
              <ThemedText type="small">&ldquo;{reflectionForDay.text}&rdquo;</ThemedText>
            ) : null}
            <Pressable onPress={() => setView('day')} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={[styles.actionButton, styles.pointer, styles.selfStart]}>
                <ThemedText type="smallBold">Open this day</ThemedText>
              </ThemedView>
            </Pressable>
          </DetailPanel>

          <DetailPanel title="🥧 Mood mix this year">
            {yearEntries.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">Nothing recorded in {year} yet.</ThemedText>
            ) : (
              <PieChart slices={moodSlices(yearEntries)} />
            )}
          </DetailPanel>

          <DetailPanel title="📊 Check-ins by month">
            {yearEntries.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">Nothing recorded in {year} yet.</ThemedText>
            ) : (
              <CompletedBarChart buckets={yearBuckets} color="#B9A3E6" />
            )}
          </DetailPanel>
        </>
      ) : null}
    </DetailPageShell>
  );
}

function MoodLegend() {
  return (
    <View style={styles.legendRow}>
      {MOODS.map((mood: Mood) => (
        <View key={mood} style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: MOOD_COLORS[mood] }]} />
          <ThemedText type="small" themeColor="textSecondary">
            {mood}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.8 },
  pointer: { cursor: 'pointer' },
  selfStart: { alignSelf: 'flex-start' },
  emoji: { fontSize: 40, lineHeight: 48 },
  dash: { fontSize: 36, lineHeight: 44 },
  topMoodCard: {
    flexGrow: 1,
    flexBasis: 200,
    alignItems: 'center',
    gap: 2,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  tabRow: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  tab: { paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: Spacing.five },
  tabTextActive: { color: '#FFFFFF' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  navButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.five },
  navLabel: { flexShrink: 1, fontSize: 16, lineHeight: 22 },
  moodRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  moodRowText: { gap: 0 },
  input: {
    minHeight: 96,
    borderWidth: 2,
    borderRadius: Spacing.three,
    padding: Spacing.two,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  actionButton: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one, borderRadius: Spacing.five },
  actionButtonText: { color: '#FFFFFF' },
  historyRow: { paddingVertical: Spacing.two, borderBottomWidth: 1, gap: 2 },
  weekdayRow: { flexDirection: 'row' },
  weekdayCell: { width: '14.2857%', textAlign: 'center' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calendarCell: { width: '14.2857%', aspectRatio: 1, padding: 2 },
  calendarDay: {
    flex: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 0,
  },
  calendarDayText: { fontSize: 13, lineHeight: 16 },
  calendarNote: { fontSize: 9, lineHeight: 11 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 12, height: 12, borderRadius: 6 },
  yearGrid: { gap: 3 },
  yearRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  yearMonthLabel: { width: 32, fontSize: 11, lineHeight: 14 },
  yearCell: { flex: 1, aspectRatio: 1 },
  yearSquare: { flex: 1, borderRadius: 3, borderWidth: 0, margin: 0.5 },
});
