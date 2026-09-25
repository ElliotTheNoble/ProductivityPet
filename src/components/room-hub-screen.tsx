import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ROOMS as ROOM_PREVIEWS, type RoomPreview } from '@/components/rooms-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { normalizeTask, occursOnDate, todayISO, type Task } from '@/utils/tasks';

const TASKS_STORAGE_KEY = '@ProductivityPet:tasks';

// On desktop the grid's own max width is allowed to grow quite wide (see
// useDesktopTileSize below, which actually drives card size there); this
// cap only stops it from stretching absurdly far on an ultra-wide monitor.
// Tablet/phone (2-/1-column) keep using this same cap too, unchanged from
// before.
const ROOMS_MAX_WIDTH = 1300;

// Below DESKTOP_MIN_WIDTH the row can't comfortably fit 3 cards without them
// getting cramped, so it drops to 2; below TABLET_MIN_WIDTH it drops to 1.
const DESKTOP_MIN_WIDTH = 900;
const TABLET_MIN_WIDTH = 600;

function useColumnCount(): 1 | 2 | 3 {
  const { width } = useWindowDimensions();
  if (width >= DESKTOP_MIN_WIDTH) return 3;
  if (width >= TABLET_MIN_WIDTH) return 2;
  return 1;
}

// Percentage width per card — tablet (2-col) and phone (1-col) only; this is
// exactly the same percentage-width grid technique the Home "Rooms" widget
// already uses (see rooms-card.tsx), unchanged from the previous version of
// this screen. Desktop (3-col) instead gets an explicit pixel size from
// useDesktopTileSize, so its cards can grow to fill the screen without
// overflowing vertically.
const CARD_WIDTH_PERCENT: Record<1 | 2, `${number}%`> = {
  1: '100%',
  2: '48%',
};

// Rough, deliberately-generous estimates (in px) of everything vertical
// around the grid on desktop — the solid app header above this screen, the
// heading/subtitle block, and the scroll container's own top/bottom
// padding. Kept generous on purpose: it's better for the tile-size formula
// below to land slightly smaller than the true available space than to
// slightly overflow it and force the one thing this screen must never do —
// scroll on desktop.
const DESKTOP_CHROME_ABOVE_GRID = 230;
// Non-image chrome inside a single card: its own padding, border, the gap
// above the badge, and the badge row's own height.
const CARD_CHROME_HORIZONTAL = 20;
const CARD_CHROME_VERTICAL = 56;
const GRID_GAP = Spacing.three;
const MIN_DESKTOP_TILE = 180;
const MAX_DESKTOP_TILE = 320;

// Desktop-only: the square room-image size (px) that lets exactly 3 columns
// x 2 rows fill the available width AND height at once, so the grid grows
// to use the screen without ever needing to scroll. Returns null off-desktop
// (tablet/phone keep their existing percentage-based sizing, untouched).
function useDesktopTileSize(columns: 1 | 2 | 3): number | null {
  const { width, height } = useWindowDimensions();
  if (columns !== 3) return null;

  const contentWidth = Math.min(width, ROOMS_MAX_WIDTH) - Spacing.four * 2;
  const widthBasedTile = (contentWidth - GRID_GAP * 2 - CARD_CHROME_HORIZONTAL * 3) / 3;

  const availableGridHeight = height - DESKTOP_CHROME_ABOVE_GRID;
  const heightBasedTile = (availableGridHeight - GRID_GAP - CARD_CHROME_VERTICAL * 2) / 2;

  const tile = Math.min(widthBasedTile, heightBasedTile);
  return Math.max(MIN_DESKTOP_TILE, Math.min(MAX_DESKTOP_TILE, tile));
}

// Soft pastel badge color per room, reusing colors already in the palette
// (and already used elsewhere for these exact rooms — sky for Bathroom on
// the calendar, backgroundSelected as "lavender" for Bedroom, etc.) so each
// badge reads as that room's own color rather than one flat green for all
// six. Only the badge's color changes — the count/label logic is untouched.
const ROOM_BADGE_COLOR: Record<string, ThemeColor> = {
  'Living Room': 'backgroundElement', // blush pink
  'Study Room': 'peach',
  Gym: 'mint',
  Bedroom: 'backgroundSelected', // lavender
  Bathroom: 'sky',
  Kitchen: 'apricot',
};

// Faint, purely decorative glyphs scattered in the desktop grid's outer
// margins — never inside the centered grid column, so they can never sit on
// top of or compete with the room artwork itself.
type Percent = `${number}%`;
const BACKGROUND_DECORATIONS: { glyph: string; top: Percent; left?: Percent; right?: Percent; size: number }[] = [
  { glyph: '🐾', top: '8%', left: '3%', size: 26 },
  { glyph: '✨', top: '18%', right: '4%', size: 20 },
  { glyph: '🌸', top: '38%', left: '2%', size: 24 },
  { glyph: '💕', top: '55%', right: '3%', size: 22 },
  { glyph: '🐾', top: '72%', left: '4%', size: 22 },
  { glyph: '✨', top: '82%', right: '2%', size: 18 },
];

function mentionsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(text);
}

// How many of today's tasks are "relevant" to each room. Study Room and Gym
// reuse the existing task category as an exact match ('Study'/'Exercise').
// Kitchen/Bathroom/Bedroom have no dedicated category of their own — chores
// for all three fall under the shared 'Clean' category — so those instead
// count today's tasks whose own text mentions that room by name. Living Room
// falls back to 'Personal', the closest existing category to general/
// downtime tasks. Only kind: 'task' items count (matches Home's "Today's
// Tasks" filter) — appointments and birthdays aren't to-dos.
function countRoomTasks(roomName: string, todaysTasks: Task[]): number {
  switch (roomName) {
    case 'Study Room':
      return todaysTasks.filter((task) => task.category === 'Study').length;
    case 'Gym':
      return todaysTasks.filter((task) => task.category === 'Exercise').length;
    case 'Kitchen':
      return todaysTasks.filter((task) => mentionsWord(task.text, 'kitchen')).length;
    case 'Bathroom':
      return todaysTasks.filter((task) => mentionsWord(task.text, 'bathroom')).length;
    case 'Bedroom':
      return todaysTasks.filter((task) => mentionsWord(task.text, 'bedroom')).length;
    case 'Living Room':
      return todaysTasks.filter((task) => task.category === 'Personal').length;
    default:
      return 0;
  }
}

function taskBadgeLabel(count: number): string {
  if (count === 0) return 'No tasks today';
  return `${count} ${count === 1 ? 'task' : 'tasks'} today`;
}

export function RoomHubScreen() {
  const router = useRouter();
  const theme = useTheme();
  const columns = useColumnCount();
  const desktopTile = useDesktopTileSize(columns);
  const [todaysTasks, setTodaysTasks] = useState<Task[]>([]);
  // Desktop-only hover state (mobile/touch never fires onHoverIn) — which
  // single room card, if any, currently has the mouse over it.
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);

  // Read-only, same storage key/hydration pattern as useBirthdayMode — this
  // screen never writes, so it can't disturb the real saved task data.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(TASKS_STORAGE_KEY)
      .then((stored) => {
        if (cancelled || !stored) return;
        try {
          const today = todayISO();
          const parsed = JSON.parse(stored) as unknown[];
          const tasks = parsed.map((raw) => normalizeTask(raw, today));
          setTodaysTasks(tasks.filter((task) => task.kind === 'task' && occursOnDate(task, today)));
        } catch {
          // Malformed storage: badges just fall back to their 0 default.
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function openRoom(slug: RoomPreview['slug']) {
    // Same navigation as the Home "Rooms" widget — Living Room goes back to
    // Home (the existing living room) instead of a separate detail page.
    if (slug === null) {
      router.push('/');
    } else {
      router.push({ pathname: '/rooms/[room]', params: { room: slug } });
    }
  }

  const cardWidth = columns === 3 && desktopTile !== null
    ? desktopTile + CARD_CHROME_HORIZONTAL
    : CARD_WIDTH_PERCENT[columns as 1 | 2];

  function renderRoomCard(room: RoomPreview, width: number | `${number}%`) {
    const count = countRoomTasks(room.name, todaysTasks);
    const isHovered = hoveredRoom === room.name;
    return (
      <Pressable
        key={room.name}
        onPress={() => openRoom(room.slug)}
        onHoverIn={() => setHoveredRoom(room.name)}
        onHoverOut={() => setHoveredRoom(null)}
        accessibilityRole="button"
        accessibilityLabel={`Enter ${room.name}`}
        style={({ pressed }) => [styles.cardWrap, { width }, pressed && styles.pressed]}>
        {/* Room name/description live inside the artwork itself (each
            preview already has its own baked-in rounded nameplate pill) —
            this card only adds the interactive frame, hover state, and the
            task-status badge below. */}
        <ThemedView
          type="backgroundElementOverlay"
          style={[styles.card, isHovered && [styles.cardHovered, { borderColor: theme.accent }]]}>
          <View style={styles.imageWrap}>
            <Image source={room.source} style={styles.image} contentFit="contain" />
            {isHovered ? (
              <View style={styles.hoverOverlay} pointerEvents="none">
                <ThemedView type="accent" style={styles.enterPill}>
                  <ThemedText type="smallBold" style={styles.enterPillText}>
                    Enter Room →
                  </ThemedText>
                </ThemedView>
              </View>
            ) : null}
          </View>
          <ThemedView type={ROOM_BADGE_COLOR[room.name] ?? 'mint'} style={styles.badge}>
            <ThemedText type="small" style={styles.badgeText}>
              {taskBadgeLabel(count)}
            </ThemedText>
          </ThemedView>
        </ThemedView>
      </Pressable>
    );
  }

  return (
    <ThemedView style={styles.container}>
      {columns === 3 ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {BACKGROUND_DECORATIONS.map((deco, index) => (
            <ThemedText
              key={index}
              style={[
                styles.decoration,
                {
                  top: deco.top,
                  left: deco.left,
                  right: deco.right,
                  fontSize: deco.size,
                },
              ]}>
              {deco.glyph}
            </ThemedText>
          ))}
        </View>
      ) : null}
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <ThemedText style={styles.heading}>🏠 Explore Your Home</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
            Each room helps you focus on a different part of your life. Tap a room to enter!
          </ThemedText>

          {columns === 3 ? (
            // Desktop: two explicit rows of exactly 3, rather than a
            // flex-wrapping grid — a flex-wrap grid only *usually* breaks
            // into 3 per row; whenever the computed tile size (see
            // useDesktopTileSize) came out on the smaller side, the row had
            // room to fit a 4th card and wrapped as 4 + 2 instead of the
            // fixed 3 x 2 shape this always needs to be.
            <View style={styles.desktopRows}>
              <View style={styles.desktopRow}>
                {ROOM_PREVIEWS.slice(0, 3).map((room) => renderRoomCard(room, cardWidth))}
              </View>
              <View style={styles.desktopRow}>
                {ROOM_PREVIEWS.slice(3, 6).map((room) => renderRoomCard(room, cardWidth))}
              </View>
            </View>
          ) : (
            <View style={styles.grid}>
              {ROOM_PREVIEWS.map((room) => renderRoomCard(room, cardWidth))}
            </View>
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
    maxWidth: ROOMS_MAX_WIDTH,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.four,
    gap: Spacing.one,
  },
  heading: {
    textAlign: 'center',
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    marginBottom: Spacing.half,
  },
  subheading: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  // Desktop only: two fixed rows of exactly 3 cards each (see the columns
  // === 3 branch above) instead of a flex-wrapping grid.
  desktopRows: {
    gap: GRID_GAP,
  },
  desktopRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: GRID_GAP,
  },
  cardWrap: {
    // width is set per-card: a px size on desktop (useDesktopTileSize) or a
    // percentage on tablet/phone (CARD_WIDTH_PERCENT).
  },
  pressed: {
    opacity: 0.85,
  },
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.two,
    gap: Spacing.one,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  // Subtle game-like "lift" on hover — a small scale/translate plus a soft
  // shadow, kept gentle rather than dramatic per instructions. borderColor
  // itself is set inline (theme-aware) alongside this.
  cardHovered: {
    transform: [{ scale: 1.03 }, { translateY: -3 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  imageWrap: {
    width: '100%',
    // Matches the source art's own near-square shape (each room's preview
    // is ~454x454-470px) so contentFit="contain" needs only a hairline of
    // letterboxing — the artwork, including its own baked-in nameplate,
    // stays fully visible and uncropped, and reads as the card's dominant
    // element now that the separate text rows below it are gone.
    aspectRatio: 1,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  hoverOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  enterPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  enterPillText: {
    color: '#FFFFFF',
  },
  badge: {
    alignSelf: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.five,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  // Faint background glyphs — desktop only, positioned in the outer margins
  // via BACKGROUND_DECORATIONS' percentage coordinates, never inside the
  // centered grid column, so they stay well clear of the room artwork.
  decoration: {
    position: 'absolute',
    opacity: 0.16,
  },
});
