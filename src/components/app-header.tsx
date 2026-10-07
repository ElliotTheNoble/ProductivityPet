import { Image } from 'expo-image';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getPetProfile, subscribeToPetProfile } from '@/utils/pet-profile';

type NavItem = {
  href: Href;
  label: string;
};

// assets/images/pawtoken.png is a 1536x1024 canvas with a lot of
// transparent padding around the actual coin art (measured via an
// alpha-channel bounding-box scan: the real content is roughly a
// 946x928 square centered around x=763, y=502) — rendering the whole
// canvas via contentFit="contain" would make the coin look much smaller
// than it needs to inside the small pill. Same fixed sprite-crop
// technique already used for PetStageIcon/TaskIcon: render the full
// image at a scale where a square crop around that content equals the
// desired icon size, inside an overflow-hidden (and circularly masked,
// since this is a round coin) frame of exactly that size.
const PAW_TOKEN_SOURCE_WIDTH = 1536;
const PAW_TOKEN_SOURCE_HEIGHT = 1024;
const PAW_TOKEN_CROP_SIZE = 960;
const PAW_TOKEN_CROP_LEFT = 284;
const PAW_TOKEN_CROP_TOP = 23;
const PAW_TOKEN_COIN_SIZE = 20;

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/rooms', label: 'Rooms' },
  { href: '/shop', label: 'Shop' },
  { href: '/stats', label: 'Stats' },
];

export function AppHeader() {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  // Home, Tasks, Stats, and Mini-Games each render their own full-screen
  // background behind this header (see src/app/_layout.tsx) — transparent
  // here lets it show through instead of the usual solid header fill.
  // Every other route is unaffected. The logo/tagline keep their own
  // translucent backdrop (brandBackdrop below) and the nav pills already
  // have their own opaque fill regardless of this flag, so both stay
  // readable over any background.
  const isImmersiveRoute =
    pathname === '/' || pathname === '/tasks' || pathname === '/stats' || pathname === '/mini-games';

  // The real pawTokens value from the persistent Pet Profile (see
  // @/utils/pet-profile.ts) — null until the first load resolves, so the
  // pill simply doesn't render rather than showing a fake starting number.
  // AppHeader itself is part of RootLayout (see src/app/_layout.tsx), not
  // any one route, so it mounts once per app session and this stays in
  // sync no matter which page is active.
  const [pawTokens, setPawTokens] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPetProfile().then((profile) => {
      if (!cancelled) setPawTokens(profile.pawTokens);
    });
    // Notified synchronously every time ANY action saves the profile
    // (Feed/Bath/Play/Rest, or Paw Token earning from completing a task or
    // appointment on either Home or Tasks) — so this updates immediately
    // without polling or needing a page refresh.
    const unsubscribe = subscribeToPetProfile((profile) => {
      if (!cancelled) setPawTokens(profile.pawTokens);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <ThemedView style={[styles.container, isImmersiveRoute && styles.transparentContainer]}>
      <View style={styles.inner}>
        <View style={[styles.brand, isImmersiveRoute && styles.brandBackdrop]}>
          <View style={styles.brandTitleRow}>
            <ThemedText style={styles.pawIcon}>🐾</ThemedText>
            <ThemedText style={styles.title}>Productivity Pet</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Small steps. A happier you.
          </ThemedText>
        </View>

        <View style={styles.nav}>
          {pawTokens !== null ? (
            <View style={[styles.pawTokenPill, { backgroundColor: theme.apricot }]}>
              <View style={styles.pawTokenCoinFrame}>
                <Image
                  source={require('@/assets/images/pawtoken.png')}
                  contentFit="fill"
                  style={{
                    position: 'absolute',
                    width: PAW_TOKEN_SOURCE_WIDTH * (PAW_TOKEN_COIN_SIZE / PAW_TOKEN_CROP_SIZE),
                    height: PAW_TOKEN_SOURCE_HEIGHT * (PAW_TOKEN_COIN_SIZE / PAW_TOKEN_CROP_SIZE),
                    left: -PAW_TOKEN_CROP_LEFT * (PAW_TOKEN_COIN_SIZE / PAW_TOKEN_CROP_SIZE),
                    top: -PAW_TOKEN_CROP_TOP * (PAW_TOKEN_COIN_SIZE / PAW_TOKEN_CROP_SIZE),
                  }}
                />
              </View>
              <ThemedText type="smallBold">{pawTokens}</ThemedText>
            </View>
          ) : null}

          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Pressable
                key={item.label}
                onPress={() => router.replace(item.href)}
                style={({ pressed }) => pressed && styles.pressed}>
                <View
                  style={[
                    styles.navPill,
                    { backgroundColor: isActive ? theme.purple : theme.backgroundElement },
                  ]}>
                  <ThemedText
                    type="smallBold"
                    style={isActive ? styles.navLabelActive : undefined}>
                    {item.label}
                  </ThemedText>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    // No left padding here — brand's own paddingLeft (below) provides the
    // same visual inset on every route, but keeps the container's left edge
    // itself at true x0 so the immersive backdrop can sit flush against it.
    paddingRight: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  transparentContainer: {
    backgroundColor: 'transparent',
  },
  inner: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  brand: {
    gap: Spacing.half,
    paddingLeft: Spacing.three,
  },
  // Home/Tasks only (see isImmersiveRoute above): a soft translucent cream
  // shape behind the logo/tagline — flush against the true left screen
  // edge (no left padding/radius, so it reads as continuing off-screen)
  // with a rounded, cloud-like end on the right. Not centered, not a
  // floating rounded rectangle.
  brandBackdrop: {
    backgroundColor: 'rgba(252, 243, 233, 0.78)',
    borderTopRightRadius: Spacing.four,
    borderBottomRightRadius: Spacing.four,
    paddingRight: Spacing.four,
    paddingVertical: Spacing.one,
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
  },
  pawIcon: {
    fontSize: 22,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  nav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  navPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  navLabelActive: {
    color: '#FFFFFF',
  },
  pressed: {
    opacity: 0.7,
  },
  pawTokenPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.half,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  pawTokenCoinFrame: {
    width: PAW_TOKEN_COIN_SIZE,
    height: PAW_TOKEN_COIN_SIZE,
    borderRadius: PAW_TOKEN_COIN_SIZE / 2,
    overflow: 'hidden',
  },
});
