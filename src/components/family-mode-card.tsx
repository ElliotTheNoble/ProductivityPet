import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useParentAccess } from '@/hooks/use-parent-access';
import { useT } from '@/i18n';
import { getHouseholdIntegrity, hasAnyChildRecord, useHousehold } from '@/utils/household';
import { hasPinVerifier } from '@/utils/parent-gate';
import { restartOnboarding, useOnboarding } from '@/utils/onboarding';

// The explicit, opt-in way for anyone (especially an existing player) to reach the new Family / Parent mode.
// Starting setup only changes the onboarding status; no pet, task, token or Pawadise data is touched.
export function FamilyModeCard() {
  const router = useRouter();
  const { t } = useT();
  const onboarding = useOnboarding();
  const household = useHousehold();
  const access = useParentAccess();
  if (!onboarding || access.state === 'checking') return null;
  // Family mode, no Parent PIN, and a household that has children (or cannot be read): the dashboard shortcut and "start setup" are NOT
  // offered. Only the protected setup is (the device security check first, see @/components/parent-setup-claim.tsx).
  if (hasPinVerifier() && access.state === 'unprotected') {
    if (!household) return null;
    if (hasAnyChildRecord(household, getHouseholdIntegrity())) {
      return (
        <Card title={t('familyModeTitle')}>
          <ThemedText type="small" themeColor="textSecondary">
            {t('pkCardText')}
          </ThemedText>
          <View style={styles.row}>
            <Button label={t('pkPickerButton')} tone="mint" onPress={() => router.push('/parent-security')} />
          </View>
        </Card>
      );
    }
  }
  const hasParent = !!household?.parent;
  // With a parent PIN set and the parent area locked, this card (which anyone can reach from Pet Care) only offers to
  // unlock it; Start setup and the dashboard shortcut stay out of reach.
  if (access.state === 'locked' || access.state === 'cooldown') {
    return (
      <Card title={t('familyModeTitle')}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('pgCardLocked')}
        </ThemedText>
        <View style={styles.row}>
          <Button label={t('pgUnlockButton')} tone="mint" onPress={() => router.push('/parent')} />
        </View>
      </Card>
    );
  }
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
