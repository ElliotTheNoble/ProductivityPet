import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DevBathingArtPreview } from '@/components/dev-bathing-art-preview';
import { RoomPet } from '@/components/room-pet';
import { RoomTaskPanel } from '@/components/room-task-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { DEV_ENABLE_BATHING_ART_PREVIEW } from '@/utils/dev-flags';
import { getDevPreviewStageIndex, subscribeToDevPreviewStageIndex } from '@/utils/dev-stage-preview';
import { getRenderedStage } from '@/utils/pet-growth';
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

  // Simple explanation: tracks whether the player has pressed "Wash
  // Kitty" in the Bathroom — this is step 1 of the future full bathing
  // sequence (wash → rinse → dry). It's plain local component state, NOT
  // saved anywhere and NOT part of the persistent Pet Profile — it only
  // decides which PICTURE to show right now, exactly like
  // devPreviewStageIndex above does for stage previewing. Because
  // RoomDetailScreen remounts on every room navigation (same convention
  // noted above for petProfile/tasks), this naturally resets to false the
  // moment the player leaves the Bathroom — "local to the Bathroom", per
  // instructions. Cleanliness, needsBath, and every other real pet-care
  // value are completely untouched by this — only a later step (once
  // rinse + dry exist too) will actually update those.
  const [isWashing, setIsWashing] = useState(false);

  // Defensive backstop, not the only thing preventing this — the "Wash
  // Kitty" button below is already only rendered for the Bathroom while a
  // non-Egg stage is displayed, and room-pet.tsx separately refuses to
  // show soapy art for Egg regardless of this state. Checked against
  // displayedStage (not realStage) since this purely visual toggle only
  // ever matters for whatever is CURRENTLY shown, the same way isDirty
  // above and the Stage Preview itself work.
  function handleWashKitty() {
    if (room.slug !== 'bathroom' || displayedStage === 'Egg') return;
    setIsWashing(true);
  }

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

        {/* TEMPORARY, developer-only — see DEV_ENABLE_BATHING_ART_PREVIEW's
            own comment in @/utils/dev-flags.ts. Only shown on the Bathroom
            page, entirely separate from the real "Wash Kitty"
            button/isWashing state above — this never changes what Kitty
            actually shows for real gameplay, it's purely a visual
            spot-check tool for the 14 bathing sprite sheets prepared in
            @/utils/bathing-stage-art.ts. */}
        {DEV_ENABLE_BATHING_ART_PREVIEW && room.slug === 'bathroom' ? <DevBathingArtPreview /> : null}

        {/* Every room now renders Kitty — Study Room/Gym/Bedroom/Kitchen
            via their own activity sprite art (see @/utils/room-pet-art.ts),
            Bathroom via that same shared "normal"/dirty pet art Home
            already shows, OR — while isWashing is true — her new soapy
            picture instead (see @/components/room-pet.tsx and
            handleWashKitty above; this is step 1 of the bathing
            sequence, rinse/dry aren't built yet). Position/size for the
            currently-displayed stage come from petPlacement, resolved
            above via @/utils/room-pet-placement.ts. */}
        <View style={[styles.petArea, petPlacement.areaStyle]} pointerEvents="none">
          <View style={[styles.petBox, petPlacement.boxStyle]}>
            <RoomPet roomSlug={room.slug} stage={displayedStage} isDirty={isDirty} isWashing={isWashing} />
          </View>
        </View>

        {/* Simple explanation: a cute "Wash Kitty" button, only shown in
            the Bathroom (never any other room) and only while a real,
            non-Egg stage is being shown (an Egg can't be bathed yet —
            she hasn't hatched). Pressing it shows Kitty's soapy picture
            above and stays that way (no timer reverts it) until the next
            bathing step (Rinse) is built later.
            Positioned in its own full-width row, well above where
            Kitty's box can ever reach in this room (her box tops out at
            petPlacement's own maxWidthPx + paddingBottomPx — see
            @/utils/room-pet-placement.ts's 'bathroom' entry — comfortably
            less than the 380px clearance used here), and horizontally
            centered the standard "full-width row + alignItems: center"
            way rather than Kitty's own box position, so it reliably never
            covers her regardless of screen size. The row itself is
            `pointerEvents="box-none"` so only the button inside it is
            actually tappable — the empty space around it still lets taps
            reach whatever's beneath (consistent with petArea's own
            pointerEvents="none" above). This also stays clear of the
            task panel, which only ever docks to a screen EDGE (top-right
            on desktop, bottom-right/collapsed on mobile — see
            @/components/room-task-panel.tsx), never the horizontal
            center this button lives in. */}
        {room.slug === 'bathroom' && displayedStage !== 'Egg' && !isWashing ? (
          <View style={styles.washButtonRow} pointerEvents="box-none">
            <Pressable onPress={handleWashKitty} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="sky" style={styles.washButton}>
                <ThemedText type="smallBold">🧼 Wash Kitty</ThemedText>
              </ThemedView>
            </Pressable>
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
  // Full-width row, horizontally centering the button inside it — the
  // standard RN way to center an absolutely-positioned overlay element
  // (an absolute child can't use alignSelf: 'center' on its own the way a
  // normal flex child can). bottom: 380 comfortably clears the Bathroom's
  // own Kitty box at its largest possible size — see the "Wash Kitty"
  // comment above for the exact numbers this is checked against.
  washButtonRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 380,
    alignItems: 'center',
  },
  washButton: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
});
