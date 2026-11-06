import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Card, FAMILY_BACKGROUND, PageShell } from '@/components/family-ui';
import { ParentGate } from '@/components/parent-gate';
import { ManageHome, SetupFlow } from '@/components/parent-pin-flows';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useParentAuthStatus } from '@/hooks/use-parent-auth-status';
import { useT } from '@/i18n';

// The /parent-security screen: what it shows depends only on the saved authentication state, never on anything passed in
// the address.
//   family mode off .... nothing (the route file already shows nothing)
//   unsupported ........ an explanation (this device cannot keep a PIN safely)
//   verifier-missing ... the locked explanation (offers nothing that creates a PIN)
//   none / pending ..... the first setup (the parent area is not protected yet, so no lock is needed)
//   ready .............. management, behind the Parent Gate (which first asks for the PIN, and for an unconfirmed
//                        recovery code before anything else)
export function ParentSecurityScreen() {
  const status = useParentAuthStatus();
  const { t } = useT();
  const router = useRouter();
  if (status.loading || status.state === 'off') return <View style={styles.blank} />;
  if (status.state === 'unsupported') {
    return (
      <PageShell maxWidth={480}>
        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.center}>
            {t('puTitle')}
          </ThemedText>
        </View>
        <Card>
          <ThemedText type="small">{t('puBody')}</ThemedText>
          <Button tone="soft" label={t('pmBackDashboard')} onPress={() => router.replace('/parent')} />
        </Card>
      </PageShell>
    );
  }
  if (status.state === 'verifier-missing') {
    return (
      <PageShell maxWidth={480}>
        <View style={styles.header}>
          <ThemedText type="subtitle" style={styles.center}>
            {t('pgTitle')}
          </ThemedText>
        </View>
        <Card>
          <ThemedText type="small">{t('pgVerifierMissing')}</ThemedText>
          <Button tone="soft" label={t('pgBackHome')} onPress={() => router.replace('/')} />
        </Card>
      </PageShell>
    );
  }
  if (status.state === 'none' || status.state === 'pending') return <SetupFlow pending={status.state === 'pending'} />;
  return (
    <ParentGate>
      <ManageHome />
    </ParentGate>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: FAMILY_BACKGROUND },
  header: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.four },
  center: { textAlign: 'center' },
});
