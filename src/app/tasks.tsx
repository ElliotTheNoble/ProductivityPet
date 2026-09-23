import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TaskCalendar } from '@/components/task-calendar';
import { TaskEditModal, type TaskEditValues } from '@/components/task-edit-modal';
import { TaskIcon } from '@/components/task-icon';
import { TaskMenu, type TaskMenuItem } from '@/components/task-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getHolidayForDate } from '@/utils/holidays';
import { cancelTaskNotification, ensureNotificationPermission, syncTaskNotifications } from '@/utils/notifications';
import {
  createTask,
  editItemDetails,
  excludeDateFromTask,
  formatFullDate,
  getTasksForDate,
  isOccurrenceCompleted,
  normalizeTask,
  reminderOffsetLabel,
  sortByImportantFirst,
  stopRepeatingFrom,
  todayISO,
  toggleTaskOccurrence,
  type ReminderOffsetMinutes,
  type RepeatRule,
  type Task,
  type TaskKind,
} from '@/utils/tasks';

// Same key Home reads/writes — both screens hydrate independently from
// AsyncStorage (there's no shared app-wide store), and since Expo Router
// unmounts the previous screen on navigation, only one of them is ever
// mounted at a time, so this never causes a conflicting write.
const TASKS_STORAGE_KEY = '@ProductivityPet:tasks';

// Below this width, the calendar and the selected day's list stack instead
// of sitting side by side.
const WIDE_LAYOUT_BREAKPOINT = 700;
const WIDE_MAX_WIDTH = 1100;

const WEEKDAY_TOGGLE_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type RepeatOption = 'none' | 'daily' | 'weekly';

type ReminderOption =
  | 'none'
  | 'at-time'
  | '10-before'
  | '30-before'
  | '60-before'
  | '1-day-before'
  | '1-week-before';

const REMINDER_UI_OPTIONS: ReminderOption[] = ['none', 'at-time', '10-before', '30-before', '60-before'];

// Birthdays get two extra, longer-lead-time options on top of the usual
// four — Task/Appointment only ever see REMINDER_UI_OPTIONS.
const BIRTHDAY_REMINDER_UI_OPTIONS: ReminderOption[] = [...REMINDER_UI_OPTIONS, '1-day-before', '1-week-before'];

function reminderOptionToMinutes(option: ReminderOption): ReminderOffsetMinutes | undefined {
  switch (option) {
    case 'at-time':
      return 0;
    case '10-before':
      return 10;
    case '30-before':
      return 30;
    case '60-before':
      return 60;
    case '1-day-before':
      return 1440;
    case '1-week-before':
      return 10080;
    default:
      return undefined;
  }
}

function reminderOptionLabel(option: ReminderOption): string {
  if (option === 'none') return 'None';
  return reminderOffsetLabel(reminderOptionToMinutes(option) as ReminderOffsetMinutes);
}

const KIND_OPTIONS: TaskKind[] = ['task', 'event', 'birthday'];

function kindLabel(kind: TaskKind): string {
  switch (kind) {
    case 'task':
      return 'Task';
    case 'event':
      return 'Appointment';
    case 'birthday':
      return 'Birthday';
  }
}

export default function TasksScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isWideLayout = width >= WIDE_LAYOUT_BREAKPOINT;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayISO());

  const [isAdding, setIsAdding] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftKind, setDraftKind] = useState<TaskKind>('task');
  const [draftTime, setDraftTime] = useState('');
  const [draftRepeat, setDraftRepeat] = useState<RepeatOption>('none');
  const [draftWeeklyDays, setDraftWeeklyDays] = useState<Set<number>>(new Set());
  const [draftReminder, setDraftReminder] = useState<ReminderOption>('none');

  const [editingItem, setEditingItem] = useState<Task | null>(null);

  // Loads the same tasks Home saves, applying the same legacy-data repair
  // (normalizeTask) so a task added before this feature existed still shows
  // up under today rather than vanishing.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(TASKS_STORAGE_KEY)
      .then((stored) => {
        if (cancelled || !stored) return;
        try {
          const parsed = JSON.parse(stored) as unknown[];
          const today = todayISO();
          setTasks(parsed.map((raw) => normalizeTask(raw, today)));
        } catch {
          // Ignore corrupted/unreadable data and keep the default empty list.
        }
      })
      .finally(() => {
        if (!cancelled) setIsHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Also reconciles reminder notifications against the current tasks (see
  // syncTaskNotifications) — this only ever touches scheduling bookkeeping
  // fields, never anything that drives history or pet progress. Skipping
  // setTasks when nothing changed avoids re-triggering this same effect.
  useEffect(() => {
    if (!isHydrated) return;
    AsyncStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks)).catch(() => {});
    syncTaskNotifications(tasks)
      .then((updated) => {
        if (updated !== tasks) setTasks(updated);
      })
      .catch(() => {});
  }, [tasks, isHydrated]);

  function resetDraft() {
    setDraftText('');
    setDraftKind('task');
    setDraftTime('');
    setDraftRepeat('none');
    setDraftWeeklyDays(new Set());
    setDraftReminder('none');
    setIsAdding(false);
  }

  // Requests notification permission only at the moment the user actually
  // picks a reminder — never on app launch or just by opening the form. If
  // permission is denied, the selection simply doesn't change (stays at
  // whatever it was), so no reminder gets saved.
  async function selectDraftReminder(option: ReminderOption) {
    if (option !== 'none') {
      const granted = await ensureNotificationPermission();
      if (!granted) return;
    }
    setDraftReminder(option);
  }

  function toggleWeeklyDay(day: number) {
    setDraftWeeklyDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function handleAdd() {
    const text = draftText.trim();
    if (!text) return;

    let repeat: RepeatRule | undefined;
    if (draftKind === 'task') {
      if (draftRepeat === 'daily') {
        repeat = { kind: 'daily' };
      } else if (draftRepeat === 'weekly' && draftWeeklyDays.size > 0) {
        repeat = { kind: 'weekly', days: Array.from(draftWeeklyDays).sort() };
      }
    }

    const newTask = createTask({
      text,
      kind: draftKind,
      date: selectedDate,
      time: draftTime.trim() || undefined,
      repeat,
      reminderMinutesBefore: reminderOptionToMinutes(draftReminder),
    });
    setTasks((prev) => [...prev, newTask]);
    resetDraft();
  }

  function handleToggle(id: string) {
    setTasks((prev) => toggleTaskOccurrence(prev, id, selectedDate));
  }

  // Same Important toggle as Home — both screens hydrate the same
  // AsyncStorage-backed task list, so this stays saved and shows
  // consistently on both.
  function toggleImportant(id: string) {
    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, important: !task.important } : task))
    );
  }

  // Full delete — only ever used for one-time tasks and appointments, since
  // neither has recurring history that needs protecting. Cancels any
  // scheduled reminder first: once the record is filtered out,
  // syncTaskNotifications has nothing left to reconcile it against.
  function handleDelete(id: string) {
    const target = tasks.find((task) => task.id === id);
    if (target) cancelTaskNotification(target).catch(() => {});
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  // For a repeating task: everything before `selectedDate` (including past
  // completions) is left untouched; `selectedDate` and every later date
  // stop occurring.
  function handleStopRepeating(id: string) {
    setTasks((prev) => stopRepeatingFrom(prev, id, selectedDate));
  }

  // For a repeating task: removes just this one occurrence, leaving the
  // rest of the series (past and future) and all completion history alone.
  function handleRemoveThisDay(id: string) {
    setTasks((prev) => excludeDateFromTask(prev, id, selectedDate));
  }

  // Updates the existing record in place (editItemDetails only ever touches
  // name/kind/date/time/repeat/reminder) — completed, completedDates,
  // repeatUntil, excludedDates, and important all carry through untouched,
  // so editing (including changing its type, e.g. Task -> Appointment)
  // can't disturb history or pet progress. Birthday's yearly repeat is
  // enforced by editItemDetails itself, not here.
  function handleSaveEdit(id: string, values: TaskEditValues) {
    setTasks((prev) =>
      editItemDetails(prev, id, {
        text: values.text,
        kind: values.kind,
        date: values.date,
        time: values.time,
        repeat: values.repeat,
        reminderMinutesBefore: values.reminderMinutesBefore,
      })
    );
  }

  // Same three-dot menu component Home uses, so behavior is identical
  // rather than two separately-implemented look-alikes. A repeating task
  // gets both of the history-safe controls (Stop Repeating, Remove Just
  // This Day) instead of a single destructive delete.
  function buildMenuItems(task: Task): TaskMenuItem[] {
    const importantItem: TaskMenuItem = {
      key: 'important',
      label: task.important ? '⭐ Remove Important' : '⭐ Mark as Important',
      onPress: () => toggleImportant(task.id),
    };
    const editItem: TaskMenuItem = {
      key: 'edit',
      label: '✏️ Edit Task',
      onPress: () => setEditingItem(task),
    };

    if (task.repeat) {
      return [
        importantItem,
        editItem,
        {
          key: 'stop-repeating',
          label: '⏹ Stop Repeating From Here',
          onPress: () => handleStopRepeating(task.id),
          destructive: true,
        },
        {
          key: 'remove-day',
          label: '🗑️ Remove Just This Day',
          onPress: () => handleRemoveThisDay(task.id),
          destructive: true,
        },
      ];
    }

    return [
      importantItem,
      editItem,
      {
        key: 'delete',
        label: '🗑️ Delete Task',
        onPress: () => handleDelete(task.id),
        destructive: true,
      },
    ];
  }

  // Shared menu shape for both appointments and birthdays: no Important
  // toggle (only tasks have one). A birthday always has repeat set (forced
  // to yearly), so it always gets the same history-safe Stop Repeating /
  // Remove Just This Day pair an appointment gets if it happens to repeat;
  // a one-time appointment just gets Delete.
  function buildNonTaskMenuItems(item: Task): TaskMenuItem[] {
    const label = kindLabel(item.kind);
    const editItem: TaskMenuItem = {
      key: 'edit',
      label: `✏️ Edit ${label}`,
      onPress: () => setEditingItem(item),
    };

    if (item.repeat) {
      return [
        editItem,
        {
          key: 'stop-repeating',
          label: '⏹ Stop Repeating From Here',
          onPress: () => handleStopRepeating(item.id),
          destructive: true,
        },
        {
          key: 'remove-day',
          label: '🗑️ Remove Just This Day',
          onPress: () => handleRemoveThisDay(item.id),
          destructive: true,
        },
      ];
    }

    return [
      editItem,
      {
        key: 'delete',
        label: `🗑️ Delete ${label}`,
        onPress: () => handleDelete(item.id),
        destructive: true,
      },
    ];
  }

  const dayItems = getTasksForDate(tasks, selectedDate);
  const dayTasks = sortByImportantFirst(dayItems.filter((task) => task.kind === 'task'));
  const dayEvents = dayItems.filter((task) => task.kind === 'event');
  const dayBirthdays = dayItems.filter((task) => task.kind === 'birthday');
  // Read-only system data — entirely separate from the user's saved tasks;
  // never created, edited, or deleted through this screen's task editor.
  const dayHoliday = getHolidayForDate(selectedDate);

  const selectedDateLabel = formatFullDate(selectedDate);

  const calendar = (
    <TaskCalendar tasks={tasks} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
  );

  const dayPanel = (
    <ThemedView type="backgroundElementOverlay" style={styles.dayCard}>
      <View style={styles.dayHeaderRow}>
        <ThemedText style={styles.dayTitle}>{selectedDateLabel}</ThemedText>
        <Pressable
          onPress={() => setIsAdding((prev) => !prev)}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="accent" style={styles.addButton}>
            <ThemedText type="smallBold" style={styles.addButtonText}>
              + Add
            </ThemedText>
          </ThemedView>
        </Pressable>
      </View>

      {dayHoliday ? (
        <View style={[styles.holidayBanner, { backgroundColor: theme.sky }]}>
          <ThemedText type="smallBold" style={styles.holidayText}>
            🎉 {dayHoliday.name}
          </ThemedText>
        </View>
      ) : null}

      {isAdding ? (
        <View style={styles.form}>
          <View style={styles.pillRow}>
            {KIND_OPTIONS.map((kind) => (
              <Pressable
                key={kind}
                onPress={() => setDraftKind(kind)}
                style={({ pressed }) => pressed && styles.pressed}>
                <View
                  style={[
                    styles.pill,
                    { backgroundColor: draftKind === kind ? theme.purple : theme.background },
                  ]}>
                  <ThemedText type="smallBold" style={draftKind === kind ? styles.pillTextActive : undefined}>
                    {kindLabel(kind)}
                  </ThemedText>
                </View>
              </Pressable>
            ))}
          </View>

          <TextInput
            autoFocus
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
            ]}
            placeholder={
              draftKind === 'task'
                ? 'What do you need to do?'
                : draftKind === 'event'
                  ? 'What is the appointment?'
                  : 'Whose birthday is it?'
            }
            placeholderTextColor={theme.textSecondary}
            value={draftText}
            onChangeText={setDraftText}
            onSubmitEditing={handleAdd}
            returnKeyType="done"
          />

          <TextInput
            style={[
              styles.input,
              { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
            ]}
            placeholder="Time (optional, e.g. 3:00 PM)"
            placeholderTextColor={theme.textSecondary}
            value={draftTime}
            onChangeText={setDraftTime}
            onSubmitEditing={handleAdd}
            returnKeyType="done"
          />

          {draftTime.trim() ? (
            <View style={styles.repeatSection}>
              <ThemedText type="small" themeColor="textSecondary">
                Reminder
              </ThemedText>
              <View style={styles.pillRow}>
                {(draftKind === 'birthday' ? BIRTHDAY_REMINDER_UI_OPTIONS : REMINDER_UI_OPTIONS).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => selectDraftReminder(option)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <View
                      style={[
                        styles.pill,
                        { backgroundColor: draftReminder === option ? theme.purple : theme.background },
                      ]}>
                      <ThemedText
                        type="small"
                        style={draftReminder === option ? styles.pillTextActive : undefined}>
                        {reminderOptionLabel(option)}
                      </ThemedText>
                    </View>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {draftKind === 'birthday' ? (
            <ThemedText type="small" themeColor="textSecondary">
              🎂 Repeats every year on this date
            </ThemedText>
          ) : null}

          {draftKind === 'task' ? (
            <View style={styles.repeatSection}>
              <ThemedText type="small" themeColor="textSecondary">
                Repeat
              </ThemedText>
              <View style={styles.pillRow}>
                {(['none', 'daily', 'weekly'] as RepeatOption[]).map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setDraftRepeat(option)}
                    style={({ pressed }) => pressed && styles.pressed}>
                    <View
                      style={[
                        styles.pill,
                        { backgroundColor: draftRepeat === option ? theme.purple : theme.background },
                      ]}>
                      <ThemedText
                        type="small"
                        style={draftRepeat === option ? styles.pillTextActive : undefined}>
                        {option === 'none' ? 'Once' : option === 'daily' ? 'Daily' : 'Weekly'}
                      </ThemedText>
                    </View>
                  </Pressable>
                ))}
              </View>

              {draftRepeat === 'weekly' ? (
                <View style={styles.pillRow}>
                  {WEEKDAY_TOGGLE_LABELS.map((label, day) => {
                    const isActive = draftWeeklyDays.has(day);
                    return (
                      <Pressable
                        key={day}
                        onPress={() => toggleWeeklyDay(day)}
                        style={({ pressed }) => pressed && styles.pressed}>
                        <View
                          style={[
                            styles.weekdayToggle,
                            { backgroundColor: isActive ? theme.purple : theme.background },
                          ]}>
                          <ThemedText type="small" style={isActive ? styles.pillTextActive : undefined}>
                            {label}
                          </ThemedText>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.formButtonRow}>
            <Pressable onPress={handleAdd} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="accent" style={styles.saveButton}>
                <ThemedText type="smallBold" style={styles.addButtonText}>
                  Save
                </ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable onPress={resetDraft} style={({ pressed }) => pressed && styles.pressed}>
              <View style={[styles.cancelButton, { backgroundColor: theme.background }]}>
                <ThemedText type="smallBold">Cancel</ThemedText>
              </View>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Tasks
        </ThemedText>
        {dayTasks.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No tasks for this day.
          </ThemedText>
        ) : (
          dayTasks.map((task) => {
            const completed = isOccurrenceCompleted(task, selectedDate);
            return (
              <View key={task.id} style={styles.row}>
                <Pressable
                  onPress={() => handleToggle(task.id)}
                  style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
                  <View
                    style={[
                      styles.checkbox,
                      { borderColor: theme.backgroundSelected },
                      completed && { backgroundColor: theme.mint, borderColor: theme.mint },
                    ]}>
                    {completed ? <ThemedText style={styles.checkmark}>✓</ThemedText> : null}
                  </View>
                  <TaskIcon category={task.category} />
                  <View style={styles.rowTextGroup}>
                    <ThemedText
                      style={completed ? styles.completedText : undefined}
                      themeColor={completed ? 'textSecondary' : 'text'}>
                      {task.text}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {task.category}
                      {task.repeat ? ` · ${task.repeat.kind === 'daily' ? 'Daily' : 'Weekly'}` : ''}
                      {task.time ? ` · ${task.time}` : ''}
                    </ThemedText>
                  </View>
                </Pressable>

                {task.important ? <ThemedText style={styles.importantStar}>⭐</ThemedText> : null}

                <TaskMenu items={buildMenuItems(task)} />
              </View>
            );
          })
        )}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Appointments
        </ThemedText>
        {dayEvents.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No appointments for this day.
          </ThemedText>
        ) : (
          dayEvents.map((event) => (
            <View key={event.id} style={styles.row}>
              <View style={styles.rowMain}>
                <TaskIcon category={event.category} />
                <View style={styles.rowTextGroup}>
                  <ThemedText>{event.text}</ThemedText>
                  {event.time ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {event.time}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
              <TaskMenu items={buildNonTaskMenuItems(event)} />
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Birthdays
        </ThemedText>
        {dayBirthdays.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No birthdays for this day.
          </ThemedText>
        ) : (
          dayBirthdays.map((birthday) => (
            <View key={birthday.id} style={styles.row}>
              <View style={styles.rowMain}>
                <ThemedText style={styles.cakeIcon}>🎂</ThemedText>
                <View style={styles.rowTextGroup}>
                  <ThemedText>{birthday.text}</ThemedText>
                  {birthday.time ? (
                    <ThemedText type="small" themeColor="textSecondary">
                      {birthday.time}
                    </ThemedText>
                  ) : null}
                </View>
              </View>
              <TaskMenu items={buildNonTaskMenuItems(birthday)} />
            </View>
          ))
        )}
      </View>
    </ThemedView>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={[styles.safeArea, { maxWidth: isWideLayout ? WIDE_MAX_WIDTH : MaxContentWidth }]}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          <View style={styles.introBackdrop}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
              Pick a date to see, add, or check off tasks and appointments — including repeating
              tasks that land on that day. 🗓️
            </ThemedText>
          </View>

          {isWideLayout ? (
            <View style={styles.wideRow}>
              <View style={styles.wideCalendarCol}>{calendar}</View>
              <View style={styles.wideDayCol}>{dayPanel}</View>
            </View>
          ) : (
            <>
              {calendar}
              {dayPanel}
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {editingItem ? (
        <TaskEditModal
          key={editingItem.id}
          kind={editingItem.kind}
          initialText={editingItem.text}
          initialDate={editingItem.date}
          initialTime={editingItem.time}
          initialRepeat={editingItem.repeat}
          initialReminderMinutes={editingItem.reminderMinutesBefore}
          onSave={(values) => {
            handleSaveEdit(editingItem.id, values);
            setEditingItem(null);
          }}
          onCancel={() => setEditingItem(null)}
        />
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // The Task_Background.png image renders once in src/app/_layout.tsx
  // (behind the header too, on this route), not here — this container stays
  // transparent so that shows through instead of the usual opaque fill.
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  safeArea: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.five,
    gap: Spacing.three,
  },
  // Small, subtle translucent cream backdrop — same idea as the header's
  // logo bubble — just large enough to fit the sentence, not a full card.
  introBackdrop: {
    alignSelf: 'center',
    maxWidth: '92%',
    backgroundColor: 'rgba(252, 243, 233, 0.78)',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  intro: {
    textAlign: 'center',
  },
  wideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.four,
  },
  wideCalendarCol: {
    flexGrow: 2,
    flexBasis: 0,
    minWidth: 320,
  },
  wideDayCol: {
    flexGrow: 3,
    flexBasis: 0,
    minWidth: 340,
    gap: Spacing.three,
  },
  dayCard: {
    width: '100%',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  // Read-only, system-generated — styled as a solid pastel banner (rather
  // than the translucent card style used elsewhere) so it visually stands
  // apart from the user's own Tasks/Appointments/Birthdays below.
  holidayBanner: {
    alignSelf: 'flex-start',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  holidayText: {
    color: '#2E4A57',
  },
  dayTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    flexShrink: 1,
  },
  addButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  addButtonText: {
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.7,
  },
  form: {
    gap: Spacing.two,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  weekdayToggle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  repeatSection: {
    gap: Spacing.one,
  },
  formButtonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  saveButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  cancelButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  section: {
    gap: Spacing.one,
  },
  emptyText: {
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  rowTextGroup: {
    flex: 1,
    gap: 2,
  },
  completedText: {
    textDecorationLine: 'line-through',
  },
  importantStar: {
    fontSize: 15,
  },
  cakeIcon: {
    fontSize: 22,
    width: 28,
    textAlign: 'center',
  },
});
