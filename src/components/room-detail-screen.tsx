import { useRouter } from 'expo-router';
import { useEffect, useReducer, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BATHING_INSTRUCTIONS, BathingMiniGame, TOTAL_BATHING_TARGETS, type BathingPhase } from '@/components/bathing-mini-game';
import { RoomPet } from '@/components/room-pet';
import { RoomTaskPanel } from '@/components/room-task-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { BATHING_STEP_COUNTS, type BathingStep } from '@/utils/bathing-stage-art';
import { getActiveSoapItem } from '@/utils/bathing-soap';
import { getDevPreviewStageIndex, subscribeToDevPreviewStageIndex } from '@/utils/dev-stage-preview';
import { getRenderedStage } from '@/utils/pet-growth';
import { BATH_DRY_HOLD_MS, completeBathing, isShowingBathDryHold as getIsShowingBathDryHold } from '@/utils/pet-bathing';
import { isPetDirty } from '@/utils/pet-needs';
import { getPetProfile, type PetProfile } from '@/utils/pet-profile';
import { PET_STAGES } from '@/utils/pet-stage';
import { resolveRoomPetPlacement } from '@/utils/room-pet-placement';
import { getRoomTasks } from '@/utils/room-tasks';
import type { RoomInfo } from '@/utils/rooms';
import { getCachedTasks, persistCachedTasks } from '@/utils/task-storage';
import {
  createTask,
  getCompletedTaskCount,
  isOccurrenceCompleted,
  occursOnDate,
  sortByImportantFirst,
  todayISO,
  toggleTaskOccurrence,
  type DisplayTask,
  type Task,
} from '@/utils/tasks';

// The shower hose and blow dryer have no Shop-purchasable data model yet
// (per instructions, only soap gets that treatment for now — see
// @/utils/bathing-soap.ts), so their icons just live here directly.
const HOSE_ICON = '🚿';
const BLOW_DRYER_ICON = '💨';

type RoomDetailScreenProps = {
  room: RoomInfo;
};

// The room's own background (with its birthday override, where one
// exists) renders full-bleed behind the header, in src/app/_layout.tsx —
// the same treatment Home/Tasks/Stats/Mini-Games already use — instead of
// a small aspect-locked image box inside this screen. This screen stays
// transparent (see styles.container) so that background shows through,
// and only renders the small overlay UI on top of it: a Back to Rooms
// pill (bottom-left), Kitty (every room now has her — see
// @/components/room-pet.tsx), and this room's own task panel (right side
// on desktop by default, left for Kitchen, collapsible on mobile — see
// @/components/room-task-panel.tsx).
export function RoomDetailScreen({ room }: RoomDetailScreenProps) {
  const router = useRouter();
  // Needed by resolveRoomPetPlacement below (Bedroom's wide-desktop nudge
  // is the only placement that currently depends on it).
  const { width } = useWindowDimensions();

  // The pet's real stage, same formula Home uses — loaded fresh on every
  // mount (this screen remounts per room navigation, same convention as
  // equippedAccessoryId elsewhere), falling back to 0/empty before either
  // resolves so Egg renders rather than guessing.
  const [petProfile, setPetProfile] = useState<PetProfile | null>(null);
  // Full task list (not just a count) — needed so this room's own task
  // panel can show, toggle, and add real tasks, not just a number.
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    let cancelled = false;
    getPetProfile()
      .then((profile) => {
        if (!cancelled) setPetProfile(profile);
      })
      .catch(() => {});
    getCachedTasks()
      .then((cached) => {
        if (!cancelled) setTasks(cached);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const realStage = getRenderedStage(getCompletedTaskCount(tasks), petProfile?.paidStageIndex ?? 0);

  // Mirrors the same dev-only Pet Stage Preview selected on Home's Pet
  // Progress panel (see @/utils/dev-stage-preview.ts for why this needs to
  // be a shared module rather than Home's own local state) — purely a
  // display swap, same as Home's displayedStage; never written anywhere,
  // never affects real progression.
  const [devPreviewStageIndex, setDevPreviewStageIndexState] = useState<number | null>(() =>
    getDevPreviewStageIndex()
  );
  useEffect(() => subscribeToDevPreviewStageIndex(setDevPreviewStageIndexState), []);
  const displayedStage = devPreviewStageIndex !== null ? PET_STAGES[devPreviewStageIndex] : realStage;

  // Where/how big Kitty renders in this room, for the stage actually
  // being displayed (the real stage, or the dev preview override above —
  // see resolveRoomPetPlacement's own comment in
  // @/utils/room-pet-placement.ts for why passing displayedStage here is
  // what keeps the preview's artwork and positioning in sync without
  // touching real saved progression). Every RoomSlug (all 5) now has an
  // entry in ROOM_PET_PLACEMENTS, Bathroom included, so this always
  // resolves — no more per-room gating needed here.
  const petPlacement = resolveRoomPetPlacement(room.slug, displayedStage, width);

  // Only ever changes the Bathroom's artwork (see RoomPet) — computed from
  // the real loaded profile, false before it's loaded (same "not loaded
  // yet" convention as every other petProfile?.field read in this app).
  const isDirty = petProfile ? isPetDirty(petProfile) : false;

  // The soap the mini-game actually uses — see @/utils/bathing-soap.ts's
  // own module comment for why there's only ever one right now (no Shop
  // purchase flow for soaps yet) and how a future one would plug in here
  // without this screen needing to change.
  const soapItem = getActiveSoapItem();

  // Simple explanation: which bathing tool the player currently has
  // selected (the Soap bar, the Shower hose, the Blow Dryer, or none) —
  // picking one shows the interactive hover-and-hold mini-game
  // (@/components/bathing-mini-game.tsx) for that phase. Plain local
  // component state, same "local to the Bathroom" reasoning as every
  // other piece of bathing UI state here (this screen remounts on every
  // room navigation).
  const [activeTool, setActiveTool] = useState<BathingPhase | null>(null);
  // How many of the 5 targets the player has finished holding over so
  // far, for each phase — the real source of truth for the Soap/Rinse/
  // Blow Dry progress bars below, and for unlocking the next tool/
  // actually completing the bath.
  //
  // Deliberately NOT auto-reset to 0 the instant a bath completes — an
  // EARLIER version did that (inside the completion effect's own
  // finally()), which was itself a bug: the progress bars would visibly
  // snap back to 0% completely on their own the moment Blow Dry finished,
  // reading as "the whole mini-game just restarted itself" even though
  // nothing the player did asked for that. All three now stay at
  // TOTAL_BATHING_TARGETS (visibly "done") after a completed bath, right
  // up until the player explicitly reselects Soap — see handleSelectTool
  // below, which is the ONLY place these three ever reset together now.
  //
  // Separately: the tool-select row below is never hidden just because
  // Kitty is currently showing her post-bath Dry pose (isShowingBathDryHold)
  // — bathing again doesn't depend on Cleanliness, needsBath, or the Dry
  // hold at all, per instructions (an EARLIER version hid the whole row
  // during that window, which was a different bug — there was no way to
  // even reach the Soap button to start a new bath for the entire
  // 30-minute hold).
  const [soapCompletedCount, setSoapCompletedCount] = useState(0);
  const [rinseCompletedCount, setRinseCompletedCount] = useState(0);
  const [blowDryCompletedCount, setBlowDryCompletedCount] = useState(0);
  const isSoapDone = soapCompletedCount >= TOTAL_BATHING_TARGETS;
  const isRinseDone = rinseCompletedCount >= TOTAL_BATHING_TARGETS;
  const isBlowDryDone = blowDryCompletedCount >= TOTAL_BATHING_TARGETS;

  // The moment whichever tool is currently active finishes ITS OWN phase
  // (not necessarily all three — see the separate completion effect
  // further below, which is what actually finishes the bath), deselect
  // it — without this, a just-finished mini-game would keep rendering
  // inertly (its own completedCount already at TOTAL_BATHING_TARGETS, so
  // nothing it does matters) while still visually reading as "selected,"
  // instead of clearly handing control back to the tool-select buttons so
  // the player can consciously pick the next tool.
  useEffect(() => {
    if (activeTool === 'soap' && isSoapDone) setActiveTool(null);
    if (activeTool === 'rinse' && isRinseDone) setActiveTool(null);
    if (activeTool === 'blowDry' && isBlowDryDone) setActiveTool(null);
  }, [activeTool, isSoapDone, isRinseDone, isBlowDryDone]);

  // Defensive backstop, not the only thing preventing this — the tool
  // buttons below already only render/enable under the right conditions.
  // Checked against displayedStage (not realStage) since this purely
  // visual toggle only ever matters for whatever is CURRENTLY shown, the
  // same way isDirty above and the Stage Preview itself work. Rinse can't
  // be selected until Soap is fully done, Blow Dry can't be selected
  // until Rinse is fully done, and neither can be re-selected once its
  // own phase is already done — Soap is the one deliberate exception (see
  // below).
  function handleSelectTool(tool: BathingPhase) {
    if (room.slug !== 'bathroom' || displayedStage === 'Egg') return;
    if (tool === 'soap' && isSoapDone) {
      // Explicitly choosing to START A NEW BATH: all three phases stay at
      // 100% after a completed bath (see the completion effect below —
      // they're deliberately NOT auto-reset the moment the bath finishes,
      // per instructions, so a just-finished bath visibly stays
      // "completed" instead of looking like it silently restarted on its
      // own) until the player consciously picks Soap again. Only then do
      // they actually reset to 0, right here, together with selecting it.
      setSoapCompletedCount(0);
      setRinseCompletedCount(0);
      setBlowDryCompletedCount(0);
      setActiveTool('soap');
      return;
    }
    if (tool === 'rinse' && (!isSoapDone || isRinseDone)) return;
    if (tool === 'blowDry' && (!isRinseDone || isBlowDryDone)) return;
    setActiveTool(tool);
  }

  // Called by BathingMiniGame the moment the player finishes holding the
  // active tool over whichever target circle is currently next, for
  // whichever phase is active — see that component's own onTargetReached
  // prop comment for why moving off a target before it finishes pauses
  // (rather than resets) progress; only actually finishing the hold ever
  // advances anything.
  function handleTargetReached(tool: BathingPhase) {
    const increment = (prev: number) => Math.min(prev + 1, TOTAL_BATHING_TARGETS);
    if (tool === 'soap') setSoapCompletedCount(increment);
    else if (tool === 'rinse') setRinseCompletedCount(increment);
    else setBlowDryCompletedCount(increment);
  }

  // While a tool is actively selected and its phase isn't done yet, show
  // Kitty's REAL Soap/Rinse/Dry sprite progressing frame-by-frame as the
  // player finishes each target — completedCount 0 shows frame 1, 1 shows
  // frame 2, and so on, capped at each step's own last real frame
  // (BATHING_STEP_COUNTS.soap/rinse/dry) since Soap only has 4 real frames
  // for 5 targets. Blow Dry reuses the existing Dry sprite frames (the
  // same ones the old automatic reveal used to play on a timer) — so by
  // the time Blow Dry's own 5th target finishes, Kitty is already showing
  // her real final Dry pose live, driven by the player's own actions
  // rather than a separate auto-played animation afterward.
  //
  // undefined whenever no tool is active OR the active tool's own phase
  // just finished — see lastBathingFrameRef just below for why that gap
  // is NOT the same thing as "nothing to show."
  const miniGameFrame =
    activeTool === 'soap' && !isSoapDone
      ? { step: 'soap' as const, stepNumber: Math.min(soapCompletedCount + 1, BATHING_STEP_COUNTS.soap) }
      : activeTool === 'rinse' && !isRinseDone
        ? { step: 'rinse' as const, stepNumber: Math.min(rinseCompletedCount + 1, BATHING_STEP_COUNTS.rinse) }
        : activeTool === 'blowDry' && !isBlowDryDone
          ? { step: 'dry' as const, stepNumber: Math.min(blowDryCompletedCount + 1, BATHING_STEP_COUNTS.dry) }
          : undefined;

  // ROOT CAUSE of "Kitty flashes back to Dirty between phases / right
  // after finishing all three": miniGameFrame above (correctly) goes
  // undefined the instant a phase finishes — activeTool auto-deselects
  // (see the effect above) the moment isSoapDone/isRinseDone/isBlowDryDone
  // flips true, and undefined stayed undefined until the player picked
  // the NEXT tool (or, after Blow Dry, until completeBathing below
  // actually resolved and isShowingBathDryHold turned true). During that
  // entire gap, RoomPet had nothing authoritative to show and fell
  // through to its normal/dirty branch — which read as Dirty, since
  // needsBath/low Cleanliness are still true for the WHOLE bath, right up
  // until completeBathing's own finally() below actually clears them.
  //
  // Fix: remember the last REAL frame miniGameFrame produced, and keep
  // showing it across that gap instead of falling through. Deliberately a
  // ref updated inline during render (not useState/useEffect) — it needs
  // to win out on the VERY SAME render miniGameFrame first goes undefined
  // (e.g. the render where soapCompletedCount hits 5), not one render
  // later, otherwise that single frame would still flash Dirty. Cleared
  // back to undefined only once completeBathing's own finally() runs
  // below — from that point on, the REAL isShowingBathDryHold takes over
  // showing dry_5 for BATH_DRY_HOLD_MS, and clearing this ref is what lets
  // a genuinely NEW poop accident during that hold correctly override to
  // Dirty again (see room-pet.tsx's own isShowingBathDryHold && !isDirty
  // guard) instead of this ref indefinitely masking it.
  const lastBathingFrameRef = useRef<{ step: BathingStep; stepNumber: number } | undefined>(undefined);
  if (miniGameFrame) {
    lastBathingFrameRef.current = miniGameFrame;
  }
  const bathingFrame = miniGameFrame ?? lastBathingFrameRef.current;

  // The real "the player just finished all three phases" trigger —
  // completeBathing (@/utils/pet-bathing.ts) is what actually restores
  // Cleanliness to 100 and clears needsBath, and stamps lastBathCompletedAt
  // (so Kitty's final Dry pose — already showing live from Blow Dry above
  // — keeps showing for BATH_DRY_HOLD_MS afterward; see
  // isShowingBathDryHold below).
  //
  // Deliberately does NOT reset soapCompletedCount/rinseCompletedCount/
  // blowDryCompletedCount here (an earlier version of this effect did,
  // which was itself a bug: resetting them the INSTANT the bath finished
  // made the tool row's own progress bars visibly snap back to 0% on
  // their own, reading as "the whole mini-game just restarted itself,"
  // per instructions that a completed bath should instead visibly STAY
  // completed until the player consciously chooses to bathe again). Those
  // three only ever reset together now in handleSelectTool, exactly when
  // the player explicitly picks Soap again after already being done.
  //
  // Guarded purely by the dependency array: isSoapDone/isRinseDone/
  // isBlowDryDone all stay true for the whole async gap while
  // completeBathing is in flight (nothing else changes them, now that
  // nothing resets them right after either), so this effect simply
  // doesn't re-run while already-true stays already-true — it can only
  // ever fire again once a FUTURE bath makes all three true again from a
  // genuine 0 → 5 climb, not as some artifact of this effect's own past
  // run.
  useEffect(() => {
    if (!isSoapDone || !isRinseDone || !isBlowDryDone) return;
    completeBathing(new Date())
      .then((updated) => {
        setPetProfile(updated);
        // See lastBathingFrameRef's own comment above for why this must
        // be cleared the moment the bath is confirmed complete (here, not
        // later) — from this point on the REAL isShowingBathDryHold takes
        // over showing dry_5, and clearing this ref is what lets a
        // genuinely NEW poop accident during that hold still correctly
        // override to Dirty instead of this ref masking it indefinitely.
        lastBathingFrameRef.current = undefined;
      })
      .catch(() => {});
  }, [isSoapDone, isRinseDone, isBlowDryDone]);

  // Simple explanation: true if Kitty should still be showing her final
  // Dry picture right now because a real bath finished less than
  // BATH_DRY_HOLD_MS ago — this is what makes the Dry pose survive
  // leaving the Bathroom and coming back (this screen remounts on every
  // room navigation, but petProfile.lastBathCompletedAt is real saved
  // state, loaded fresh on mount above) and surviving a full app restart,
  // without ever restarting the window just because this component
  // happened to remount or re-render.
  const bathDryHoldElapsedMs = petProfile?.lastBathCompletedAt
    ? Date.now() - new Date(petProfile.lastBathCompletedAt).getTime()
    : Infinity;
  const isShowingBathDryHold = getIsShowingBathDryHold(petProfile?.lastBathCompletedAt);
  const [, forceRerenderAfterBathDryHold] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => {
    if (!isShowingBathDryHold) return;
    const remainingMs = Math.max(BATH_DRY_HOLD_MS - bathDryHoldElapsedMs, 0);
    const timer = setTimeout(forceRerenderAfterBathDryHold, remainingMs);
    return () => clearTimeout(timer);
    // Deliberately keyed on the real input (lastBathCompletedAt), not on
    // isShowingBathDryHold/bathDryHoldElapsedMs themselves — same
    // reasoning as pet-placeholder.tsx's own hatch-intro/Dry-hold effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petProfile?.lastBathCompletedAt]);

  // This room's own tasks for today — same two-step filter Home's
  // "Today's Tasks" uses (kind === 'task' && occursOnDate), then narrowed
  // to just this room via getRoomTasks (@/utils/room-tasks.ts — the exact
  // same room-membership logic the Rooms hub's own task-count badges use,
  // see room-hub-screen.tsx: explicit Task.room when set, else the legacy
  // category/keyword fallback), then mapped to the same DisplayTask shape
  // every task list in this app already renders from.
  const today = todayISO();
  const todaysTasks = tasks.filter((task) => task.kind === 'task' && occursOnDate(task, today));
  const roomTasks: DisplayTask[] = sortByImportantFirst(
    getRoomTasks(room.slug, todaysTasks).map((task) => ({
      id: task.id,
      text: task.text,
      completed: isOccurrenceCompleted(task, today),
      category: task.category,
      important: task.important,
      isRepeating: !!task.repeat,
      time: task.time,
    }))
  );

  // Toggling here uses the exact same toggleTaskOccurrence +
  // persistCachedTasks pair Home and the Tasks tab both use — the same
  // write updates the shared in-memory task cache (so Home/Tasks see the
  // change the moment they next mount), persists to AsyncStorage, AND
  // reconciles Paw Token earning (see @/utils/paw-tokens.ts), with its
  // existing duplicate-award protection completely unchanged — nothing
  // about rewards is reimplemented here.
  function handleToggleRoomTask(id: string) {
    const updated = toggleTaskOccurrence(tasks, id, today);
    setTasks(updated);
    persistCachedTasks(updated);
  }

  // Creates the task via the exact same createTask() the Tasks tab uses,
  // explicitly assigned to this room's slug (room.slug is a RoomSlug,
  // directly assignable to TaskRoom — see @/utils/rooms.ts) — no text
  // rewriting/tagging involved, just the real field — then persists
  // through the identical toggle/save path.
  function handleAddRoomTask(text: string) {
    const created = createTask({ text, kind: 'task', date: today, room: room.slug });
    const updated = [...tasks, created];
    setTasks(updated);
    persistCachedTasks(updated);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <Pressable
          onPress={() => router.push('/rooms')}
          style={({ pressed }) => [styles.backButtonPressable, pressed && styles.pressed]}>
          <ThemedView type="accent" style={styles.backButton}>
            <ThemedText type="smallBold" style={styles.backButtonText}>
              ← Back to Rooms
            </ThemedText>
          </ThemedView>
        </Pressable>

        {/* Every room now renders Kitty — Study Room/Gym/Bedroom/Kitchen
            via their own activity sprite art (see @/utils/room-pet-art.ts),
            Bathroom via that same shared "normal"/dirty pet art Home
            already shows, OR — while a tool is selected and its phase
            isn't done yet (bathingFrame set to miniGameFrame above) — her
            REAL Soap/Rinse/Dry sprite, progressing frame-by-frame as the
            player finishes each target (Blow Dry reuses the Dry sprite —
            see miniGameFrame's own comment above for why that means no
            separate auto-played reveal is needed anymore), OR — for
            BATH_DRY_HOLD_MS after a bath finishes (isShowingBathDryHold)
            — her final Dry pose (see @/components/room-pet.tsx and the
            effects above). Position/size for the currently-displayed
            stage come from petPlacement, resolved above via
            @/utils/room-pet-placement.ts. The interactive mini-game
            overlay (below, only while a tool is selected) is sized to
            this exact same petBox, so its targets always line up with
            Kitty regardless of screen size. */}
        <View style={[styles.petArea, petPlacement.areaStyle]} pointerEvents="box-none">
          <View style={[styles.petBox, petPlacement.boxStyle]}>
            <RoomPet
              roomSlug={room.slug}
              stage={displayedStage}
              isDirty={isDirty}
              needsBath={petProfile?.needsBath}
              bathingFrame={bathingFrame}
              isShowingBathDryHold={isShowingBathDryHold}
            />
            {/* Only mounted while a tool is actually selected — see
                handleSelectTool above. stage is narrowed away from 'Egg'
                by the same displayedStage !== 'Egg' check the tool
                buttons below are already gated on, so this never renders
                for an Egg. */}
            {activeTool && displayedStage !== 'Egg' ? (
              <BathingMiniGame
                phase={activeTool}
                toolIcon={activeTool === 'soap' ? soapItem.icon : activeTool === 'rinse' ? HOSE_ICON : BLOW_DRYER_ICON}
                completedCount={
                  activeTool === 'soap' ? soapCompletedCount : activeTool === 'rinse' ? rinseCompletedCount : blowDryCompletedCount
                }
                onTargetReached={() => handleTargetReached(activeTool)}
              />
            ) : null}
          </View>
        </View>

        {/* The bathing mini-game's own controls: pick a tool (Soap bar,
            then Shower hose once Soap is fully done, then Blow Dryer once
            Rinse is fully done), see its progress fill as the player holds
            each circle for 2 seconds in @/components/bathing-mini-game.tsx,
            and watch the bath actually complete once all three reach
            100%. Only shown in the Bathroom (never any other room) and
            only while a real, non-Egg stage is being shown (an Egg can't
            be bathed yet — she hasn't hatched) — deliberately NOT also
            hidden while isShowingBathDryHold is true: bathing is always
            available on demand, with no Cleanliness/needsBath/Dry-hold
            gate, so the player can start a brand new bath at any time,
            including immediately after finishing one (see the ROOT CAUSE
            note on soapCompletedCount/rinseCompletedCount/
            blowDryCompletedCount below for why an EARLIER version of this
            condition made that impossible). Selecting a tool here
            immediately overrides whatever Kitty is currently showing —
            including an active Dry hold from a previous bath — since
            miniGameFrame (passed to RoomPet as bathingFrame) always takes
            priority over isShowingBathDryHold once a tool is active; see
            @/components/room-pet.tsx's own bathingFrame-before-
            isShowingBathDryHold ordering. Positioned in its own full-width
            row, well above where Kitty's box can ever reach in this room
            (her box tops out at petPlacement's own maxWidthPx +
            paddingBottomPx — see @/utils/room-pet-placement.ts's
            'bathroom' entry — comfortably less than the 380px clearance
            used here), and horizontally centered the standard "full-width
            row + alignItems: center" way rather than Kitty's own box
            position, so it reliably never covers her regardless of screen
            size. The row itself is `pointerEvents="box-none"` so only the
            buttons inside it are actually tappable — the empty space
            around them still lets taps reach whatever's beneath
            (consistent with petArea's own pointerEvents="box-none"
            above). This also stays clear of the task panel, which only
            ever docks to a screen EDGE (top-right on desktop, bottom-
            right/collapsed on mobile — see
            @/components/room-task-panel.tsx), never the horizontal center
            this row lives in. */}
        {room.slug === 'bathroom' && displayedStage !== 'Egg' ? (
          <View style={styles.washButtonRow} pointerEvents="box-none">
            {/* Only shown while a tool is actually selected — there's no
                "glowing circle" to point at otherwise. Wording changes per
                tool via BATHING_INSTRUCTIONS (@/components/bathing-mini-game.tsx),
                per instructions. Purely informational text, so it stays
                out of the pointerEvents="box-none" row's own tap target
                (no onPress, nothing to intercept). */}
            {activeTool ? (
              <ThemedView type="peachOverlay" style={styles.instructionBanner}>
                <ThemedText type="smallBold">{BATHING_INSTRUCTIONS[activeTool]}</ThemedText>
              </ThemedView>
            ) : null}
            <View style={styles.toolButtonRow}>
              <BathingToolButton
                icon={soapItem.icon}
                label={soapItem.name}
                percent={(soapCompletedCount / TOTAL_BATHING_TARGETS) * 100}
                selected={activeTool === 'soap'}
                // Deliberately never disabled, unlike Rinse/Blow Dry below
                // — this is the one way to start an entirely new bath
                // (see handleSelectTool's own comment), so it must stay
                // tappable even while already fully done/showing 100%.
                disabled={false}
                onPress={() => handleSelectTool('soap')}
              />
              <BathingToolButton
                icon={HOSE_ICON}
                label="Shower Hose"
                percent={(rinseCompletedCount / TOTAL_BATHING_TARGETS) * 100}
                selected={activeTool === 'rinse'}
                disabled={!isSoapDone || isRinseDone}
                onPress={() => handleSelectTool('rinse')}
              />
              <BathingToolButton
                icon={BLOW_DRYER_ICON}
                label="Blow Dryer"
                percent={(blowDryCompletedCount / TOTAL_BATHING_TARGETS) * 100}
                selected={activeTool === 'blowDry'}
                disabled={!isRinseDone || isBlowDryDone}
                onPress={() => handleSelectTool('blowDry')}
              />
            </View>
          </View>
        ) : null}

        {/* Kitchen's task panel docks to the LEFT instead of the shared
            right-side default — Kitty's position there has moved
            progressively further right over several rounds of tuning,
            close enough to a right-docked panel to risk covering her and
            her cleaning equipment. Every other room keeps the default
            (side omitted → 'right'). */}
        <RoomTaskPanel
          roomName={room.name}
          tasks={roomTasks}
          onToggleTask={handleToggleRoomTask}
          onAddTask={handleAddRoomTask}
          side={room.slug === 'kitchen' ? 'left' : undefined}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

// One tool-select button (Soap bar, Shower hose, or Blow Dryer) plus its
// own progress bar — a small presentational piece, kept local to this
// file since nothing else needs it. `disabled` means "not unlocked yet"
// (e.g. Rinse before Soap is done, or either Rinse/Blow Dry once their
// OWN phase is already fully done) — pressing it does nothing, and it
// reads visually dimmed. Soap is the one exception: see its own call
// site's `disabled={false}` comment for why it's never disabled, even
// once fully done.
function BathingToolButton({
  icon,
  label,
  percent,
  selected,
  disabled,
  onPress,
}: {
  icon: string;
  label: string;
  percent: number;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={({ pressed }) => pressed && !disabled && styles.pressed}>
      <ThemedView type="sky" style={[styles.toolButton, selected && styles.toolButtonSelected, disabled && styles.toolButtonDisabled]}>
        <ThemedText type="smallBold">
          {icon} {label}
        </ThemedText>
        <View style={styles.toolProgressTrack}>
          <View style={[styles.toolProgressFill, { width: `${percent}%` }]} />
        </View>
      </ThemedView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  safeArea: {
    flex: 1,
    width: '100%',
  },
  backButtonPressable: {
    position: 'absolute',
    left: Spacing.four,
    bottom: Spacing.four,
    zIndex: 1,
  },
  // Larger pill + a deeper pink than the shared theme.accent (#F28DAE) —
  // this one specific button wants to read clearly over a busy
  // full-bleed background photo, where the normal accent color can wash
  // out a little. Same rounded-pill shape and white text as before, just
  // bigger and a bit more saturated.
  backButton: {
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.five,
    backgroundColor: '#EC6F98',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    lineHeight: 24,
  },
  pressed: {
    opacity: 0.7,
  },
  // Structural only — fills the full safe area, bottom-anchored main
  // axis. paddingBottom/alignItems/paddingLeft all now come from
  // petPlacement.areaStyle (@/utils/room-pet-placement.ts) for every
  // room, so nothing room-specific is hardcoded here anymore.
  petArea: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'flex-end',
  },
  // Structural only — stays square (RoomPet contain-fits its actual
  // sprite crop inside this box without stretching regardless of size —
  // see @/components/room-pet.tsx); width/maxWidth/marginLeft all come
  // from petPlacement.boxStyle for every room.
  petBox: {
    aspectRatio: 1,
  },
  // Full-width row, horizontally centering the two tool buttons inside it
  // — the standard RN way to center an absolutely-positioned overlay
  // element (an absolute child can't use alignSelf: 'center' on its own
  // the way a normal flex child can). bottom: 380 comfortably clears the
  // Bathroom's own Kitty box at its largest possible size — see the tool-
  // buttons comment above for the exact numbers this is checked against.
  // Outer column: the instruction banner (only while a tool is selected)
  // stacked above the row of tool buttons, both horizontally centered.
  washButtonRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 380,
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  instructionBanner: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  toolButtonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
  },
  // 3 buttons now (Soap/Shower Hose/Blow Dryer) instead of 2 — minWidth
  // trimmed down a little from before so all 3 still comfortably fit a
  // typical phone width in one row (flexWrap above is still there as a
  // backstop for genuinely narrow screens).
  toolButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    minWidth: 120,
    alignItems: 'center',
    gap: Spacing.one,
  },
  toolButtonSelected: {
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  toolButtonDisabled: {
    opacity: 0.4,
  },
  toolProgressTrack: {
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.5)',
    overflow: 'hidden',
  },
  toolProgressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#34C759',
  },
});
