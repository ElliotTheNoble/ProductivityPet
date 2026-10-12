import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { TaskIcon } from '@/components/task-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DisplayTask } from '@/utils/tasks';

// Same breakpoint Home uses for its own two-column vs. stacked layout
// (see WIDE_LAYOUT_BREAKPOINT in src/app/index.tsx) — reused here so this
// panel's "docked vs. collapsible" switch lines up with the rest of the
// app's own desktop/mobile boundary.
const WIDE_PANEL_BREAKPOINT = 700;

type RoomTaskPanelProps = {
  // Display name matching RoomInfo.name — 'Study Room', 'Gym', etc. — used
  // only for the "<Room> Tasks" header text.
  roomName: string;
  // Already filtered to just this room's own tasks and sorted
  // important-first by the caller (see getRoomTasks in
  // @/utils/room-tasks.ts and room-detail-screen.tsx) — this component
  // doesn't know or care how that filtering works, it only renders what
  // it's given.
  tasks: DisplayTask[];
  onToggleTask: (id: string) => void;
  onAddTask: (text: string) => void;
  // Which screen edge this panel docks to. Defaults to 'right' — every
  // room except Kitchen. Kitchen passes 'left' (see room-detail-screen.tsx)
  // because Kitty's own position there has moved progressively further
  // right over several rounds of tuning, close enough to the right-docked
  // panel that the panel needed to move to the opposite side instead.
  side?: 'left' | 'right';
};

// A pastel task panel for a Room detail page — shows only that room's own
// tasks and lets them be completed or added without leaving the room. All
// actual task data work (loading, filtering, toggling, persisting, reward
// reconciliation) happens in the caller (room-detail-screen.tsx); this
// component is purely presentational plus its own tiny bit of local UI
// state (the add-task draft text, and whether it's expanded on a narrow
// screen).
//
// Desktop (width >= WIDE_PANEL_BREAKPOINT): docked to the right edge, full
// height, always expanded — the room (and Kitty) stay visible to its
// left/center. Mobile/narrow: starts collapsed to a small pill in the
// bottom-right so it never covers Kitty or the room by default; tapping it
// expands into a bottom-anchored panel with its own scrollable list and a
// way to collapse it again — sized and positioned to stay clear of the
// Back to Rooms button in the bottom-left (see room-detail-screen.tsx).
export function RoomTaskPanel({ roomName, tasks, onToggleTask, onAddTask, side = 'right' }: RoomTaskPanelProps) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= WIDE_PANEL_BREAKPOINT;
  const [isExpanded, setIsExpanded] = useState(false);
  const [draftText, setDraftText] = useState('');
  const isLeft = side === 'left';

  const completedCount = tasks.filter((task) => task.completed).length;
  const totalCount = tasks.length;
  const progressPercent = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);
  const allDone = totalCount > 0 && completedCount === totalCount;

  function handleAdd() {
    const trimmed = draftText.trim();
    if (!trimmed) return;
    onAddTask(trimmed);
    setDraftText('');
  }

  const panelBody = (
    <>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold">{roomName} Tasks</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {completedCount}/{totalCount}
        </ThemedText>
      </View>

      <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
        <View style={{ flex: progressPercent, backgroundColor: theme.mint }} />
        <View style={{ flex: 100 - progressPercent }} />
      </View>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {totalCount === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No tasks yet! Let&apos;s add one! 🐾
          </ThemedText>
        ) : (
          tasks.map((task) => (
            <Pressable
              key={task.id}
              onPress={() => onToggleTask(task.id)}
              style={({ pressed }) => [styles.taskRow, pressed && styles.pressed]}>
              <View
                style={[
                  styles.checkbox,
                  { borderColor: theme.purple },
                  task.completed && { backgroundColor: theme.mint, borderColor: theme.mint },
                ]}>
                {task.completed ? <ThemedText style={styles.checkmark}>✓</ThemedText> : null}
              </View>

              <TaskIcon category={task.category} size={22} />

              <ThemedText
                style={[styles.taskText, task.completed && styles.completedText]}
                themeColor={task.completed ? 'textSecondary' : 'text'}
                numberOfLines={2}>
                {task.text}
              </ThemedText>

              {task.important ? <ThemedText style={styles.star}>⭐</ThemedText> : null}
            </Pressable>
          ))
        )}
      </ScrollView>

      {allDone ? (
        <ThemedText type="smallBold" themeColor="accent" style={styles.celebrateText}>
          Yippee! All done! 🎉
        </ThemedText>
      ) : null}

      <TextInput
        value={draftText}
        onChangeText={setDraftText}
        placeholder="What needs doing here?"
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
        ]}
        onSubmitEditing={handleAdd}
        returnKeyType="done"
      />
      <Pressable onPress={handleAdd} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView type="accent" style={styles.addButton}>
          <ThemedText type="smallBold" style={styles.addButtonText}>
            + Add a task to this room
          </ThemedText>
        </ThemedView>
      </Pressable>
    </>
  );

  if (isWide) {
    return (
      <ThemedView
        type="backgroundElementOverlay"
        style={[
          styles.panel,
          styles.panelDocked,
          // Kitchen only (side='left'): docks to the left edge instead,
          // and caps shorter (60% vs. the default 75%) to leave guaranteed
          // clearance above the Back to Rooms button, which shares this
          // same bottom-left corner once the panel is on this side too —
          // every other room keeps the original right-docked, 75%-capped
          // shape untouched.
          isLeft ? { left: Spacing.four, maxHeight: '60%' } : { right: Spacing.four },
        ]}>
        {panelBody}
      </ThemedView>
    );
  }

  if (!isExpanded) {
    return (
      <Pressable onPress={() => setIsExpanded(true)} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView
          type="backgroundElementOverlay"
          style={[styles.collapsedPill, isLeft ? { left: Spacing.three } : { right: Spacing.three }]}>
          <ThemedText type="smallBold">
            📋 {roomName} ({completedCount}/{totalCount})
          </ThemedText>
        </ThemedView>
      </Pressable>
    );
  }

  return (
    <ThemedView
      type="backgroundElementOverlay"
      style={[
        styles.panel,
        styles.panelCollapsible,
        isLeft ? { left: Spacing.three, right: '18%' } : { right: Spacing.three, left: '18%' },
      ]}>
      <Pressable
        onPress={() => setIsExpanded(false)}
        style={({ pressed }) => [styles.collapseButton, pressed && styles.pressed]}>
        <ThemedText type="small" themeColor="textSecondary">
          ▾ Collapse
        </ThemedText>
      </Pressable>
      {panelBody}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // Shared shape for both the desktop-docked and mobile-expanded panel —
  // soft rounded corners + the translucent pastel-pink backgroundElementOverlay
  // fill (same token Home's own Today's Tasks card and Pet Progress panel
  // use), so this reads as part of the same design system. overflow:
  // 'hidden' is what makes maxHeight below actually clip/cap the panel
  // (and keeps the rounded corners clean) instead of letting content spill
  // past it.
  panel: {
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two,
    overflow: 'hidden',
  },
  // Only `top` is anchored — deliberately no `bottom` here (that was the
  // bug: with both set, the panel was forced to stretch to a fixed full
  // height no matter how little content it had). Height is now auto —
  // the panel wraps tightly around its own content (header + progress bar
  // + however tall the task list currently is + the add-task controls) —
  // with maxHeight as a safety cap against the available screen height so
  // it still can't ever grow past the viewport on a very long task list;
  // styles.list's own maxHeight is what actually makes the list scroll
  // internally once there are many tasks, keeping the rest of the panel
  // (header/progress/add controls) always visible rather than scrolled
  // away with it.
  // left/right are deliberately NOT set here — they're always supplied by
  // the side-conditional inline style in the JSX above (exactly one of
  // the two, never both; setting both would stretch this absolutely
  // positioned panel across the screen, the same class of bug the
  // top+bottom stretch fix elsewhere in this file already dealt with).
  // maxHeight here is the default (right-docked, every room but Kitchen);
  // Kitchen's left-docked override supplies its own smaller value inline.
  panelDocked: {
    position: 'absolute',
    top: Spacing.four,
    width: 320,
    maxHeight: '75%',
  },
  // Bottom-anchored, and raised clear of the Back to Rooms button's own
  // bottom-left corner (see room-detail-screen.tsx) regardless of side —
  // also auto-height (no `top` set) up to maxHeight, same reasoning as
  // panelDocked above. left/right are supplied inline (see JSX above),
  // not here, for the same reason as panelDocked.
  panelCollapsible: {
    position: 'absolute',
    bottom: 72,
    maxHeight: '55%',
  },
  // left/right supplied inline (see JSX above), not here.
  collapsedPill: {
    position: 'absolute',
    bottom: 72,
    borderRadius: Spacing.five,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  collapseButton: {
    alignSelf: 'flex-end',
  },
  pressed: {
    opacity: 0.7,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressTrack: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  // flexGrow: 0 + a fixed maxHeight — this is what lets the list shrink
  // down to fit just a couple of short rows (no leftover blank space, see
  // panelDocked above) while also capping how tall it can grow for a long
  // task list, so IT scrolls internally rather than pushing the panel's
  // header/progress bar/add-task controls off past the edge of the screen.
  list: {
    flexGrow: 0,
    maxHeight: 260,
  },
  emptyText: {
    textAlign: 'center',
    paddingVertical: Spacing.three,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
  },
  // Same size/radius as Home's own Today's Tasks checkbox (see
  // task-card.tsx) — reused here rather than inventing new numbers, just
  // slightly larger than this panel's previous 22px so it's easier to
  // see/tap. The border color (set inline above, theme.purple) is a more
  // saturated existing token than the old theme.backgroundSelected, for
  // a clearer unchecked-vs-checked distinction against the pink panel.
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
  taskText: {
    flex: 1,
  },
  completedText: {
    textDecorationLine: 'line-through',
  },
  star: {
    fontSize: 13,
  },
  celebrateText: {
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  addButton: {
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#FFFFFF',
  },
});
