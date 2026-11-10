import { useState } from 'react';

import { Button } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { useT } from '@/i18n';
import { passDeviceCheck, type DeviceCheckResult } from '@/utils/parent-gate';

// Shown after five wrong Parent PINs in a row (there is no waiting period): a button that asks the phone to confirm ITS OWN screen lock
// (PIN, pattern, password, fingerprint or face). When that is confirmed the tries start again; it never opens anything by itself. See
// passDeviceCheck in @/utils/parent-gate.ts. `onPassed` is called only after a successful check. A phone with no screen lock gets a message
// that PIN tries are stopped and the recovery code is the way on (no waiting period, no free tries).
export function DeviceCheckPanel({ onPassed }: { onPassed?: () => void }) {
  const { t } = useT();
  const [state, setState] = useState<'idle' | 'checking' | Exclude<DeviceCheckResult, 'passed'>>('idle');
  const run = async () => {
    setState('checking');
    const result = await passDeviceCheck(t('pgDeviceCheckPrompt'), t('pgDeviceCheckCancel'));
    if (result === 'passed') {
      setState('idle');
      onPassed?.();
      return;
    }
    setState(result);
  };
  const note =
    state === 'cancelled'
      ? t('pgDeviceCheckCancelled')
      : state === 'failed'
        ? t('pgDeviceCheckFailed')
        : state === 'unavailable'
          ? t('pgDeviceCheckUnavailable')
          : state === 'no-device-lock'
            ? t('pgDeviceCheckNoLock')
            : null;
  return (
    <>
      {note ? (
        <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
          {note}
        </ThemedText>
      ) : null}
      <Button label={state === 'checking' ? t('pgChecking') : t('pgDeviceCheckButton')} onPress={() => void run()} disabled={state === 'checking'} />
    </>
  );
}
