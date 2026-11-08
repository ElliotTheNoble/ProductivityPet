import { Image } from 'expo-image';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { AppState, Platform, StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppHeader } from '@/components/app-header';
import { CriticalAlertEffects } from '@/components/critical-alert-effects';
import { PetFamilyBar } from '@/components/pet-family-bar';
import { ResurrectionOverlay } from '@/components/resurrection-overlay';
import { ROOMS as ROOM_PREVIEWS } from '@/components/rooms-card';
import { useBirthdayMode } from '@/hooks/use-birthday-mode';
import { useActiveProfileId } from '@/hooks/use-active-profile';
import { useSelectedPetId } from '@/hooks/use-pet-family';
import { loadPetProfileWithNeedsUpdate } from '@/utils/pet-needs';
import { getTokenHistory } from '@/utils/token-history';
import { advanceAllPets } from '@/utils/pet-family';
import { getRenderedStage } from '@/utils/pet-growth';
import { startPetAlerts } from '@/utils/pet-alerts';
import { startPawadiseMail } from '@/utils/pawadise-mail';
import { ensureOnboardingLoaded, useOnboarding } from '@/utils/onboarding';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { consumePendingRoute } from '@/utils/family-session';
import { startParentGateAutoLock } from '@/utils/parent-gate';
import { captureProfileOwner, ensureProfilesReady, isProfileOwner } from '@/utils/profiles';
import { checkForPoopAccumulation } from '@/utils/pet-poop';
import { BIRTHDAY_BACKGROUNDS, resolveRoomBackground, type SpecialEvent } from '@/utils/room-backgrounds';
import { ROOMS, isRoomSlug } from '@/utils/rooms';
import { getCachedTasks } from '@/utils/task-storage';
import { getCompletedTaskCount } from '@/utils/tasks';

SplashScreen.preventAutoHideAsync();

// Family mode on the WEB only (development, never in a release build): only one browser tab may use the family storage. The write fence
// goes in RIGHT NOW, while this file loads, before anything can write: it refuses every ProductivityPet write until this document really
// holds the family Web Lock, and WebTabGate (below) renders nothing of the app, and starts none of the startup work, until then. Nothing
// that reads or writes private family data may run at import time in this mode, so the onboarding load below is part of that startup.
const FAMILY_WEB = FAMILY_MODE_ENABLED && Platform.OS === 'web';
if (FAMILY_WEB) (require('@/utils/family-tab') as typeof import('@/utils/family-tab')).installFamilyTabProtection();

// Decide "new install or existing player?" RIGHT NOW, while this file loads, before anything below creates the
// first pet. Existing players are never forced into onboarding (see @/utils/onboarding.ts).
// (In family mode on the web this happens once the tab owns the family storage instead, see RootLayoutContent.)
if (!FAMILY_WEB) void ensureOnboardingLoaded().catch(() => {});

const LIVING_ROOM_NORMAL = require('@/assets/images/rooms/living-room.png');
const TASKS_NORMAL = require('@/assets/images/rooms/backgrounds/Task_Background.png');
const STATS_BACKGROUND = require('@/assets/images/stats/stats_background.png');
const MINI_GAMES_BACKGROUND = require('@/assets/images/mini-games/mini_games_background.png');
const SHOP_BACKGROUND = require('@/assets/images/shop/shop_background.png');

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

// The whole app shell is keyed by the active profile: when the profile changes (Stage 2 will add the picker), every
// screen and hook remounts, so nothing from the previous profile can stay on screen. With only the main profile
// the key never changes and nothing remounts.
export default function RootLayout() {
  if (FAMILY_WEB) {
    const { WebTabGate } = require('@/components/web-tab-gate') as typeof import('@/components/web-tab-gate');
    return (
      <WebTabGate>
        <RootLayoutContent gated />
      </WebTabGate>
    );
  }
  return <RootLayoutContent />;
}

// Everything that starts the app up lives here, so that in family mode on the web none of it runs until the tab owns the storage.
function RootLayoutContent({ gated = false }: { gated?: boolean }) {
  const profileId = useActiveProfileId();
  // Gated (family mode on the web): the onboarding decision is made now, in the first render after ownership was confirmed, which is
  // still before any screen or store below can create a first pet.
  useState(() => {
    if (gated) void ensureOnboardingLoaded().catch(() => {});
    // Family mode on a phone: clean up private notifications left by an earlier run before anything schedules, and keep the anonymous
    // family-care reminders current (see @/utils/family-notifications.ts). Nothing here on the web or with family mode off.
    if (FAMILY_MODE_ENABLED && Platform.OS !== 'web') {
      (require('@/utils/family-notifications') as typeof import('@/utils/family-notifications')).startFamilyNotifications();
    }
    return null;
  });
  useEffect(() => {
    void ensureProfilesReady();
  }, []);
  // Family mode is OFF for everyone: then nothing below is even loaded and the parent area stays open exactly as before.
  // When it is on (never for real users yet) the parent PIN checker is registered with the Parent Gate.
  useEffect(() => {
    if (FAMILY_MODE_ENABLED) (require('@/utils/parent-pin') as typeof import('@/utils/parent-pin')).startParentAuth();
  }, []);
  // Gives every household child a storage profile with the same id (adds registry records only; it changes no child data and
  // deletes nothing; what it cannot resolve is left as it is). There is no picker yet, so nothing visible comes of it.
  useEffect(() => {
    if (FAMILY_MODE_ENABLED) void (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles().catch(() => {});
  }, []);
  // The parent area locks itself when the app leaves the foreground or the profile changes (see @/utils/parent-gate.ts).
  useEffect(() => startParentGateAutoLock(), []);
  if (!FAMILY_MODE_ENABLED) return <AppShell key={profileId} />;
  // Family mode (development only, never in a release build): the family picker comes first. Until someone has chosen a profile
  // the app shell is not rendered, so no game store loads and nothing is scheduled (see @/components/family-gate.tsx).
  const { FamilyGate } = require('@/components/family-gate') as typeof import('@/components/family-gate');
  return (
    <FamilyGate>
      <AppShell key={profileId} />
    </FamilyGate>
  );
}

function AppShell() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const router = useRouter();
  const onboarding = useOnboarding();
  const isWelcome = pathname === '/welcome';
  // The picker's parent-only "Add a child" path: after the PIN, Main opens and this goes on to the (still gated) parent dashboard.
  useEffect(() => {
    const route = consumePendingRoute();
    if (route) router.replace(route);
  }, [router]);
  // A brand-new install goes to the welcome flow until it is finished or skipped; everyone else is untouched.
  useEffect(() => {
    if (onboarding?.status === 'pending' && !isWelcome) router.replace('/welcome');
  }, [onboarding?.status, isWelcome, router]);
  const isHome = pathname === '/';
  const isTasks = pathname === '/tasks';
  // Includes the per-category Accomplishments pages (/stats/<category>) so they
  // share Stats' background.
  const isStats = pathname === '/stats' || pathname.startsWith('/stats/');
  // The pet family bar (switch pets, adopt, health warnings, resurrection) is
  // shown on the pet pages: Home, Rooms, Shop and Stats.
  const showFamilyBar =
    pathname === '/' || pathname === '/shop' || pathname === '/rooms' || pathname.startsWith('/rooms/') || isStats;
  const isMiniGames = pathname === '/mini-games';
  const isShop = pathname === '/shop';
  // The 5 individual Room detail pages (/rooms/study-room, /rooms/gym,
  // ...) — a dynamic route, so this parses the slug straight out of the
  // pathname rather than a fixed string match. The Rooms hub itself
  // (/rooms, no slug) is NOT included — it keeps its own existing
  // (non-full-bleed) layout, only the individual room detail pages move to
  // this same full-bleed treatment.
  const roomDetailSlug = pathname.startsWith('/rooms/') ? pathname.slice('/rooms/'.length) : null;
  const { width: windowWidth } = useWindowDimensions();
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
  // Catches the whole pet family up to now (needs, sleep, sickness, death —
  // see @/utils/pet-family.ts), then runs the poop check for the SELECTED
  // pet. Re-runs when a different pet is selected, because only the selected
  // pet is shown. The family itself also advances on a timer below, so none
  // of this depends on Home being open.
  const selectedPetId = useSelectedPetId();
  useEffect(() => {
    // The stage worked out below belongs to the profile session this effect started in; if that session is over before the
    // poop check runs, the check is skipped (it would otherwise apply one profile's stage to another profile's pet).
    const owner = captureProfileOwner();
    loadPetProfileWithNeedsUpdate()
      .then(async (profile) => {
        if (profile.lifeState === 'deceased') return;
        const tasks = await getCachedTasks();
        if (!isProfileOwner(owner)) return;
        const growthCount =
          profile.growthCredit !== undefined ? Math.floor(profile.growthCredit) : getCompletedTaskCount(tasks);
        return checkForPoopAccumulation(getRenderedStage(growthCount, profile.paidStageIndex));
      })
      .catch(() => {});
  }, [selectedPetId]);

  // Time passes for every living pet even when no screen is looking at them:
  // once a minute while the app is open, and again whenever it comes back to
  // the foreground.
  useEffect(() => {
    // These timers belong to the profile session they were started in. Once it is over (the person left; the picker is coming up
    // or showing; someone else is in) they do nothing: a timer that fires in the moment between the release and the screens
    // unmounting, or one that somehow outlives its screen, must not touch another profile's pets.
    const owner = captureProfileOwner();
    const tick = () => {
      if (!isProfileOwner(owner)) return;
      try {
        advanceAllPets(new Date(), true);
      } catch {
        // a tick that cannot run is simply skipped; the next one catches up
      }
    };
    const interval = setInterval(tick, 60000);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') tick();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  // Health alerts: phone notifications scheduled ahead from the sickness
  // clocks, plus the live critical signal (see @/utils/pet-alerts.ts).
  useEffect(() => startPetAlerts(), []);

  // Surprise postcards from retired pets (see @/utils/pawadise-mail.ts): checks what is due at launch, on
  // returning to the app and once a minute; the schedule itself is saved, so it doesn't need the app open.
  useEffect(() => startPawadiseMail(), []);

  // Starts the Paw Token earnings history (@/utils/token-history.ts) at app
  // launch, so its recorded start date is when tracking really began — not
  // whenever someone first opens a page that reads it. Read/create only.
  useEffect(() => {
    getTokenHistory().catch(() => {});
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
      {/* Shop's own background (shop_background.png) — same single-
          static-image, full-bleed "cover" treatment as Stats'/Mini-Games'
          above (no stretching/distortion, no gaps, stays centered and
          crops instead of letterboxing at any window size). */}
      {isShop ? (
        <Image source={SHOP_BACKGROUND} style={styles.homeBackground} contentFit="cover" cachePolicy="memory-disk" />
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
          // Phone-width Kitchen only: the centred crop showed the sink and almost no floor, so
          // the picture is framed toward the right where the flowered rug and floor are.
          contentPosition={roomDetailSlug === 'kitchen' && windowWidth < 700 ? { left: '62%', top: '50%' } : undefined}
          cachePolicy="memory-disk"
        />
      ) : null}
      {isWelcome ? null : <AppHeader />}
      {showFamilyBar ? <PetFamilyBar /> : null}
      <Slot />
      <ResurrectionOverlay />
      <CriticalAlertEffects />
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
