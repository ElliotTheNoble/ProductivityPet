import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, FAMILY_BACKGROUND, PageShell } from '@/components/family-ui';
import { PinEntry, useShortLandscape } from '@/components/pin-entry';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useParentAccess } from '@/hooks/use-parent-access';
import { useSensitiveScreen } from '@/hooks/use-sensitive-screen';
import { useT } from '@/i18n';
import {
  PIN_FORMAT,
  formatRemaining,
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
export function ParentGate({ children }: { children: ReactNode }) {
  const access = useParentAccess();
  const { t } = useT();
  if (access.state === 'checking') return <View style={styles.blank} />; // never shows the content while checking
  if (access.state === 'unprotected') return <>{children}</>;
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
  | { kind: 'unavailable' }
  | null;

export function ParentLockScreen({ access }: { access: ParentAccess }) {
  const { t, tn } = useT();
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [localUntil, setLocalUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [recovering, setRecovering] = useState(false);
  const sideBySide = useShortLandscape();

  // The typed digits are wiped when the app leaves the foreground or the profile changes; the screen also blocks screenshots
  // and the app-switcher preview where the platform allows it.
  const clearPin = useCallback(() => setPin(''), []);
  useSensitiveScreen(clearPin);

  const accessUntil = useMemo(() => (access.state === 'cooldown' ? Date.now() + access.remainingMs : 0), [access]);
  const until = Math.max(accessUntil, localUntil);
  const remaining = until - now;
  const paused = remaining > 0;

  useEffect(() => {
    if (!paused) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);

  async function submit() {
    if (busy || paused) return;
    if (!PIN_FORMAT.test(pin)) {
      setFeedback({ kind: 'format' });
      return;
    }
    setBusy(true);
    setFeedback(null);
    const result = await unlockParentArea(pin);
    setBusy(false);
    setPin('');
    if (result.ok) return; // the gate re-renders with the content
    const at = Date.now();
    setNow(at);
    if (result.reason === 'cooldown') setLocalUntil(at + result.remainingMs);
    else if (result.reason === 'wrong') {
      if (result.cooldownMs > 0) setLocalUntil(at + result.cooldownMs);
      setFeedback({ kind: 'wrong', triesLeft: result.triesLeft });
    } else if (result.reason === 'invalid-format') setFeedback({ kind: 'format' });
    else setFeedback({ kind: 'unavailable' });
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
      <PinEntry label={t('pgPinLabel')} value={pin} onChange={setPin} onSubmit={() => void submit()} disabled={busy || paused}>
        {paused ? (
          <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
            {t('pgCooldown', { time: formatRemaining(remaining) })}
          </ThemedText>
        ) : null}
        {!paused && feedback?.kind === 'wrong' ? (
          <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
            {t('pgWrong')}
            {feedback.triesLeft > 0 ? ` ${tn('pgTriesLeft', feedback.triesLeft)}` : ''}
          </ThemedText>
        ) : null}
        {!paused && feedback?.kind === 'format' ? (
          <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
            {t('pgFormat')}
          </ThemedText>
        ) : null}
        {!paused && feedback?.kind === 'unavailable' ? (
          <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="polite">
            {t('pgUnavailable')}
          </ThemedText>
        ) : null}
        <Button label={busy ? t('pgChecking') : t('pgUnlock')} onPress={() => void submit()} disabled={busy || paused || pin.length < 6} />
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
