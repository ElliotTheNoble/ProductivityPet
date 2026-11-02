import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { hoverLift } from '@/constants/hover';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT, type StringKey } from '@/i18n';
import { getPetProfile, subscribeToPetProfile } from '@/utils/pet-profile';
import { isRoomSlug } from '@/utils/rooms';

type NavItem = {
  href: Href;
  labelKey: StringKey;
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
  { href: '/', labelKey: 'navHome' },
  { href: '/tasks', labelKey: 'navTasks' },
  { href: '/rooms', labelKey: 'navRooms' },
  { href: '/shop', labelKey: 'navShop' },
  { href: '/stats', labelKey: 'navStats' },
];

export function AppHeader() {
  const { t } = useT();
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  // Home, Tasks, Stats, Mini-Games, Shop, and each individual Room detail
  // page each render their own full-screen background behind this header
  // (see src/app/_layout.tsx) — transparent here lets it show through
  // instead of the usual solid header fill. Every other route (including
  // the Rooms hub list itself, /rooms with no slug) is unaffected. The
  // logo/tagline keep their own translucent backdrop (brandBackdrop below)
  // and the nav pills already have their own opaque fill regardless of
  // this flag, so both stay readable over any background.
  const roomDetailSlug = pathname.startsWith('/rooms/') ? pathname.slice('/rooms/'.length) : null;
  const isPhone = useWindowDimensions().width < 700;
  const isImmersiveRoute =
    pathname === '/' ||
    pathname === '/tasks' ||
    pathname === '/stats' ||
    pathname.startsWith('/stats/') ||
    pathname === '/mini-games' ||
    pathname === '/shop' ||
    (roomDetailSlug !== null && isRoomSlug(roomDetailSlug));

  // The real pawTokens value from the persistent Pet Profile (see
  // @/utils/pet-profile.ts) — null until the first load resolves, so the
  // pill simply doesn't render rather than showing a fake starting number.
  // AppHeader itself is part of RootLayout (see src/app/_layout.tsx), not
  // any one route, so it mounts once per app session and this stays in
  // sync no matter which page is active.
  const [pawTokens, setPawTokens] = useState<number | null>(null);
  // Desktop-only hover state for the bell tab's tooltip.
  const [bellHovered, setBellHovered] = useState(false);

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
    <ThemedView
      style={[
        styles.container,
        isImmersiveRoute && styles.transparentContainer,
        // Phone width: the pet chips sit right under the nav pills (small gap, not a big empty band).
        isPhone && styles.containerPhone,
      ]}>
      <View style={styles.inner}>
        <View style={[styles.brand, isImmersiveRoute && styles.brandBackdrop]}>
          <View style={styles.brandTitleRow}>
            <ThemedText style={styles.pawIcon}>🐾</ThemedText>
            <ThemedText style={styles.title}>Productivity Pet</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            {t('brandTagline')}
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
            // The per-category Accomplishments pages live under /stats/, so they keep
            // the Stats pill highlighted.
            const isActive =
              pathname === item.href || (item.href === '/stats' && pathname.startsWith('/stats/'));
            return (
              <Pressable
                key={String(item.href)}
                onPress={() => router.replace(item.href)}
                style={(state) => [state.pressed && styles.pressed, hoverLift(state, !isActive)]}>
                <View
                  style={[
                    styles.navPill,
                    { backgroundColor: isActive ? theme.purple : theme.backgroundElement },
                  ]}>
                  <ThemedText
                    type="smallBold"
                    style={isActive ? styles.navLabelActive : undefined}>
                    {t(item.labelKey)}
                  </ThemedText>
                </View>
              </Pressable>
            );
          })}

          {/* Pet Care & Alerts — an icon-only tab, always last (after Stats). Same
              pastel pill, spacing and active state as the other tabs. */}
          <View style={styles.bellWrap}>
            <Pressable
              onPress={() => router.replace('/pet-alerts')}
              onHoverIn={() => setBellHovered(true)}
              onHoverOut={() => setBellHovered(false)}
              accessibilityRole="button"
              accessibilityLabel={t('navAlerts')}
              accessibilityState={{ selected: pathname === '/pet-alerts' }}
              style={(state) => [state.pressed && styles.pressed, hoverLift(state, pathname !== '/pet-alerts')]}>
              <View
                style={[
                  styles.navPill,
                  styles.bellPill,
                  { backgroundColor: pathname === '/pet-alerts' ? theme.purple : theme.backgroundElement },
                ]}>
                <Ionicons
                  name="notifications-outline"
                  size={19}
                  color={pathname === '/pet-alerts' ? '#FFFFFF' : theme.text}
                />
              </View>
            </Pressable>
            {bellHovered ? (
              <View style={styles.tooltip} pointerEvents="none">
                <ThemedText type="small" style={styles.tooltipText}>
                  {t('navAlerts')}
                </ThemedText>
              </View>
            ) : null}
          </View>
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
  containerPhone: {
    paddingBottom: Spacing.one,
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
  // maxWidth/flexShrink: on a phone the pills must wrap onto a second row instead
  // of making the whole page scroll sideways (react-native-web items default to
  // flexShrink 0, so the nav kept its single-row width).
  nav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    maxWidth: '100%',
    flexShrink: 1,
  },
  navPill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  // The icon-only bell tab: same pill, but sized so the icon sits centred with a
  // comfortable touch area (at least 44 px wide and 40 px tall).
  bellPill: {
    minWidth: 44,
    minHeight: 40,
    paddingHorizontal: Spacing.two + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellWrap: {
    position: 'relative',
  },
  tooltip: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
    backgroundColor: 'rgba(80, 55, 70, 0.92)',
    zIndex: 20,
  },
  tooltipText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
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
