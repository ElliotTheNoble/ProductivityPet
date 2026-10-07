import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KittyCatchGame } from '@/components/mini-games/kitty-catch-game';
import { MemoryMatchGame } from '@/components/mini-games/memory-match-game';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

// The Mini-Games hub — a small, deliberately generic registry
// (MINI_GAMES below) plus a host that renders either the hub grid or
// whichever game is currently active. Adding mini-game #2/#3 later is
// meant to be: build its own `<SomeGame onExit={...} />` component (same
// shape as KittyCatchGame), add one more entry to MINI_GAMES with
// status: 'playable', and one more branch in the host's render-switch
// below — nothing about Kitty Catch or this hub needs to change.
type MiniGameStatus = 'playable' | 'coming-soon';

type MiniGameDefinition = {
  id: string;
  name: string;
  emoji: string;
  status: MiniGameStatus;
  description: string;
};

const MINI_GAMES: MiniGameDefinition[] = [
  {
    id: 'kitty-catch',
    name: 'Kitty Catch',
    emoji: '🧶',
    status: 'playable',
    description: 'Catch falling toys and treats before you miss one!',
  },
  {
    id: 'memory-match',
    name: 'Kitty Memory Match',
    emoji: '🐾',
    status: 'playable',
    description: 'Flip cards and find every matching pair!',
  },
  {
    id: 'game-3',
    name: 'Coming Soon',
    emoji: '🎲',
    status: 'coming-soon',
    description: 'A new mini-game is on the way.',
  },
];

export function MiniGamesScreen() {
  const theme = useTheme();
  // null = showing the hub grid; otherwise the id of the game currently
  // being played, which is also what decides which game component the
  // host below renders.
  const [activeGameId, setActiveGameId] = useState<string | null>(null);

  function handleSelectGame(game: MiniGameDefinition) {
    if (game.status !== 'playable') return;
    setActiveGameId(game.id);
  }

  // Kitty Catch (and any future playable game) renders OUTSIDE the hub's
  // ScrollView, filling the SafeAreaView directly instead — see
  // KittyCatchGame's own root style (flex: 1) for why: the whole point is
  // for it to lay out via flexbox against the real available screen space
  // (and never scroll) rather than being one more scrollable block. The
  // hub grid below is unaffected and keeps its own ScrollView exactly as
  // before.
  if (activeGameId === 'kitty-catch') {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <KittyCatchGame onExit={() => setActiveGameId(null)} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (activeGameId === 'memory-match') {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <MemoryMatchGame onExit={() => setActiveGameId(null)} />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.headingWrap}>
            <ThemedView type="backgroundElementOverlay" style={styles.headingBanner}>
              <ThemedText type="title" style={styles.heading}>
                Mini-Games
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
                Play with your pet to earn Happiness and Paw Tokens!
              </ThemedText>
            </ThemedView>
          </View>

          <View style={styles.grid}>
            {MINI_GAMES.map((game) => (
              <Pressable
                key={game.id}
                onPress={() => handleSelectGame(game)}
                disabled={game.status !== 'playable'}
                style={styles.cardPressable}>
                <ThemedView
                  type="backgroundElementOverlay"
                  style={[styles.card, { borderColor: theme.backgroundSelected }]}>
                  <ThemedText style={styles.cardEmoji}>{game.emoji}</ThemedText>
                  <ThemedText type="smallBold" style={styles.cardName}>
                    {game.name}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.cardDescription}>
                    {game.description}
                  </ThemedText>
                  {game.status === 'coming-soon' ? (
                    <ThemedView type="backgroundSelected" style={styles.badge}>
                      <ThemedText type="small" themeColor="textSecondary">
                        Coming soon
                      </ThemedText>
                    </ThemedView>
                  ) : (
                    <ThemedView type="accent" style={styles.badge}>
                      <ThemedText type="smallBold" style={styles.playBadgeText}>
                        Play
                      </ThemedText>
                    </ThemedView>
                  )}
                </ThemedView>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  // Transparent so the shared Mini-Games background rendered in
  // src/app/_layout.tsx (behind the now-transparent header too — see
  // app-header.tsx's isImmersiveRoute) shows through as one continuous
  // image, instead of this screen's own opaque cream fill hiding it. Same
  // technique Home/Tasks/Stats already use for their own backgrounds.
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  safeArea: {
    flex: 1,
    width: '100%',
  },
  scrollContent: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
  },
  headingWrap: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  // A small translucent pastel banner behind the heading/subheading, same
  // backgroundElementOverlay panel the hub's own game cards already use —
  // keeps the title readable over the new illustrated background without
  // covering more of it than necessary. Same idea as Stats' own heading
  // banner (see stats-screen.tsx).
  headingBanner: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
  },
  heading: {
    textAlign: 'center',
  },
  subheading: {
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  cardPressable: {
    width: 200,
  },
  card: {
    borderRadius: Spacing.three,
    borderWidth: 2,
    padding: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
  },
  cardEmoji: {
    fontSize: 40,
  },
  cardName: {
    textAlign: 'center',
  },
  cardDescription: {
    textAlign: 'center',
  },
  badge: {
    marginTop: Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  playBadgeText: {
    color: '#FFFFFF',
  },
});
