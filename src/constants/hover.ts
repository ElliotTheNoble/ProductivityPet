// The ONE hover look for pills, tabs, chips and buttons: a small lift (the same scale/translate the Pet Album
// tabs and the Shop cards already use). Applied from React Native Web's Pressable `hovered` state, which only
// ever becomes true for a real mouse pointer, so a touch tap never leaves a control stuck highlighted, and it
// does not depend on the screen size or orientation. Selected/active controls skip it (see hoverLift).
import type { ViewStyle } from 'react-native';

export const HOVER_LIFT: ViewStyle = {
  transform: [{ scale: 1.04 }, { translateY: -2 }],
  shadowColor: '#000',
  shadowOpacity: 0.16,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 3 },
};

// `state` is Pressable's style-callback argument; `hovered` exists on the web build only.
export function hoverLift(state: unknown, enabled = true): ViewStyle | false {
  const hovered = (state as { hovered?: boolean }).hovered === true;
  return hovered && enabled ? HOVER_LIFT : false;
}
