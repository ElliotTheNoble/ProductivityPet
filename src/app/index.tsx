import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppointmentsCard } from '@/components/appointments-card';
import { ConfettiBurst } from '@/components/confetti-burst';
import { PetProgress } from '@/components/pet-progress';
import { PetRoom } from '@/components/pet-room';
import { RoomsCard } from '@/components/rooms-card';
import { TaskCard } from '@/components/task-card';
import { ThemedView } from '@/components/themed-view';
import { TodayMood } from '@/components/today-mood';
import { Spacing } from '@/constants/theme';
import { MOODS, getRandomMoodMessage, type Mood } from '@/utils/mood';
import { cancelTaskNotification, syncTaskNotifications } from '@/utils/notifications';
import { getPetStage } from '@/utils/pet-stage';
import {
  excludeDateFromTask,
  formatFullDate,
  getCompletedTaskCount,
  isOccurrenceCompleted,
  normalizeTask,
  occursOnDate,
  sortByImportantFirst,
  stopRepeatingFrom,
  todayISO,
  toggleTaskOccurrence,
  type DisplayAppointment,
  type DisplayTask,
  type Task,
} from '@/utils/tasks';

const COMPLETION_MESSAGES = ['Yippee!', 'Yay!', 'Woohoo!', 'I knew you could do it!'];

// Shown briefly when a completed task gets unchecked.
const UNCHECK_MESSAGE = 'Aww, not done yet? You got this! 💕';

// How long a reactive message (task completed/unchecked) stays on screen
// before the speech bubble falls back to the ambient mood message.
const TEMPORARY_MESSAGE_DURATION_MS = 3000;

// How long the "all done" celebration (confetti + message) stays on screen.
const CELEBRATION_DURATION_MS = 2200;

// How often the ambient mood message re-rolls to a different line from the
// same mood's pool while idle — occasional, not constant/rapid.
const MOOD_MESSAGE_REFRESH_INTERVAL_MS = 60000;

const DEFAULT_MOOD: Mood = 'Happy';

// Local persistence only (AsyncStorage — works on native and web, no backend).
const TASKS_STORAGE_KEY = '@ProductivityPet:tasks';
const MOOD_STORAGE_KEY = '@ProductivityPet:mood';

// Below this window width, the dashboard stacks into a single column instead
// of showing the task card and living room side by side.
const WIDE_LAYOUT_BREAKPOINT = 700;

// The Home dashboard intentionally uses a much wider cap than the shared
// MaxContentWidth (used by the header and other screens) so it can fill most
// of the browser on wide/web screens instead of staying phone-width there.
const HOME_MAX_WIDTH = 1400;

export default function HomeScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [temporaryMessage, setTemporaryMessage] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [mood, setMood] = useState<Mood>(DEFAULT_MOOD);
  const [isMoodHydrated, setIsMoodHydrated] = useState(false);
  const [moodMessage, setMoodMessage] = useState(() => getRandomMoodMessage(DEFAULT_MOOD));
  const celebrationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const temporaryMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width } = useWindowDimensions();
  const isWideLayout = width >= WIDE_LAYOUT_BREAKPOINT;

  useEffect(() => {
    return () => {
      if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
      if (temporaryMessageTimeoutRef.current) clearTimeout(temporaryMessageTimeoutRef.current);
    };
  }, []);

  // Load any previously saved mood once on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(MOOD_STORAGE_KEY)
      .then((stored) => {
        if (cancelled || !stored) return;
        if (MOODS.includes(stored as Mood)) setMood(stored as Mood);
      })
      .finally(() => {
        if (!cancelled) setIsMoodHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isMoodHydrated) return;
    AsyncStorage.setItem(MOOD_STORAGE_KEY, mood).catch(() => {});
  }, [mood, isMoodHydrated]);

  // Pick a fresh random message whenever the mood changes (including once
  // hydration loads a saved mood), then occasionally re-roll a different
  // message from the same pool while idle — not constantly or rapidly.
  useEffect(() => {
    setMoodMessage(getRandomMoodMessage(mood));
    const interval = setInterval(() => {
      setMoodMessage((prev) => getRandomMoodMessage(mood, prev));
    }, MOOD_MESSAGE_REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [mood]);

  // Load any previously saved tasks once on mount. normalizeTask() gives any
  // task saved before the planner/calendar feature existed a concrete date
  // (today) and default kind, so it still shows up rather than disappearing
  // from a now date-filtered list — see src/utils/tasks.ts.
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

  // Save whenever tasks change, but only after the initial load above has
  // finished — otherwise the empty starting state would overwrite storage.
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

  function toggleTask(id: string) {
    const target = tasks.find((task) => task.id === id);
    if (!target) return;
    const today = todayISO();
    const completed = !isOccurrenceCompleted(target, today);
    if (temporaryMessageTimeoutRef.current) clearTimeout(temporaryMessageTimeoutRef.current);
    if (completed) {
      setTemporaryMessage(COMPLETION_MESSAGES[messageIndex]);
      setMessageIndex((prev) => (prev + 1) % COMPLETION_MESSAGES.length);
    } else {
      setTemporaryMessage(UNCHECK_MESSAGE);
    }
    temporaryMessageTimeoutRef.current = setTimeout(
      () => setTemporaryMessage(null),
      TEMPORARY_MESSAGE_DURATION_MS
    );

    const updatedTasks = toggleTaskOccurrence(tasks, id, today);
    setTasks(updatedTasks);

    // Only celebrate when *this* action is what just finished the last of
    // TODAY's tasks — never from hydrating already-complete data on load,
    // never repeatedly while sitting at 100%, and never from deleting the
    // last open task.
    const todaysTasks = updatedTasks.filter((task) => task.kind !== 'event' && occursOnDate(task, today));
    const justFinishedEverything =
      completed &&
      todaysTasks.length > 0 &&
      todaysTasks.every((task) => isOccurrenceCompleted(task, today));
    if (justFinishedEverything) {
      setIsCelebrating(true);
      if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
      celebrationTimeoutRef.current = setTimeout(
        () => setIsCelebrating(false),
        CELEBRATION_DURATION_MS
      );
    }
  }

  function toggleImportant(id: string) {
    setTasks((prev) =>
      prev.map((task) => (task.id === id ? { ...task, important: !task.important } : task))
    );
  }

  // Full delete — only ever used for one-time tasks and appointments, since
  // neither has recurring history that needs protecting. A repeating item's
  // three-dot menu instead offers stopRepeating/removeTodayOccurrence below.
  // Cancels any scheduled reminder first: once the record is filtered out,
  // syncTaskNotifications has nothing left to reconcile it against.
  function deleteTask(id: string) {
    const target = tasks.find((task) => task.id === id);
    if (target) cancelTaskNotification(target).catch(() => {});
    setTasks((prev) => prev.filter((task) => task.id !== id));
  }

  // "Stop repeating from here", using today as the reference date since
  // Home only ever shows today. Every earlier date (and its completedDates,
  // which is what pet progress is computed from) is left untouched — only
  // today and future occurrences stop showing up.
  function stopRepeating(id: string) {
    setTasks((prev) => stopRepeatingFrom(prev, id, todayISO()));
  }

  // "Remove just this day" for today specifically — hides only today's
  // occurrence, leaving the rest of the series (past and future) and all
  // completion history untouched.
  function removeTodayOccurrence(id: string) {
    setTasks((prev) => excludeDateFromTask(prev, id, todayISO()));
  }

  const completedTaskCount = getCompletedTaskCount(tasks);
  const petStage = getPetStage(completedTaskCount);
  // Reactive task messages take priority while active; otherwise the pet's
  // bubble shows the ambient mood message.
  const displayedPetMessage = temporaryMessage ?? moodMessage;

  // "Today's Tasks" and "Today's Appointments" show only what's actually
  // scheduled for today — including today's occurrence of any repeating
  // task — never another day's items. Appointments are always their own,
  // separately-rendered list: they never have a completed state and never
  // affect pet progress.
  const today = todayISO();
  const todaysDisplayTasks: DisplayTask[] = sortByImportantFirst(
    tasks
      .filter((task) => task.kind !== 'event' && occursOnDate(task, today))
      .map((task) => ({
        id: task.id,
        text: task.text,
        completed: isOccurrenceCompleted(task, today),
        category: task.category,
        important: task.important,
        isRepeating: !!task.repeat,
        time: task.time,
      }))
  );
  const todaysDisplayAppointments: DisplayAppointment[] = tasks
    .filter((task) => task.kind === 'event' && occursOnDate(task, today))
    .map((task) => ({
      id: task.id,
      text: task.text,
      category: task.category,
      time: task.time,
      isRepeating: !!task.repeat,
    }));

  const taskCard = (
    <TaskCard
      tasks={todaysDisplayTasks}
      dateLabel={formatFullDate(today)}
      onToggleTask={toggleTask}
      onToggleImportant={toggleImportant}
      onDeleteTask={deleteTask}
      onStopRepeating={stopRepeating}
      onRemoveToday={removeTodayOccurrence}
      isCelebrating={isCelebrating}
    />
  );

  const appointmentsCard = (
    <AppointmentsCard
      appointments={todaysDisplayAppointments}
      onDeleteAppointment={deleteTask}
      onStopRepeating={stopRepeating}
      onRemoveToday={removeTodayOccurrence}
    />
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}>
          {isWideLayout ? (
            <>
              <View style={styles.dashboardRow}>
                <View style={styles.leftColumn}>
                  {taskCard}
                  {appointmentsCard}
                  <TodayMood mood={mood} message={moodMessage} onSelectMood={setMood} />
                </View>
                <View style={styles.rightColumn}>
                  <PetRoom stage={petStage} message={displayedPetMessage} />
                  <RoomsCard />
                </View>
              </View>
              <PetProgress completedTaskCount={completedTaskCount} />
            </>
          ) : (
            <>
              <PetRoom stage={petStage} message={displayedPetMessage} />
              <PetProgress completedTaskCount={completedTaskCount} />
              {taskCard}
              {appointmentsCard}
              <TodayMood mood={mood} message={moodMessage} onSelectMood={setMood} />
              <RoomsCard />
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Full-screen, non-interactive celebration layer — sits above every
          dashboard section (living room included) without affecting layout. */}
      <View style={styles.confettiOverlay} pointerEvents="none">
        <ConfettiBurst active={isCelebrating} />
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  confettiOverlay: {
    ...StyleSheet.absoluteFill,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: HOME_MAX_WIDTH,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
  },
  dashboardRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.five,
  },
  leftColumn: {
    flexGrow: 2,
    flexBasis: 0,
    minWidth: 320,
    gap: Spacing.four,
  },
  rightColumn: {
    flexGrow: 3,
    flexBasis: 0,
    minWidth: 380,
    gap: Spacing.four,
  },
});
