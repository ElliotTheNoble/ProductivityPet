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
  // Home renders its own full-screen living-room background behind this
  // header (see src/app/_layout.tsx) — transparent here lets it show
  // through instead of the usual solid header fill. Every other route is
  // unaffected.
  const isHome = pathname === '/';

  return (
    <ThemedView style={[styles.container, isHome && styles.transparentContainer]}>
      <View style={styles.inner}>
        <View style={[styles.brand, isHome && styles.brandBackdrop]}>
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
    paddingHorizontal: Spacing.three,
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
  },
  // Home only (see isHome above): a small, subtle translucent cream panel
  // just behind the logo/tagline so they stay readable over the
  // living-room background, without stretching across the whole header.
  brandBackdrop: {
    backgroundColor: 'rgba(252, 243, 233, 0.78)',
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.two,
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
