import * as ExpoRouter from 'expo-router';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { HoverPressable } from '@/components/hover-pressable';
import { ThemedText } from '@/components/themed-text';
import { hoverLift } from '@/constants/hover';
import { Spacing } from '@/constants/theme';
import { useT, type StringKey } from '@/i18n';
import {
  ROOM_KEYS,
  isOutstanding,
  outstandingByRoom,
  submitAssignedTask,
  undoAssignedTask,
  useAssignedTasks,
  viewsForRoom,
  type AssignedState,
  type AssignedTaskView,
  type RoomKey,
} from '@/utils/assigned-tasks';
import { ROOMS } from '@/utils/rooms';

// How a child sees the tasks a parent assigned (see @/utils/assigned-tasks.ts): inside the matching room, in the Tasks tab, and as a short
// "go and check" guide in Home's right-hand "Home Features" tab. The three states look clearly different: To do (pink), Try again (peach, a
// parent sent it back) and Waiting for my parent (lavender, handed in). A task is only ever one row, from the one household record, and nothing
// here touches the child's own task list.

const STATE_TEXT: Record<AssignedState, StringKey> = { 'to-do': 'atToDo', 'sent-back': 'atSentBack', waiting: 'atWaiting' };
const STATE_LOOK: Record<AssignedState, { fill: string; text: string }> = {
  'to-do': { fill: '#FBE3EC', text: '#9A3E63' },
  'sent-back': { fill: '#FBD9B8', text: '#8A4B12' },
  waiting: { fill: '#E6DBF8', text: '#5B3F8F' },
};

// How long a section stays softly highlighted after a tap on Home's guide brought the child to it.
export const FOCUS_HIGHLIGHT_MS = 2500;

// The "focus" value a screen was opened with (Home's guide sends a fresh one each tap, so tapping twice works twice). Test doubles of the
// router that have no search params simply give nothing.
export function useFocusParam(): string | undefined {
  const useParams = (ExpoRouter as { useLocalSearchParams?: () => Record<string, string | string[] | undefined> }).useLocalSearchParams;
  const params = useParams ? useParams() : {};
  const value = params?.focus;
  return Array.isArray(value) ? value[0] : value;
}

// True for a short while each time `token` changes to something: the section lights up, then goes back to normal.
export function useFocusPulse(token: string | undefined): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!token) return;
    setOn(true);
    const id = setTimeout(() => setOn(false), FOCUS_HIGHLIGHT_MS);
    return () => clearTimeout(id);
  }, [token]);
  return on;
}

function StatePill({ state }: { state: AssignedState }) {
  const { t } = useT();
  return (
    <View style={[styles.pill, { backgroundColor: STATE_LOOK[state].fill }]}>
      <ThemedText type="smallBold" style={{ color: STATE_LOOK[state].text }}>
        {t(STATE_TEXT[state])}
      </ThemedText>
    </View>
  );
}

// One assigned task: a card with its words and state, and ONE button in a fixed place ("I did it!" / "Undo"). Used by every view of these tasks
// (the Tasks tab and the rooms), so they behave and look the same. `showRoom` adds the room line (the Tasks tab lists every room together).
//
// Tapping the words (not the button) opens or closes the card's details; it never hands in or undoes anything. The words are their own
// control, next to the action button rather than around it, so screen readers and the keyboard reach both. A mouse hover lightly tints the
// card and a press darkens it a little.
function TaskRow({ view, showRoom = false }: { view: AssignedTaskView; showRoom?: boolean }) {
  const { t } = useT();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const roomName = view.room ? ROOMS[view.room].name : t('atAnywhere');
  // One handler for the one button in this spot: "I did it!" while the child has to act, "Undo" while the parent has not looked yet.
  // `busy` keeps a second tap from starting a second action; the household checks the state again when it applies the change.
  async function press() {
    if (busy) return;
    setBusy(true);
    if (view.state === 'waiting') setFailed((await undoAssignedTask(view.id)) === 'too-late');
    else setFailed((await submitAssignedTask(view.id)) === 'failed');
    setBusy(false);
  }
  return (
    <View style={[styles.row, open && styles.rowOpen]} testID={`assigned-${view.id}`}>
      <HoverPressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityLabel={t('atCardLabel', { task: view.text, state: t(STATE_TEXT[view.state]) })}
        accessibilityHint={t(open ? 'atCardHintClose' : 'atCardHintOpen')}
        accessibilityState={{ expanded: open }}
        testID={`assigned-card-${view.id}`}
        noHover
        style={(state) => [
          styles.rowText,
          (state as { hovered?: boolean }).hovered === true && styles.rowHover,
          state.pressed && styles.rowPressed,
        ]}>
        <ThemedText type="small" style={styles.taskText} numberOfLines={open ? undefined : 2}>
          {view.text}
        </ThemedText>
        {showRoom || open ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t('atParentRoomLine', { room: roomName })}
          </ThemedText>
        ) : null}
        <StatePill state={view.state} />
        {failed ? (
          <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
            {view.state === 'waiting' ? t('atUndoFailed') : t('atSendFailed')}
          </ThemedText>
        ) : null}
      </HoverPressable>
      <Pressable
        onPress={() => void press()}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={view.state === 'waiting' ? t('atUndoFor', { task: view.text }) : t('atDoneFor', { task: view.text })}
        style={(state) => [styles.doneButton, view.state === 'waiting' && styles.undoButton, state.pressed && styles.pressed, busy && styles.busy, hoverLift(state, !busy)]}>
        <ThemedText type="smallBold" style={view.state === 'waiting' ? styles.undoText : styles.doneText}>
          {view.state === 'waiting' ? t('atUndo') : t('atDone')}
        </ThemedText>
      </Pressable>
    </View>
  );
}

// Inside one room (Study Room, Gym, Bedroom, Kitchen, Bathroom): that room's assigned tasks. Nothing at all when there are none.
// `highlight` lights the section up for a moment (the child came here from Home's guide).
export function AssignedRoomTasks({ room, highlight = false }: { room: RoomKey; highlight?: boolean }) {
  const { t } = useT();
  const views = viewsForRoom(useAssignedTasks(), room);
  if (views.length === 0) return null;
  return (
    <View style={[styles.section, highlight && styles.highlight]} testID="assigned-section" accessibilityLabel={t('atTitle')}>
      <ThemedText type="smallBold">{t('atTitle')}</ThemedText>
      {views.map((view) => (
        <TaskRow key={view.id} view={view} />
      ))}
    </View>
  );
}

// The child's Tasks tab: EVERY task a parent assigned (all rooms and "anywhere"), each with its title, its room and its state, until the parent
// approves it. A separate section from the child's own tasks, which are not touched. Nothing at all when there are none.
// When the screen was opened from Home's guide (a "focus" value), the section lights up for a moment and the screen scrolls to it.
// `embedded`: the list goes INSIDE the screen's own "Today's Tasks" section (no title of its own), above the child's own tasks.
export function AssignedAllTasks({ scrollRef, embedded = false }: { scrollRef?: RefObject<ScrollView | null>; embedded?: boolean }) {
  const { t } = useT();
  const views = useAssignedTasks();
  const focus = useFocusParam();
  const highlight = useFocusPulse(focus);
  const sectionRef = useRef<View>(null);
  const has = views.length > 0;
  useEffect(() => {
    if (!focus || !has) return;
    const scroll = scrollRef?.current as (ScrollView & { getInnerViewRef?: () => unknown }) | null | undefined;
    const section = sectionRef.current;
    if (!scroll || !section) return;
    try {
      const inner = (scroll.getInnerViewRef?.() ?? scroll) as never;
      section.measureLayout(inner, (_x, y) => scroll.scrollTo({ y: Math.max(0, y - Spacing.two), animated: true }), () => {});
    } catch {
      // scrolling is a nicety; the section is on the screen either way
    }
  }, [focus, has, scrollRef]);
  if (!has) return null;
  return (
    <View ref={sectionRef} style={[styles.section, highlight && styles.highlight]} testID="assigned-section" accessibilityLabel={t('atTitle')}>
      {embedded ? null : (
        <ThemedText type="smallBold" themeColor="textSecondary">
          {t('atTitle')}
        </ThemedText>
      )}
      {views.map((view) => (
        <TaskRow key={view.id} view={view} showRoom />
      ))}
    </View>
  );
}

// Home's "Today's Tasks" card, the parent's part: each assigned task as one compact, tappable row (title, "From my parent" with the room, and its
// state). No buttons here: tapping a row takes the child to where the task is done: its room (which opens its task panel and lights the tasks up)
// or, for a task with no room, the Tasks tab ("Tasks from my parent" lit up). Waiting tasks stay in the list, marked as waiting. Nothing when
// there are none. The card around it (title, date, the child's own tasks, the count) is src/components/task-card.tsx.
export function AssignedHomeRows() {
  const { t } = useT();
  const router = useRouter();
  const views = useAssignedTasks();
  if (views.length === 0) return null;
  const nonce = () => String(Date.now());
  return (
    <View style={styles.homeRows}>
      {views.map((view) => {
        const roomName = view.room ? ROOMS[view.room].name : null;
        const from = roomName ? t('atFromParentRoom', { room: roomName }) : t('atFromParent');
        return (
          <HoverPressable
            key={view.id}
            onPress={() =>
              view.room
                ? router.push({ pathname: '/rooms/[room]', params: { room: view.room, focus: nonce() } })
                : router.push({ pathname: '/tasks', params: { focus: nonce() } })
            }
            accessibilityRole="button"
            accessibilityLabel={t('atHomeRowLabel', { task: view.text, state: t(STATE_TEXT[view.state]), from })}
            accessibilityHint={roomName ? t('atOpenRoom', { room: roomName }) : t('atOpenTasksTab')}
            testID={`assigned-home-${view.id}`}
            style={(state) => [styles.homeRow, state.pressed && styles.pressed]}>
            <View style={styles.rowText}>
              <ThemedText type="small" style={styles.taskText} numberOfLines={2}>
                {view.text}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {from}
              </ThemedText>
            </View>
            <StatePill state={view.state} />
          </HoverPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: Spacing.one, paddingVertical: Spacing.one, borderRadius: Spacing.three },
  // The brief "here they are" light after Home's guide brought the child to the section.
  highlight: { backgroundColor: '#FFF1B8', paddingHorizontal: Spacing.two, borderWidth: 2, borderColor: '#F2C94C' },
  card: { gap: Spacing.two, padding: Spacing.three, borderRadius: Spacing.four, backgroundColor: 'rgba(255, 255, 255, 0.75)', borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.9)' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', borderRadius: Spacing.three },
  rowOpen: { backgroundColor: 'rgba(230, 219, 248, 0.45)' },
  rowText: { flex: 1, minWidth: 140, gap: 4, borderRadius: Spacing.two, padding: Spacing.one },
  rowHover: { backgroundColor: 'rgba(242, 141, 174, 0.14)' },
  rowPressed: { backgroundColor: 'rgba(242, 141, 174, 0.26)' },
  taskText: { flexShrink: 1 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: Spacing.two, paddingVertical: 2, borderRadius: Spacing.three },
  doneButton: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.four, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7FD9B6' },
  doneText: { color: '#1F4D3A' },
  // Undo takes the same place and size as "I did it!", in the lavender of "waiting".
  undoButton: { backgroundColor: '#E6DBF8' },
  undoText: { color: '#5B3F8F' },
  homeRows: { gap: Spacing.one },
  homeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', minHeight: 44, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one, borderRadius: Spacing.three, backgroundColor: '#FFF4E3' },
  roomRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.two, minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.three, backgroundColor: '#FFF4E3' },
  roomName: { flexGrow: 1, flexShrink: 1 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  busy: { opacity: 0.6 },
});
