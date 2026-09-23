import { Image } from 'expo-image';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppHeader } from '@/components/app-header';
import { useBirthdayMode } from '@/hooks/use-birthday-mode';
import { BIRTHDAY_BACKGROUNDS, resolveRoomBackground, type SpecialEvent } from '@/utils/room-backgrounds';

SplashScreen.preventAutoHideAsync();

const LIVING_ROOM_NORMAL = require('@/assets/images/rooms/living-room.png');
const TASKS_NORMAL = require('@/assets/images/rooms/backgrounds/Task_Background.png');

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const isHome = pathname === '/';
  const isTasks = pathname === '/tasks';
  // Re-checks whenever the route changes (RootLayout itself persists across
  // navigation, unlike the screens it wraps), so adding/removing a birthday
  // and then (re)visiting a screen reflects it without a full app restart.
  const hasBirthdayToday = useBirthdayMode(pathname);

  // Ordered priority list of currently-active special events — to add
  // another one later (Christmas, Halloween, ...), compute its own "is it
  // active today" boolean and push one more entry here; resolveRoomBackground
  // itself doesn't change. See src/utils/room-backgrounds.ts.
  const activeEvents: SpecialEvent[] = [
    { id: 'birthday', isActive: hasBirthdayToday, backgrounds: BIRTHDAY_BACKGROUNDS },
  ];

  // Every full-screen background — normal or special-event — is full-bleed
  // and extends behind the header (which is already transparent on these
  // routes; see app-header.tsx's isImmersiveRoute). Home uses "cover"
  // (crop-to-fill, no stretching); Tasks uses "fill" (see below).
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/* Rendered above the header/routed screen in z-order (behind them,
          since it comes first) so each immersive page's background extends
          under the header too — the header (transparent on these routes)
          and the page's own transparent container both let it show through. */}
      {isHome ? (
        <Image
          source={resolveRoomBackground('living-room', LIVING_ROOM_NORMAL, activeEvents)}
          style={styles.homeBackground}
          contentFit="cover"
        />
      ) : null}
      {isTasks ? (
        <Image
          source={resolveRoomBackground('tasks', TASKS_NORMAL, activeEvents)}
          style={styles.homeBackground}
          // "fill" instead of "cover": on this screen "cover" was still
          // leaving hairline top/bottom gaps (a sub-pixel viewport-vs-image
          // aspect-ratio mismatch), so per explicit approval this stretches
          // the image to the container's exact size instead of cropping to
          // it — a negligible stretch traded for zero visible edge gaps.
          contentFit="fill"
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
});
