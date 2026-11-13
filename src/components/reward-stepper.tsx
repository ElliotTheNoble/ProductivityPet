import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';
import { MAX_REWARD } from '@/utils/household';

// A whole number of Paw Tokens, changed one at a time with − and +. It can only show 0 to MAX_REWARD, so a negative, fractional or otherwise
// invalid amount cannot be entered at all (the household checks again when it saves). `kind` names what the amount is for (screen readers).
export function RewardStepper({ value, onChange, kind }: { value: number; onChange: (next: number) => void; kind: string }) {
  const { t, tn } = useT();
  return (
    <View style={styles.row}>
      <Button small tone="soft" label="−" disabled={value <= 0} onPress={() => onChange(Math.max(0, value - 1))} accessibilityLabel={t('rwFewerFor', { kind })} />
      <ThemedText type="smallBold" style={styles.value} accessibilityLiveRegion="polite" testID="reward-value">
        {tn('rwTokens', value)}
      </ThemedText>
      <Button small tone="soft" label="+" disabled={value >= MAX_REWARD} onPress={() => onChange(Math.min(MAX_REWARD, value + 1))} accessibilityLabel={t('rwMoreFor', { kind })} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  value: { minWidth: 110, textAlign: 'center' },
});
