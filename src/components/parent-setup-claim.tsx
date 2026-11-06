import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button, Card, FAMILY_BACKGROUND, PageShell } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useParentAuthStatus } from '@/hooks/use-parent-auth-status';
import { useT, type StringKey } from '@/i18n';
import { authenticateDevice, type DeviceAuthFailure } from '@/utils/device-auth';
import { clearSetupClaim, grantSetupClaim, useSetupClaim } from '@/utils/family-claim';

// The protected first-time Parent PIN setup for a household that already has children but no Parent PIN (BUG-077 / BUG-080). Instead of
// the dashboard, or the open setup screen, this is what such a household sees: the operating system's own device security check first, and
// only after it really succeeded the EXISTING setup (PIN, recovery code, confirmation: unchanged).
//
// It says plainly what the check proves: that someone can unlock this device, not who that person is. It is offered only while no PIN
// exists. An existing PIN (or one that cannot be found, read or confirmed) is never replaced, reset or bypassed through here, and a
// successful device check opens nothing: it only allows the setup to start (see @/utils/family-claim.ts).
//
// The claim ends when this screen is left, so the browser history or the back button cannot return to a half-open setup.

const FAILURE_TEXT: Record<DeviceAuthFailure, StringKey> = {
  'not-secured': 'pkNotSecured',
  cancelled: 'pkCancelled',
  failed: 'pkFailed',
  lockout: 'pkLockout',
  unavailable: 'pkUnavailable',
  unsupported: 'pkUnsupported',
};

export function ParentSetupClaim({ onLeave, onFinished }: { onLeave?: () => void; onFinished?: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const status = useParentAuthStatus();
  const claimed = useSetupClaim();
  const [checking, setChecking] = useState(false);
  // Once the setup has started on this screen it stays (starting it spends the claim, which must not swap the screen away from the
  // recovery code just shown). Leaving the screen ends it: coming back asks for the device check again.
  const [started, setStarted] = useState(false);
  // In a browser there is no native device check and none is simulated: said up front, nothing to press.
  const [failure, setFailure] = useState<DeviceAuthFailure | null>(Platform.OS === 'web' ? 'unsupported' : null);
  const mounted = useRef(true);
  const leave = onLeave ?? (() => router.replace('/'));

  useEffect(() => {
    if (claimed) setStarted(true);
  }, [claimed]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearSetupClaim(); // leaving the screen ends the claim: the setup cannot be resumed from the history
    };
  }, []);

  if (status.loading) return <View style={styles.blank} />;

  // No PIN to set up here: no secure storage on this device. Nothing can be created, nothing is offered.
  if (status.state === 'unsupported' || status.state === 'off') {
    return (
      <PageShell maxWidth={480}>
        <Card>
          <ThemedText type="subtitle" style={styles.center}>
            {t('puTitle')}
          </ThemedText>
          <ThemedText type="small">{t('puBody')}</ThemedText>
          <Button tone="soft" label={t('pkBack')} onPress={leave} />
        </Card>
      </PageShell>
    );
  }

  // Only a household with NO PIN at all (or an unfinished setup, which protects nothing) is ever offered a first setup. A PIN that
  // exists, is unconfirmed or cannot be found is not this screen's business: the Parent Gate shows the right screen for it.
  if (status.state !== 'none' && status.state !== 'pending') return <View style={styles.blank} />;

  if (claimed || started) {
    const { SetupFlow } = require('@/components/parent-pin-flows') as typeof import('@/components/parent-pin-flows');
    return <SetupFlow pending={status.state === 'pending'} onLeave={leave} onFinished={onFinished} />;
  }

  const check = async () => {
    if (checking) return;
    setChecking(true);
    setFailure(null);
    const result = await authenticateDevice(t('pkPrompt'), t('pkCancelLabel'));
    // A success is only believed when the claim itself can be granted (family mode, a phone or tablet, and still no PIN).
    const granted = result.ok ? await grantSetupClaim() : false;
    if (!mounted.current) return;
    setChecking(false);
    if (!result.ok) setFailure(result.reason);
    else if (!granted) setFailure('unavailable');
  };

  return (
    <PageShell maxWidth={480}>
      <View style={styles.header}>
        <ThemedText style={styles.icon}>🔐</ThemedText>
        <ThemedText type="subtitle" accessibilityRole="header" style={styles.center}>
          {t('pkTitle')}
        </ThemedText>
      </View>
      <Card>
        <ThemedText type="small">{t('pkWhy')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('pkHonest')}
        </ThemedText>
        {failure ? (
          <ThemedText type="small" themeColor="accent" accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {t(FAILURE_TEXT[failure])}
          </ThemedText>
        ) : null}
        {checking ? (
          <ThemedText type="small" accessibilityLiveRegion="polite">
            {t('pkChecking')}
          </ThemedText>
        ) : null}
        <Button label={t('pkCheck')} onPress={() => void check()} disabled={checking || failure === 'unsupported'} />
        <Button tone="soft" label={t('pkBack')} onPress={leave} />
      </Card>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: FAMILY_BACKGROUND },
  header: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.four },
  icon: { fontSize: 40, lineHeight: 48 },
  center: { textAlign: 'center' },
});
