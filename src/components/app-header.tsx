import { usePathname, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type NavItem = {
  href: Href;
  label: string;
};

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
  // Home and Tasks each render their own full-screen background behind this
  // header (see src/app/_layout.tsx) — transparent here lets it show
  // through instead of the usual solid header fill. Every other route is
  // unaffected.
  const isImmersiveRoute = pathname === '/' || pathname === '/tasks';

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
});
