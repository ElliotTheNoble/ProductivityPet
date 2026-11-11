import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { hoverLift } from '@/constants/hover';
import { Spacing } from '@/constants/theme';
import { getLocale, useT, type StringKey } from '@/i18n';
import {
  BUCKET_COUNTS,
  MISSED_ESTIMATE_DAYS,
  buildActivity,
  historyStartISO,
  type ActivityBucket,
  type ActivityPeriod,
  type Milestone,
  type MilestoneKind,
  type TaskLine,
} from '@/utils/child-activity-model';
import type { ChildActivity } from '@/utils/child-activity';

// The read-only Tasks, Accomplishments and Activity History cards of one child's overview on the Parent Dashboard. Everything shown comes from
// the ChildActivity record (see @/utils/child-activity.ts); where the saved data does not say something, a plain empty state is shown instead.
// Nothing here changes anything: there is no control except the Day / Week / Month / Year choice, which only changes what is shown.

type IconName = ComponentProps<typeof Ionicons>['name'];

const LIST_LIMIT = 8;

function formatDate(iso: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(getLocale(), options);
}
const shortDate = (iso: string) => formatDate(iso, { month: 'short', day: 'numeric' });

function SectionTitle({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <Ionicons name={icon} size={18} color="#7B5CB8" accessibilityElementsHidden importantForAccessibility="no" />
      <ThemedText type="smallBold">{children}</ThemedText>
    </View>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}

function Lines({ lines, repeatingSuffix }: { lines: TaskLine[]; repeatingSuffix?: boolean }) {
  const { t } = useT();
  return (
    <View style={styles.lines}>
      {lines.slice(0, LIST_LIMIT).map((item) => (
        <View key={item.id} style={styles.lineRow}>
          <ThemedText type="small" style={styles.lineText}>
            {item.important ? '★ ' : ''}
            {item.text}
          </ThemedText>
          {item.dateISO && !repeatingSuffix ? (
            <ThemedText type="small" themeColor="textSecondary">
              {shortDate(item.dateISO)}
            </ThemedText>
          ) : null}
        </View>
      ))}
      {lines.length > LIST_LIMIT ? <Note>{t('paMore', { count: lines.length - LIST_LIMIT })}</Note> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------------------------------------
export function ChildTasksSection({ activity }: { activity: ChildActivity }) {
  const { t } = useT();
  const section = activity.tasks;
  return (
    <>
      <Card title={t('phTasks')}>
        {section.state === 'unreadable' ? <Note>{t('paUnavailable')}</Note> : null}
        {section.state === 'none' ? <Note>{t('paTasksEmpty')}</Note> : null}
        {section.state === 'ok' ? <TaskStatusBlocks activity={activity} /> : null}
      </Card>

      <Card title={t('paAssignedTitle')} color="#FFF4E3">
        <Note>{t('paAssignedNote', { name: activity.nickname })}</Note>
        {activity.assigned.total === 0 ? <Note>{t('paAssignedEmpty', { name: activity.nickname })}</Note> : null}
        {(
          [
            ['assigned', 'paAssignedToDo'],
            ['pending', 'paAssignedPending'],
            ['approved', 'paAssignedApproved'],
            ['completed', 'paAssignedDone'],
          ] as const
        ).map(([status, label]) =>
          activity.assigned.byStatus[status].length > 0 ? (
            <View key={status} style={styles.block}>
              <ThemedText type="smallBold">{`${t(label)} (${activity.assigned.byStatus[status].length})`}</ThemedText>
              <View style={styles.lines}>
                {activity.assigned.byStatus[status].slice(0, LIST_LIMIT).map((task) => (
                  <ThemedText key={task.id} type="small">
                    {task.text}
                  </ThemedText>
                ))}
                {activity.assigned.byStatus[status].length > LIST_LIMIT ? (
                  <Note>{t('paMore', { count: activity.assigned.byStatus[status].length - LIST_LIMIT })}</Note>
                ) : null}
              </View>
            </View>
          ) : null
        )}
      </Card>
    </>
  );
}

function TaskStatusBlocks({ activity: a }: { activity: ChildActivity }) {
  const { t, tn } = useT();
  if (a.tasks.state !== 'ok') return null;
  const { status, skippedEntries } = a.tasks.value;
  const total = status.completed.total;
  return (
    <>
      <View style={styles.block}>
        <SectionTitle icon="today-outline">{t('paTasksNow')}</SectionTitle>
        <Note>{t('paTasksNowNote')}</Note>
        {status.dueToday.length === 0 && status.doneTodayCount === 0 ? <ThemedText type="small">{t('paNothingToday')}</ThemedText> : null}
        {status.dueToday.length > 0 ? <ThemedText type="smallBold">{tn('paDueToday', status.dueToday.length)}</ThemedText> : null}
        {status.dueToday.length > 0 ? <Lines lines={status.dueToday} repeatingSuffix /> : null}
        {status.doneTodayCount > 0 ? <ThemedText type="small">{t('paDoneToday', { count: status.doneTodayCount })}</ThemedText> : null}
        {status.activeRepeatingCount > 0 ? <Note>{tn('paRepeatingRunning', status.activeRepeatingCount)}</Note> : null}
      </View>

      {status.upcoming.length > 0 ? (
        <View style={styles.block}>
          <SectionTitle icon="calendar-outline">{`${t('paUpcoming')} (${status.upcoming.length})`}</SectionTitle>
          <Note>{t('paUpcomingNote')}</Note>
          <Lines lines={status.upcoming} />
        </View>
      ) : null}

      {status.pastDueNotDone.length > 0 ? (
        <View style={styles.block}>
          <SectionTitle icon="alert-circle-outline">{`${t('paPastDue')} (${status.pastDueNotDone.length})`}</SectionTitle>
          <Note>{t('paPastDueNote')}</Note>
          <Lines lines={status.pastDueNotDone} />
        </View>
      ) : null}

      {status.noDueDate.length > 0 ? (
        <View style={styles.block}>
          <SectionTitle icon="help-circle-outline">{`${t('paNoDueDate')} (${status.noDueDate.length})`}</SectionTitle>
          <Note>{t('paNoDueDateNote')}</Note>
          <Lines lines={status.noDueDate} />
        </View>
      ) : null}

      <View style={styles.block}>
        <SectionTitle icon="repeat-outline">{t('paRepeating')}</SectionTitle>
        <Note>{t('paRepeatingNote', { days: MISSED_ESTIMATE_DAYS })}</Note>
        {status.repeatingEstimate.items.length === 0 ? <ThemedText type="small">{t('paRepeatingNone', { days: MISSED_ESTIMATE_DAYS })}</ThemedText> : null}
        {status.repeatingEstimate.items.slice(0, LIST_LIMIT).map((item) => (
          <ThemedText key={item.id} type="small">
            {`${item.important ? '★ ' : ''}${item.text}: ${item.dates.slice(0, 6).map(shortDate).join(', ')}${item.dates.length > 6 ? ` +${item.dates.length - 6}` : ''}`}
          </ThemedText>
        ))}
        {status.repeatingEstimate.items.length > LIST_LIMIT ? <Note>{t('paMore', { count: status.repeatingEstimate.items.length - LIST_LIMIT })}</Note> : null}
      </View>

      <View style={styles.block}>
        <SectionTitle icon="checkmark-circle-outline">{tn('paCompletedTotal', total)}</SectionTitle>
        <Note>{t('paCompletedNote')}</Note>
        {status.completed.important > 0 ? <ThemedText type="small">{t('paCompletedImportant', { count: status.completed.important })}</ThemedText> : null}
        {status.completed.undated > 0 ? <ThemedText type="small">{tn('paCompletedUndated', status.completed.undated)}</ThemedText> : null}
        {skippedEntries > 0 ? <Note>{tn('paTasksSkipped', skippedEntries)}</Note> : null}
      </View>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
const MILESTONE_TEXT: Record<MilestoneKind, StringKey> = {
  adopted: 'paMsArrived',
  hatched: 'paMsHatched',
  recovered: 'paMsRecovered',
  resurrected: 'paMsResurrected',
  retired: 'paMsRetired',
  returned: 'paMsReturned',
  died: 'paMsDied',
};

const SOURCE_TEXT = { task: 'thSrcTask', appointment: 'thSrcAppointment', 'kitty-catch': 'thSrcKittyCatch', 'memory-match': 'thSrcMemoryMatch' } as const;

export function ChildAccomplishmentsSection({ activity }: { activity: ChildActivity }) {
  const { t, tn } = useT();
  const milestones = activity.milestones;
  const tokens = activity.tokens;
  const streak = activity.streak;
  const bigDate = (iso: string) => formatDate(iso, { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <Card title={t('phAchievements')}>
      <View style={styles.block}>
        <SectionTitle icon="flame-outline">{t('paStreak')}</SectionTitle>
        {streak === null ? (
          <ThemedText type="small">{t('paReadError')}</ThemedText>
        ) : (
          <>
            <ThemedText type="smallBold">{tn('paDays', streak.current)}</ThemedText>
            <Note>{t('paBest', { value: tn('paDays', streak.longest) })}</Note>
          </>
        )}
      </View>

      <View style={styles.block}>
        <SectionTitle icon="star-outline">{t('paTokens')}</SectionTitle>
        {tokens.state === 'unreadable' ? <ThemedText type="small">{t('paReadError')}</ThemedText> : null}
        {tokens.state === 'none' ? <ThemedText type="small">{t('paTokensNone')}</ThemedText> : null}
        {tokens.state === 'ok' ? (
          <>
            {tokens.value.balance !== null ? <ThemedText type="smallBold">{t('paTokensNow', { count: tokens.value.balance })}</ThemedText> : null}
            <Note>{t('paTokensEarned', { count: tokens.value.total, date: tokens.value.startedISO ? bigDate(tokens.value.startedISO) : '—' })}</Note>
            {(Object.keys(SOURCE_TEXT) as (keyof typeof SOURCE_TEXT)[])
              .filter((source) => tokens.value.bySource[source] > 0)
              .map((source) => (
                <View key={source} style={styles.lineRow}>
                  <ThemedText type="small" style={styles.lineText}>
                    {t(SOURCE_TEXT[source])}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {tokens.value.bySource[source]}
                  </ThemedText>
                </View>
              ))}
          </>
        ) : null}
      </View>

      <View style={styles.block}>
        <SectionTitle icon="bag-handle-outline">{t('paShopItems')}</SectionTitle>
        {activity.itemsOwned.state === 'unreadable' ? <ThemedText type="small">{t('paReadError')}</ThemedText> : null}
        {activity.itemsOwned.state === 'none' ? <ThemedText type="smallBold">0</ThemedText> : null}
        {activity.itemsOwned.state === 'ok' ? <ThemedText type="smallBold">{activity.itemsOwned.value}</ThemedText> : null}
      </View>

      <View style={styles.block}>
        <SectionTitle icon="ribbon-outline">{t('paMilestones')}</SectionTitle>
        {milestones.state === 'unreadable' ? <ThemedText type="small">{t('paReadError')}</ThemedText> : null}
        {milestones.state === 'none' || (milestones.state === 'ok' && milestones.value.length === 0) ? <ThemedText type="small">{t('paNoMilestones')}</ThemedText> : null}
        {milestones.state === 'ok'
          ? milestones.value.slice(0, LIST_LIMIT).map((m) => (
              <View key={`${m.petId}:${m.kind}:${m.at}`} style={styles.lineRow}>
                <ThemedText type="small" style={styles.lineText}>
                  {t(MILESTONE_TEXT[m.kind], { pet: m.petLabel })}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {bigDate(m.dateISO)}
                </ThemedText>
              </View>
            ))
          : null}
        {milestones.state === 'ok' && milestones.value.length > LIST_LIMIT ? <Note>{t('paMore', { count: milestones.value.length - LIST_LIMIT })}</Note> : null}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------------------
const PERIODS: { id: ActivityPeriod; label: StringKey }[] = [
  { id: 'day', label: 'paPeriodDay' },
  { id: 'week', label: 'paPeriodWeek' },
  { id: 'month', label: 'paPeriodMonth' },
  { id: 'year', label: 'paPeriodYear' },
];

export function ChildActivitySection({ activity }: { activity: ChildActivity }) {
  const { t, tn } = useT();
  const [period, setPeriod] = useState<ActivityPeriod>('day');
  const buckets = buildActivity(period, activity.today, activity.activityInput);
  const undated = activity.tasks.state === 'ok' ? activity.tasks.value.status.completed.undated : 0;
  const start = historyStartISO(activity.activityInput, activity.today);
  const label = (bucket: ActivityBucket): string => {
    if (period === 'day') return formatDate(bucket.startISO, { weekday: 'short', month: 'short', day: 'numeric' });
    if (period === 'week') return t('paWeekOf', { date: shortDate(bucket.startISO) });
    if (period === 'month') return formatDate(bucket.startISO, { month: 'long', year: 'numeric' });
    return bucket.key;
  };
  return (
    <Card title={t('paActTitle')}>
      <Note>{t('paActNote')}</Note>
      <View accessibilityRole="radiogroup" style={styles.pills}>
        {PERIODS.map((item) => {
          const selected = item.id === period;
          return (
            <Pressable
              key={item.id}
              onPress={() => setPeriod(item.id)}
              accessibilityRole="radio"
              accessibilityLabel={t(item.label)}
              accessibilityState={{ checked: selected, selected }}
              style={(state) => [styles.pill, selected ? styles.pillOn : styles.pillOff, state.pressed && styles.pillPressed, hoverLift(state, !selected)]}>
              <ThemedText type="smallBold" style={selected ? styles.pillOnText : undefined}>
                {t(item.label)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
      {undated > 0 ? <Note>{tn('paActUndated', undated)}</Note> : null}
      {start ? <Note>{t('paActSince', { date: formatDate(start, { month: 'short', day: 'numeric', year: 'numeric' }) })}</Note> : null}
      {buckets.length === 0 ? <ThemedText type="small">{t('paActNothing')}</ThemedText> : null}
      <View style={styles.rows} testID={`activity-${period}`}>
        {buckets.slice(0, BUCKET_COUNTS[period]).map((bucket) => (
          <View key={bucket.key} style={styles.activityRow}>
            <ThemedText type="smallBold">{label(bucket)}</ThemedText>
            <ThemedText type="small">{bucket.tasksCompleted > 0 ? tn('paRowTasks', bucket.tasksCompleted) : t('paRowNone')}</ThemedText>
            {bucket.tokenCoverage === 'tracked' && (bucket.tokens ?? 0) > 0 ? <ThemedText type="small">{t('paRowTokens', { count: bucket.tokens ?? 0 })}</ThemedText> : null}
            {bucket.tokenCoverage === 'partial' && (bucket.tokens ?? 0) > 0 ? <ThemedText type="small">{t('paRowTokensPartial', { count: bucket.tokens ?? 0 })}</ThemedText> : null}
            {bucket.tokenCoverage === 'before-tracking' ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('paRowTokensBefore')}
              </ThemedText>
            ) : null}
            {bucket.tokenCoverage === 'not-recorded' ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('paRowTokensNone')}
              </ThemedText>
            ) : null}
            {bucket.milestones.map((m: Milestone) => (
              <ThemedText key={`${m.petId}:${m.kind}:${m.at}`} type="small" themeColor="textSecondary">
                {`🐾 ${t(MILESTONE_TEXT[m.kind], { pet: m.petLabel })}`}
              </ThemedText>
            ))}
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  block: { gap: Spacing.one, paddingTop: Spacing.one },
  lines: { gap: 2 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  lineText: { flex: 1, minWidth: 0 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  pill: { minHeight: 44, minWidth: 64, paddingHorizontal: Spacing.three, borderRadius: Spacing.five, alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: '#A78BDB' },
  pillOff: { backgroundColor: '#EFE9FA' },
  pillOnText: { color: '#FFFFFF' },
  pillPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  rows: { gap: Spacing.two },
  activityRow: { gap: 2, paddingVertical: Spacing.one, borderBottomWidth: 1, borderColor: 'rgba(167, 139, 219, 0.25)' },
});
