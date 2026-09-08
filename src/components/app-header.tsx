import { usePathname, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
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

  return (
    <ThemedView style={styles.container}>
      <View style={styles.inner}>
        <View style={styles.brand}>
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
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.three,
  },
  inner: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  brand: {
    gap: Spacing.half,
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
