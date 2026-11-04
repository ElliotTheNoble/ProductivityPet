import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, Field, FAMILY_BACKGROUND, PageShell } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useParentAccess } from '@/hooks/use-parent-access';
import { useT } from '@/i18n';
import {
  PIN_FORMAT,
  formatRemaining,
  lockParentArea,
  touchParentSession,
  unlockParentArea,
  type ParentAccess,
} from '@/utils/parent-gate';

// Wraps a parent-only screen. The screen's content is only rendered when the parent area is open (or when no PIN exists
// at all, which is how the app has always behaved); otherwise the PIN screen is shown INSTEAD of the content. Because the
// content is simply not rendered, opening the screen by its address (/parent, /welcome) cannot bypass the lock.
export function ParentGate({ children }: { children: ReactNode }) {
  const access = useParentAccess();
  const { t } = useT();
  if (access.state === 'checking') return <View style={styles.blank} />; // never shows the content while checking
  if (access.state === 'unprotected') return <>{children}</>;
  if (access.state === 'unlocked') {
    return (
      <View
        style={styles.fill}
        // Any touch inside the parent area counts as use (keeps it open); it never takes the touch away.
        onStartShouldSetResponderCapture={() => {
          touchParentSession();
          return false;
        }}>
        <View style={styles.bar}>
          <ThemedText type="small">🔓 {t('pgUnlockedBar')}</ThemedText>
          <Button small tone="soft" label={t('pgLockNow')} onPress={lockParentArea} />
        </View>
        {children}
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

  return (
    <PageShell maxWidth={480}>
      <View style={styles.header}>
        <ThemedText style={styles.lockIcon}>🔒</ThemedText>
        <ThemedText type="subtitle" style={styles.center}>
          {t('pgTitle')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {t('pgSubtitle')}
        </ThemedText>
      </View>
      <Card>
        <Field
          label={t('pgPinLabel')}
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 8))}
          placeholder={t('pgPinPlaceholder')}
          secureTextEntry
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={8}
          autoComplete="off"
          autoCorrect={false}
          editable={!busy && !paused}
          onSubmitEditing={() => void submit()}
        />
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
        <Button label={busy ? t('pgChecking') : t('pgUnlock')} onPress={() => void submit()} disabled={busy || paused} />
        <Button tone="soft" label={t('pgBackHome')} onPress={() => router.replace('/')} />
      </Card>
      <Card title={t('pgForgotTitle')}>
        <ThemedText type="small" themeColor="textSecondary">
          {t('pgForgotText')}
        </ThemedText>
      </Card>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {t('pgHonest')}
      </ThemedText>
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
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  header: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.four },
  lockIcon: { fontSize: 40, lineHeight: 48 },
  center: { textAlign: 'center' },
});
