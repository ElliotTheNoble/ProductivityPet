import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppointmentsCard } from '@/components/appointments-card';
import { ConfettiBurst } from '@/components/confetti-burst';
import { PetProgress } from '@/components/pet-progress';
import { HATCHLING_INTRO_DURATION_MS } from '@/components/pet-placeholder';
import { PetRoom } from '@/components/pet-room';
import { RoomsCard } from '@/components/rooms-card';
import { TaskCard } from '@/components/task-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { TodayMood } from '@/components/today-mood';
import { Spacing } from '@/constants/theme';
import {
  DEV_DIRTY_TEST_CLEANLINESS_VALUE,
  DEV_ENABLE_DIRTY_TEST_CONTROLS,
  DEV_ENABLE_HATCH_INTRO_PREVIEW,
  DEV_ENABLE_TEST_PAW_TOKEN_GRANT,
  DEV_TEST_PAW_TOKEN_GRANT_AMOUNT,
} from '@/utils/dev-flags';
import {
  getDevPreviewStageIndex,
  setDevPreviewStageIndex,
  subscribeToDevPreviewStageIndex,
} from '@/utils/dev-stage-preview';
import { MOODS, getRandomMoodMessage, type Mood } from '@/utils/mood';
import { cancelTaskNotification, syncTaskNotifications } from '@/utils/notifications';
import { reconcilePawTokenEarnings } from '@/utils/paw-tokens';
import {
  applyAddPoopPile,
  applyCleanUpPile,
  applyClearAllPiles,
  applyDevFastForwardAccumulation,
} from '@/utils/pet-poop';
import { getEquippedAccessoryId } from '@/utils/pet-equipment';
import { feedPet } from '@/utils/pet-feeding';
import { getGrowthEligibility, getRenderedStageIndex, getRenderedStage, growPet } from '@/utils/pet-growth';
import { restPet } from '@/utils/pet-resting';
import { getPetProfile, savePetProfile, type PetProfile, type PoopSize } from '@/utils/pet-profile';
import { PET_STAGES, type PetStage } from '@/utils/pet-stage';
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

// How long the "Dev: Replay Hatching Animation" button's simulated Egg
// artwork briefly shows before the simulated hatch itself begins — purely
// a dev-preview flourish so the replay reads as "before -> after," same
// as a real hatch genuinely starting from Egg art. Not a real pet-care
// timing value; nothing else in the app reads this.
const DEV_HATCH_REPLAY_EGG_HOLD_MS = 1200;

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
  const [isPlaying, setIsPlaying] = useState(false);
  const [isResting, setIsResting] = useState(false);
  // TEMPORARY — supports the test-only Grow control in handleGrow below.
  const [isGrowing, setIsGrowing] = useState(false);
  const [growResultMessage, setGrowResultMessage] = useState<string | null>(null);
  // TEMPORARY — supports the test-only Pet Stage Preview, clickable
  // directly on PetProgress's own stage icons (gated behind
  // DEV_ENABLE_STAGE_PREVIEW there — see @/components/pet-progress.tsx and
  // @/utils/dev-flags.ts). null = showing the pet's actual rendered stage;
  // otherwise an index into PET_STAGES to preview instead. Seeded from, and
  // kept in sync with, the shared module-level store in
  // @/utils/dev-stage-preview.ts — NOT plain local state — so the same
  // preview also applies on a Room Detail page (Study Room/Gym/Bedroom/
  // Kitchen) after navigating there, which a page-local useState alone
  // couldn't survive. Never persisted to disk either way, never read by
  // anything that computes real progression (petStage/renderedStageIndex/
  // growthEligibility below are completely unaffected by this), so a page
  // reload always comes back showing the real stage.
  const [devPreviewStageIndex, setDevPreviewStageIndexState] = useState<number | null>(() =>
    getDevPreviewStageIndex()
  );
  useEffect(() => subscribeToDevPreviewStageIndex(setDevPreviewStageIndexState), []);
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
  // isRealEgg (defined further down, from the real saved stage — see its
  // own comment there) guards every pet-care handler below as a hard
  // safety net, independent of whether its button actually rendered —
  // closures resolve it at call time, so it's always the current value
  // even though this function is declared earlier in the file. This
  // means a real Feed/Bathe/Play/Rest/Clean Up/poop-trigger action can
  // never mutate the saved profile while the pet is genuinely still an
  // unhatched Egg, regardless of what's currently being displayed/
  // previewed (see the isDisplayedEgg-driven prop gating further down,
  // which is a separate, purely visual layer for hiding the buttons/art
  // in the first place).
  function handleFeed() {
    if (isRealEgg || isFeeding) return;
    setIsFeeding(true);
    feedPet()
      .then((updated) => setPetProfile(updated))
      .catch(() => {})
      .finally(() => setIsFeeding(false));
  }

  // The Home "Bath" button was removed — bathing is now accessed through
  // the Bathroom room page instead (its own future interactive sequence).
  // bathePet() (@/utils/pet-bathing.ts) itself is untouched and still
  // reused from there once that's built; only this Home shortcut and its
  // local isBathing state were removed.

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
    if (isRealEgg) return;
    router.push('/mini-games');
  }

  // Same shape as the other three handlers, calling the existing
  // persistent restPet() action (see @/utils/pet-resting.ts) — no Energy
  // math lives here. restPet() never sets isSleeping; the automatic 8 PM-
  // 8 AM bedtime system stays entirely separate and untouched by this.
  function handleRest() {
    if (isRealEgg || isResting) return;
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

  // TEMPORARY, test-only — replays the full Egg-to-Hatchling transition
  // sequence on demand: briefly shows the Egg artwork (same as what's
  // genuinely on screen right before a real hatch), then simulates the
  // hatch itself, which triggers the exact same ~5-second "just hatched"
  // picture that a real hatch does, before switching straight to the new
  // permanent one (PetPlaceholder can't tell the difference between this
  // and a real hatchedAt). Purely visual — never writes to petProfile,
  // completedTaskCount, or paidStageIndex, so real saved progression is
  // completely untouched.
  //
  // Only one timer is ever pending at a time, tracked in
  // devHatchReplayTimerRef so it can be cancelled — both to prevent two
  // overlapping replays if the button is somehow pressed again mid-replay
  // (also guarded by the early-return + the button's own `disabled` prop
  // below) and so leaving Home (component unmount) cleanly cancels it
  // instead of it firing into an unmounted screen — see the cleanup
  // effect right after this function.
  const devHatchReplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function handleDevReplayHatchAnimation() {
    if (devHatchReplayInProgress) return;
    if (devHatchReplayTimerRef.current) {
      clearTimeout(devHatchReplayTimerRef.current);
      devHatchReplayTimerRef.current = null;
    }
    setDevHatchReplayInProgress(true);
    setDevHatchIntroPreviewAt(null);
    setDevHatchReplayShowingEgg(true);
    devHatchReplayTimerRef.current = setTimeout(() => {
      setDevHatchReplayShowingEgg(false);
      setDevHatchIntroPreviewAt(Date.now());
      devHatchReplayTimerRef.current = setTimeout(() => {
        // devHatchIntroPreviewAt is deliberately left set here — this is
        // what "leaves the new Hatchling artwork visible when the preview
        // finishes" rather than snapping back to whatever the real/
        // regular-preview stage is. Only devHatchReplayInProgress resets,
        // so the button becomes pressable again for another replay.
        setDevHatchReplayInProgress(false);
        devHatchReplayTimerRef.current = null;
      }, HATCHLING_INTRO_DURATION_MS);
    }, DEV_HATCH_REPLAY_EGG_HOLD_MS);
  }
  // Cancels any pending replay timer the moment Home unmounts (navigating
  // away, or closing the app) — "clean up animation timers when leaving
  // the Home screen." PetPlaceholder's own hatch-intro timers already
  // clean themselves up the same way (a normal useEffect cleanup
  // function), since that component also unmounts along with Home.
  useEffect(() => {
    return () => {
      if (devHatchReplayTimerRef.current) clearTimeout(devHatchReplayTimerRef.current);
    };
  }, []);
  // Wraps the real Pet Stage Preview's own setter (passed to PetProgress
  // below as onPreviewStage/onResetPreview) so picking a different stage
  // there — or resetting it — always takes back control of what's shown,
  // instead of the screen staying stuck on the replay's leftover Hatchling
  // display (or, if pressed mid-replay, the in-progress sequence)
  // regardless of what's actually selected.
  function handleSetDevPreviewStage(index: number | null) {
    if (devHatchReplayTimerRef.current) {
      clearTimeout(devHatchReplayTimerRef.current);
      devHatchReplayTimerRef.current = null;
    }
    setDevHatchReplayShowingEgg(false);
    setDevHatchIntroPreviewAt(null);
    setDevHatchReplayInProgress(false);
    setDevPreviewStageIndex(index);
  }

  // TEMPORARY, test-only — handlers that each write to the real saved Pet
  // Profile, so the Dirty Kitty art swap and gradual Happiness/Energy
  // penalty (see isPetDirty/applyDirtyPenalty in @/utils/pet-needs.ts) can
  // be tested on demand. Same read-petProfile-write-updated-save-setState
  // shape as handleDevAddTestTokens above. Only reachable via the buttons
  // below, which only render while DEV_ENABLE_DIRTY_TEST_CONTROLS is true.
  function handleDevSetDirtyCleanliness() {
    if (!petProfile) return;
    const updated = { ...petProfile, cleanliness: DEV_DIRTY_TEST_CLEANLINESS_VALUE };
    savePetProfile(updated);
    setPetProfile(updated);
  }
  function handleDevRestoreCleanliness() {
    if (!petProfile) return;
    const updated = { ...petProfile, cleanliness: 100 };
    savePetProfile(updated);
    setPetProfile(updated);
  }
  // Reuses applyAddPoopPile (@/utils/pet-poop.ts) — the exact same
  // pile-creation + needsBath + rescheduling transition a real
  // accumulation step applies — so this button exercises real behavior
  // instead of a simplified copy of it. Leaves `size` unset, so
  // applyAddPoopPile rolls one at random, same as a real event. Silently
  // a no-op once already at MAX_POOP_PILES, same as the real system.
  // Guarded by isRealEgg — the real pet-care system never accumulates a
  // poop pile while she's genuinely still an unhatched Egg (see
  // applyPoopAccumulation in @/utils/pet-poop.ts), so this dev-only
  // shortcut must not be able to force one either; it safely does nothing
  // instead of corrupting a real Egg profile with poop state. The
  // corresponding buttons are also hidden below while isRealEgg, so this
  // is a backstop, not the only protection.
  function handleDevAddPoopPile() {
    if (!petProfile || isRealEgg) return;
    const updated = applyAddPoopPile(petProfile, petStage);
    if (updated === petProfile) return;
    savePetProfile(updated);
    setPetProfile(updated);
  }
  // Same transition, but with an explicit size — lets each of the 3
  // cleanup difficulties (Small=1 click, Medium=2, Large=3 — see
  // POOP_CLEANUP_ACTIONS in @/utils/pet-poop.ts) be tested on demand
  // without waiting for a random roll to happen to land on it. Same
  // isRealEgg guard as handleDevAddPoopPile above.
  function handleDevAddPoopPileSize(size: PoopSize) {
    if (!petProfile || isRealEgg) return;
    const updated = applyAddPoopPile(petProfile, petStage, new Date(), size);
    if (updated === petProfile) return;
    savePetProfile(updated);
    setPetProfile(updated);
  }
  // Simulates exactly one 2-hour accumulation tick passing (see
  // applyDevFastForwardAccumulation's own comment in @/utils/pet-poop.ts
  // for exactly how) — the main way to test accumulation building up to
  // the 5-pile max without actually waiting several hours. Pressing it
  // repeatedly adds one more pile each time, up to the max, then becomes
  // a no-op — exactly like real elapsed time would. Needs the real
  // petStage (defined further down) the same way the real accumulation
  // check does, and is guarded by isRealEgg for the same reason as the
  // other dev poop buttons (the function itself also independently
  // refuses on a real Egg, as a backstop).
  function handleDevFastForwardAccumulation() {
    if (!petProfile || isRealEgg) return;
    const updated = applyDevFastForwardAccumulation(petProfile, petStage);
    if (updated === petProfile) return;
    savePetProfile(updated);
    setPetProfile(updated);
  }
  // Dev-only bulk reset — clears every active pile at once (not something
  // the real per-pile Clean Up buttons ever do) so a test run can start
  // from a clean floor quickly. Not guarded by isRealEgg: this is a
  // cleanup tool, not a trigger, and stays useful for clearing stale
  // piles left over if the pet ever reverts back to Egg (e.g. after
  // unchecking completed tasks) — same reasoning as Clear Poop/Reset
  // needsBath already had.
  function handleDevClearAllPiles() {
    if (!petProfile) return;
    const updated = applyClearAllPiles(petProfile);
    if (updated === petProfile) return;
    savePetProfile(updated);
    setPetProfile(updated);
  }
  // Dev-only reset for needsBath — lets "Kitty still needs an actual bath"
  // be cleared for testing without having to build the real Bathroom
  // wash/dry sequence first (see @/utils/pet-profile.ts's needsBath field).
  // Only ever touches needsBath; poopPiles/Cleanliness are untouched.
  function handleDevResetNeedsBath() {
    if (!petProfile) return;
    const updated = { ...petProfile, needsBath: false };
    savePetProfile(updated);
    setPetProfile(updated);
  }

  // Simple explanation: runs when the player cleans up one poop pile
  // (by clicking/tapping it — see PetPlaceholder). Updates just that one
  // pile and saves the change.
  //
  // The real, production "Clean Up" action for ONE specific pile — see
  // the tappable poop artwork rendered by PetPlaceholder below (only
  // while petProfile?.poopPiles has at least one entry). Reuses the exact
  // same pure applyCleanUpPile (@/utils/pet-poop.ts) that pile-targeted
  // logic, just via the already-loaded local petProfile state rather than
  // a fresh storage read — same save+setState shape as every other
  // handler here. Every OTHER pile is left completely untouched.
  // Deliberately never restores Cleanliness (only bathing does that) and
  // never touches needsBath.
  function handleCleanUpPile(pileId: string) {
    if (!petProfile || isRealEgg) return;
    const updated = applyCleanUpPile(petProfile, pileId);
    if (updated === petProfile) return;
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
  // Simple explanation: the Egg stage should have NO pet-care stuff at
  // all — no feeding, no poop, no accessories. We check this in two
  // places (isRealEgg and isDisplayedEgg below) so that both the REAL
  // saved pet and whatever is being PREVIEWED on screen are covered.
  //
  // The Egg is a pre-hatching stage, not an active pet-care stage. This is
  // split into two deliberately different checks, used for two different
  // purposes:
  //
  // - isRealEgg (below) is the REAL saved stage — it never looks at the
  //   Pet Stage Preview. Every handler that actually WRITES to the saved
  //   Pet Profile (handleFeed/handlePlay/handleRest/handleCleanUpPile, and
  //   the dev poop-trigger handlers) is guarded by
  //   this, so a real pet-care action can never mutate the profile while
  //   she's genuinely still an unhatched Egg — regardless of what's
  //   currently being previewed. This is the one that must survive a
  //   restart and must never be fooled by the preview.
  // - isDisplayedEgg (below, after displayedStage) is what actually
  //   controls which props get passed to <PetRoom> — i.e. which controls/
  //   art are visible right now. It's keyed on displayedStage instead, so
  //   previewing the Egg (on an already-hatched pet) correctly hides
  //   Feed/Bath/Play/Rest/Clean Up/poop/accessories/need bars for that
  //   preview — matching what the Egg should look like — without the
  //   preview itself ever touching real saved state (it's still just a
  //   local read of devPreviewStageIndex, exactly as before).
  //
  // Both are needed together: isDisplayedEgg alone could let a real
  // Feed/etc. action fire while genuinely still an Egg (if something were
  // ever previewed as a later stage), and isRealEgg alone would leave
  // those same controls visibly (if inertly) rendered while previewing
  // the Egg. Poop EVENTS are separately already gated the same way, on
  // the real stage computed in src/app/_layout.tsx — see
  // applyPoopAccumulation in @/utils/pet-poop.ts.
  //
  // Simple explanation: true only if the pet's REAL saved stage is Egg
  // (ignores any preview).
  const isRealEgg = petStage === 'Egg';
  // TEMPORARY — when a Pet Stage Preview is active (selected directly on
  // PetProgress's own stage icons — see @/components/pet-progress.tsx),
  // this is what's actually passed to <PetRoom> instead of petStage —
  // purely a display swap. Nothing that computes REAL progression
  // (petStage itself, renderedStageIndex/growthEligibility below, and
  // PetProgress's own stage/level math) reads this — PetProgress is only
  // ever given devPreviewStageIndex to decide which icon to highlight as
  // "currently previewed," never to change what it reports as the real
  // stage.
  const displayedStage = devPreviewStageIndex !== null ? PET_STAGES[devPreviewStageIndex] : petStage;
  // TEMPORARY, test-only — lets a developer replay the full Egg-to-
  // Hatchling transition sequence on demand ("Dev: Replay Hatching
  // Animation" button below), without touching real saved progression.
  // Two separate local-only phases, never persisted:
  // - devHatchReplayShowingEgg: briefly shows the Egg artwork first,
  //   same as what's actually on screen right before a real hatch.
  // - devHatchIntroPreviewAt: the moment (if any) the simulated hatch
  //   "happened" — PetPlaceholder computes the rest (the 5s hold + fade)
  //   from this timestamp, the exact same way it does for a real hatch.
  // Only one of the two is ever active at a time; see
  // handleDevReplayHatchAnimation below for the sequence between them.
  const [devHatchReplayShowingEgg, setDevHatchReplayShowingEgg] = useState(false);
  const [devHatchIntroPreviewAt, setDevHatchIntroPreviewAt] = useState<number | null>(null);
  // True only while the replay's OWN timers are actively mid-sequence
  // (egg hold -> 5s hold -> fade) — this is what the button's `disabled`
  // is tied to, NOT whether Hatchling art is still being force-displayed.
  // It's deliberately a separate flag from the two above: once the
  // sequence finishes, devHatchIntroPreviewAt is left set on purpose (see
  // handleDevReplayHatchAnimation) so the new Hatchling artwork stays
  // visible — but devHatchReplayInProgress still drops back to false right
  // then, so the button re-enables for another replay ("allow me to
  // replay the animation as many times as I want").
  const [devHatchReplayInProgress, setDevHatchReplayInProgress] = useState(false);
  // Whether either replay phase is currently forcing the displayed stage
  // (used below for effectiveDisplayedStage/isEffectiveStagePreviewActive)
  // — unlike devHatchReplayInProgress above, this stays true even after
  // the sequence completes, for as long as devHatchIntroPreviewAt is left
  // set (i.e. until the next replay, or leaving Home).
  const isDevHatchReplayDisplayActive = devHatchReplayShowingEgg || devHatchIntroPreviewAt !== null;
  // While either replay phase is active, it forces the stage actually
  // shown to Egg (first) then Hatchling (next) — entirely separate from,
  // and never writing to, the real petProfile.hatchedAt/completedTaskCount
  // or the regular Pet Stage Preview (devPreviewStageIndex) below.
  const effectiveDisplayedStage: PetStage = devHatchReplayShowingEgg
    ? 'Egg'
    : devHatchIntroPreviewAt !== null
      ? 'Hatchling'
      : displayedStage;
  const effectiveHatchedAt =
    devHatchIntroPreviewAt !== null ? new Date(devHatchIntroPreviewAt).toISOString() : petProfile?.hatchedAt;
  // Must stay false during the replay specifically — it deliberately
  // simulates a real hatch (so the intro SHOULD play), unlike the regular
  // Pet Stage Preview, which must never trigger it (see PetPlaceholder's
  // own isStagePreviewActive prop comment).
  const isEffectiveStagePreviewActive = !isDevHatchReplayDisplayActive && devPreviewStageIndex !== null;
  // Simple explanation: true if the stage currently SHOWN on screen is
  // Egg — this can differ from isRealEgg while a developer is previewing
  // a different stage.
  // See the isRealEgg comment above — this is the display-only half of
  // the Egg gating, used purely to decide which props reach <PetRoom>.
  const isDisplayedEgg = effectiveDisplayedStage === 'Egg';

  // Simple explanation: watches for the REAL moment the Egg hatches into a
  // Hatchling, and saves that exact timestamp (hatchedAt) the first time
  // it happens — this is what PetPlaceholder later compares against to
  // decide whether to still show the temporary "just hatched" picture.
  //
  // Detects the crossing (not just "is currently Hatchling") by comparing
  // petStage (the REAL stage, never the preview) against the previous
  // render's real stage, stored in a ref — this is deliberately NOT a
  // lazy "if Hatchling-or-later and hatchedAt is empty, backfill it now"
  // check, since that would wrongly set hatchedAt to "now" (and replay the
  // intro) for an existing pet that hatched long ago, before this field
  // existed. prevRealStageRef starting at null (nothing seen yet) is what
  // correctly skips a returning player who's already past Egg on their
  // very first render this session — only a LIVE Egg-to-Hatchling
  // transition, observed while the app is actually open, ever sets this.
  const prevRealStageRef = useRef<PetStage | null>(null);
  useEffect(() => {
    const previous = prevRealStageRef.current;
    prevRealStageRef.current = petStage;
    if (!petProfile) return;
    if (previous === 'Egg' && petStage === 'Hatchling' && !petProfile.hatchedAt) {
      const updated = { ...petProfile, hatchedAt: new Date().toISOString() };
      savePetProfile(updated);
      setPetProfile(updated);
    }
  }, [petStage, petProfile]);

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

  // TEMPORARY test control for the Egg-to-Hatchling hatching transition —
  // see handleDevReplayHatchAnimation above and
  // DEV_ENABLE_HATCH_INTRO_PREVIEW in @/utils/dev-flags.ts. Entirely
  // gated behind that one flag, same as the other dev cards here — never
  // rendered at all while it's false, so normal players never see it.
  // disabled (while devHatchReplayInProgress) both greys the button out
  // and makes React Native ignore extra taps, so a replay already in
  // progress can't be started again on top of itself — note this is
  // specifically about the SEQUENCE still running, not about whether the
  // resulting Hatchling artwork is still being shown afterward (see
  // devHatchReplayInProgress's own comment above), so the button is
  // pressable again well before the next real/regular-preview stage
  // change would otherwise replace what's on screen.
  const hatchReplayTestControl = DEV_ENABLE_HATCH_INTRO_PREVIEW ? (
    <ThemedView type="peachOverlay" style={styles.growTestCard}>
      <ThemedText type="small" themeColor="textSecondary">
        Temporary test control — hatching transition
      </ThemedText>
      <Pressable onPress={handleDevReplayHatchAnimation} disabled={devHatchReplayInProgress}>
        <ThemedView type="sky" style={styles.growTestButton}>
          <ThemedText type="smallBold">
            {devHatchReplayInProgress ? 'Replaying…' : 'Dev: Replay Hatching Animation'}
          </ThemedText>
        </ThemedView>
      </Pressable>
    </ThemedView>
  ) : null;

  // TEMPORARY test control for the Dirty Kitty appearance system — see the
  // 4 handlers above and DEV_ENABLE_DIRTY_TEST_CONTROLS in
  // @/utils/dev-flags.ts. Entirely gated behind that one flag, same as the
  // Paw Token grant button above — never rendered at all while it's false.
  const dirtyTestControl = DEV_ENABLE_DIRTY_TEST_CONTROLS ? (
    <ThemedView type="peachOverlay" style={styles.growTestCard}>
      <ThemedText type="small" themeColor="textSecondary">
        Temporary test control — Dirty Kitty
      </ThemedText>
      <Pressable onPress={handleDevSetDirtyCleanliness}>
        <ThemedView type="sky" style={styles.growTestButton}>
          <ThemedText type="smallBold">{`Dev: Set Cleanliness to ${DEV_DIRTY_TEST_CLEANLINESS_VALUE}%`}</ThemedText>
        </ThemedView>
      </Pressable>
      <Pressable onPress={handleDevRestoreCleanliness}>
        <ThemedView type="sky" style={styles.growTestButton}>
          <ThemedText type="smallBold">Dev: Restore Cleanliness to 100%</ThemedText>
        </ThemedView>
      </Pressable>
      {/* The pile-ADDING/accumulating buttons specifically are hidden
          while the real pet is still an Egg (isRealEgg — the real saved
          stage, never the Stage Preview) — the real accumulation system
          already refuses to add a pile on a real Egg (see
          applyPoopAccumulation in @/utils/pet-poop.ts), so these dev
          shortcuts shouldn't be able to force one either. Their handlers
          also independently no-op in that case (see handleDevAddPoopPile/
          handleDevAddPoopPileSize/handleDevFastForwardAccumulation above)
          as a backstop. Clear All Piles/Reset needsBath below are
          deliberately NOT hidden — they're cleanup tools, not triggers,
          and stay useful for clearing stale poopPiles/needsBath left over
          from before the pet reverted back to Egg (e.g. after unchecking
          completed tasks). */}
      {!isRealEgg ? (
        <>
          <Pressable onPress={handleDevAddPoopPile}>
            <ThemedView type="sky" style={styles.growTestButton}>
              <ThemedText type="smallBold">Dev: Add Poop Pile (Random Size)</ThemedText>
            </ThemedView>
          </Pressable>
          <Pressable onPress={() => handleDevAddPoopPileSize('small')}>
            <ThemedView type="sky" style={styles.growTestButton}>
              <ThemedText type="smallBold">Dev: Add Small Pile (1 cleanup)</ThemedText>
            </ThemedView>
          </Pressable>
          <Pressable onPress={() => handleDevAddPoopPileSize('medium')}>
            <ThemedView type="sky" style={styles.growTestButton}>
              <ThemedText type="smallBold">Dev: Add Medium Pile (2 cleanups)</ThemedText>
            </ThemedView>
          </Pressable>
          <Pressable onPress={() => handleDevAddPoopPileSize('large')}>
            <ThemedView type="sky" style={styles.growTestButton}>
              <ThemedText type="smallBold">Dev: Add Large Pile (3 cleanups)</ThemedText>
            </ThemedView>
          </Pressable>
          {/* The main way to test accumulation building up to the
              5-pile max without actually waiting several hours — each
              press simulates one real POOP_PILE_ACCUMULATION_INTERVAL_HOURS
              (2h) tick passing, reusing the exact real accumulation logic
              (see applyDevFastForwardAccumulation's comment in
              @/utils/pet-poop.ts). Press it repeatedly to watch piles
              build up to 5, then confirm it stops. */}
          <Pressable onPress={handleDevFastForwardAccumulation}>
            <ThemedView type="sky" style={styles.growTestButton}>
              <ThemedText type="smallBold">Dev: Fast-Forward Accumulation (+2h)</ThemedText>
            </ThemedView>
          </Pressable>
        </>
      ) : (
        <ThemedText type="small" themeColor="textSecondary">
          Poop triggers disabled — Kitty is still an Egg
        </ThemedText>
      )}
      {petProfile?.poopPiles && petProfile.poopPiles.length > 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          {`Active piles: ${petProfile.poopPiles.length}/5 (${petProfile.poopPiles.map((p) => p.size).join(', ')})`}
        </ThemedText>
      ) : null}
      <Pressable onPress={handleDevClearAllPiles}>
        <ThemedView type="sky" style={styles.growTestButton}>
          <ThemedText type="smallBold">Dev: Clear All Piles</ThemedText>
        </ThemedView>
      </Pressable>
      <Pressable onPress={handleDevResetNeedsBath}>
        <ThemedView type="sky" style={styles.growTestButton}>
          <ThemedText type="smallBold">Dev: Reset needsBath</ThemedText>
        </ThemedView>
      </Pressable>
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
                stage={effectiveDisplayedStage}
                message={displayedPetMessage}
                // The Egg is a pre-hatching stage, not an active pet-care
                // stage. Gated on isDisplayedEgg (what's CURRENTLY SHOWN —
                // the real stage OR the Pet Stage Preview override, see
                // its comment above), not isRealEgg — so previewing the
                // Egg correctly hides these too, not just a genuinely
                // unhatched real Egg. Every prop below that either renders
                // a pet-care control or displays pet-care state is
                // omitted entirely (passed undefined/null) while
                // isDisplayedEgg is true, rather than being passed
                // through and separately disabled, reusing
                // PetRoom/PetPlaceholder's existing "only render while
                // this prop is actually provided" convention (the same
                // one onFeed/onPlay/onRest/onCleanUpPile/poopPiles/ etc.
                // already follow) — no new conditional rendering logic
                // needed in either of those components. The handlers
                // themselves (handleFeed etc.) also separately guard on
                // isRealEgg — see their own comments — so a real action
                // can't fire even if some future change made one of these
                // controls visible again.
                equippedAccessoryId={isDisplayedEgg ? null : equippedAccessoryId}
                hunger={isDisplayedEgg ? undefined : petProfile?.hunger}
                cleanliness={isDisplayedEgg ? undefined : petProfile?.cleanliness}
                happiness={isDisplayedEgg ? undefined : petProfile?.happiness}
                energy={isDisplayedEgg ? undefined : petProfile?.energy}
                poopPiles={isDisplayedEgg ? undefined : petProfile?.poopPiles}
                needsBath={isDisplayedEgg ? undefined : petProfile?.needsBath}
                onFeed={isDisplayedEgg ? undefined : handleFeed}
                isFeeding={isFeeding}
                onPlay={isDisplayedEgg ? undefined : handlePlay}
                isPlaying={isPlaying}
                onRest={isDisplayedEgg ? undefined : handleRest}
                isResting={isResting}
                onCleanUpPile={isDisplayedEgg ? undefined : handleCleanUpPile}
                hatchedAt={effectiveHatchedAt}
                isStagePreviewActive={isEffectiveStagePreviewActive}
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
              <PetProgress
                completedTaskCount={completedTaskCount}
                paidStageIndex={petProfile?.paidStageIndex ?? 0}
                previewStageIndex={devPreviewStageIndex}
                onPreviewStage={handleSetDevPreviewStage}
                onResetPreview={() => handleSetDevPreviewStage(null)}
              />
              {growTestControl}
              {hatchReplayTestControl}
              {dirtyTestControl}
            </ScrollView>
          </View>
        ) : (
          // Same idea stacked vertically: the pet sits in a fixed strip at
          // the top, and everything else scrolls independently beneath it.
          <View style={styles.narrowStack}>
            <View style={[styles.fixedPetTop, isDisplayedEgg && styles.fixedPetTopEggClearance]}>
              <PetRoom
                stage={effectiveDisplayedStage}
                message={displayedPetMessage}
                // Same Egg gating as the wide-layout <PetRoom> above — see
                // its comment there for the full isRealEgg/isDisplayedEgg
                // explanation.
                equippedAccessoryId={isDisplayedEgg ? null : equippedAccessoryId}
                hunger={isDisplayedEgg ? undefined : petProfile?.hunger}
                cleanliness={isDisplayedEgg ? undefined : petProfile?.cleanliness}
                happiness={isDisplayedEgg ? undefined : petProfile?.happiness}
                energy={isDisplayedEgg ? undefined : petProfile?.energy}
                poopPiles={isDisplayedEgg ? undefined : petProfile?.poopPiles}
                needsBath={isDisplayedEgg ? undefined : petProfile?.needsBath}
                onFeed={isDisplayedEgg ? undefined : handleFeed}
                isFeeding={isFeeding}
                onPlay={isDisplayedEgg ? undefined : handlePlay}
                isPlaying={isPlaying}
                onRest={isDisplayedEgg ? undefined : handleRest}
                isResting={isResting}
                onCleanUpPile={isDisplayedEgg ? undefined : handleCleanUpPile}
                hatchedAt={effectiveHatchedAt}
                isStagePreviewActive={isEffectiveStagePreviewActive}
              />
            </View>
            <ScrollView
              style={styles.scrollPane}
              contentContainerStyle={styles.narrowScrollContent}
              showsVerticalScrollIndicator={false}>
              <PetProgress
                completedTaskCount={completedTaskCount}
                paidStageIndex={petProfile?.paidStageIndex ?? 0}
                previewStageIndex={devPreviewStageIndex}
                onPreviewStage={handleSetDevPreviewStage}
                onResetPreview={() => handleSetDevPreviewStage(null)}
              />
              {growTestControl}
              {hatchReplayTestControl}
              {dirtyTestControl}
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
  // Only applied on top of fixedPetTop while the Egg is what's actually
  // displayed (narrow/mobile layout only — the wide/desktop layout
  // already has plenty of headroom above the pet via petOverlaySpacerTop
  // below, so it doesn't need this). The Egg picture renders higher and
  // bigger than its own box (see EGG_OFFSET_Y_PX/EGG_SCALE in
  // @/components/pet-placeholder.tsx — currently -90px and 1.625x) via a
  // transform, which doesn't get clipped by anything, but on a narrow
  // phone the normal 16px top padding alone isn't enough room for that to
  // stay fully on-screen above the SafeAreaView's own top edge. This
  // extra padding pushes the whole fixed strip (and therefore the Egg's
  // own box) down first, so the subsequent upward transform still lands
  // comfortably on-screen instead of clipping off the top (kept generous
  // rather than retuned to the exact current numbers, since it only ever
  // applies while the Egg is displayed and costs nothing but some
  // otherwise-empty space above it). Reverts to the normal fixedPetTop
  // padding the instant any other stage is displayed — Hatchling/Baby/
  // Young/Adult's own positioning is completely untouched by this.
  fixedPetTopEggClearance: {
    paddingTop: Spacing.three + 150,
  },
  narrowScrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
    gap: Spacing.four,
  },
});
