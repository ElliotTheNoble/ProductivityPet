import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppointmentsCard } from '@/components/appointments-card';
import { ConfettiBurst } from '@/components/confetti-burst';
import { PetProgress } from '@/components/pet-progress';
import { HATCHLING_INTRO_DURATION_MS } from '@/components/pet-placeholder';
import { PetRoom } from '@/components/pet-room';
import { RoomsCard } from '@/components/rooms-card';
import { AssignedHomeRows } from '@/components/assigned-task-views';
import { SlideOutPanel } from '@/components/slide-out-panel';
import { PawadiseMailbox } from '@/components/pawadise-mailbox';
import { ToyPlayCard } from '@/components/toy-play-card';
import { useToySession } from '@/utils/pet-toy-session';
import { TaskCard } from '@/components/task-card';
import { ThemedView } from '@/components/themed-view';
import { TodayMood } from '@/components/today-mood';
import { Spacing } from '@/constants/theme';
import { consumeDevHatchReplayRequest, subscribeToDevHatchReplayRequest } from '@/utils/dev-hatch-replay';
import {
  getDevPreviewStageIndex,
  setDevPreviewStageIndex,
  subscribeToDevPreviewStageIndex,
} from '@/utils/dev-stage-preview';
import { useT, trList, tr } from '@/i18n';
import { getMoodMessage, getRandomMoodMessageIndex, type Mood } from '@/utils/mood';
import { toggleMoodForDate, useMoodForDate } from '@/utils/mood-log';
import { getPetLifeMessage } from '@/utils/pet-life-messages';
import { cancelTaskNotification, reminderResyncNeeded, syncTaskNotifications } from '@/utils/notifications';
import { isOutstanding, outstandingTotal, useAssignedTasks, useIsChildProfile } from '@/utils/assigned-tasks';
import { reconcilePawTokenEarnings } from '@/utils/paw-tokens';
import { isPoopPaused, applyCleanUpPile } from '@/utils/pet-poop';
import { useSelectedPetId } from '@/hooks/use-pet-family';
import { getEquippedAccessories, type EquippedAccessories } from '@/utils/pet-equipment';
import { feedPet } from '@/utils/pet-feeding';
import { getRenderedStage } from '@/utils/pet-growth';
import { restPet } from '@/utils/pet-resting';
import { getPetProfile, savePetProfile, subscribeToPetProfile, type PetProfile } from '@/utils/pet-profile';
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

// The reactive speech-bubble messages are kept as a reference (which message), not as text, so they follow the
// language if it changes while they are showing. The wording is in the translation catalog (lists / strings).
type TemporaryMessage = { kind: 'complete'; index: number } | { kind: 'uncheck' };

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
// The player's mood is one record per day in the active profile's mood log (see @/utils/mood-log.ts).

// How long the "Dev: Replay Hatching Animation" button's simulated Egg
// artwork briefly shows before the simulated hatch itself begins — purely
// a dev-preview flourish so the replay reads as "before -> after," same
// as a real hatch genuinely starting from Egg art. Not a real pet-care
// timing value; nothing else in the app reads this.
const DEV_HATCH_REPLAY_EGG_HOLD_MS = 1200;

// How wide the kitty actually LOOKS compared with the box the pet picture sits in (Young is drawn scaled up,
// the others fill less of their box). Only used to size the Pawadise mailbox next to her; it does not
// change the kitty.
const KITTY_VISIBLE_PER_BOX: Partial<Record<string, number>> = {
  Egg: 0.8,
  Hatchling: 0.72,
  Baby: 0.75,
  Young: 1.15,
  Adult: 0.95,
};

export default function HomeScreen() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const { t, lang } = useT();
  const [temporaryMessage, setTemporaryMessage] = useState<TemporaryMessage | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const [isCelebrating, setIsCelebrating] = useState(false);
  // The player's mood for TODAY, from the one-mood-per-day record (see @/utils/mood-log.ts): null until they pick one, and it follows the
  // Tasks calendar's mood selector. Nothing is chosen or saved for them. The pet's bubble keeps its usual ambient line (the Happy pool) while
  // there is no mood, so the kitty's own messages do not change.
  const recordedMood = useMoodForDate(todayISO());
  const mood: Mood = recordedMood ?? DEFAULT_MOOD;
  const [moodMessageIndex, setMoodMessageIndex] = useState(() => getRandomMoodMessageIndex(DEFAULT_MOOD));
  const moodMessage = getMoodMessage(mood, moodMessageIndex);
  // The Today's Mood picker's handler: updates the on-screen mood exactly as
  // before AND appends a timestamped check-in to the mood history (see
  // @/utils/mood-log.ts) that the Stats Mood Journey reads. Only a real
  // player selection records an entry — loading the saved mood on startup
  // goes through setMood directly and does not.
  const handleSelectMood = (selected: Mood) => {
    toggleMoodForDate(todayISO(), selected).catch(() => {});
  };
  // Local copy of the Pet Profile, used only by the Feed button below for
  // now. Seeded from getPetProfile() on mount — not
  // loadPetProfileWithNeedsUpdate() — because src/app/_layout.tsx already
  // runs the real decay/bedtime catch-up exactly once per app session on
  // launch (see that file); getPetProfile() just resolves that same
  // already-current profile from its shared in-memory cache instead of
  // re-running (and potentially re-saving) that catch-up a second time.
  const [petProfile, setPetProfile] = useState<PetProfile | null>(null);
  // The hat and the bow that are currently equipped (one of each can be
  // worn at once — see @/utils/pet-equipment.ts), loaded fresh on every
  // mount — Home is unmounted/remounted on navigation (same as every routed
  // screen here), so this naturally picks up a change made on the Shop page
  // as soon as the user navigates back, without needing a cross-page
  // subscription.
  const [equippedAccessories, setEquippedAccessories] = useState<EquippedAccessories>({
    hat: null,
    bow: null,
  });
  // What the pet components actually draw (bow first, hat on top).
  const equippedAccessoryIds = [equippedAccessories.bow, equippedAccessories.hat];
  const [isFeeding, setIsFeeding] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isResting, setIsResting] = useState(false);
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
  const { width, height } = useWindowDimensions();
  // Tasks a parent assigned to THIS child (none unless family mode is on and a child is playing): a small number on the right-hand tab.
  const assignedTasks = useAssignedTasks();
  const isChildProfile = useIsChildProfile();
  // Portrait = taller than wide. Re-evaluated on every rotation, so switching orientation just
  // re-lays-out Home (nothing saved changes).
  const isPortrait = height >= width;
  // One slide-out panel at a time: 'progress' (left), 'features' (right) or none.
  const [openPanel, setOpenPanel] = useState<'progress' | 'features' | null>(null);
  // Portrait phones: a panel covers most of the screen; landscape / desktop: a comfortable
  // fixed-size sheet that leaves the kitty visible beside it.
  // Short windows (a phone held sideways): if the pet, her bars and the care buttons are taller
  // than the room, the whole group is scaled down to fit instead of being cut off.
  const [overlayHeight, setOverlayHeight] = useState(0);
  const [petGroupHeight, setPetGroupHeight] = useState(0);
  const petFitScale =
    overlayHeight > 0 && petGroupHeight > overlayHeight ? Math.max(0.45, overlayHeight / petGroupHeight) : 1;
  const panelWidth = Math.min(isPortrait ? 360 : 400, Math.round(width * (isPortrait ? 0.88 : 0.5)));

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

  // Keeps petProfile in sync with saves made from ANYWHERE else in the app
  // — in particular, completeBathing() (@/utils/pet-bathing.ts), fired from
  // the Bathroom room page (a separate screen/mount from this one) once the
  // real animated Soap→Rinse→Dry sequence finishes. Without this, Home
  // would keep showing Kitty's stale pre-bath Cleanliness/needsBath (and
  // never pick up lastBathCompletedAt for the Dry-pose hold — see
  // @/components/pet-placeholder.tsx) until something else happened to
  // reload the profile. subscribeToPetProfile (@/utils/pet-profile.ts) is
  // exactly this app's existing mechanism for this kind of cross-screen
  // reactivity — same one the header's Paw Token balance already relies on.
  useEffect(() => subscribeToPetProfile(setPetProfile), []);

  // Seed the equipped accessories the same way — see the state
  // declaration above for why a plain mount-time read is sufficient here.
  // Re-read whenever a different pet is selected (each pet wears its own).
  const selectedPetId = useSelectedPetId();
  // The temporary toy (if any) out to play with the selected pet.
  const toySession = useToySession(selectedPetId);
  useEffect(() => {
    let cancelled = false;
    getEquippedAccessories()
      .then((equipped) => {
        if (!cancelled) setEquippedAccessories(equipped);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedPetId]);

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
    if (isRealEgg || isDeceased || isFeeding) return;
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
    if (isRealEgg || isDeceased) return;
    router.push('/mini-games');
  }

  // Same shape as the other three handlers, calling the existing
  // persistent restPet() action (see @/utils/pet-resting.ts) — no Energy
  // math lives here. restPet() never sets isSleeping; the automatic 8 PM-
  // 8 AM bedtime system stays entirely separate and untouched by this.
  function handleRest() {
    if (isRealEgg || isDeceased || isResting) return;
    setIsResting(true);
    restPet()
      .then((updated) => setPetProfile(updated))
      .catch(() => {})
      .finally(() => setIsResting(false));
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
    if (!petProfile || isRealEgg || isPoopPaused(petProfile)) return;
    const updated = applyCleanUpPile(petProfile, pileId);
    if (updated === petProfile) return;
    savePetProfile(updated);
    setPetProfile(updated);
  }

  // Pick a fresh random message whenever the mood changes (including once
  // hydration loads a saved mood), then occasionally re-roll a different
  // message from the same pool while idle — not constantly or rapidly.
  useEffect(() => {
    setMoodMessageIndex(getRandomMoodMessageIndex(mood));
    const interval = setInterval(() => {
      setMoodMessageIndex((prev) => getRandomMoodMessageIndex(mood, prev));
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
      // Nothing changed, so nothing is re-saved. The one exception: if a profile swap has cancelled the phone's reminders since
      // the last pass, they are scheduled again now (see syncTaskNotifications); the tasks are only re-saved if that changed them.
      if (!reminderResyncNeeded()) return;
      syncTaskNotifications(tasks)
        .then((updated) => {
          if (updated !== tasks) setTasks(updated);
        })
        .catch(() => {});
      return;
    }
    persistCachedTasks(tasks);
    syncTaskNotifications(tasks)
      .then((updated) => {
        if (updated !== tasks) setTasks(updated);
      })
      .catch(() => {});
  }, [tasks, isHydrated, lang]);

  function toggleTask(id: string) {
    const target = tasks.find((task) => task.id === id);
    if (!target) return;
    const today = todayISO();
    const completed = !isOccurrenceCompleted(target, today);
    if (temporaryMessageTimeoutRef.current) clearTimeout(temporaryMessageTimeoutRef.current);
    if (completed) {
      setTemporaryMessage({ kind: 'complete', index: messageIndex });
      setMessageIndex((prev) => (prev + 1) % trList('completion').length);
    } else {
      setTemporaryMessage({ kind: 'uncheck' });
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

  // The pet's stage comes from ITS OWN growth credit (growth is shared between
  // living pets — see @/utils/pet-family.ts), floored to whole tasks; the global
  // task count is only a fallback before the profile has loaded.
  const completedTaskCount =
    petProfile?.growthCredit !== undefined ? Math.floor(petProfile.growthCredit) : getCompletedTaskCount(tasks);
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
  // (ignores any preview) AND she has never actually hatched before.
  //
  // Two conditions beyond a plain `petStage === 'Egg'` check, both fixing
  // BUG-017 (see bugs.md): `tasks` starts as `[]` and `petProfile` starts
  // as `null` (their own useState defaults above) before either has
  // actually finished loading — plugged into completedTaskCount/
  // getRenderedStage, those "nothing loaded yet" placeholders are
  // mathematically indistinguishable from "genuinely 0 completed tasks,
  // no paid upgrade," so petStage can misread as 'Egg' for a pet at ANY
  // real stage for as long as this runs before both loads resolve.
  // `isHydrated` (tasks' own real "finished loading" flag, also used by
  // the save/sync effect further below) and `petProfile !== null`
  // together require real, loaded data before isRealEgg can ever be
  // true, so it can no longer be fooled by either value's own temporary
  // unloaded default. `!petProfile.hatchedAt` is a second, independent
  // floor: once a real hatch has ever been recorded (hatchedAt is set
  // exactly once and never cleared — see @/utils/pet-profile.ts),
  // isRealEgg stays permanently false regardless of what petStage itself
  // computes — the same "once true, never revert" protection
  // paidStageIndex already gives Young/Adult (see getRenderedStageIndex
  // in @/utils/pet-growth.ts), just keyed off the free hatch event
  // instead of a paid one. A pet that has genuinely never hatched
  // (hatchedAt === '') is unaffected by either addition — isRealEgg
  // still correctly requires loaded data confirming petStage === 'Egg'.
  const isRealEgg = isHydrated && petProfile !== null && petStage === 'Egg' && !petProfile.hatchedAt;
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
  // Development only: Alerts -> Developer Tools -> "Replay Hatching Animation" asks Home to run
  // the (purely visual) replay. A request made while Home wasn't open is picked up on mount.
  const replayHatchRef = useRef<() => void>(() => {});
  replayHatchRef.current = handleDevReplayHatchAnimation;
  useEffect(() => {
    if (!__DEV__) return;
    if (consumeDevHatchReplayRequest()) replayHatchRef.current();
    return subscribeToDevHatchReplayRequest(() => {
      if (consumeDevHatchReplayRequest()) replayHatchRef.current();
    });
  }, []);
  // Whether either replay phase is currently forcing the displayed stage
  // (used below for effectiveDisplayedStage/isEffectiveStagePreviewActive)
  // — unlike devHatchReplayInProgress above, this stays true even after
  // the sequence completes, for as long as devHatchIntroPreviewAt is left
  // set (i.e. until the next replay, or leaving Home).
  const isDevHatchReplayDisplayActive = devHatchReplayShowingEgg || devHatchIntroPreviewAt !== null;
  // The hatching replay is a purely visual override of the pet on screen, so it
  // must not follow the player to a different pet: switching pets cancels it.
  useEffect(() => {
    if (devHatchReplayTimerRef.current) {
      clearTimeout(devHatchReplayTimerRef.current);
      devHatchReplayTimerRef.current = null;
    }
    setDevHatchReplayShowingEgg(false);
    setDevHatchIntroPreviewAt(null);
    setDevHatchReplayInProgress(false);
  }, [selectedPetId]);
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
  // A deceased pet keeps its picture and accessories but has no needs, piles or
  // care buttons (see @/utils/pet-family.ts). Resurrection lives in the pet
  // family bar.
  const isDeceased = petProfile?.lifeState === 'deceased';
  const hideCare = isDisplayedEgg || isDeceased;
  // Poop clean-up is paused while this pet is Sick or Critical (its piles stay).
  const poopPaused = petProfile ? isPoopPaused(petProfile) : false;

  // The hatch date (hatchedAt) is no longer recorded here: it's saved by the
  // shared pet family code (awardGrowthForTasks in @/utils/pet-family.ts,
  // called when a newly completed task is rewarded) the moment a pet's
  // growth moves it from Egg to Hatchling, whichever screen is open. This screen just reads
  // petProfile.hatchedAt (kept current by subscribeToPetProfile) to decide
  // whether to still show the temporary "just hatched" picture.

  // Reactive task messages take priority while active; otherwise the pet's
  // bubble shows the ambient mood message.
  // A sick, critical or deceased pet's own message comes before the usual mood line.
  // A passed-away pet shows no speech bubble: the memorial card under the navigation already says
  // it (and carries the resurrection button), so the same sentence above the tombstone was a duplicate.
  const temporaryText = temporaryMessage
    ? temporaryMessage.kind === 'uncheck'
      ? tr('uncheckMessage')
      : trList('completion')[temporaryMessage.index % trList('completion').length]
    : null;
  const displayedPetMessage = isDeceased ? null : (temporaryText ?? getPetLifeMessage(petProfile) ?? moodMessage);

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
      // A child's parent-assigned tasks join this one card (nothing for Main, or a child with none assigned)
      assignedRows={assignedTasks.length > 0 ? <AssignedHomeRows /> : undefined}
      assignedTotal={assignedTasks.length}
      assignedOutstanding={assignedTasks.filter(isOutstanding).length}
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

  return (
    // The living-room background now renders once in src/app/_layout.tsx
    // (behind the header too, on Home), not here — this container stays
    // transparent so that shows through instead of the usual opaque fill.
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {/* The kitty is the main focus: the pet, her needs bars and the care buttons sit in
            the open room. Everything else lives in the two slide-out panels below (their
            tabs are the only other thing visible on the edges). The pet is in an overlay,
            not inside any scroll view, so nothing ever moves her. */}
        <View
          style={styles.petOverlay}
          pointerEvents="box-none"
          onLayout={(event) => setOverlayHeight(event.nativeEvent.layout.height)}>
          <View style={styles.petOverlaySpacerTop} />
          <View
            pointerEvents="box-none"
            onLayout={(event) => setPetGroupHeight(event.nativeEvent.layout.height)}
            style={petFitScale < 1 ? { transform: [{ scale: petFitScale }], transformOrigin: 'top' } : undefined}>
          <PetRoom
            // Phone width: a lowered Sick / Critical kitty gets real space under her (so the bars and
            // care buttons below it move down and the group still fits); desktop keeps the visual shift.
            reserveHealthSpace={width < 700}
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
            // this prop is actually provided" convention. The handlers
            // themselves (handleFeed etc.) also separately guard on
            // isRealEgg — see their own comments — so a real action
            // can't fire even if some future change made one of these
            // controls visible again.
            equippedAccessoryIds={isDisplayedEgg ? undefined : equippedAccessoryIds}
            isMemorial={isDeceased}
            healthState={petProfile?.lifeState}
            hunger={hideCare ? undefined : petProfile?.hunger}
            cleanliness={hideCare ? undefined : petProfile?.cleanliness}
            happiness={hideCare ? undefined : petProfile?.happiness}
            energy={hideCare ? undefined : petProfile?.energy}
            poopPiles={hideCare ? undefined : petProfile?.poopPiles}
            needsBath={hideCare ? undefined : petProfile?.needsBath}
            onFeed={hideCare ? undefined : handleFeed}
            isFeeding={isFeeding}
            onPlay={hideCare ? undefined : handlePlay}
            isPlaying={isPlaying}
            onRest={hideCare ? undefined : handleRest}
            isResting={isResting}
            onCleanUpPile={hideCare || poopPaused ? undefined : handleCleanUpPile}
            hatchedAt={effectiveHatchedAt}
            isStagePreviewActive={isEffectiveStagePreviewActive}
            lastBathCompletedAt={hideCare ? undefined : petProfile?.lastBathCompletedAt}
            toyId={hideCare ? undefined : toySession?.toyId}
          />
          </View>
          <View style={styles.petOverlaySpacerBottom} />
        </View>

        {/* Left: Pet Progress (level, growth bar, tasks to the next stage, the five stages and
            the development-only Pet Stage Preview). */}
        <SlideOutPanel
          side="left"
          label={t('panelPetProgress')}
          icon="paw"
          tint="#DCCBF5"
          panelBackground="#F6F0FD"
          panelWidth={panelWidth}
          tabTop={0.3}
          open={openPanel === 'progress'}
          tabHidden={openPanel === 'features'}
          onOpen={() => setOpenPanel('progress')}
          onClose={() => setOpenPanel((current) => (current === 'progress' ? null : current))}>
          <PetProgress
            completedTaskCount={completedTaskCount}
            paidStageIndex={petProfile?.paidStageIndex ?? 0}
            previewStageIndex={devPreviewStageIndex}
            onPreviewStage={handleSetDevPreviewStage}
            onResetPreview={() => handleSetDevPreviewStage(null)}
          />
        </SlideOutPanel>

        {/* Right: Home Features (Today's Tasks, Appointments, Today's Mood and — in landscape
            only — the Rooms shortcut; portrait already has the Rooms tab in the top navigation). */}
        <SlideOutPanel
          side="right"
          label={t('panelHomeFeatures')}
          icon="home"
          tint="#FBC9DB"
          panelBackground="#FFF1F6"
          panelWidth={panelWidth}
          tabTop={0.3}
          open={openPanel === 'features'}
          tabHidden={openPanel === 'progress'}
          badge={outstandingTotal(assignedTasks)}
          badgeLabel={t('atTabBadge', { count: outstandingTotal(assignedTasks) })}
          onOpen={() => setOpenPanel('features')}
          onClose={() => setOpenPanel((current) => (current === 'features' ? null : current))}>
          <ToyPlayCard />
          {taskCard}
          {/* A child's Home hides the whole appointments card (heading and empty message too) while there is nothing today; Main always shows it. */}
          {isChildProfile && todaysDisplayAppointments.length === 0 ? null : appointmentsCard}
          <TodayMood mood={recordedMood} message={moodMessage} onSelectMood={handleSelectMood} />
          {!isPortrait ? <RoomsCard /> : null}
        </SlideOutPanel>

        {/* A postcard from Pawadise has arrived: the mailbox drifts around until tapped. */}
        <PawadiseMailbox
          kittyVisiblePx={
            Math.min(260, Math.max(150, 0.46 * (width - 2 * Spacing.five))) * petFitScale * (KITTY_VISIBLE_PER_BOX[effectiveDisplayedStage] ?? 0.9)
          }
        />
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
  confettiOverlay: {
    ...StyleSheet.absoluteFill,
  },
  // overflow hidden: a closed panel waits just off-screen, and must never make the page scroll
  // sideways.
  safeArea: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  // Absolutely positioned so nothing ever scrolls or moves the pet. The spacers bias her
  // toward the lower part of the room, roughly where the rug sits in the background art.
  petOverlay: {
    ...StyleSheet.absoluteFill,
    paddingHorizontal: Spacing.five,
  },
  petOverlaySpacerTop: {
    flexGrow: 5,
  },
  petOverlaySpacerBottom: {
    flexGrow: 1,
  },
});
