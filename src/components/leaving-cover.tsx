import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { FAMILY_BACKGROUND } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';

// Shown over the whole app (never instead of it) while a profile is being left: see leaveProfile in @/utils/family-session.ts. It is
// opaque and carries no information about any profile, so nothing can be read, and nothing underneath can be tapped, while the
// profile's pending saves finish and its stores let go. It is a cover rather than a replacement so that, if leaving fails, the screen
// underneath is exactly as the person left it (an unfinished game round or a half-typed text is still there).
export function LeavingCover() {
  const { t } = useT();
  const ref = useRef<View>(null);
  // On the web the cover takes the keyboard focus, so Tab, Enter and Space can only land on it, never on the app underneath.
  useEffect(() => {
    if (Platform.OS === 'web') (ref.current as unknown as { focus?: () => void } | null)?.focus?.();
  }, []);
  return (
    <View
      ref={ref}
      tabIndex={-1}
      style={styles.cover}
      accessible
      accessibilityViewIsModal
      accessibilityRole="progressbar"
      accessibilityLabel={t('fpLeaving')}
      accessibilityLiveRegion="polite"
      onStartShouldSetResponder={() => true}>
      <ActivityIndicator size="large" color="#A78BDB" />
      <ThemedText type="smallBold">{t('fpLeaving')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        {t('fpLeavingHint')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFill,
    zIndex: 10000,
    elevation: 10000,
    backgroundColor: FAMILY_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    padding: Spacing.four,
  },
  hint: { textAlign: 'center', maxWidth: 360 },
});
