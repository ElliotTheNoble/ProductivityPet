import { DarkTheme, DefaultTheme, Slot, ThemeProvider, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FAMILY_BACKGROUND } from '@/components/family-ui';
import { InParentShellContext } from '@/hooks/use-in-parent-shell';
import { ProfileChip } from '@/components/profile-chip';
import { ThemedText } from '@/components/themed-text';
import { hoverLift } from '@/constants/hover';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';
import { consumePendingRoute } from '@/utils/family-session';

// What the app shows while Main is the open profile in family mode (see RootLayoutContent in src/app/_layout.tsx): the Parent Dashboard
// and the parent-only screens, and NOTHING of the game. It is deliberately a separate, small shell instead of the game shell with a
// different page in it: the game shell starts the pet catch-up, health alerts, Pawadise mail, token history and birthday checks of the
// open profile, and none of that must run for Main while a parent is only looking at the dashboard (Main's own pet, tasks, journal and
// shop stay exactly as they were saved). So this file mounts none of those, and a route that belongs to the game is not rendered at all
// (not even for a moment): it is sent to the dashboard instead.
//
// Every page here still sits behind the Parent Gate (the dashboard, Family Settings = /parent, and the PIN screens), so an expired or
// background-locked session shows the PIN screen instead of the content, and typing an address cannot skip it. The header stays visible
// above the lock screen, so a parent can always switch profile.

export const PARENT_SHELL_ROUTES = ['/dashboard', '/parent', '/parent-security'] as const;

export function isParentShellRoute(pathname: string): boolean {
  return (PARENT_SHELL_ROUTES as readonly string[]).includes(pathname);
}

export function ParentShell() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const router = useRouter();
  const allowed = isParentShellRoute(pathname);

  // The one-time route chosen by the picker (the parent-only "Add a child" path leads to /parent). Reading it clears it.
  useEffect(() => {
    const route = consumePendingRoute();
    if (route) router.replace(route);
  }, [router]);
  // Anything that is not a parent screen (Home, Tasks, Rooms... the game) goes to the dashboard.
  useEffect(() => {
    if (!allowed) router.replace('/dashboard');
  }, [allowed, router]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <InParentShellContext.Provider value>
        <View style={styles.root}>
          <ParentHeader pathname={pathname} />
          {allowed ? <Slot /> : <View style={styles.blank} />}
        </View>
      </InParentShellContext.Provider>
    </ThemeProvider>
  );
}

function ParentHeader({ pathname }: { pathname: string }) {
  const { t } = useT();
  const router = useRouter();
  const items = [
    { href: '/dashboard' as const, label: t('phNavDashboard'), active: pathname === '/dashboard' },
    { href: '/parent' as const, label: t('phSettings'), active: pathname === '/parent' || pathname === '/parent-security' },
  ];
  return (
    <SafeAreaView edges={['top']} style={styles.header}>
      <View style={styles.titleRow}>
        <ThemedText style={styles.paw}>🐾</ThemedText>
        <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>
          {t('phTitle')}
        </ThemedText>
      </View>
      <View style={styles.nav}>
        <ProfileChip />
        {items.map((item) => (
          <Pressable
            key={item.href}
            onPress={() => router.replace(item.href)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: item.active }}
            style={(state) => [state.pressed && styles.pressed, hoverLift(state, !item.active)]}>
            <View style={[styles.pill, item.active ? styles.pillActive : styles.pillIdle]}>
              <ThemedText type="smallBold" style={item.active ? styles.pillActiveText : undefined}>
                {item.label}
              </ThemedText>
            </View>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: FAMILY_BACKGROUND },
  blank: { flex: 1, backgroundColor: FAMILY_BACKGROUND },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    backgroundColor: FAMILY_BACKGROUND,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  paw: { fontSize: 22 },
  title: { fontSize: 18, lineHeight: 24 },
  nav: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  pill: { minHeight: 44, paddingHorizontal: Spacing.three, borderRadius: Spacing.five, alignItems: 'center', justifyContent: 'center' },
  pillIdle: { backgroundColor: '#FBE3EC' },
  pillActive: { backgroundColor: '#A78BDB' },
  pillActiveText: { color: '#FFFFFF' },
  pressed: { opacity: 0.85 },
});
