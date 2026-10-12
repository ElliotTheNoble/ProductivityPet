import { Image } from 'expo-image';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { StyleSheet, View, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppHeader } from '@/components/app-header';
import { ROOMS as ROOM_PREVIEWS } from '@/components/rooms-card';
import { useBirthdayMode } from '@/hooks/use-birthday-mode';
import { loadPetProfileWithNeedsUpdate } from '@/utils/pet-needs';
import { checkForPoopAccumulation } from '@/utils/pet-poop';
import { getPetStage } from '@/utils/pet-stage';
import { BIRTHDAY_BACKGROUNDS, resolveRoomBackground, type SpecialEvent } from '@/utils/room-backgrounds';
import { ROOMS, isRoomSlug } from '@/utils/rooms';
import { getCachedTasks } from '@/utils/task-storage';
import { getCompletedTaskCount } from '@/utils/tasks';

SplashScreen.preventAutoHideAsync();

const LIVING_ROOM_NORMAL = require('@/assets/images/rooms/living-room.png');
const TASKS_NORMAL = require('@/assets/images/rooms/backgrounds/Task_Background.png');
const STATS_BACKGROUND = require('@/assets/images/stats/stats_background.png');
const MINI_GAMES_BACKGROUND = require('@/assets/images/mini-games/mini_games_background.png');

// Mounted once, for the lifetime of the app (RootLayout itself never
// remounts on navigation — only the routed screen inside <Slot/> swaps), so
// this never re-triggers per route change. Renders the Home background, the
// Tasks background, the 6 Rooms-hub preview thumbnails, AND all 7 Birthday
// Mode backgrounds (Home, Tasks, and each of the 5 individual rooms — see
// BIRTHDAY_BACKGROUNDS in @/utils/room-backgrounds) as invisible 1x1 images,
// purely to make the browser start fetching/decoding them as soon as the
// app loads — instead of only starting that work the moment you actually
// navigate to the screen that needs it. The birthday set is prefetched
// unconditionally (regardless of whether Birthday Mode is active today) so
// there's no gap the first time it turns on. Still doesn't prefetch the 5
// individual rooms' normal (non-birthday) detail backgrounds — out of scope
// for this pass.
function ImagePrefetchLayer() {
  return (
    <View style={styles.prefetchLayer} pointerEvents="none">
      <Image source={LIVING_ROOM_NORMAL} style={styles.prefetchImage} cachePolicy="memory-disk" />
      <Image source={TASKS_NORMAL} style={styles.prefetchImage} cachePolicy="memory-disk" />
      {ROOM_PREVIEWS.map((room) => (
        <Image key={room.name} source={room.source} style={styles.prefetchImage} cachePolicy="memory-disk" />
      ))}
      {Object.entries(BIRTHDAY_BACKGROUNDS).map(([key, source]) =>
        source ? (
          <Image key={`birthday-${key}`} source={source} style={styles.prefetchImage} cachePolicy="memory-disk" />
        ) : null
      )}
    </View>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const isHome = pathname === '/';
  const isTasks = pathname === '/tasks';
  const isStats = pathname === '/stats';
  const isMiniGames = pathname === '/mini-games';
  // The 5 individual Room detail pages (/rooms/study-room, /rooms/gym,
  // ...) — a dynamic route, so this parses the slug straight out of the
  // pathname rather than a fixed string match. The Rooms hub itself
  // (/rooms, no slug) is NOT included — it keeps its own existing
  // (non-full-bleed) layout, only the individual room detail pages move to
  // this same full-bleed treatment.
  const roomDetailSlug = pathname.startsWith('/rooms/') ? pathname.slice('/rooms/'.length) : null;
  const isRoomDetail = roomDetailSlug !== null && isRoomSlug(roomDetailSlug);
  // Re-checks whenever the route changes (RootLayout itself persists across
  // navigation, unlike the screens it wraps), so adding/removing a birthday
  // and then (re)visiting a screen reflects it without a full app restart.
  const hasBirthdayToday = useBirthdayMode(pathname);

  // Simple explanation: runs once when the app first opens. It brings the
  // pet's needs (Hunger, Cleanliness, etc.) up to date based on how much
  // real time has passed, and checks whether new poop should appear.
  //
  // Starts the virtual pet-care profile the moment the app launches —
  // RootLayout mounts exactly once for the app's lifetime, so this fires
  // once per app session, not per navigation. loadPetProfileWithNeedsUpdate
  // (see src/utils/pet-needs.ts) loads the existing profile (creating a
  // default one on the very first-ever launch, same as before), brings
  // every need up to date with real elapsed time since lastUpdatedAt
  // (including the gradual Dirty Kitty penalty), and saves the result only
  // if anything actually changed — adoptionDate is never touched.
  //
  // Once that settles, checkForPoopAccumulation (@/utils/pet-poop.ts) does
  // the same "compare real elapsed/scheduled time, not a timer" check for
  // the poop-pile accumulation system: it needs the pet's current real
  // stage (to skip accumulating on an Egg, or while asleep), which lives
  // in the task list rather than the Pet Profile, so this reads the
  // already-cached task list (no extra storage round-trip beyond what
  // Home/Tasks/Rooms already warm) purely to compute that one
  // completedTaskCount -> stage value. Running this here — once per app
  // session, same as the needs update above — rather than from Home's own
  // mount effect is what keeps a pile from re-accumulating every time the
  // user navigates back to Home or between rooms; it only ever re-checks
  // on a fresh app launch, and correctly catches up on however many piles
  // should have accumulated (up to the max) if the app was closed for a
  // while — see applyPoopAccumulation's own comment for exactly how.
  useEffect(() => {
    loadPetProfileWithNeedsUpdate()
      .then(() => getCachedTasks())
      .then((tasks) => checkForPoopAccumulation(getPetStage(getCompletedTaskCount(tasks))))
      .catch(() => {});
  }, []);

  // Ordered priority list of currently-active special events — to add
  // another one later (Christmas, Halloween, ...), compute its own "is it
  // active today" boolean and push one more entry here; resolveRoomBackground
  // itself doesn't change. See src/utils/room-backgrounds.ts.
  const activeEvents: SpecialEvent[] = [
    { id: 'birthday', isActive: hasBirthdayToday, backgrounds: BIRTHDAY_BACKGROUNDS },
  ];

  // Every full-screen background — normal or special-event — is full-bleed
  // and extends behind the header (which is already transparent on these
  // routes; see app-header.tsx's isImmersiveRoute). Home, Tasks, and each
  // individual Room detail page always use plain "cover" (crop-to-fill,
  // aspect ratio preserved, no stretching) with no exceptions, for either
  // their normal or birthday background — this guarantees zero gaps at
  // every window size, which a conditional "contain" (tried and reverted)
  // could not. Stats' own background (stats_background.png) isn't part of
  // the birthday/room-background system — it's a single static image — but
  // uses the same full-bleed "cover" treatment for the same reason.
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <ImagePrefetchLayer />
      {/* Rendered above the header/routed screen in z-order (behind them,
          since it comes first) so each immersive page's background extends
          under the header too — the header (transparent on these routes)
          and the page's own transparent container both let it show through. */}
      {isHome ? (
        <Image
          source={resolveRoomBackground('living-room', LIVING_ROOM_NORMAL, activeEvents)}
          style={styles.homeBackground}
          contentFit="cover"
          // Keeps the decoded bitmap in memory (not just disk) across
          // mount/unmount — this Image element gets unmounted every time you
          // navigate away from Home and re-mounted on return, so without
          // this it was re-decoding the same background from scratch on
          // every visit. See src/utils/task-storage.ts's comment for the
          // other half of this navigation-speed pass.
          cachePolicy="memory-disk"
        />
      ) : null}
      {isTasks ? (
        <Image
          source={resolveRoomBackground('tasks', TASKS_NORMAL, activeEvents)}
          style={styles.homeBackground}
          // "cover" instead of "fill": matches Home's behavior exactly —
          // preserves the image's aspect ratio at every window size and
          // crops instead of stretching/distorting when the window is
          // resized, for both the normal and birthday background alike.
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : null}
      {isStats ? (
        <Image source={STATS_BACKGROUND} style={styles.homeBackground} contentFit="cover" cachePolicy="memory-disk" />
      ) : null}
      {/* Mini-Games' own background (mini_games_background.png), same
          single-static-image treatment as Stats' — shared by every screen
          under the /mini-games route (hub, Kitty Catch, Memory Match, and
          any future mini-game) via this one route-level image, instead of
          each needing its own copy. */}
      {isMiniGames ? (
        <Image
          source={MINI_GAMES_BACKGROUND}
          style={styles.homeBackground}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : null}
      {/* Individual Room detail pages — same full-bleed "cover" treatment,
          resolved per-room (with the same birthday-override priority list)
          exactly the way Home resolves 'living-room' above. The Rooms hub
          list page keeps its own separate layout/background, untouched. */}
      {isRoomDetail && roomDetailSlug && isRoomSlug(roomDetailSlug) ? (
        <Image
          source={resolveRoomBackground(roomDetailSlug, ROOMS[roomDetailSlug].image, activeEvents)}
          style={styles.homeBackground}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : null}
      <AppHeader />
      <Slot />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  homeBackground: {
    ...StyleSheet.absoluteFill,
  },
  // Positioned off-screen and clipped to 1x1 — never visible, never affects
  // layout, and ignores touches (pointerEvents="none" above).
  prefetchLayer: {
    position: 'absolute',
    top: -9999,
    left: -9999,
    width: 1,
    height: 1,
    overflow: 'hidden',
  },
  prefetchImage: {
    width: 1,
    height: 1,
  },
});
