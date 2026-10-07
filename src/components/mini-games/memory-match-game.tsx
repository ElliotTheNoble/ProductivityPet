import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { BackToGamesButton } from '@/components/mini-games/back-to-games-button';
import { MemoryMatchDifficultySelect } from '@/components/mini-games/memory-match-difficulty-select';
import { MemoryMatchResults } from '@/components/mini-games/memory-match-results';
import { SpriteCrop } from '@/components/sprite-crop';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  computeMemoryMatchGridLayout,
  createMemoryMatchBoard,
  MEMORY_MATCH_CARD_BACK,
  MEMORY_MATCH_CARD_FACES,
  MEMORY_MATCH_DIFFICULTY_INFO,
  type MemoryMatchCard,
  type MemoryMatchDifficulty,
} from '@/utils/memory-match';
import {
  completeMemoryMatchRound,
  getMemoryMatchBestMoves,
  type MemoryMatchRoundResult,
} from '@/utils/memory-match-rewards';

// Kitty Memory Match — the second playable mini-game (see
// @/components/mini-games/mini-games-screen.tsx for the hub that hosts
// this). All game-mechanics math (board generation, shuffling, responsive
// grid sizing) lives in @/utils/memory-match.ts; all persistence (Best
// Moves per difficulty, daily reward limits, Happiness/Paw Token
// awarding) lives in @/utils/memory-match-rewards.ts — this component
// only drives the flip/match/move-counting flow and renders the current
// state. Entirely independent of Kitty Catch's files, so nothing here can
// affect that game.

// How long a non-matching pair stays face-up before flipping back —
// "briefly", per the game's own spec; long enough to actually see both
// cards, short enough not to feel sluggish.
const MISMATCH_FLIP_BACK_DELAY_MS = 900;
const CARD_GAP = Spacing.two;
// Reserved breathing room above/below the card grid, between the HUD and
// the first row. This is real padding on `board` (see styles.board) —
// the view the grid's available height is measured FROM is `boardSurface`,
// a plain flex:1 child with no padding of its own, so its onLayout size
// already has this inset baked out by the flexbox engine itself. The
// previous fix instead subtracted this amount from the measured height in
// JS and added it back as the grid's own padding — mathematically
// equivalent, but relying on our arithmetic matching Yoga's exactly. Using
// real padding on an unmeasured ancestor removes that dependency: the gap
// is structurally guaranteed regardless of how the grid's own size is
// computed.
const GRID_VERTICAL_INSET = Spacing.two;
// Easy is always a 4x4 board (16 cards), never the generic algorithm's
// preferred 8x2 on wide screens — see computeMemoryMatchGridLayout's
// `forcedColumns` param.
const EASY_FORCED_COLUMNS = 4;

// Easy's 4 columns are deliberately sized by HEIGHT (4 rows) long before
// they run out of desktop WIDTH, which is exactly why there was so much
// unused space on either side — the card size itself was already right,
// there was just leftover width nothing was using. Rather than growing
// the cards to soak that space up (which the request explicitly didn't
// want), this spreads it into the gaps BETWEEN the 4 columns instead:
// given the already-computed card width, solve for whatever column gap
// exactly fills the real available width, floored at the normal CARD_GAP
// (so it never shrinks the existing look) and capped at one card's width
// (so columns can't drift so far apart the board stops reading as a
// single 4x4 grid). On a narrow/mobile board the ideal gap is already
// ~CARD_GAP (the layout was width-constrained to begin with), so this is
// a no-op there — the widening only ever shows up when there's real
// spare width to use.
function computeEasyColumnGap(cardWidth: number, columns: number, availableWidth: number): number {
  if (columns <= 1) return CARD_GAP;
  const idealGap = (availableWidth - columns * cardWidth) / (columns - 1);
  return Math.max(CARD_GAP, Math.min(idealGap, cardWidth));
}

type Phase = 'select' | 'playing' | 'ended';

type MemoryMatchGameProps = {
  onExit: () => void;
};

export function MemoryMatchGame({ onExit }: MemoryMatchGameProps) {
  const theme = useTheme();

  const [phase, setPhase] = useState<Phase>('select');
  const [difficulty, setDifficulty] = useState<MemoryMatchDifficulty | null>(null);
  const [bestMovesByDifficulty, setBestMovesByDifficulty] = useState<
    Partial<Record<MemoryMatchDifficulty, number>>
  >({});
  const [cards, setCards] = useState<MemoryMatchCard[]>([]);
  // 0, 1, or 2 card ids currently face-up and NOT yet matched.
  const [revealedIds, setRevealedIds] = useState<string[]>([]);
  const [matchedFaceIndices, setMatchedFaceIndices] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);
  // True only while a non-matching pair is being shown before flipping
  // back — blocks further selections so rapid taps can't corrupt state.
  const [isResolving, setIsResolving] = useState(false);
  const [boardSize, setBoardSize] = useState({ width: 0, height: 0 });
  const [roundResult, setRoundResult] = useState<MemoryMatchRoundResult | null>(null);
  const [isSubmittingRound, setIsSubmittingRound] = useState(false);

  const movesRef = useRef(0);
  const roundSubmittedRef = useRef(false);
  const resolveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load every difficulty's saved Best Moves once, for the difficulty-
  // select screen's "Best: N moves" badges and the in-game HUD.
  useEffect(() => {
    let cancelled = false;
    getMemoryMatchBestMoves().then((record) => {
      if (!cancelled) setBestMovesByDifficulty(record);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      if (resolveTimeoutRef.current) clearTimeout(resolveTimeoutRef.current);
    },
    []
  );

  function startRound(selected: MemoryMatchDifficulty) {
    if (resolveTimeoutRef.current) {
      clearTimeout(resolveTimeoutRef.current);
      resolveTimeoutRef.current = null;
    }
    setDifficulty(selected);
    setCards(createMemoryMatchBoard(selected));
    setRevealedIds([]);
    setMatchedFaceIndices(new Set());
    movesRef.current = 0;
    setMoves(0);
    setIsResolving(false);
    roundSubmittedRef.current = false;
    setRoundResult(null);
    setPhase('playing');
  }

  function handleBoardLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setBoardSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }

  function handleCardPress(card: MemoryMatchCard) {
    if (phase !== 'playing' || isResolving) return;
    if (matchedFaceIndices.has(card.faceIndex)) return;
    if (revealedIds.includes(card.id)) return;
    if (revealedIds.length >= 2) return;

    const nextRevealed = [...revealedIds, card.id];
    setRevealedIds(nextRevealed);
    if (nextRevealed.length < 2) return;

    const [firstId, secondId] = nextRevealed;
    const firstCard = cards.find((candidate) => candidate.id === firstId);
    const secondCard = cards.find((candidate) => candidate.id === secondId);
    if (!firstCard || !secondCard) return;

    // A "move" is selecting two cards, win or lose.
    const nextMoves = movesRef.current + 1;
    movesRef.current = nextMoves;
    setMoves(nextMoves);

    if (firstCard.faceIndex === secondCard.faceIndex) {
      const nextMatched = new Set(matchedFaceIndices);
      nextMatched.add(firstCard.faceIndex);
      setMatchedFaceIndices(nextMatched);
      setRevealedIds([]);

      if (nextMatched.size === cards.length / 2) {
        setPhase('ended');
      }
    } else {
      setIsResolving(true);
      resolveTimeoutRef.current = setTimeout(() => {
        setRevealedIds([]);
        setIsResolving(false);
        resolveTimeoutRef.current = null;
      }, MISMATCH_FLIP_BACK_DELAY_MS);
    }
  }

  // Reports the finished round exactly once (same roundSubmittedRef guard
  // shape as Kitty Catch's kitty-catch-game.tsx) — this is what actually
  // awards Happiness/Paw Tokens and updates the saved Best Moves record.
  useEffect(() => {
    if (phase !== 'ended' || roundSubmittedRef.current || !difficulty) return;
    roundSubmittedRef.current = true;
    setIsSubmittingRound(true);
    completeMemoryMatchRound(difficulty, movesRef.current)
      .then((result) => {
        setRoundResult(result);
        setBestMovesByDifficulty((prev) => ({ ...prev, [difficulty]: result.bestMoves }));
      })
      .catch(() => setRoundResult(null))
      .finally(() => setIsSubmittingRound(false));
  }, [phase, difficulty]);

  function handlePlayAgain() {
    if (!difficulty) return;
    startRound(difficulty);
  }

  if (phase === 'select') {
    return (
      <ScrollView style={styles.phaseScroll} contentContainerStyle={styles.phaseScrollContent}>
        <MemoryMatchDifficultySelect bestMoves={bestMovesByDifficulty} onSelect={startRound} onExit={onExit} />
      </ScrollView>
    );
  }

  // The Game Over/results screen is explicitly NOT part of the no-scroll
  // requirement below (that's specifically about the active board) — it
  // keeps its own exact design (MemoryMatchResults itself drives that),
  // just wrapped in a ScrollView as a safety net so it's never clipped on
  // a short screen, same approach as Kitty Catch's results screen.
  if (phase === 'ended') {
    return (
      <ScrollView style={styles.phaseScroll} contentContainerStyle={styles.phaseScrollContent}>
        {isSubmittingRound || !roundResult ? (
          <ThemedText type="small" themeColor="textSecondary">
            Saving your round…
          </ThemedText>
        ) : (
          <MemoryMatchResults result={roundResult} onPlayAgain={handlePlayAgain} onExit={onExit} />
        )}
      </ScrollView>
    );
  }

  // Active gameplay: a full-height flex column (HUD, then the board),
  // never a ScrollView — same no-scroll philosophy as Kitty Catch. The
  // board is the only flex:1 child, so it always receives whatever
  // vertical space is left after the HUD row, within this screen's real
  // available height; computeMemoryMatchGridLayout then picks however
  // many columns make the cards as large as possible inside THAT real
  // measured box (see memory-match.ts) — so this reflows correctly on its
  // own for any difficulty, any screen size, and both orientations, with
  // no manual branching here.
  const totalCards = cards.length;
  const layout =
    boardSize.width > 0 && boardSize.height > 0
      ? computeMemoryMatchGridLayout(
          totalCards,
          boardSize.width,
          boardSize.height,
          CARD_GAP,
          difficulty === 'easy' ? EASY_FORCED_COLUMNS : undefined
        )
      : null;
  const pairsTotal = totalCards / 2;
  const currentBest = difficulty ? bestMovesByDifficulty[difficulty] : undefined;
  const columnGap =
    layout && difficulty === 'easy'
      ? computeEasyColumnGap(layout.cardWidth, layout.columns, boardSize.width)
      : CARD_GAP;

  return (
    <View style={styles.screen}>
      <ThemedView type="backgroundElementOverlay" style={styles.hud}>
        <BackToGamesButton onPress={onExit} />
        <ThemedText type="smallBold">{difficulty ? MEMORY_MATCH_DIFFICULTY_INFO[difficulty].label : ''}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Moves: {moves}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Pairs: {matchedFaceIndices.size}/{pairsTotal}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Best: {currentBest ?? '—'}
        </ThemedText>
      </ThemedView>

      <View style={styles.board}>
        <View style={styles.boardSurface} onLayout={handleBoardLayout}>
          {layout ? (
            <View
              style={[
                styles.grid,
                {
                  width: layout.columns * layout.cardWidth + (layout.columns - 1) * columnGap,
                  rowGap: CARD_GAP,
                  columnGap,
                },
              ]}>
              {cards.map((card) => {
                const isFaceUp = revealedIds.includes(card.id) || matchedFaceIndices.has(card.faceIndex);
                const isMatched = matchedFaceIndices.has(card.faceIndex);
                return (
                  <Pressable
                    key={card.id}
                    onPress={() => handleCardPress(card)}
                    disabled={isMatched || isResolving}
                    style={({ pressed }) => [
                      { width: layout.cardWidth, height: layout.cardHeight },
                      pressed && !isMatched && !isResolving ? styles.cardPressed : null,
                    ]}>
                    <View
                      style={[
                        styles.cardShadow,
                        isMatched && { opacity: 0.55 },
                      ]}>
                      <SpriteCrop
                        {...(isFaceUp ? MEMORY_MATCH_CARD_FACES[card.faceIndex] : MEMORY_MATCH_CARD_BACK)}
                        width={layout.cardWidth}
                        height={layout.cardHeight}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Shared by the 'select' and 'ended' phases — a safety-net ScrollView
  // (flexGrow:1 + centered content) so a difficulty-select grid or the
  // results card is never clipped/unreachable on a short screen, while
  // still displaying centered (not pinned to the top) whenever it fits
  // without scrolling. Same approach as Kitty Catch's own results screen.
  phaseScroll: {
    flex: 1,
    width: '100%',
  },
  phaseScrollContent: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  // Fills the full SafeAreaView this component renders into (see
  // mini-games-screen.tsx) — a column of [hud, board] where only board
  // (flex: 1) grows/shrinks to fit whatever height is actually available,
  // same no-scroll mechanism as Kitty Catch's `screen` style.
  screen: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  // A small translucent pastel panel (not an opaque one) behind the
  // Difficulty/Moves/Pairs/Best readout — keeps it legible over the
  // illustrated background without covering any more of it than this one
  // HUD row.
  hud: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  // flex: 1 (no fixed height) is what makes this take "whatever vertical
  // space is left" in `screen` above. The vertical padding here is the
  // real, structural HUD-to-grid gap — it's on THIS view (never measured
  // directly), not on boardSurface below, so the space it reserves can't
  // be eaten into by anything the grid itself does.
  board: {
    flex: 1,
    width: '100%',
    paddingVertical: GRID_VERTICAL_INSET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The view onLayout actually measures. Because it's a plain flex:1
  // child of the padded `board` above with no padding of its own, the
  // flexbox engine hands it exactly board's content box (board's height
  // minus the vertical padding) — so boardSize already excludes the
  // reserved gap with no manual arithmetic needed, and
  // computeMemoryMatchGridLayout's output can never overflow back into
  // that reserved space.
  boardSurface: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // rowGap/columnGap are supplied inline instead of here (see the grid
  // render below) — columnGap varies for Easy (spread across leftover
  // desktop width), so it can't be a single static value.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignContent: 'center',
  },
  cardShadow: {
    flex: 1,
    borderRadius: Spacing.one,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.8,
  },
});
