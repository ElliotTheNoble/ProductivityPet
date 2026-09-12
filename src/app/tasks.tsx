import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TaskCalendar } from '@/components/task-calendar';
import { TaskIcon } from '@/components/task-icon';
import { TaskMenu, type TaskMenuItem } from '@/components/task-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createTask,
  excludeDateFromTask,
  formatFullDate,
  getTasksForDate,
  isOccurrenceCompleted,
  normalizeTask,
  stopRepeatingFrom,
  todayISO,
  toggleTaskOccurrence,
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

  useEffect(() => {
    if (!isHydrated) return;
    AsyncStorage.setItem(TASKS_STORAGE_KEY, JSON.stringify(tasks)).catch(() => {});
  }, [tasks, isHydrated]);

  function resetDraft() {
    setDraftText('');
    setDraftKind('task');
    setDraftTime('');
    setDraftRepeat('none');
    setDraftWeeklyDays(new Set());
    setIsAdding(false);
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
      time: draftKind === 'event' ? draftTime.trim() || undefined : undefined,
      repeat,
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
  // neither has recurring history that needs protecting.
  function handleDelete(id: string) {
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

    if (task.repeat) {
      return [
        importantItem,
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
      {
        key: 'delete',
        label: '🗑️ Delete Task',
        onPress: () => handleDelete(task.id),
        destructive: true,
      },
    ];
  }

  // Same menu shape as Home's AppointmentsCard: no Important toggle
  // (appointments don't have one), just Delete for a one-time appointment,
  // or the same history-safe Stop Repeating / Remove Just This Day pair for
  // a repeating one.
  function buildAppointmentMenuItems(event: Task): TaskMenuItem[] {
    if (event.repeat) {
      return [
        {
          key: 'stop-repeating',
          label: '⏹ Stop Repeating From Here',
          onPress: () => handleStopRepeating(event.id),
          destructive: true,
        },
        {
          key: 'remove-day',
          label: '🗑️ Remove Just This Day',
          onPress: () => handleRemoveThisDay(event.id),
          destructive: true,
        },
      ];
    }

    return [
      {
        key: 'delete',
        label: '🗑️ Delete Appointment',
        onPress: () => handleDelete(event.id),
        destructive: true,
      },
    ];
  }

  const dayItems = getTasksForDate(tasks, selectedDate);
  const dayTasks = dayItems.filter((task) => task.kind === 'task');
  const dayEvents = dayItems.filter((task) => task.kind === 'event');

  const selectedDateLabel = formatFullDate(selectedDate);

  const calendar = (
    <TaskCalendar tasks={tasks} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
  );

  const dayPanel = (
    <ThemedView type="backgroundElement" style={styles.dayCard}>
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

      {isAdding ? (
        <View style={styles.form}>
          <View style={styles.pillRow}>
            {(['task', 'event'] as TaskKind[]).map((kind) => (
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
                    {kind === 'task' ? 'Task' : 'Appointment'}
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
            placeholder={draftKind === 'task' ? 'What do you need to do?' : 'What is the appointment?'}
            placeholderTextColor={theme.textSecondary}
            value={draftText}
            onChangeText={setDraftText}
            onSubmitEditing={handleAdd}
            returnKeyType="done"
          />

          {draftKind === 'event' ? (
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
          ) : (
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
          )}

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
              <TaskMenu items={buildAppointmentMenuItems(event)} />
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
          <ThemedText type="small" themeColor="textSecondary" style={styles.intro}>
            Pick a date to see, add, or check off tasks and appointments — including repeating
            tasks that land on that day. 🗓️
          </ThemedText>

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
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
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
});
