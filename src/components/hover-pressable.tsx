import { forwardRef } from 'react';
import { Pressable, StyleSheet, type PressableProps, type View, type ViewStyle } from 'react-native';

// A drop-in Pressable that adds a visible mouse-hover highlight. It is used ONLY by the screens that had no
// hover feedback before; controls that already had their own hover effect keep using plain Pressable and are
// untouched.
//
//  - Enabled control, hovered (real mouse only; touch never sets `hovered`, so nothing sticks after a tap):
//    a pastel pink glow, a stronger/more saturated colour, and a small lift.
//  - Selected control (accessibilityState.selected): keeps its look and gets only a gentler glow, no lift.
//  - Disabled control: no hover response at all.
//  - `noHover`: for invisible surfaces (dimmed backdrops, tap-catchers) that merely close something.
//  - The lift is skipped when the control already sets its own `transform` (cards that flip, etc.) so it can
//    never override that; the colour/glow still applies.
//  - The caller's own style (including its pressed feedback) and every other prop pass through unchanged.
//    Hovering never triggers onPress.

const GLOW: ViewStyle = {
  shadowColor: '#F28DAE',
  shadowOpacity: 0.45,
  shadowRadius: 9,
  shadowOffset: { width: 0, height: 2 },
};
const SOFT_GLOW: ViewStyle = { ...GLOW, shadowOpacity: 0.25, shadowRadius: 6 };

// `filter` and `transition*` are web-only style properties.
const WEB_STRONG = { filter: 'saturate(1.35) brightness(0.97)' } as unknown as ViewStyle;
const WEB_SOFT = { filter: 'saturate(1.15) brightness(0.985)' } as unknown as ViewStyle;
const WEB_SMOOTH = { transitionProperty: 'transform, filter, box-shadow, opacity', transitionDuration: '140ms' } as unknown as ViewStyle;

export type HoverPressableProps = PressableProps & { noHover?: boolean };

export const HoverPressable = forwardRef<View, HoverPressableProps>(function HoverPressable(
  { style, disabled, noHover, ...rest },
  ref
) {
  const selected = (rest.accessibilityState as { selected?: boolean } | undefined)?.selected === true;
  return (
    <Pressable
      ref={ref}
      disabled={disabled}
      {...rest}
      style={(state) => {
        const base = typeof style === 'function' ? style(state) : style;
        const hovered = (state as { hovered?: boolean }).hovered === true;
        if (noHover || disabled) return base;
        if (!hovered) return [base, WEB_SMOOTH];
        const hasTransform = !!(StyleSheet.flatten(base as never) as ViewStyle | undefined)?.transform;
        const lift: ViewStyle | null =
          selected || hasTransform ? null : { transform: [{ translateY: -1.5 }, { scale: 1.03 }] };
        return [base, WEB_SMOOTH, selected ? SOFT_GLOW : GLOW, selected ? WEB_SOFT : WEB_STRONG, lift];
      }}
    />
  );
});
