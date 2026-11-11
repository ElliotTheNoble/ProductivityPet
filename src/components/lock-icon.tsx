import { Ionicons } from '@expo/vector-icons';

// The one Parent PIN icon: a simple outline lock (the same Ionicons outline family as the other icons in the app), in the soft purple of
// the pastel design. Purely decorative: the words next to it say what it means, so it is hidden from screen readers.
export const LOCK_ICON_COLOR = '#7B5CB8';

export function LockIcon({ size = 40, open = false, testID = 'parent-pin-lock-icon' }: { size?: number; open?: boolean; testID?: string }) {
  return (
    <Ionicons
      testID={testID}
      name={open ? 'lock-open-outline' : 'lock-closed-outline'}
      size={size}
      color={LOCK_ICON_COLOR}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
