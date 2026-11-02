import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';
import { useHousehold } from '@/utils/household';
import { restartOnboarding, useOnboarding } from '@/utils/onboarding';

// The explicit, opt-in way for anyone (especially an existing player) to reach the new Family / Parent mode.
// Starting setup only changes the onboarding status; no pet, task, token or Pawadise data is touched.
export function FamilyModeCard() {
  const router = useRouter();
  const { t } = useT();
  const onboarding = useOnboarding();
  const household = useHousehold();
  if (!onboarding) return null;
  const hasParent = !!household?.parent;
  return (
    <Card title={t('familyModeTitle')}>
      <ThemedText type="small" themeColor="textSecondary">
        {t('familyModeText')}
      </ThemedText>
      <View style={styles.row}>
        {hasParent ? <Button label={t('openDashboard')} tone="mint" onPress={() => router.push('/parent')} /> : null}
        <Button
          label={t('startSetup')}
          tone={hasParent ? 'soft' : 'primary'}
          onPress={async () => {
            await restartOnboarding();
            router.push('/welcome');
          }}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({ row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' } });
