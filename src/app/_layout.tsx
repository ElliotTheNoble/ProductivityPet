import { Image } from 'expo-image';
import { DarkTheme, DefaultTheme, Slot, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet, useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppHeader } from '@/components/app-header';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const isHome = pathname === '/';

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/* Rendered above the header/routed screen in z-order (behind them,
          since it comes first) so Home's living-room background extends
          under the header too — the header (transparent on Home) and
          index.tsx (transparent container) both let it show through. */}
      {isHome ? (
        <Image
          source={require('@/assets/images/rooms/living-room.png')}
          style={styles.homeBackground}
          contentFit="cover"
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
