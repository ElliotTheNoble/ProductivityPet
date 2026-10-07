import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppointmentsCard } from '@/components/appointments-card';
import { ConfettiBurst } from '@/components/confetti-burst';
import { PetProgress } from '@/components/pet-progress';
import { PetRoom } from '@/components/pet-room';
import { RoomsCard } from '@/components/rooms-card';
import { TaskCard } from '@/components/task-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TodayMood } from '@/components/today-mood';
import { Spacing } from '@/constants/theme';
import { DEV_ENABLE_TEST_PAW_TOKEN_GRANT, DEV_TEST_PAW_TOKEN_GRANT_AMOUNT } from '@/utils/dev-flags';
import { MOODS, getRandomMoodMessage, type Mood } from '@/utils/mood';
import { cancelTaskNotification, syncTaskNotifications } from '@/utils/notifications';
import { reconcilePawTokenEarnings } from '@/utils/paw-tokens';
import { bathePet } from '@/utils/pet-bathing';
import { getEquippedAccessoryId } from '@/utils/pet-equipment';
import { feedPet } from '@/utils/pet-feeding';
import { getGrowthEligibility, getRenderedStageIndex, getRenderedStage, growPet } from '@/utils/pet-growth';
import { restPet } from '@/utils/pet-resting';
import { getPetProfile, savePetProfile, type PetProfile } from '@/utils/pet-profile';
import { getCachedTasks, persistCachedTasks } from '@/utils/task-storage';
import {
  excludeDateFromTask,
  formatFullDate,
  getCompletedTaskCount,
  isOccurrenceCompleted,
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
// Tasks storage (read/write) goes through @/utils/task-storage, which caches
// the parsed list in memory so Home, Tasks, birthday detection, and the
// Rooms hub don't each do their own independent AsyncStorage read on every
// navigation — see that file for details.
const MOOD_STORAGE_KEY = '@ProductivityPet:mood';

// Below this window width, the dashboard stacks into a single column instead
// of showing the task card and living room side by side.
const WIDE_LAYOUT_BREAKPOINT = 700;

export default function HomeScreen() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [temporaryMessage, setTemporaryMessage] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const [isCelebrating, setIsCelebrating] = useState(false);
  const [mood, setMood] = useState<Mood>(DEFAULT_MOOD);
  const [isMoodHydrated, setIsMoodHydrated] = useState(false);
  const [moodMessage, setMoodMessage] = useState(() => getRandomMoodMessage(DEFAULT_MOOD));
  // Local copy of the Pet Profile, used only by the Feed button below for
  // now. Seeded from getPetProfile() on mount — not
  // loadPetProfileWithNeedsUpdate() — because src/app/_layout.tsx already
  // runs the real decay/bedtime catch-up exactly once per app session on
  // launch (see that file); getPetProfile() just resolves that same
  // already-current profile from its shared in-memory cache instead of
  // re-running (and potentially re-saving) that catch-up a second time.
  const [petProfile, setPetProfile] = useState<PetProfile | null>(null);
  // The id of whatever Pet Accessory is currently equipped (see
  // @/utils/pet-equipment.ts), loaded fresh on every mount — Home is
  // unmounted/remounted on navigation (same as every routed screen here),
  // so this naturally picks up a change made on the Shop page as soon as
  // the user navigates back, without needing a cross-page subscription.
  const [equippedAccessoryId, setEquippedAccessoryId] = useState<string | null>(null);
  const [isFeeding, setIsFeeding] = useState(false);
  const [isBathing, setIsBathing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isResting, setIsResting] = useState(false);
  // TEMPORARY — supports the test-only Grow control in handleGrow below.
  const [isGrowing, setIsGrowing] = useState(false);
  const [growResultMessage, setGrowResultMessage] = useState<string | null>(null);
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

  // Set right before hydration finishes so the save/sync effect below can
  // tell "tasks just got set FROM storage" apart from "tasks changed for a
  // real reason" — both look identical as a [tasks, isHydrated] dependency
  // change, but only the latter should trigger a save + notification sync.
  const skipNextSyncRef = useRef(false);

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

  // Seed the local Pet Profile state once on mount (see the petProfile
  // declaration above for why this uses getPetProfile() rather than
  // re-running the needs/bedtime catch-up here).
  useEffect(() => {
    let cancelled = false;
    getPetProfile()
      .then((profile) => {
        if (!cancelled) setPetProfile(profile);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Seed the equipped accessory id the same way — see the state
  // declaration above for why a plain mount-time read is sufficient here.
  useEffect(() => {
    let cancelled = false;
    getEquippedAccessoryId()
      .then((id) => {
        if (!cancelled) setEquippedAccessoryId(id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Feed button handler — calls the existing persistent feedPet() action
  // (see @/utils/pet-feeding.ts) and updates local state with whatever it
  // actually saved; no feeding math lives here. The isFeeding guard (also
  // passed down as the button's `disabled` prop) blocks a second feed from
  // starting while one is still in flight, rather than letting rapid taps
  // queue up multiple overlapping calls.
  function handleFeed() {
    if (isFeeding) return;
    setIsFeeding(true);
    feedPet()
      .then((updated) => setPetProfile(updated))
      .catch(() => {})
      .finally(() => setIsFeeding(false));
  }

  // Same shape as handleFeed, calling the existing persistent bathePet()
  // action (see @/utils/pet-bathing.ts) — no Cleanliness math lives here.
  function handleBathe() {
    if (isBathing) return;
    setIsBathing(true);
    bathePet()
      .then((updated) => setPetProfile(updated))
      .catch(() => {})
      .finally(() => setIsBathing(false));
  }

  // Play no longer directly increases Happiness here — pressing it now
  // opens the Mini-Games page (see @/components/mini-games/mini-games-screen.tsx);
  // finishing a round there is what now fulfills the pet's Play/Happiness
  // interaction (see @/utils/kitty-catch-rewards.ts). playWithPet() /
  // pet-playing.ts itself is intentionally left untouched and unused by
  // this button — preserved exactly as it was, in case it's wanted again
  // for a different trigger later. isPlaying is kept (always false) only
  // so PetPlaceholder's existing onPlay/isPlaying prop contract doesn't
  // need to change.
  function handlePlay() {
    router.push('/mini-games');
  }

  // Same shape as the other three handlers, calling the existing
  // persistent restPet() action (see @/utils/pet-resting.ts) — no Energy
  // math lives here. restPet() never sets isSleeping; the automatic 8 PM-
  // 8 AM bedtime system stays entirely separate and untouched by this.
  function handleRest() {
    if (isResting) return;
    setIsResting(true);
    restPet()
      .then((updated) => setPetProfile(updated))
      .catch(() => {})
      .finally(() => setIsResting(false));
  }

  // TEMPORARY test control for the new paid Baby->Young/Young->Adult
  // growth system (see @/utils/pet-growth.ts) — a real "grow pet" UI isn't
  // built yet, this just exercises growPet() so the underlying logic can
  // be verified. Re-derives eligibility fresh (not trusted from stale UI
  // state) and growPet() itself re-validates everything again server-side
  // against the real saved profile before spending anything.
  function handleGrow() {
    if (isGrowing) return;
    setIsGrowing(true);
    growPet(completedTaskCount)
      .then((result) => {
        if (result.success) setPetProfile(result.profile);
        setGrowResultMessage(
          result.success
            ? `Grew to ${result.newStage}!`
            : result.reason === 'insufficient-funds'
              ? 'Not enough Paw Tokens.'
              : 'Not eligible to grow yet.'
        );
      })
      .catch(() => setGrowResultMessage('Something went wrong.'))
      .finally(() => setIsGrowing(false));
  }

  // TEMPORARY, test-only — adds DEV_TEST_PAW_TOKEN_GRANT_AMOUNT Paw Tokens
  // directly to the real saved Pet Profile (see @/utils/dev-flags.ts for
  // exactly what this does and doesn't affect), purely so the 500/1,000
  // token growth costs can be tested without earning that many tokens for
  // real first. Only reachable via the button below, which only renders at
  // all while DEV_ENABLE_TEST_PAW_TOKEN_GRANT is true.
  function handleDevAddTestTokens() {
    if (!petProfile) return;
    const updated = { ...petProfile, pawTokens: petProfile.pawTokens + DEV_TEST_PAW_TOKEN_GRANT_AMOUNT };
    savePetProfile(updated);
    setPetProfile(updated);
  }

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

  // Load previously saved tasks once on mount, via the shared in-memory
  // cache (see @/utils/task-storage) instead of a fresh AsyncStorage read —
  // only the very first call this session actually hits AsyncStorage;
  // navigating back to Home afterward resolves from memory. normalizeTask()
  // (applied inside getCachedTasks) gives any task saved before the
  // planner/calendar feature existed a concrete date (today) and default
  // kind, so it still shows up rather than disappearing from a now
  // date-filtered list — see src/utils/tasks.ts.
  useEffect(() => {
    let cancelled = false;
    getCachedTasks()
      .then((cached) => {
        if (cancelled) return;
        setTasks(cached);
        // Seeds the Paw Token "already awarded" record from whatever is
        // already completed, using this very first load this session —
        // before any real edit can happen — so tasks completed before
        // this feature existed are recorded as already-accounted-for
        // rather than suddenly paying out. See @/utils/paw-tokens.ts.
        reconcilePawTokenEarnings(cached).catch(() => {});
      })
      .finally(() => {
        if (!cancelled) {
          // The save/sync effect below is about to run once purely because
          // isHydrated just flipped true, with the exact tasks that were
          // just read from storage — not a real change, so it shouldn't
          // re-save or re-sync notifications.
          skipNextSyncRef.current = true;
          setIsHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Save whenever tasks change, but only after the initial load above has
  // finished — otherwise the empty starting state would overwrite storage.
  // persistCachedTasks writes to AsyncStorage exactly as before and keeps
  // the shared cache in sync in the same step. Also reconciles reminder
  // notifications against the current tasks (see syncTaskNotifications) —
  // this only ever touches scheduling bookkeeping fields, never anything
  // that drives history or pet progress. Skipping setTasks when nothing
  // changed avoids re-triggering this same effect. skipNextSyncRef
  // additionally skips the one run that fires just from hydration
  // completing (see above) — every other change to tasks (adding, editing,
  // toggling, etc.) still saves and syncs normally.
  useEffect(() => {
    if (!isHydrated) return;
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false;
      return;
    }
    persistCachedTasks(tasks);
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
    // last open task. Appointments and birthdays are never completable, so
    // they must never count toward "everything" here (a birthday landing
    // today would otherwise permanently block the celebration).
    const todaysTasks = updatedTasks.filter((task) => task.kind === 'task' && occursOnDate(task, today));
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

  // Marks an appointment done/not-done — deliberately separate from
  // toggleTask above rather than reused: it uses the exact same underlying
  // toggleTaskOccurrence (so completion is stored and persisted exactly
  // like a task's, which is what lets it flow through to Paw Token
  // earning via persistCachedTasks -> reconcilePawTokenEarnings), but
  // skips the task-specific speech-bubble message and "all done"
  // celebration check, which were built for Today's Tasks specifically.
  function toggleAppointment(id: string) {
    setTasks((prev) => toggleTaskOccurrence(prev, id, todayISO()));
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
  // The pet's ACTUAL rendered stage — Egg/Hatchling/Baby still advance
  // automatically for free purely from completedTaskCount (unchanged);
  // Young/Adult only ever show once paid for via growPet() (see
  // @/utils/pet-growth.ts), regardless of completedTaskCount. Falls back
  // to paidStageIndex 0 (no paid upgrade yet) before petProfile has
  // loaded, same "not loaded yet" convention as petProfile?.hunger below.
  const petStage = getRenderedStage(completedTaskCount, petProfile?.paidStageIndex ?? 0);
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
      .filter((task) => task.kind === 'task' && occursOnDate(task, today))
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
  // Appointments and birthdays share this card — neither is completable or
  // counts toward pet progress; DisplayAppointment.kind picks the icon.
  const todaysDisplayAppointments: DisplayAppointment[] = tasks
    .filter((task) => (task.kind === 'event' || task.kind === 'birthday') && occursOnDate(task, today))
    .map((task) => ({
      id: task.id,
      text: task.text,
      category: task.category,
      kind: task.kind as 'event' | 'birthday',
      time: task.time,
      isRepeating: !!task.repeat,
      completed: isOccurrenceCompleted(task, today),
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
      onToggleAppointment={toggleAppointment}
      onDeleteAppointment={deleteTask}
      onStopRepeating={stopRepeating}
      onRemoveToday={removeTodayOccurrence}
    />
  );

  // TEMPORARY test control for the new paid growth system — see
  // handleGrow above. Only shown once the pet is actually eligible for a
  // paid upgrade (or while a grow attempt is in flight/just finished), so
  // it stays out of the way for Egg/Hatchling/Baby and for an
  // already-maxed Adult pet.
  const renderedStageIndex = getRenderedStageIndex(completedTaskCount, petProfile?.paidStageIndex ?? 0);
  const growthEligibility = getGrowthEligibility(renderedStageIndex, completedTaskCount);
  const growTestControl =
    growthEligibility.canGrow || growResultMessage || DEV_ENABLE_TEST_PAW_TOKEN_GRANT ? (
      <ThemedView type="peachOverlay" style={styles.growTestCard}>
        <ThemedText type="small" themeColor="textSecondary">
          Temporary test control — paid growth system
        </ThemedText>
        {DEV_ENABLE_TEST_PAW_TOKEN_GRANT ? (
          <Pressable onPress={handleDevAddTestTokens}>
            <ThemedView type="sky" style={styles.growTestButton}>
              <ThemedText type="smallBold">{`Dev: +${DEV_TEST_PAW_TOKEN_GRANT_AMOUNT} Paw Tokens`}</ThemedText>
            </ThemedView>
          </Pressable>
        ) : null}
        {growthEligibility.canGrow ? (
          <Pressable onPress={handleGrow} disabled={isGrowing}>
            <ThemedView type="accent" style={styles.growTestButton}>
              <ThemedText type="smallBold" style={styles.growTestButtonText}>
                {isGrowing
                  ? 'Growing…'
                  : `Grow to ${growthEligibility.nextStage} (${growthEligibility.cost} 🐾)`}
              </ThemedText>
            </ThemedView>
          </Pressable>
        ) : null}
        {growResultMessage ? (
          <ThemedText type="small" themeColor="textSecondary">
            {growResultMessage}
          </ThemedText>
        ) : null}
      </ThemedView>
    ) : null;

  return (
    // The living-room background now renders once in src/app/_layout.tsx
    // (behind the header too, on Home), not here — this container stays
    // transparent so that shows through instead of the usual opaque fill.
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {isWideLayout ? (
          // Cards flank the open middle of the room: Tasks/Appointments/Mood
          // on the left, Rooms/Pet Progress on the right, each in its own
          // ScrollView. The pet sits in a separate, absolutely-positioned
          // overlay in between — not inside either ScrollView, so it never
          // moves when either side scrolls. It's rendered first so both
          // card columns paint on top of it if they ever overlap it.
          <View style={styles.splitRow}>
            <View style={styles.petOverlayWide} pointerEvents="box-none">
              <View style={styles.petOverlaySpacerTop} />
              <PetRoom
                stage={petStage}
                message={displayedPetMessage}
                equippedAccessoryId={equippedAccessoryId}
                hunger={petProfile?.hunger}
                cleanliness={petProfile?.cleanliness}
                happiness={petProfile?.happiness}
                energy={petProfile?.energy}
                onFeed={handleFeed}
                isFeeding={isFeeding}
                onBathe={handleBathe}
                isBathing={isBathing}
                onPlay={handlePlay}
                isPlaying={isPlaying}
                onRest={handleRest}
                isResting={isResting}
              />
              <View style={styles.petOverlaySpacerBottom} />
            </View>

            <ScrollView
              style={styles.leftScrollPane}
              contentContainerStyle={styles.leftScrollContent}
              showsVerticalScrollIndicator={false}>
              {taskCard}
              {appointmentsCard}
              <TodayMood mood={mood} message={moodMessage} onSelectMood={setMood} />
            </ScrollView>

            <ScrollView
              style={styles.rightScrollPane}
              contentContainerStyle={styles.rightScrollContent}
              showsVerticalScrollIndicator={false}>
              <RoomsCard />
              <PetProgress completedTaskCount={completedTaskCount} />
              {growTestControl}
            </ScrollView>
          </View>
        ) : (
          // Same idea stacked vertically: the pet sits in a fixed strip at
          // the top, and everything else scrolls independently beneath it.
          <View style={styles.narrowStack}>
            <View style={styles.fixedPetTop}>
              <PetRoom
                stage={petStage}
                message={displayedPetMessage}
                equippedAccessoryId={equippedAccessoryId}
                hunger={petProfile?.hunger}
                cleanliness={petProfile?.cleanliness}
                happiness={petProfile?.happiness}
                energy={petProfile?.energy}
                onFeed={handleFeed}
                isFeeding={isFeeding}
                onBathe={handleBathe}
                isBathing={isBathing}
                onPlay={handlePlay}
                isPlaying={isPlaying}
                onRest={handleRest}
                isResting={isResting}
              />
            </View>
            <ScrollView
              style={styles.scrollPane}
              contentContainerStyle={styles.narrowScrollContent}
              showsVerticalScrollIndicator={false}>
              <PetProgress completedTaskCount={completedTaskCount} />
              {growTestControl}
              {taskCard}
              {appointmentsCard}
              <TodayMood mood={mood} message={moodMessage} onSelectMood={setMood} />
              <RoomsCard />
            </ScrollView>
          </View>
        )}
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
    backgroundColor: 'transparent',
  },
  // TEMPORARY — styles for the test-only Grow control (see
  // growTestControl/handleGrow above).
  growTestCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  growTestButton: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    alignItems: 'center',
  },
  growTestButtonText: {
    color: '#FFFFFF',
  },
  confettiOverlay: {
    ...StyleSheet.absoluteFill,
  },
  safeArea: {
    flex: 1,
    width: '100%',
  },
  scrollPane: {
    flex: 1,
  },
  // Wide/desktop: cards flank the open middle of the room (Tasks/
  // Appointments/Mood on the left, Rooms/Pet Progress on the right), each
  // scrolling independently, with the middle left open for the pet.
  splitRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  leftScrollPane: {
    width: '24%',
    minWidth: 270,
    maxWidth: 320,
  },
  leftScrollContent: {
    gap: Spacing.four,
    paddingBottom: Spacing.four,
  },
  rightScrollPane: {
    width: '26%',
    minWidth: 240,
    maxWidth: 340,
  },
  rightScrollContent: {
    gap: Spacing.four,
    paddingBottom: Spacing.four,
  },
  // Absolutely positioned so it never scrolls with either card column;
  // rendered before them in the JSX so both columns paint over it if they
  // ever overlap it. The top/bottom spacers bias the pet toward the lower
  // portion of the room, roughly where the rug sits in the background art.
  petOverlayWide: {
    ...StyleSheet.absoluteFill,
  },
  petOverlaySpacerTop: {
    flexGrow: 5,
  },
  petOverlaySpacerBottom: {
    flexGrow: 1,
  },
  // Narrow/mobile: a non-scrolling column split into a fixed pet strip on
  // top and a scrollable card stack below it.
  narrowStack: {
    flex: 1,
  },
  fixedPetTop: {
    width: '100%',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  narrowScrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
  },
});
