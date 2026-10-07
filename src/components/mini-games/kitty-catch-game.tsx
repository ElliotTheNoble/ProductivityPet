import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { BackToGamesButton } from '@/components/mini-games/back-to-games-button';
import { KittyCatchResults } from '@/components/mini-games/kitty-catch-results';
import { SpriteCrop } from '@/components/sprite-crop';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  getFallSpeedForScore,
  getFallingObjectArt,
  getRandomFallingObjectType,
  KITTY_SPRITE_IDLE,
  KITTY_SPRITE_WALK_LEFT,
  KITTY_SPRITE_WALK_RIGHT,
  type FallingObjectType,
} from '@/utils/kitty-catch';
import {
  completeKittyCatchRound,
  getKittyCatchHighScore,
  type KittyCatchRoundResult,
} from '@/utils/kitty-catch-rewards';

// Kitty Catch — the first playable mini-game (see
// @/components/mini-games/mini-games-screen.tsx for the hub that hosts
// this). All game-mechanics math (difficulty curve, which object appears)
// lives in @/utils/kitty-catch.ts; all persistence (high score, daily
// reward limits, Happiness/Paw Token awarding) lives in
// @/utils/kitty-catch-rewards.ts — this component only drives the actual
// falling/catching animation loop and renders the current state.

const KITTY_SIZE = 56;
const OBJECT_SIZE = 44;
// How far above the very bottom edge a falling object is judged against
// the kitty — gives the catch/miss moment a little visual breathing room
// instead of judging exactly at the floor.
const CATCH_LINE_INSET = 12;
// Keyboard move speed, in pixels/second (desktop only — see the keydown/
// keyup effect below).
const KITTY_KEY_SPEED = 360;
// Caps how wide the game area gets on very large screens — still just
// `flex: 1` + `width: '100%'` of whatever's actually available below that
// (see the `screen`/`gameArea` styles below), so phones/tablets in either
// orientation are unaffected by this cap. No fixed aspect ratio anymore:
// the game area's actual box is determined by flexbox filling whatever
// vertical space is left after the HUD/hint rows in the full-height
// `screen` column (so the kitty never ends up below the fold) and by its
// own width up to this cap — never a hardcoded width/height pair. Whatever
// size that resolves to is read back via onLayout (areaSize below), which
// is what kitty/object X-Y position, spawn range, and collision already
// use — so widening/narrowing/reshaping this box needs no change to any
// of that math, it already follows the real measured box.
const GAME_AREA_MAX_WIDTH = 1000;

type FallingObject = {
  type: FallingObjectType;
  x: number;
  y: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function spawnFallingObject(areaWidth: number): FallingObject {
  return {
    type: getRandomFallingObjectType(),
    x: Math.random() * Math.max(areaWidth - OBJECT_SIZE, 0),
    y: -OBJECT_SIZE,
  };
}

type KittyCatchGameProps = {
  onExit: () => void;
};

export function KittyCatchGame({ onExit }: KittyCatchGameProps) {
  const theme = useTheme();

  const [areaSize, setAreaSize] = useState({ width: 0, height: 0 });
  const [kittyX, setKittyX] = useState(0);
  // Which kitty sprite to draw — 'idle' when not moving, 'left'/'right'
  // while moving that direction. Derived every frame from actual kittyX
  // movement (see the tick loop below), so it reflects BOTH keyboard and
  // touch-drag input uniformly, without either input method needing to
  // set it directly.
  const [facing, setFacing] = useState<'idle' | 'left' | 'right'>('idle');
  const [fallingObject, setFallingObject] = useState<FallingObject | null>(null);
  const [score, setScore] = useState(0);
  const [phase, setPhase] = useState<'playing' | 'ended'>('playing');
  const [bestScoreBeforeRound, setBestScoreBeforeRound] = useState<number | null>(null);
  const [roundResult, setRoundResult] = useState<KittyCatchRoundResult | null>(null);
  const [isSubmittingRound, setIsSubmittingRound] = useState(false);

  // Mirrors of the state above, read inside the rAF loop below — the loop
  // never reads React state directly (which would need it in the effect's
  // dependency array and re-create the whole loop every frame); it reads
  // these instead and calls the matching setState alongside each ref
  // update, so rendering always reflects the latest values.
  const kittyXRef = useRef(0);
  const facingRef = useRef<'idle' | 'left' | 'right'>('idle');
  const scoreRef = useRef(0);
  const fallingObjectRef = useRef<FallingObject | null>(null);
  const areaSizeRef = useRef({ width: 0, height: 0 });
  // -1 (left), 0 (none), or 1 (right) — set by the keydown/keyup listeners
  // below, read every frame by the loop for smooth continuous movement
  // while a key is held.
  const keyDirectionRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const hasInitializedRef = useRef(false);
  // Guards completeKittyCatchRound() from ever being called twice for the
  // same finished round (e.g. if this effect were somehow re-triggered) —
  // the real data-integrity backstop is still the serialized queue inside
  // completeKittyCatchRound itself, but a round should only ever be
  // *reported* once from here in the first place.
  const roundSubmittedRef = useRef(false);

  useEffect(() => {
    areaSizeRef.current = areaSize;
  }, [areaSize]);

  // Load the existing best score once, purely to show "Best: N" in the HUD
  // while playing — the authoritative before/after comparison for THIS
  // round happens inside completeKittyCatchRound itself, not here.
  useEffect(() => {
    let cancelled = false;
    getKittyCatchHighScore().then((best) => {
      if (!cancelled) setBestScoreBeforeRound(best);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleAreaLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setAreaSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }

  // First real measurement of the game area — set the kitty's starting
  // position and spawn the first falling object. Only ever runs once per
  // mount; handlePlayAgain (below) re-spawns directly instead of relying
  // on this.
  useEffect(() => {
    if (hasInitializedRef.current) return;
    if (areaSize.width === 0 || areaSize.height === 0) return;
    hasInitializedRef.current = true;

    const startX = (areaSize.width - KITTY_SIZE) / 2;
    kittyXRef.current = startX;
    setKittyX(startX);

    const spawned = spawnFallingObject(areaSize.width);
    fallingObjectRef.current = spawned;
    setFallingObject(spawned);
  }, [areaSize]);

  // Desktop keyboard controls — Left/Right arrows, and A/D. Web only (React
  // Native doesn't have DOM keyboard events); mobile/tablet uses the touch
  // drag handlers on the game area instead (see below). Always listening
  // while mounted — harmless while phase !== 'playing' since the game loop
  // below simply isn't running then.
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        keyDirectionRef.current = -1;
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        keyDirectionRef.current = 1;
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.key === 'ArrowLeft' || event.key === 'a' || event.key === 'A') {
        if (keyDirectionRef.current === -1) keyDirectionRef.current = 0;
      } else if (event.key === 'ArrowRight' || event.key === 'd' || event.key === 'D') {
        if (keyDirectionRef.current === 1) keyDirectionRef.current = 0;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // The main animation loop — moves the kitty (from held-key input) and
  // the falling object every frame, and judges catch-vs-miss once the
  // object reaches the catch line. Only runs while actually playing and
  // once the area has a real measured size.
  useEffect(() => {
    if (phase !== 'playing' || areaSize.width === 0 || areaSize.height === 0) return;

    function tick(now: number) {
      if (lastFrameTimeRef.current === null) lastFrameTimeRef.current = now;
      // Clamped so a dropped/backgrounded tab resuming doesn't apply one
      // huge catch-up jump to the falling object or the kitty.
      const dt = Math.min((now - lastFrameTimeRef.current) / 1000, 0.05);
      lastFrameTimeRef.current = now;
      const { width: areaWidth, height: areaHeight } = areaSizeRef.current;
      // Captured before any movement this frame, then compared against
      // the post-movement position below — this picks up net movement
      // from BOTH keyboard (applied just below) and touch-drag (applied
      // directly by updateKittyFromTouch between frames), uniformly.
      const kittyXAtFrameStart = kittyXRef.current;

      if (keyDirectionRef.current !== 0) {
        const nextX = clamp(
          kittyXRef.current + keyDirectionRef.current * KITTY_KEY_SPEED * dt,
          0,
          areaWidth - KITTY_SIZE
        );
        kittyXRef.current = nextX;
        setKittyX(nextX);
      }

      const FACING_EPSILON = 0.5;
      const movedX = kittyXRef.current - kittyXAtFrameStart;
      const nextFacing = movedX > FACING_EPSILON ? 'right' : movedX < -FACING_EPSILON ? 'left' : 'idle';
      if (nextFacing !== facingRef.current) {
        facingRef.current = nextFacing;
        setFacing(nextFacing);
      }

      const obj = fallingObjectRef.current;
      if (obj) {
        const fallSpeedPxPerSec = (getFallSpeedForScore(scoreRef.current) / 100) * areaHeight;
        const nextY = obj.y + fallSpeedPxPerSec * dt;
        const catchLineY = areaHeight - KITTY_SIZE - CATCH_LINE_INSET;

        if (nextY + OBJECT_SIZE >= catchLineY) {
          const kittyLeft = kittyXRef.current;
          const kittyRight = kittyLeft + KITTY_SIZE;
          const objLeft = obj.x;
          const objRight = objLeft + OBJECT_SIZE;
          const caught = objRight > kittyLeft && objLeft < kittyRight;

          if (caught) {
            const nextScore = scoreRef.current + 1;
            scoreRef.current = nextScore;
            setScore(nextScore);
            const spawned = spawnFallingObject(areaWidth);
            fallingObjectRef.current = spawned;
            setFallingObject(spawned);
          } else {
            fallingObjectRef.current = null;
            setFallingObject(null);
            lastFrameTimeRef.current = null;
            setPhase('ended');
            return; // round over — don't schedule another frame
          }
        } else {
          const updated = { ...obj, y: nextY };
          fallingObjectRef.current = updated;
          setFallingObject(updated);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastFrameTimeRef.current = null;
    };
  }, [phase, areaSize.width, areaSize.height]);

  // Reports the finished round exactly once (see roundSubmittedRef above)
  // — this is what actually awards Happiness/Paw Tokens and updates the
  // saved high score (see @/utils/kitty-catch-rewards.ts).
  useEffect(() => {
    if (phase !== 'ended' || roundSubmittedRef.current) return;
    roundSubmittedRef.current = true;
    setIsSubmittingRound(true);
    completeKittyCatchRound(scoreRef.current)
      .then((result) => setRoundResult(result))
      .catch(() => setRoundResult(null))
      .finally(() => setIsSubmittingRound(false));
  }, [phase]);

  function updateKittyFromTouch(event: GestureResponderEvent) {
    if (phase !== 'playing') return;
    const { width: areaWidth } = areaSizeRef.current;
    if (areaWidth === 0) return;
    const nextX = clamp(event.nativeEvent.locationX - KITTY_SIZE / 2, 0, areaWidth - KITTY_SIZE);
    kittyXRef.current = nextX;
    setKittyX(nextX);
  }

  function handlePlayAgain() {
    keyDirectionRef.current = 0;
    roundSubmittedRef.current = false;
    setRoundResult(null);

    scoreRef.current = 0;
    setScore(0);

    facingRef.current = 'idle';
    setFacing('idle');

    const { width: areaWidth } = areaSizeRef.current;
    const startX = (areaWidth - KITTY_SIZE) / 2;
    kittyXRef.current = startX;
    setKittyX(startX);

    const spawned = spawnFallingObject(areaWidth);
    fallingObjectRef.current = spawned;
    setFallingObject(spawned);

    setPhase('playing');
  }

  // The Game Over/results screen is explicitly NOT part of the no-scroll
  // requirement below (that's specifically about active gameplay) — it
  // keeps its own exact design (KittyCatchResults itself is untouched),
  // just wrapped in a ScrollView as a safety net so it's never clipped/
  // unreachable on a short screen. flexGrow:1 + centered content means it
  // still displays centered (not pinned to the top) on any screen tall
  // enough to show it without scrolling.
  if (phase === 'ended') {
    return (
      <ScrollView style={styles.endedScroll} contentContainerStyle={styles.endedScrollContent}>
        {isSubmittingRound || !roundResult ? (
          <ThemedText type="small" themeColor="textSecondary">
            Saving your round…
          </ThemedText>
        ) : (
          <KittyCatchResults result={roundResult} onPlayAgain={handlePlayAgain} onExit={onExit} />
        )}
      </ScrollView>
    );
  }

  // Active gameplay: a full-height flex column (HUD, then the game area,
  // then the controls hint) — never a ScrollView. The game area is the
  // only flex:1 child, so it always receives exactly whatever vertical
  // space is left after the HUD/hint rows take theirs, within this
  // screen's real available height (from the SafeAreaView this renders
  // into — see mini-games-screen.tsx) — which is what keeps the kitty on
  // screen without scrolling, and what makes this reflow correctly on its
  // own when the device rotates, with no manual portrait/landscape
  // branching needed.
  return (
    <View style={styles.screen}>
      <ThemedView type="backgroundElementOverlay" style={styles.hud}>
        <BackToGamesButton onPress={onExit} />
        <ThemedText type="smallBold">Score: {score}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Best: {bestScoreBeforeRound ?? '—'}
        </ThemedText>
      </ThemedView>

      <View
        style={[styles.gameArea, { backgroundColor: theme.skyOverlay, borderColor: theme.sky }]}
        onLayout={handleAreaLayout}
        // Explicit Responder API (not just onTouchStart/onTouchMove) — more
        // reliable than the plain onTouch* props in general, and still
        // matters here even though active gameplay is no longer inside a
        // ScrollView (see mini-games-screen.tsx): returning true from the
        // should-set-responder callbacks is what reliably wins the touch
        // for this View right away instead of it being ambiguous.
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={updateKittyFromTouch}
        onResponderMove={updateKittyFromTouch}>
        {fallingObject ? (
          <View style={[styles.fallingObjectWrap, { left: fallingObject.x, top: fallingObject.y }]}>
            <SpriteCrop {...getFallingObjectArt(fallingObject.type)} size={OBJECT_SIZE} />
          </View>
        ) : null}
        <View style={[styles.kittyWrap, { left: kittyX, top: areaSize.height - KITTY_SIZE }]}>
          <SpriteCrop
            {...(facing === 'left'
              ? KITTY_SPRITE_WALK_LEFT
              : facing === 'right'
                ? KITTY_SPRITE_WALK_RIGHT
                : KITTY_SPRITE_IDLE)}
            size={KITTY_SIZE}
          />
        </View>
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        {Platform.OS === 'web' ? '← → or A/D to move' : 'Drag to move the kitty'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fills the full SafeAreaView this component renders into (see
  // mini-games-screen.tsx) — a column of [hud, gameArea, hint] where only
  // gameArea (flex: 1) grows/shrinks to fit whatever height is actually
  // available, which is the whole no-scroll mechanism. No ScrollView here.
  screen: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  // A small translucent pastel panel (not an opaque one) behind the score
  // readout — keeps it legible over the illustrated background without
  // covering any more of it than this one HUD row.
  hud: {
    width: '100%',
    maxWidth: GAME_AREA_MAX_WIDTH,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
  // flex: 1 (not a fixed height or aspectRatio) is what makes this take
  // "whatever vertical space is left" in `screen` above, on any screen
  // size/orientation — its real rendered box is then read back via
  // onLayout into areaSize, which the game loop already treats as the
  // source of truth regardless of how that size was arrived at.
  gameArea: {
    flex: 1,
    width: '100%',
    maxWidth: GAME_AREA_MAX_WIDTH,
    borderRadius: Spacing.three,
    borderWidth: 2,
    overflow: 'hidden',
    position: 'relative',
  },
  fallingObjectWrap: {
    position: 'absolute',
    width: OBJECT_SIZE,
    height: OBJECT_SIZE,
  },
  kittyWrap: {
    position: 'absolute',
    width: KITTY_SIZE,
    height: KITTY_SIZE,
  },
  hint: {
    textAlign: 'center',
  },
  // The Game Over/results screen's own safety-net ScrollView (see the
  // phase === 'ended' branch above) — flexGrow:1 on the content container
  // keeps KittyCatchResults centered when it fits, while still allowing a
  // real scroll if it doesn't on a short screen. KittyCatchResults' own
  // styling is completely unrelated to/unaffected by this wrapper.
  endedScroll: {
    flex: 1,
    width: '100%',
  },
  endedScrollContent: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
});
