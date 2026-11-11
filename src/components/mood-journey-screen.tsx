import { Ionicons } from '@expo/vector-icons';

import { getLocale, useT } from '@/i18n';
import { useUnfinishedWork } from '@/hooks/use-unfinished-work';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

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
import { MoodIcon } from '@/components/mood-icon';
import { PieChart, type PieSlice } from '@/components/pie-chart';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useActiveProfileId } from '@/hooks/use-active-profile';
import { useTheme } from '@/hooks/use-theme';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import {
  MAX_REFLECTION_LENGTH,
  deleteReflection,
  getReflections,
  isShared,
  saveReflection,
  setReflectionVisibility,
  subscribeToJournal,
  type Reflection,
} from '@/utils/journal';
import { getProfilesStatus } from '@/utils/profiles';
import { MOODS, moodName, type Mood } from '@/utils/mood';
import { getMoodLog, subscribeToMoodLog, type MoodEntry } from '@/utils/mood-log';
import {
  monthNames,
  monthShortNames,
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

function parseISO(dateISO: string): { year: number; month0: number; day: number } {
  const [y, m, d] = dateISO.split('-').map(Number);
  return { year: y, month0: m - 1, day: d };
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' });
}

function moodSlices(entries: MoodEntry[]): PieSlice[] {
  const counts = countByMood(entries);
  return MOODS.map((mood) => ({ key: mood, label: moodName(mood), value: counts[mood], color: MOOD_COLORS[mood] }));
}

// The two privacy buttons: big, rounded, pastel. The chosen one keeps a clear border, a deeper fill and a checkmark; hovering (mouse, web)
// gets the shared soft glow from HoverPressable; pressing (touch) shrinks and dims it a little so a tap is always visible.
const CHOICE_COLORS = {
  private: { fill: '#EFE9FA', fillSelected: '#E2D6F7', border: '#A78BDB', icon: '#7B5CB8' },
  shared: { fill: '#FCEEF1', fillSelected: '#F9D9E4', border: '#F28DAE', icon: '#D9578A' },
} as const;

// The two privacy icons: simple outline icons of one size and weight (a lock, and two people), used on the buttons and in the history.
const CHOICE_ICON_NAME = { private: 'lock-closed-outline', shared: 'people-outline' } as const;
const CHOICE_ICON_SIZE = 28;
const MARKER_ICON_SIZE = 16;

function PrivacyChoiceButton({
  kind,
  label,
  hint,
  selected,
  disabled,
  colors,
  onPress,
}: {
  kind: 'private' | 'shared';
  label: string;
  hint: string;
  selected: boolean;
  disabled: boolean;
  colors: { fill: string; fillSelected: string; border: string; icon: string };
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={`${label}. ${hint}`}
      accessibilityState={{ checked: selected, selected, disabled }}
      style={({ pressed }) => [
        styles.choiceButton,
        { backgroundColor: selected ? colors.fillSelected : colors.fill, borderColor: selected ? colors.border : 'rgba(255, 255, 255, 0.85)' },
        pressed && styles.choicePressed,
        disabled && styles.choiceDisabled,
      ]}>
      <View style={styles.choiceIcon}>
        <Ionicons
          testID={`privacy-icon-${kind}`}
          name={CHOICE_ICON_NAME[kind]}
          size={CHOICE_ICON_SIZE}
          color={colors.icon}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </View>
      <View style={styles.choiceText}>
        <ThemedText type="smallBold" style={styles.choiceLabel}>
          {label}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      </View>
      {selected ? (
        <View style={[styles.choiceCheck, { backgroundColor: colors.border }]}>
          <ThemedText style={styles.choiceCheckMark}>✓</ThemedText>
        </View>
      ) : null}
    </Pressable>
  );
}

export function MoodJourneyScreen() {
  const { t, tl } = useT();
  const WEEKDAY_INITIALS = tl('weekdaysNarrow');
  const theme = useTheme();
  const [view, setView] = useState<View_>('day');
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [entries, setEntries] = useState<MoodEntry[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [draft, setDraft] = useState('');
  // Only a CHILD profile in family mode can share an entry with a parent. Main (and a later Adult Profile) never gets the choice: its
  // journal stays personal.
  const profileId = useActiveProfileId();
  const canShare = FAMILY_MODE_ENABLED && getProfilesStatus().profiles.some((p) => p.id === profileId && p.kind === 'child');
  // The choice shown in the editor. A day's entry starts as stored (private unless shared); picking Shared only takes effect at Save.
  const [shareChoice, setShareChoice] = useState(false);
  const [privacyBusy, setPrivacyBusy] = useState(false);
  // 'saved' only after a save really reached storage; 'error' if it didn't. 'private' = an entry was made private and that was confirmed.
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error' | 'private' | 'privacy-error'>('idle');
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
  // A reflection with changes that were not saved is unfinished.
  const storedShared = reflectionForDay ? isShared(reflectionForDay) : false;
  useUnfinishedWork('journal', draft.trim() !== (reflectionForDay?.text ?? '').trim() || (canShare && shareChoice && !storedShared));

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

  // The choice follows what is stored for the day (on a day change, and when the stored setting changes). A Shared pick that was not
  // saved yet is not overwritten by unrelated updates, because the stored setting has not changed.
  useEffect(() => {
    setShareChoice(storedShared);
  }, [selectedDate, storedShared]);

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
    // Only a child who can share passes a choice; otherwise the entry keeps the setting it has (private for a new one).
    const ok = await saveReflection(date, draft, canShare ? (shareChoice ? 'shared' : 'private') : undefined);
    // Ignore the result if the player has since moved to another day.
    if (selectedDateRef.current !== date) return;
    // Saving empty text just clears the day, so there is nothing to confirm.
    setSaveStatus(!ok ? 'error' : hasText ? 'saved' : 'idle');
  }
  // Shared -> Private for an entry that is already shared: saved at once and confirmed against what is stored. ONLY the setting changes:
  // the text in the editor (saved or not) is left exactly as it is, and nothing is saved or discarded. Private -> Shared is just a pick
  // until Save.
  async function handleShareToggle() {
    if (privacyBusy) return;
    if (shareChoice && storedShared && reflectionForDay) {
      const date = selectedDate;
      setPrivacyBusy(true);
      const ok = await setReflectionVisibility(date, 'private');
      setPrivacyBusy(false);
      if (selectedDateRef.current !== date) return;
      if (ok) setShareChoice(false);
      setSaveStatus(ok ? 'private' : 'privacy-error');
      return;
    }
    setShareChoice(!shareChoice);
    setSaveStatus('idle');
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
          {t('mjNoCheckin')}
        </ThemedText>
      );
    }
    return (
      <>
        {dayEntries.map((entry) => (
          <View key={entry.id} style={styles.moodRow}>
            <MoodIcon mood={entry.mood} size={40} />
            <View style={styles.moodRowText}>
              <ThemedText type="smallBold">{moodName(entry.mood)}</ThemedText>
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
        <Pressable onPress={onPrev} accessibilityRole="button" accessibilityLabel={t('histPrevious')} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
            <ThemedText type="smallBold">‹</ThemedText>
          </ThemedView>
        </Pressable>
        <ThemedText type="smallBold" style={styles.navLabel}>
          {label}
        </ThemedText>
        <Pressable onPress={onNext} accessibilityRole="button" accessibilityLabel={t('histNext')} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
            <ThemedText type="smallBold">›</ThemedText>
          </ThemedView>
        </Pressable>
        {extra}
      </View>
    );
  }

  const tabs: { id: View_; label: string }[] = [
    { id: 'day', label: t('mjTabDay') },
    { id: 'month', label: t('mjTabMonth') },
    { id: 'year', label: t('mjTabYear') },
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
    weekdayLabel: monthShortNames()[i],
    count,
  }));
  const yearDays = isLeapYear(year) ? 366 : 365;

  return (
    <DetailPageShell>
      <DetailTitleCard
        icon={<MoodIcon mood="Happy" size={64} />}
        title={t('mjTitle')}
        backgroundColor={PAGE_BACKGROUND}
      />

      <SummaryRow>
        <SummaryCard value={entries.length} label={t('mjCheckins')} backgroundColor={PAGE_BACKGROUND} />
        <SummaryCard value={distinctDays(entries)} label={t('mjDays')} backgroundColor={PAGE_BACKGROUND} />
        <View style={[styles.topMoodCard, { backgroundColor: PAGE_BACKGROUND }]}>
          {topMood ? <MoodIcon mood={topMood} size={44} /> : <ThemedText style={styles.dash}>–</ThemedText>}
          <ThemedText type="smallBold">{topMood ? moodName(topMood) : t('mjNoCheckinsYet')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('mjMostRecorded')}
          </ThemedText>
        </View>
      </SummaryRow>

      <DetailPanel title={t('mjPattern')}>
        <ThemedText type="small" themeColor="textSecondary">
          {describeMoodPattern(entries)}
        </ThemedText>
        <DetailNote>{t('mjLocalNote')}</DetailNote>
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
          <DetailPanel title={t('mjDailyView')}>
            <Nav
              label={formatFullDate(selectedDate)}
              onPrev={() => setSelectedDate(addDaysISO(selectedDate, -1))}
              onNext={() => setSelectedDate(addDaysISO(selectedDate, 1))}
              extra={
                selectedDate !== todayISO() ? (
                  <Pressable onPress={() => setSelectedDate(todayISO())} style={({ pressed }) => pressed && styles.pressed}>
                    <ThemedView type="backgroundElement" style={[styles.navButton, styles.pointer]}>
                      <ThemedText type="smallBold">{t('mjToday')}</ThemedText>
                    </ThemedView>
                  </Pressable>
                ) : null
              }
            />
            <ThemedText type="smallBold">{t('mjHowFelt')}</ThemedText>
            <MoodList dateISO={selectedDate} />
          </DetailPanel>

          <DetailPanel title={t('mjReflection')}>
            <ThemedText type="small" themeColor="textSecondary">
              {t('mjReflectionPrompt')}
            </ThemedText>
            <TextInput
              value={draft}
              onChangeText={(text) => {
                setDraft(text);
                setSaveStatus('idle');
              }}
              multiline
              maxLength={MAX_REFLECTION_LENGTH}
              placeholder={t('mjReflectionPlaceholder')}
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
              ]}
            />
            {canShare ? (
              <View style={styles.shareBox}>
                <View accessibilityRole="radiogroup" accessibilityLabel={t('mjShareLabel')} style={styles.choiceRow}>
                  <PrivacyChoiceButton
                    kind="private"
                    label={t('mjJustMe')}
                    hint={t('mjJustMeHint')}
                    selected={!shareChoice}
                    disabled={privacyBusy}
                    colors={CHOICE_COLORS.private}
                    onPress={() => {
                      if (shareChoice) void handleShareToggle();
                    }}
                  />
                  <PrivacyChoiceButton
                    kind="shared"
                    label={t('mjShareParent')}
                    hint={t('mjShareParentHint')}
                    selected={shareChoice}
                    disabled={privacyBusy}
                    colors={CHOICE_COLORS.shared}
                    onPress={() => {
                      if (!shareChoice) void handleShareToggle();
                    }}
                  />
                </View>
                <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
                  {shareChoice ? (storedShared ? t('mjSharedExplain') : t('mjShareNeedsSave')) : t('mjPrivateExplain')}
                </ThemedText>
              </View>
            ) : null}
            <View style={styles.buttonRow}>
              <Pressable onPress={handleSave} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="accent" style={[styles.actionButton, styles.pointer]}>
                  <ThemedText type="smallBold" style={styles.actionButtonText}>
                    {reflectionForDay ? t('mjUpdate') : t('mjSave')}
                  </ThemedText>
                </ThemedView>
              </Pressable>
              {reflectionForDay ? (
                <Pressable onPress={handleDelete} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedView type="backgroundElement" style={[styles.actionButton, styles.pointer]}>
                    <ThemedText type="smallBold">{t('mjDelete')}</ThemedText>
                  </ThemedView>
                </Pressable>
              ) : null}
              {saveStatus === 'saved' ? (
                <ThemedText type="small" themeColor="textSecondary">
                  {t('mjSaved')}
                </ThemedText>
              ) : null}
              {saveStatus === 'private' ? (
                <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
                  {t('mjNowPrivate')}
                </ThemedText>
              ) : null}
              {saveStatus === 'privacy-error' ? (
                <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
                  {t('mjPrivacyFailed')}
                </ThemedText>
              ) : null}
              {saveStatus === 'error' ? (
                <ThemedText type="small" themeColor="accent">
                  {t('mjSaveFailed')}
                </ThemedText>
              ) : null}
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {t('mjCounter', { n: draft.length, max: MAX_REFLECTION_LENGTH })}
            </ThemedText>
          </DetailPanel>

          <DetailPanel title={t('mjJournalHistory')}>
            {reflections.length === 0 ? (
              <DetailEmptyState
                icon={<ThemedText style={styles.emoji}>📖</ThemedText>}
                title={t('mjNoReflections')}
                text={t('mjNoReflectionsText')}
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
                    {canShare ? (
                      <View style={styles.marker}>
                        <Ionicons
                          testID={`history-icon-${isShared(r) ? 'shared' : 'private'}`}
                          name={CHOICE_ICON_NAME[isShared(r) ? 'shared' : 'private']}
                          size={MARKER_ICON_SIZE}
                          color={CHOICE_COLORS[isShared(r) ? 'shared' : 'private'].icon}
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                        />
                        <ThemedText type="small" themeColor="textSecondary">
                          {isShared(r) ? t('mjShareParent') : t('mjJustMe')}
                        </ThemedText>
                      </View>
                    ) : null}
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
          <DetailPanel title={t('mjMonthly')}>
            <Nav label={`${monthNames()[month0]} ${year}`} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} />
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
                    accessibilityLabel={mood ? t('mjDayLabel', { date: formatFullDate(dateISO), mood: moodName(mood) }) : t('mjDayLabelNone', { date: formatFullDate(dateISO) })}
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
            <DetailNote>{t('mjCalendarNote')}</DetailNote>
          </DetailPanel>

          <DetailPanel title={t('mjCheckinsMonth')}>
            {monthEntries.length === 0 ? (
              <DetailEmptyState icon={<ThemedText style={styles.emoji}>🌱</ThemedText>} title={t('mjNoCheckinsMonth')} text={t('mjNoCheckinsMonthText')} />
            ) : (
              <CompletedBarChart buckets={monthBuckets} color="#B9A3E6" labelEvery={5} />
            )}
          </DetailPanel>

          <DetailPanel title={t('mjMixMonth')}>
            {monthEntries.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">{t('mjNothingMonth')}</ThemedText>
            ) : (
              <PieChart slices={moodSlices(monthEntries)} />
            )}
          </DetailPanel>
        </>
      ) : null}

      {view === 'year' ? (
        <>
          <DetailPanel title={t('mjYearly')}>
            <Nav label={`${year}`} onPrev={() => shiftYear(-1)} onNext={() => shiftYear(1)} />
            <ThemedText type="small" themeColor="textSecondary">
              {t('mjYearSummary', { days: yearDays, leap: isLeapYear(year) ? t('mjLeap') : '', n: distinctDays(yearEntries) })}
            </ThemedText>
            <MoodLegend />
            <View style={styles.yearGrid}>
              {Array.from({ length: 12 }, (_, m) => (
                <View key={m} style={styles.yearRow}>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.yearMonthLabel}>
                    {monthShortNames()[m]}
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
                        accessibilityLabel={mood ? t('mjDayLabel', { date: formatFullDate(dateISO), mood: moodName(mood) }) : t('mjDayLabelNone', { date: formatFullDate(dateISO) })}
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
            <DetailNote>{t('mjYearNote')}</DetailNote>
          </DetailPanel>

          <DetailPanel title={`📍 ${formatFullDate(selectedDate)}`}>
            <MoodList dateISO={selectedDate} />
            {reflectionForDay ? (
              <ThemedText type="small">&ldquo;{reflectionForDay.text}&rdquo;</ThemedText>
            ) : null}
            <Pressable onPress={() => setView('day')} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={[styles.actionButton, styles.pointer, styles.selfStart]}>
                <ThemedText type="smallBold">{t('mjOpenDay')}</ThemedText>
              </ThemedView>
            </Pressable>
          </DetailPanel>

          <DetailPanel title={t('mjMixYear')}>
            {yearEntries.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">{t('mjNothingYear', { year })}</ThemedText>
            ) : (
              <PieChart slices={moodSlices(yearEntries)} />
            )}
          </DetailPanel>

          <DetailPanel title={t('mjByMonth')}>
            {yearEntries.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">{t('mjNothingYear', { year })}</ThemedText>
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
            {moodName(mood)}
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
  shareBox: { gap: Spacing.two },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  // At least 72 px tall and 150 px wide: comfortable for a child's thumb on a phone, and two fit side by side on a tablet.
  choiceButton: {
    flexGrow: 1,
    flexBasis: 150,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 20,
    borderWidth: 3,
    cursor: 'pointer',
  },
  choicePressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  choiceDisabled: { opacity: 0.6 },
  choiceIcon: { width: CHOICE_ICON_SIZE, height: CHOICE_ICON_SIZE, alignItems: 'center', justifyContent: 'center' },
  marker: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  choiceText: { flex: 1, gap: 2 },
  choiceLabel: { fontSize: 16, lineHeight: 21 },
  choiceCheck: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  choiceCheckMark: { color: '#FFFFFF', fontSize: 15, lineHeight: 18, fontWeight: '800' },
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
