import { useRouter } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { DeviceCheckPanel } from '@/components/device-check-panel';
import { Button, Card, FAMILY_BACKGROUND, PageShell } from '@/components/family-ui';
import { PinEntry, useShortLandscape } from '@/components/pin-entry';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useParentAccess } from '@/hooks/use-parent-access';
import { getHouseholdIntegrity, hasAnyChildRecord, useHousehold } from '@/utils/household';
import { PIN_MIN_LENGTH } from '@/utils/pin-crypto';
import { useSensitiveScreen } from '@/hooks/use-sensitive-screen';
import { useT } from '@/i18n';
import {
  PIN_FORMAT,
  hasPinVerifier,
  lockParentArea,
  touchParentSession,
  unlockParentArea,
  type ParentAccess,
} from '@/utils/parent-gate';

// Wraps a parent-only screen. The screen's content is only rendered when the parent area is open (or when no PIN exists at
// all, which is how the app has always behaved); otherwise the PIN screen is shown INSTEAD of the content. Because the
// content is simply not rendered, opening the screen by its address (/parent, /welcome, /parent-security) cannot bypass the
// lock. When the area is open but the recovery code has not been confirmed, the "confirm your recovery code" step is shown
// first (see parent-recovery-gate.tsx).
// Family mode, no Parent PIN yet. A household with NO child record is where the first set-up happens, so it stays open. A household that
// already has children (or whose family list cannot be read) fails closed: the parent-only screen is NOT shown, and the only way
// forward is the protected setup (the device security check first, see @/components/parent-setup-claim.tsx). Never blank-then-open:
// nothing is shown until the household has been read.
function UnprotectedGate({ children }: { children: ReactNode }) {
  const household = useHousehold();
  if (!household) return <View style={styles.blank} />;
  if (!hasAnyChildRecord(household, getHouseholdIntegrity())) return <>{children}</>;
  const { ParentSetupClaim } = require('@/components/parent-setup-claim') as typeof import('@/components/parent-setup-claim');
  return <ParentSetupClaim />;
}

export function ParentGate({ children }: { children: ReactNode }) {
  const access = useParentAccess();
  const { t } = useT();
  if (access.state === 'checking') return <View style={styles.blank} />; // never shows the content while checking
  if (access.state === 'unprotected') {
    // Family mode off (no PIN checker at all): open exactly as it always was. Family mode on: see UnprotectedGate.
    return hasPinVerifier() ? <UnprotectedGate>{children}</UnprotectedGate> : <>{children}</>;
  }
  if (access.state === 'unlocked') {
    // Loaded only when a PIN checker exists (family mode on), so with family mode off nothing extra is even loaded.
    const guarded = hasPinVerifier()
      ? (() => {
          const { RecoveryGate } = require('@/components/parent-recovery-gate') as typeof import('@/components/parent-recovery-gate');
          return <RecoveryGate>{children}</RecoveryGate>;
        })()
      : children;
    return (
      <View
        style={styles.fill}
        // Any touch inside the parent area counts as use (keeps it open); it never takes the touch away.
        onStartShouldSetResponderCapture={() => {
          touchParentSession();
          return false;
        }}>
        <View style={styles.bar}>
          <ThemedText type="small" style={styles.barText}>
            🔓 {t('pgUnlockedBar')}
          </ThemedText>
          <Button tone="soft" label={t('pgLockNow')} onPress={lockParentArea} />
        </View>
        {guarded}
      </View>
    );
  }
  return <ParentLockScreen access={access} />;
}

type Feedback =
  | { kind: 'wrong'; triesLeft: number }
  | { kind: 'format' }
  | { kind: 'unavailable'; detail?: string }
  | { kind: 'device-check' }
  | null;

export function ParentLockScreen({ access }: { access: ParentAccess }) {
  const { t, tn } = useT();
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [recovering, setRecovering] = useState(false);
  const sideBySide = useShortLandscape();

  // The typed digits are wiped when the app leaves the foreground or the profile changes. Screenshots are NOT blocked here: this
  // screen shows only dots, never a digit, so a picture of it reveals nothing (recovery-code screens do block, see Frame).
  const clearPin = useCallback(() => setPin(''), []);
  useSensitiveScreen(clearPin, 'parent-pin', { blockCapture: false });

  // Five wrong PINs in a row (kept across restarts): the phone's screen-lock check is needed before more tries. No waiting period.
  const needsDeviceCheck = (access.state === 'locked' && access.deviceCheck === true) || feedback?.kind === 'device-check';

  async function submit() {
    if (busy || needsDeviceCheck) return;
    if (!PIN_FORMAT.test(pin)) {
      setFeedback({ kind: 'format' });
      return;
    }
    // The dots clear at once and the button says "Checking…": the key derivation behind a check can take a moment on a phone, and the
    // screen must answer the tap immediately instead of looking frozen with the old digits still showing.
    const attempt = pin;
    setPin('');
    setBusy(true);
    setFeedback(null);
    const result = await unlockParentArea(attempt);
    setBusy(false);
    if (result.ok) return; // the gate re-renders with the content
    if (result.reason === 'wrong') setFeedback({ kind: 'wrong', triesLeft: result.triesLeft });
    else if (result.reason === 'device-check') setFeedback({ kind: 'device-check' });
    else if (result.reason === 'invalid-format') setFeedback({ kind: 'format' });
    else setFeedback({ kind: 'unavailable', detail: result.reason === 'unavailable' ? result.detail : undefined });
  }

  if (access.state === 'locked' && access.reason === 'verifier-missing') {
    // A PIN should exist but its record is gone or damaged: nothing can be entered, nothing is reset or created here.
    return (
      <PageShell maxWidth={480}>
        <View style={styles.header}>
          <ThemedText style={styles.lockIcon}>🔒</ThemedText>
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

  if (recovering) {
    // Loaded only when it is used (it brings in the PIN module).
    const { RecoveryFlow } = require('@/components/parent-pin-flows') as typeof import('@/components/parent-pin-flows');
    return <RecoveryFlow onBack={() => setRecovering(false)} />;
  }

  const heading = (
    <View style={[styles.header, sideBySide && styles.headerSide]}>
      <ThemedText style={styles.lockIcon}>🔒</ThemedText>
      <ThemedText type="subtitle" accessibilityRole="header" style={styles.center}>
        {t('pgTitle')}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {t('pgSubtitle')}
      </ThemedText>
    </View>
  );
  const pinCard = (
    <Card>
      <PinEntry label={t('pgPinLabel')} value={pin} onChange={setPin} onSubmit={() => void submit()} disabled={busy || needsDeviceCheck}>
        {needsDeviceCheck ? (
          <>
            <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
              {t('pgDeviceCheck')}
            </ThemedText>
            <DeviceCheckPanel onPassed={() => setFeedback(null)} />
          </>
        ) : null}
        {!needsDeviceCheck && feedback?.kind === 'wrong' ? (
          <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
            {t('pgWrong')}
            {feedback.triesLeft > 0 ? ` ${tn('pgTriesLeft', feedback.triesLeft)}` : ''}
          </ThemedText>
        ) : null}
        {feedback?.kind === 'format' ? (
          <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
            {t('pgFormat')}
          </ThemedText>
        ) : null}
        {feedback?.kind === 'unavailable' ? (
          <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
            {t('pgUnavailable')}
          </ThemedText>
        ) : null}
        <Button label={busy ? t('pgChecking') : t('pgUnlock')} onPress={() => void submit()} disabled={busy || needsDeviceCheck || pin.length < PIN_MIN_LENGTH} />
        <Button tone="soft" label={t('pgBackHome')} onPress={() => router.replace('/')} />
      </PinEntry>
    </Card>
  );
  const forgotCard = (
    <Card title={t('pgForgotTitle')}>
      <ThemedText type="small" themeColor="textSecondary">
        {t('pgForgotText')}
      </ThemedText>
      <Button tone="mint" label={t('prStart')} onPress={() => setRecovering(true)} />
    </Card>
  );
  const honest = (
    <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
      {t('pgHonest')}
    </ThemedText>
  );

  // Short landscape: the PIN card (pad and Unlock button) is on the right, so it fits without scrolling; the heading, the
  // forgotten-PIN help and the honesty note are on the left.
  if (sideBySide) {
    return (
      <PageShell maxWidth={960} compact>
        <View style={styles.sideBySide}>
          <View style={styles.sideLeft}>
            {heading}
            {forgotCard}
            {honest}
          </View>
          <View style={styles.sideRight}>{pinCard}</View>
        </View>
      </PageShell>
    );
  }
  return (
    <PageShell maxWidth={480}>
      {heading}
      {pinCard}
      {forgotCard}
      {honest}
    </PageShell>
  );
}

const styles = StyleSheet.create({
  blank: { flex: 1, backgroundColor: FAMILY_BACKGROUND },
  fill: { flex: 1, backgroundColor: FAMILY_BACKGROUND },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap', // a larger text size or a longer translation moves "Lock now" to its own line instead of off the screen
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  barText: { flexShrink: 1 },
  header: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.four },
  headerSide: { paddingTop: Spacing.one },
  sideBySide: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  sideLeft: { flex: 2, minWidth: 0, gap: Spacing.two },
  sideRight: { flex: 3, minWidth: 0 },
  lockIcon: { fontSize: 40, lineHeight: 48 },
  center: { textAlign: 'center' },
});
