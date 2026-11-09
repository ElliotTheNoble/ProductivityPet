import { useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getPinTiming, pinTimingEnabled, subscribeToPinTiming } from '@/utils/pin-timing';

// TEMPORARY, development only (see @/utils/pin-timing.ts): a small line under the unlock screen with the last PIN check's time.
// It renders nothing in a release build, with family mode off, or before the first check. Not translated on purpose: it is a
// developer's measurement, not part of the product.
export function DevPinTiming() {
  const timing = useSyncExternalStore(subscribeToPinTiming, getPinTiming, getPinTiming);
  if (!pinTimingEnabled() || timing.totalMs === null) return null;
  return (
    <View style={styles.box} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <ThemedText type="small" themeColor="textSecondary">
        {`DEV timing, check #${timing.checks}: ${timing.totalMs} ms in total` +
          (timing.deriveMs !== null ? `, of which the scrypt step ${timing.deriveMs} ms (N=${timing.n})` : '')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { paddingVertical: Spacing.one },
});
