import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';

// The interactive hover-and-hold mechanic shared by all three bathing
// phases — Soap, Rinse, and Blow Dry (see @/components/room-detail-screen.tsx,
// which owns the overall bath state machine — which phase is unlocked,
// each phase's own completedCount, and what happens once all three reach
// TOTAL_BATHING_TARGETS). This component only ever knows about ONE phase
// at a time (whichever is passed in as `phase`) and is a fully controlled
// component: it never invents or resets progress itself, it only reports
// "the player just finished holding over the next target" via
// onTargetReached, so the parent screen remains the single source of
// truth for completedCount (needed anyway so the parent can render the
// Soap/Rinse/Blow Dry progress bars and know when a phase is finished).
//
// Target positions are plain percentages of this component's own box
// (the same `${number}%`-of-box convention @/utils/pet-accessory-placement.ts
// already uses for accessory placement), NOT individually tuned per growth
// stage/sprite pose the way accessory placements were — a deliberate
// simplification (see room-detail-screen.tsx's own comment on this). All
// three phases reuse the exact same 5 spots, in the exact same order,
// since rinsing/drying naturally cover the same places that were just
// soaped.
type Target = { xPercent: number; yPercent: number };

const TARGETS: Target[] = [
  { xPercent: 50, yPercent: 25 }, // head
  { xPercent: 30, yPercent: 45 }, // left side
  { xPercent: 70, yPercent: 45 }, // right side
  { xPercent: 50, yPercent: 60 }, // back
  { xPercent: 50, yPercent: 80 }, // tail
];

export const TOTAL_BATHING_TARGETS = TARGETS.length;

// How big each target circle's hit area is, as a percentage of the box's
// own smaller dimension — so it scales with the box instead of staying a
// fixed pixel size on every screen/stage.
const TARGET_RADIUS_PERCENT = 14;

// Pure distance check shared by the hold mechanic's tick loop and
// tryInstantComplete's click/tap check below, so both agree on exactly
// the same hit area rather than two copies of this math drifting apart.
function isPointWithinTarget(x: number, y: number, target: Target, width: number, height: number): boolean {
  const targetXPx = (target.xPercent / 100) * width;
  const targetYPx = (target.yPercent / 100) * height;
  const radiusPx = (TARGET_RADIUS_PERCENT / 100) * Math.min(width, height);
  return Math.hypot(x - targetXPx, y - targetYPx) <= radiusPx;
}

// How long the tool has to stay over the active circle, continuously, to
// complete it.
const HOLD_DURATION_MS = 2000;
// How often the hold-progress tick loop re-checks the pointer against the
// active target. 50ms (20 times/second) is fine enough that the fill reads
// as a smooth, continuous animation rather than visibly stepping, without
// re-rendering so often it costs anything noticeable.
const TICK_MS = 50;
// How long a fully-filled circle shows its checkmark before the next
// circle activates — just long enough to register as a small reward, not
// so long it feels like a delay.
const CHECKMARK_DISPLAY_MS = 500;

export type BathingPhase = 'soap' | 'rinse' | 'blowDry';

// Soap = pink, Rinse = light blue, Blow Dry = soft yellow — per
// instructions. `glow` is the active circle's pulsing ring/instruction
// accent color; `fill` is the more saturated color the circle itself
// fills with as hold progress accumulates (deliberately more saturated
// than `glow` so the fill stays easy to see against the softer pastel
// ring, per "make the fill animation smooth and easy to see"). Completed
// circles deliberately do NOT use these — they stay a single neutral
// green (see styles.targetDone) regardless of phase, so "done" always
// reads as visually distinct from "currently active," per instructions.
const PHASE_COLORS: Record<BathingPhase, { glow: string; fill: string }> = {
  soap: { glow: '#F9BBDA', fill: '#EC6FA8' },
  rinse: { glow: '#B7E4F9', fill: '#5AC8FA' },
  blowDry: { glow: '#FCEAA4', fill: '#F3C94E' },
};

// The small instruction line shown above the tool-select row while a
// tool is selected (see room-detail-screen.tsx) — per instructions, its
// wording changes with which tool is active.
export const BATHING_INSTRUCTIONS: Record<BathingPhase, string> = {
  soap: '🧼 Hover over the glowing circle to soap your kitty!',
  rinse: '🚿 Hover over the glowing circle to rinse your kitty!',
  blowDry: '💨 Hover over the glowing circle to dry your kitty!',
};

type BathingMiniGameProps = {
  phase: BathingPhase;
  // Emoji/text standing in for the active tool's own artwork (soap bar,
  // shower hose, or blow dryer — see @/utils/bathing-soap.ts for soap's
  // own data model; the hose/dryer have no Shop-purchasable data model
  // yet, per instructions, so their icons are just passed in directly by
  // the caller).
  toolIcon: string;
  // How many of TARGETS the player has already completed, in order — the
  // NEXT one to work on is always TARGETS[completedCount]. Owned entirely
  // by the parent (room-detail-screen.tsx), not this component.
  completedCount: number;
  // Called the moment the player finishes TARGETS[completedCount] (the
  // current one) — either by holding the tool over it continuously for
  // HOLD_DURATION_MS, or with a single click/tap (see tryInstantComplete)
  // — exactly once per completion either way; the parent is expected to
  // respond by incrementing its own completedCount, which flows back in
  // as a new prop and advances the target this component checks against.
  // Moving off the current target before a hold finishes PAUSES its hold
  // progress (frozen in place, not reset to zero) rather than losing it
  // — resuming the hold later continues from where it left off. Hovering
  // or clicking/tapping a DIFFERENT, not-yet-current target (or empty
  // space) does nothing either way.
  onTargetReached: () => void;
};

// Simple explanation: lets the player point a tool (soap bar, shower
// hose, or blow dryer) at Kitty and either hold it steady over a set of
// circles for 2 seconds OR click/tap a circle to finish it instantly, in
// order, to progress one bathing phase. Fills this exact box (sized/
// positioned by its parent to match Kitty's own box — see
// room-detail-screen.tsx) and only reacts while actually mounted, i.e.
// while that phase is the currently-selected tool.
//
// Mouse (continuous hover, no button needed, plus a click) + touch-and-
// hold-or-tap, including Android: two separate pointer sources feed the
// exact same tick loop (hold) and tryInstantComplete (click/tap) below.
// - On web, the real OS cursor is hidden (`cursor: 'none'`) over this box
//   the whole time it's mounted, and plain DOM-style onMouseMove/
//   onMouseLeave handlers (react-native-web forwards these straight onto
//   the underlying element, same technique already used by Pressable's
//   own hover states elsewhere in RN Web — not part of RN's own typed
//   View props, so typed loosely here rather than fought against) track
//   the mouse continuously, independent of whether any button is
//   pressed. `offsetX`/`offsetY` on the raw browser event are already
//   relative to THIS element, not the page — reliable here specifically
//   because every child below (circles, effects, the tool icon) is
//   `pointerEvents="none"`, so the browser can never resolve one of them
//   as the event target instead of this wrapper.
// - On native (iOS/Android), there is no hover without contact, so touch
//   position is tracked via React Native's own PanResponder (core RN,
//   already a transitive dependency via react-navigation — no new
//   gesture library introduced) while the finger is down; lifting it
//   clears the pointer, same as moving the mouse off the box on web.
// Either way, the SAME tick loop (below) is what actually turns "pointer
// is currently within the active target's radius" into hold progress —
// it doesn't care which platform supplied the position.
export function BathingMiniGame({ phase, toolIcon, completedCount, onTargetReached }: BathingMiniGameProps) {
  const [boxSize, setBoxSize] = useState({ width: 0, height: 0 });
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  const [holdProgressPercent, setHoldProgressPercent] = useState(0);
  // True only while the pointer is currently inside the ACTIVE target's
  // radius (i.e. hold progress is actively accumulating, not paused) —
  // drives the Rinse/Blow Dry visual effects below, so they read as "this
  // is happening right now" rather than a constant decoration.
  const [isHoveringTarget, setIsHoveringTarget] = useState(false);
  // Which target (if any) just hit 100% and is showing its checkmark for
  // CHECKMARK_DISPLAY_MS before the NEXT circle actually activates — see
  // the dedicated effect below. null the rest of the time.
  const [justCompletedIndex, setJustCompletedIndex] = useState<number | null>(null);

  // Refs mirroring the latest render's values — read from inside the tick
  // loop and the pointer-update handlers below, both of which are stable
  // callbacks (created once) that must never close over stale values.
  const completedCountRef = useRef(completedCount);
  completedCountRef.current = completedCount;
  const boxSizeRef = useRef(boxSize);
  boxSizeRef.current = boxSize;
  const pointerRef = useRef(pointer);
  pointerRef.current = pointer;
  const onTargetReachedRef = useRef(onTargetReached);
  onTargetReachedRef.current = onTargetReached;
  const justCompletedIndexRef = useRef<number | null>(justCompletedIndex);
  justCompletedIndexRef.current = justCompletedIndex;

  // How much of HOLD_DURATION_MS has accumulated for the CURRENT target.
  // A ref (not state) because it's written every TICK_MS from inside the
  // tick loop itself; holdProgressPercent (state, derived from this) is
  // what actually drives the rendered fill.
  const holdProgressMsRef = useRef(0);

  function updatePointer(x: number, y: number) {
    setPointer({ x, y });
  }
  function clearPointer() {
    setPointer(null);
  }

  // A single click/tap on the ACTIVE circle completes it instantly — an
  // alternative to the 2-second hold, not a replacement for it (both work
  // side by side; see this component's own module comment). Shares the
  // exact same "start the checkmark celebration" path
  // (setJustCompletedIndex) the hold mechanic's own tick loop uses below,
  // so fill/checkmark/glow/progress-bar behavior is identical either way
  // — this is just a second, faster way to trigger the same thing.
  // Reusing that one shared gate (justCompletedIndexRef) is also exactly
  // what makes "one click completes exactly one circle" hold: a tap only
  // ever evaluates against whichever single index is current RIGHT NOW,
  // and immediately marks it as mid-celebration, so even a very fast
  // double-tap can't rack up two completions — the second tap's check
  // finds justCompletedIndexRef already set and no-ops.
  function tryInstantComplete(x: number, y: number) {
    if (justCompletedIndexRef.current !== null) return;
    const nextIndex = completedCountRef.current;
    if (nextIndex >= TARGETS.length) return;
    const { width, height } = boxSizeRef.current;
    if (width <= 0 || height <= 0) return;
    if (isPointWithinTarget(x, y, TARGETS[nextIndex], width, height)) {
      setJustCompletedIndex(nextIndex);
    }
  }

  // The tick loop: the one place hold progress actually advances (or
  // pauses) and a target's checkmark celebration actually starts. Set up
  // once (empty dependency array — reads everything else through the
  // refs above, so it never needs to be recreated) and torn down on
  // unmount, i.e. the moment this phase's tool is deselected.
  useEffect(() => {
    const interval = setInterval(() => {
      // Mid-celebration (see the dedicated effect below, which is what
      // actually clears this and calls onTargetReached once
      // CHECKMARK_DISPLAY_MS elapses) — pause the tick loop entirely so
      // nothing advances again until the NEXT circle is truly active.
      if (justCompletedIndexRef.current !== null) return;
      const nextIndex = completedCountRef.current;
      if (nextIndex >= TARGETS.length) return;
      const { width, height } = boxSizeRef.current;
      const p = pointerRef.current;
      const within = width > 0 && height > 0 && !!p && isPointWithinTarget(p.x, p.y, TARGETS[nextIndex], width, height);
      setIsHoveringTarget(within);
      // Off-target (or no pointer at all): PAUSE — leave holdProgressMsRef
      // exactly where it is rather than decaying it, so returning to the
      // same circle later resumes instead of starting over.
      if (!within) return;
      holdProgressMsRef.current = Math.min(holdProgressMsRef.current + TICK_MS, HOLD_DURATION_MS);
      setHoldProgressPercent((holdProgressMsRef.current / HOLD_DURATION_MS) * 100);
      if (holdProgressMsRef.current >= HOLD_DURATION_MS) {
        // Fully filled — start the brief checkmark celebration (handled
        // by the effect below) instead of advancing immediately.
        setJustCompletedIndex(nextIndex);
      }
    }, TICK_MS);
    return () => clearInterval(interval);
  }, []);

  // Runs the checkmark celebration itself: once a target is reported as
  // just-completed, wait CHECKMARK_DISPLAY_MS, then reset the fill for the
  // NEXT target and tell the parent via onTargetReached — which, once its
  // own completedCount prop round-trips back down, is what actually makes
  // the following circle "current." Only one such timer is ever pending
  // (justCompletedIndex can only be set to a new value after this effect
  // has already cleared it back to null, per the tick loop's own guard
  // above), and the cleanup here discards it if the component unmounts
  // mid-celebration (e.g. the player deselects the tool).
  useEffect(() => {
    if (justCompletedIndex === null) return;
    const timer = setTimeout(() => {
      holdProgressMsRef.current = 0;
      setHoldProgressPercent(0);
      setJustCompletedIndex(null);
      onTargetReachedRef.current();
    }, CHECKMARK_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [justCompletedIndex]);

  function handleLayout(event: LayoutChangeEvent) {
    const { width, height } = event.nativeEvent.layout;
    setBoxSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
  }

  // Native touch tracking — see this component's own module comment
  // above. Only attached on native (see panHandlerProps below); on web,
  // the separate onMouseMove/onMouseLeave handlers cover pointer tracking
  // instead, so this never even gets wired up there.
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt) => updatePointer(evt.nativeEvent.locationX, evt.nativeEvent.locationY),
      onPanResponderMove: (evt) => updatePointer(evt.nativeEvent.locationX, evt.nativeEvent.locationY),
      // A release is also a tap-to-complete attempt — see
      // tryInstantComplete's own comment above. Covers BOTH "a quick tap"
      // and "the player lifted their finger partway through a hold": the
      // hold mechanic's own tick loop will have already completed it by
      // release time if the hold reached a full 2 seconds, so this is a
      // no-op then (justCompletedIndexRef already set); otherwise it
      // gives mobile the same "tap to finish instantly" shortcut web gets
      // via onClick below.
      onPanResponderRelease: (evt) => {
        tryInstantComplete(evt.nativeEvent.locationX, evt.nativeEvent.locationY);
        clearPointer();
      },
      onPanResponderTerminate: clearPointer,
    })
  ).current;

  // Web-only mouse hover tracking (+ click-to-complete) — see this
  // component's own module comment above for why these aren't part of
  // RN's typed View props (hence the loose `any` typing here) and why
  // offsetX/offsetY are reliable relative-to-this-box coordinates. Built
  // as a plain object (not spread inline) so the `any` escape hatch stays
  // contained to this one place instead of needing a cast on the JSX
  // itself.
  const webHoverHandlers: Record<string, unknown> =
    Platform.OS === 'web'
      ? {
          onMouseMove: (e: any) => updatePointer(e.nativeEvent.offsetX, e.nativeEvent.offsetY),
          onMouseLeave: clearPointer,
          onClick: (e: any) => tryInstantComplete(e.nativeEvent.offsetX, e.nativeEvent.offsetY),
        }
      : {};
  const panHandlerProps = Platform.OS === 'web' ? {} : panResponder.panHandlers;

  return (
    <View
      style={[styles.wrapper, Platform.OS === 'web' ? ({ cursor: 'none' } as object) : null]}
      onLayout={handleLayout}
      {...panHandlerProps}
      {...webHoverHandlers}>
      {TARGETS.map((target, index) => (
        <BathingTarget
          key={index}
          target={target}
          phase={phase}
          state={
            index < completedCount
              ? 'done'
              : index === justCompletedIndex
                ? 'justCompleted'
                : index === completedCount
                  ? 'current'
                  : 'pending'
          }
          fillPercent={index === justCompletedIndex ? 100 : index === completedCount ? holdProgressPercent : 0}
        />
      ))}

      {/* Water (Rinse) / warm-air (Blow Dry) effect — only while hold
          progress is actively accumulating (not paused), so it reads as
          "this is happening right now." */}
      {phase === 'rinse' && isHoveringTarget && pointer ? <WaterEffect x={pointer.x} y={pointer.y} /> : null}
      {phase === 'blowDry' && isHoveringTarget && pointer ? <WarmAirEffect x={pointer.x} y={pointer.y} /> : null}

      {/* The active tool's own icon, following the pointer continuously —
          on web as soon as the mouse is over this box (no button needed),
          on native while the finger is touching it. pointerEvents="none"
          so this purely visual layer never itself intercepts anything. */}
      {pointer ? (
        <Text
          pointerEvents="none"
          style={[styles.toolIcon, { left: pointer.x - TOOL_ICON_HALF_SIZE, top: pointer.y - TOOL_ICON_HALF_SIZE }]}>
          {toolIcon}
        </Text>
      ) : null}
    </View>
  );
}

const TOOL_ICON_SIZE = 40;
const TOOL_ICON_HALF_SIZE = TOOL_ICON_SIZE / 2;

function BathingTarget({
  target,
  phase,
  state,
  fillPercent,
}: {
  target: Target;
  phase: BathingPhase;
  state: 'done' | 'current' | 'justCompleted' | 'pending';
  fillPercent: number;
}) {
  // Gentle pulsing glow — ONLY while this is the single active ('current')
  // circle, per instructions ("only highlight one active circle at a
  // time"); stops the instant it's fully filled (state flips to
  // 'justCompleted') so the checkmark celebration reads as calm/settled
  // rather than still pulsing.
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state !== 'current') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.12, duration: 550, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 550, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  // 'done' always stays a single neutral green (styles.targetDone),
  // regardless of phase — see PHASE_COLORS' own comment above for why.
  // 'current'/'justCompleted' use this phase's own pastel/saturated pair
  // instead, applied as inline overrides since StyleSheet.create can't
  // hold a value that varies per phase.
  const isActive = state === 'current' || state === 'justCompleted';
  const colors = PHASE_COLORS[phase];

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.target,
        {
          left: `${target.xPercent}%`,
          top: `${target.yPercent}%`,
          transform: [{ translateX: -TARGET_SIZE / 2 }, { translateY: -TARGET_SIZE / 2 }, { scale: state === 'current' ? pulse : 1 }],
        },
        state === 'done' && styles.targetDone,
        isActive && { borderColor: colors.glow, backgroundColor: `${colors.glow}40` },
      ]}>
      {/* The hold-progress fill itself — a plain growing circle rather
          than a true radial/pie wipe (no SVG dependency in this project),
          but still clearly reads as "filling up" as the player holds
          still over this target. Only ever non-zero for the active
          target (see fillPercent's own caller) — colored per phase, more
          saturated than the glow ring so it stays easy to see against it. */}
      {isActive && fillPercent > 0 ? (
        <View style={[styles.targetFill, { backgroundColor: colors.fill, transform: [{ scale: fillPercent / 100 }] }]} />
      ) : null}
      <Text style={styles.targetLabel}>{state === 'done' || state === 'justCompleted' ? '✓' : ''}</Text>
    </Animated.View>
  );
}

function WaterEffect({ x, y }: { x: number; y: number }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0.9);
    Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
  }, [x, y, opacity]);

  return (
    <Animated.View pointerEvents="none" style={[styles.waterDrop, { left: x - 12, top: y - 12, opacity }]}>
      <Text style={styles.waterDropLabel}>💧</Text>
    </Animated.View>
  );
}

// A subtle warm-air puff while blow-drying — same fade-in/fade-out
// technique as WaterEffect, just a different emoji, so both reuse the
// identical "one puff per tick, fading out" visual language.
function WarmAirEffect({ x, y }: { x: number; y: number }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.setValue(0.8);
    Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
  }, [x, y, opacity]);

  return (
    <Animated.View pointerEvents="none" style={[styles.warmAirPuff, { left: x - 14, top: y - 14, opacity }]}>
      <Text style={styles.warmAirLabel}>💨</Text>
    </Animated.View>
  );
}

const TARGET_SIZE = 56;

const styles = StyleSheet.create({
  wrapper: {
    ...StyleSheet.absoluteFill,
  },
  target: {
    position: 'absolute',
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    borderRadius: TARGET_SIZE / 2,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetDone: {
    borderColor: '#34C759',
    backgroundColor: 'rgba(52,199,89,0.25)',
  },
  targetFill: {
    position: 'absolute',
    width: TARGET_SIZE - 10,
    height: TARGET_SIZE - 10,
    borderRadius: (TARGET_SIZE - 10) / 2,
    backgroundColor: 'rgba(90,200,250,0.6)',
  },
  targetLabel: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  toolIcon: {
    position: 'absolute',
    fontSize: TOOL_ICON_SIZE,
    width: TOOL_ICON_SIZE,
    height: TOOL_ICON_SIZE,
    textAlign: 'center',
  },
  waterDrop: {
    position: 'absolute',
    width: 24,
    height: 24,
  },
  waterDropLabel: {
    fontSize: 20,
  },
  warmAirPuff: {
    position: 'absolute',
    width: 28,
    height: 28,
  },
  warmAirLabel: {
    fontSize: 22,
  },
});
