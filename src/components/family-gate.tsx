import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { FamilyPicker } from '@/components/family-picker';
import { FAMILY_BACKGROUND } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';
import { decidePicker, type PickerDecision } from '@/utils/family-picker-model';
import { markProfileChosen, useProfileChosen } from '@/utils/family-session';

// Wraps the whole app in family mode (see src/app/_layout.tsx, which loads this file only when the flag is on). Until a profile
// has been chosen on the picker, `children` (the app shell) is simply NOT rendered: no profile's game stores are read, no pet
// catch-up runs, no rewards, mail or notifications are started for anybody. When nobody has to be chosen (no active child) the
// app opens exactly as it always has.
export function FamilyGate({ children }: { children: ReactNode }) {
  const chosen = useProfileChosen();
  const [decision, setDecision] = useState<PickerDecision | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (chosen) return;
    let cancelled = false;
    setDecision(null);
    void decidePicker().then((next) => {
      if (cancelled) return;
      if (next.kind === 'skip') markProfileChosen();
      else setDecision(next);
    });
    return () => {
      cancelled = true;
    };
  }, [chosen, attempt]);

  if (chosen) return <>{children}</>;
  if (!decision || decision.kind !== 'picker') return <Waiting />;
  return <FamilyPicker decision={decision} onRetry={() => setAttempt((n) => n + 1)} />;
}

// Shown for a moment while the family list is read. Deliberately not the app: nothing of any profile is on it.
function Waiting() {
  const { t } = useT();
  return (
    <View style={styles.page} accessibilityRole="progressbar" accessibilityLabel={t('fpLoading')}>
      <ActivityIndicator size="large" color="#A78BDB" />
      <ThemedText type="small" themeColor="textSecondary">
        {t('fpLoading')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: FAMILY_BACKGROUND, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
});
