import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { RoomPet } from '@/components/room-pet';
import { RoomTaskPanel } from '@/components/room-task-panel';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
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
            Bathroom via the same shared "normal" pet art Home already
            shows (see @/components/room-pet.tsx — it has no activity
            sheet of its own yet, bath mechanics aren't implemented).
            Position/size for the currently-displayed stage come from
            petPlacement, resolved above via @/utils/room-pet-placement.ts. */}
        <View style={[styles.petArea, petPlacement.areaStyle]} pointerEvents="none">
          <View style={[styles.petBox, petPlacement.boxStyle]}>
            <RoomPet roomSlug={room.slug} stage={displayedStage} isDirty={isDirty} />
          </View>
        </View>

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
});
