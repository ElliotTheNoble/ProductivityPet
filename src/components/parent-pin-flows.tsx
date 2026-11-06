import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import { Button, Card, PageShell } from '@/components/family-ui';
import { ConfirmModal } from '@/components/confirm-modal';
import { PinEntry, useShortLandscape } from '@/components/pin-entry';
import { RecoveryCodeDisplay, RecoveryCodeField } from '@/components/recovery-code';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useSensitiveScreen, type PrivacyCapabilities } from '@/hooks/use-sensitive-screen';
import { useT, type Params, type StringKey } from '@/i18n';
import { isDevAuthPreview } from '@/utils/parent-auth-backend';
import { formatRemaining, lockParentArea } from '@/utils/parent-gate';
import {
  beginPinSetup,
  changePin,
  confirmPinSetup,
  confirmRecoveryCode,
  recoverWithCode,
  regenerateRecoveryCode,
} from '@/utils/parent-pin';
import { normalizeRecoveryCode, validateNewPin } from '@/utils/pin-crypto';

// The Parent PIN screens. Every flow here only calls the existing authentication APIs (@/utils/parent-pin.ts and
// parent-gate.ts); there is no second authentication system. State that holds a PIN or a recovery code lives ONLY in React
// state: it is never stored, never put in a route or URL, never logged, and every flow wipes it (and hides any code) when the
// app leaves the foreground, the active profile changes, or the screen closes.
//
// This is a temporary access barrier. Nothing on these screens may say the PIN is secure or proves who is using the app.

type Ctx = 'pin' | 'code' | 'both';
type Failure = { ok: false; reason: string; remainingMs?: number; triesLeft?: number; cooldownMs?: number };

// ---------------------------------------------------------------------------------------------------------
// shared pieces

function usePause() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const remaining = until - now;
  const paused = remaining > 0;
  useEffect(() => {
    if (!paused) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [paused]);
  return {
    paused,
    remaining,
    start: (ms: number) => {
      const at = Date.now();
      setNow(at);
      setUntil(at + ms);
    },
  };
}

// Failure feedback: the result is kept (not the words), so the message follows a language change. A pause, whether it was
// reported by an attempt or entered by a wrong guess, disables the actions until it ends.
function useFeedback() {
  const { t, tn } = useT();
  const pause = usePause();
  const [shown, setShown] = useState<{ result: Failure; ctx: Ctx } | null>(null);
  const show = (result: Failure, ctx: Ctx) => {
    if (result.reason === 'cooldown' && result.remainingMs) pause.start(result.remainingMs);
    else if (result.reason === 'wrong' && result.cooldownMs) pause.start(result.cooldownMs);
    setShown({ result, ctx });
  };
  const text = (): string | null => {
    if (pause.paused) return t('pgCooldown', { time: formatRemaining(pause.remaining) });
    if (!shown) return null;
    const { result, ctx } = shown;
    const key = (k: StringKey, p?: Params) => t(k, p);
    switch (result.reason) {
      case 'wrong': {
        const base = ctx === 'pin' ? key('pgWrong') : ctx === 'code' ? key('peCodeWrong') : key('peMismatchBoth');
        return result.triesLeft ? `${base} ${tn('pgTriesLeft', result.triesLeft)}` : base;
      }
      case 'cooldown':
        return key('pgCooldown', { time: formatRemaining(result.remainingMs ?? 0) });
      case 'format':
        return key('pePinFormat');
      case 'weak':
        return key('pePinWeak');
      case 'mismatch':
        return key('pePinMismatch');
      case 'invalid-code':
        return key('peCodeFormat');
      case 'unsupported':
        return key('peUnsupported');
      case 'claim-required':
        return key('pkClaimRequired');
      case 'already-configured':
        return key('peAlreadyOn');
      case 'verifier-missing':
        return key('pgVerifierMissing');
      case 'not-pending':
        return key('peNotPending');
      default:
        return key('peUnavailable');
    }
  };
  return { paused: pause.paused, text, show, clear: () => setShown(null) };
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <ThemedText type="small" themeColor="accent" accessibilityLiveRegion="assertive" accessibilityRole="alert">
      {text}
    </ThemedText>
  );
}

// The Android back button during a sensitive step asks before leaving.
function useBackGuard(active: boolean, onAttempt: () => void) {
  const ref = useRef({ active, onAttempt });
  ref.current = { active, onAttempt };
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!ref.current.active) return false;
      ref.current.onAttempt();
      return true;
    });
    return () => sub?.remove();
  }, []);
}

// A page: title, explanation, content. On a short landscape screen the words go beside the content instead of above it.
function Frame({
  title,
  body,
  onClear,
  children,
}: {
  title: string;
  body?: string;
  onClear: () => void;
  children: ReactNode | ((caps: PrivacyCapabilities | null) => ReactNode);
}) {
  const { t } = useT();
  const caps = useSensitiveScreen(onClear);
  const sideBySide = useShortLandscape();
  const banner = isDevAuthPreview() ? (
    <View accessibilityRole="alert" style={styles.banner}>
      <ThemedText type="smallBold">{t('ppBanner')}</ThemedText>
    </View>
  ) : null;
  const content = typeof children === 'function' ? children(caps) : children;
  const heading = (
    <View style={styles.heading}>
      <ThemedText type="subtitle" accessibilityRole="header" style={styles.center}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {body}
        </ThemedText>
      ) : null}
    </View>
  );
  return (
    <PageShell maxWidth={sideBySide ? 960 : 520} scrollKey={title} compact={sideBySide}>
      {sideBySide ? (
        <View style={styles.sideBySide}>
          <View style={styles.sideLeft}>
            {banner}
            {heading}
          </View>
          <View style={styles.sideRight}>{content}</View>
        </View>
      ) : (
        <>
          {banner}
          {heading}
          {content}
        </>
      )}
    </PageShell>
  );
}

function LeaveDialog({ visible, onStay, onLeave }: { visible: boolean; onStay: () => void; onLeave: () => void }) {
  const { t } = useT();
  return (
    <ConfirmModal visible={visible} title={t('psLeaveTitle')} confirmLabel={t('psLeave')} onConfirm={onLeave} onCancel={onStay}>
      <ThemedText type="small">{t('psLeaveBody')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('psLeaveStay')}
      </ThemedText>
    </ConfirmModal>
  );
}

function CodeNotes({ caps }: { caps: PrivacyCapabilities | null }) {
  const { t } = useT();
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        {t('psCodeNoShot')}
      </ThemedText>
      {caps && !caps.blocksCapture ? (
        <ThemedText type="small" themeColor="accent">
          {t('psCodeCaptureOff')}
        </ThemedText>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// first setup: intro -> choose PIN -> again -> show recovery code -> type PIN + code -> parent area opens

type SetupStage = 'intro' | 'resume' | 'create' | 'again' | 'code' | 'finish';

// `onLeave` / `onFinished` say where to go when the setup is left or finished (the default is the parent dashboard, which is what the
// /parent-security route wants); the family picker, which is not inside the app's navigation, passes its own.
export function SetupFlow({ pending, onLeave, onFinished }: { pending: boolean; onLeave?: () => void; onFinished?: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const feedback = useFeedback();
  const [stage, setStage] = useState<SetupStage>(pending ? 'resume' : 'intro');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [code, setCode] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [typedPin, setTypedPin] = useState('');
  const [typedCode, setTypedCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const began = useRef(pending);

  // Wipes everything typed or shown. A code that is gone cannot be shown again, so an unfinished setup resumes from the
  // "setup wasn't finished" step (the parent who saved the code can still finish; otherwise they start over).
  const clearAll = useCallback(() => {
    setPin('');
    setAgain('');
    setCode('');
    setRevealed(false);
    setTypedPin('');
    setTypedCode('');
    feedback.clear();
    setStage(began.current ? 'resume' : 'intro');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sensitive = stage === 'code' || stage === 'finish';
  useBackGuard(sensitive, () => setLeaving(true));
  const leave = () => (onLeave ? onLeave() : router.replace('/parent'));
  const cancel = () => (sensitive ? setLeaving(true) : leave());

  const next = () => {
    const policy = validateNewPin(pin);
    if (!policy.ok) return feedback.show({ ok: false, reason: policy.reason }, 'pin');
    feedback.clear();
    setStage('again');
  };

  const begin = async () => {
    if (again !== pin) {
      setAgain('');
      return feedback.show({ ok: false, reason: 'mismatch' }, 'pin');
    }
    setBusy(true);
    const result = await beginPinSetup(pin);
    setBusy(false);
    setPin('');
    setAgain('');
    if (!result.ok) {
      setStage('create');
      return feedback.show(result, 'pin');
    }
    began.current = true;
    feedback.clear();
    setCode(result.recoveryCode);
    setRevealed(false);
    setStage('code');
  };

  const finish = async () => {
    setBusy(true);
    const result = await confirmPinSetup(typedPin, typedCode);
    setBusy(false);
    if (result.ok) {
      clearAll();
      began.current = false;
      if (onFinished) onFinished();
      else router.replace('/parent'); // the parent area is open (the first setup opens it)
      return;
    }
    setTypedPin('');
    feedback.show(result, 'both');
  };

  let body: ReactNode = null;
  let title = t('psIntroTitle');
  let blurb: string | undefined;
  if (stage === 'intro') {
    blurb = t('psIntroBody');
    body = (
      <Card>
        <ThemedText type="smallBold">{t('psIntroSelf')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('psIntroSteps')}
        </ThemedText>
        <Button label={t('psContinue')} onPress={() => setStage('create')} />
        <Button tone="soft" label={t('psCancel')} onPress={leave} />
      </Card>
    );
  } else if (stage === 'resume') {
    title = t('psResumeTitle');
    blurb = t('psResumeBody');
    body = (
      <Card>
        <Button label={t('psResumeSaved')} onPress={() => setStage('finish')} />
        <Button tone="soft" label={t('psResumeStart')} onPress={() => setStage('create')} />
        <Button tone="soft" label={t('psCancel')} onPress={leave} />
      </Card>
    );
  } else if (stage === 'create') {
    title = t('psCreateTitle');
    blurb = t('psCreateBody');
    body = (
      <Card>
        <PinEntry label={t('pgPinLabel')} value={pin} onChange={setPin} onSubmit={next}>
          <ErrorLine text={feedback.text()} />
          <Button label={t('psNext')} onPress={next} disabled={pin.length < 6} />
          <Button tone="soft" label={t('psCancel')} onPress={leave} />
        </PinEntry>
      </Card>
    );
  } else if (stage === 'again') {
    title = t('psConfirmTitle');
    blurb = t('psConfirmBody');
    body = (
      <Card>
        <PinEntry label={t('pgPinLabel')} value={again} onChange={setAgain} onSubmit={() => void begin()} disabled={busy}>
          <ErrorLine text={feedback.text()} />
          <Button label={t('psNext')} onPress={() => void begin()} disabled={busy || again.length < 6} />
          <Button
            tone="soft"
            label={t('psBack')}
            onPress={() => {
              setAgain('');
              feedback.clear();
              setStage('create');
            }}
          />
        </PinEntry>
      </Card>
    );
  } else if (stage === 'code') {
    title = t('psCodeTitle');
    blurb = t('psCodeBody');
  } else {
    title = t('psFinishTitle');
    blurb = t('psFinishBody');
    body = (
      <Card>
        <PinEntry label={t('pgPinLabel')} value={typedPin} onChange={setTypedPin} disabled={busy || feedback.paused}>
          <RecoveryCodeField value={typedCode} onChange={setTypedCode} onSubmit={() => void finish()} disabled={busy} />
          <ErrorLine text={feedback.text()} />
          <Button label={t('psFinish')} onPress={() => void finish()} disabled={busy || typedPin.length < 6 || typedCode.length < 29} />
          {code ? <Button tone="soft" label={t('psBack')} onPress={() => setStage('code')} /> : null}
          <Button tone="soft" label={t('psCancel')} onPress={cancel} />
        </PinEntry>
      </Card>
    );
  }

  return (
    <>
      <Frame title={title} body={blurb} onClear={clearAll}>
        {(caps) =>
          stage === 'code' ? (
            <Card>
              <RecoveryCodeDisplay code={code} revealed={revealed} onReveal={() => setRevealed(true)} onHide={() => setRevealed(false)} />
              <CodeNotes caps={caps} />
              <Button label={t('psCodeSaved')} onPress={() => { setRevealed(false); setStage('finish'); }} />
              <Button tone="soft" label={t('psCancel')} onPress={cancel} />
            </Card>
          ) : (
            body
          )
        }
      </Frame>
      <LeaveDialog visible={leaving} onStay={() => setLeaving(false)} onLeave={() => { setLeaving(false); clearAll(); leave(); }} />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// typing back a recovery code that has been shown (or kept from earlier) so it is confirmed

export function ConfirmCodeFlow({ title, body, onDone, onBack }: { title: string; body: string; onDone: () => void; onBack?: () => void }) {
  const { t } = useT();
  const feedback = useFeedback();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const clear = useCallback(() => setTyped(''), []);
  const submit = async () => {
    if (!normalizeRecoveryCode(typed)) return feedback.show({ ok: false, reason: 'invalid-code' }, 'code');
    setBusy(true);
    const result = await confirmRecoveryCode(typed);
    setBusy(false);
    setTyped('');
    if (result.ok) return onDone();
    feedback.show(result, 'code');
  };
  return (
    <Frame title={title} body={body} onClear={clear}>
      <Card>
        <RecoveryCodeField value={typed} onChange={setTyped} onSubmit={() => void submit()} disabled={busy || feedback.paused} />
        <ErrorLine text={feedback.text()} />
        <Button label={t('psFinish')} onPress={() => void submit()} disabled={busy || feedback.paused || typed.length < 29} />
        {onBack ? <Button tone="soft" label={t('psBack')} onPress={onBack} /> : null}
      </Card>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------------------
// a replacement recovery code: PIN -> new code shown -> typed back. Never exposes any older code.

export function ReplacementCodeFlow({
  pinTitle,
  pinBody,
  confirmTitle,
  confirmBody,
  onDone,
  onCancel,
}: {
  pinTitle: string;
  pinBody: string;
  confirmTitle: string;
  confirmBody: string;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const { t } = useT();
  const feedback = useFeedback();
  const [stage, setStage] = useState<'pin' | 'show' | 'confirm'>('pin');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const clearAll = useCallback(() => {
    setPin('');
    setCode('');
    setRevealed(false);
    setStage('pin');
    feedback.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useBackGuard(stage !== 'pin', () => setLeaving(true));

  const issue = async () => {
    setBusy(true);
    const result = await regenerateRecoveryCode(pin);
    setBusy(false);
    setPin('');
    if (!result.ok) return feedback.show(result, 'pin');
    feedback.clear();
    setCode(result.recoveryCode);
    setRevealed(false);
    setStage('show');
  };

  if (stage === 'confirm') {
    return (
      <ConfirmCodeFlow
        title={confirmTitle}
        body={confirmBody}
        onDone={() => {
          clearAll();
          onDone();
        }}
        onBack={code ? () => setStage('show') : undefined}
      />
    );
  }
  return (
    <>
      <Frame title={stage === 'pin' ? pinTitle : t('psCodeTitle')} body={stage === 'pin' ? pinBody : t('psCodeBody')} onClear={clearAll}>
        {(caps) =>
          stage === 'pin' ? (
            <Card>
              <PinEntry label={t('pgPinLabel')} value={pin} onChange={setPin} onSubmit={() => void issue()} disabled={busy || feedback.paused}>
                <ErrorLine text={feedback.text()} />
                <Button label={t('psNext')} onPress={() => void issue()} disabled={busy || feedback.paused || pin.length < 6} />
                {onCancel ? <Button tone="soft" label={t('psCancel')} onPress={onCancel} /> : null}
              </PinEntry>
            </Card>
          ) : (
            <Card>
              <RecoveryCodeDisplay code={code} revealed={revealed} onReveal={() => setRevealed(true)} onHide={() => setRevealed(false)} />
              <CodeNotes caps={caps} />
              <Button label={t('psCodeSaved')} onPress={() => { setRevealed(false); setStage('confirm'); }} />
            </Card>
          )
        }
      </Frame>
      <LeaveDialog
        visible={leaving}
        onStay={() => setLeaving(false)}
        onLeave={() => {
          setLeaving(false);
          clearAll();
          onCancel?.();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// change the PIN: current -> new -> again

export function ChangePinFlow({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useT();
  const feedback = useFeedback();
  const [stage, setStage] = useState<'current' | 'new' | 'again' | 'done'>('current');
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const clearAll = useCallback(() => {
    setCurrent('');
    setFresh('');
    setAgain('');
    setStage('current');
    feedback.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toAgain = () => {
    const policy = validateNewPin(fresh);
    if (!policy.ok) return feedback.show({ ok: false, reason: policy.reason }, 'pin');
    feedback.clear();
    setStage('again');
  };
  const save = async () => {
    if (again !== fresh) {
      setAgain('');
      return feedback.show({ ok: false, reason: 'mismatch' }, 'pin');
    }
    setBusy(true);
    const result = await changePin(current, fresh);
    setBusy(false);
    setCurrent('');
    setFresh('');
    setAgain('');
    if (result.ok) {
      feedback.clear();
      return setStage('done');
    }
    setStage('current');
    feedback.show(result, 'pin');
  };

  const cancelButton = <Button tone="soft" label={t('psCancel')} onPress={onCancel} />;
  const title = stage === 'current' ? t('pmCurrentPin') : stage === 'new' ? t('pmNewPin') : stage === 'again' ? t('pmNewPinAgain') : t('pmChanged');
  return (
    <Frame title={title} onClear={clearAll}>
      <Card>
        {stage === 'current' ? (
          <PinEntry label={t('pgPinLabel')} value={current} onChange={setCurrent} onSubmit={() => current.length >= 6 && setStage('new')} disabled={feedback.paused}>
            <ErrorLine text={feedback.text()} />
            <Button label={t('psNext')} onPress={() => { feedback.clear(); setStage('new'); }} disabled={feedback.paused || current.length < 6} />
            {cancelButton}
          </PinEntry>
        ) : null}
        {stage === 'new' ? (
          <PinEntry label={t('pgPinLabel')} value={fresh} onChange={setFresh} onSubmit={toAgain}>
            <ErrorLine text={feedback.text()} />
            <Button label={t('psNext')} onPress={toAgain} disabled={fresh.length < 6} />
            {cancelButton}
          </PinEntry>
        ) : null}
        {stage === 'again' ? (
          <PinEntry label={t('pgPinLabel')} value={again} onChange={setAgain} onSubmit={() => void save()} disabled={busy}>
            <ErrorLine text={feedback.text()} />
            <Button label={t('psFinish')} onPress={() => void save()} disabled={busy || again.length < 6} />
            {cancelButton}
          </PinEntry>
        ) : null}
        {stage === 'done' ? <Button label={t('pmDone')} onPress={onDone} /> : null}
      </Card>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------------------
// forgotten PIN, from the lock screen: recovery code -> new PIN -> new code shown -> typed back -> back to unlock.
// It NEVER opens the parent area: the parent unlocks with the new PIN afterwards.

type RecoveryStage = 'code' | 'newpin' | 'again' | 'show' | 'confirm' | 'done';

export function RecoveryFlow({ onBack }: { onBack: () => void }) {
  const { t } = useT();
  const feedback = useFeedback();
  const [stage, setStage] = useState<RecoveryStage>('code');
  const [typedCode, setTypedCode] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [newCode, setNewCode] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const recovered = useRef(false);

  // After the recovery has happened the old code is already dead, so wiping the screen cannot go back to the first step:
  // the next unlock (with the new PIN) leads to the "confirm your recovery code" step (see parent-recovery-gate.tsx).
  const clearAll = useCallback(() => {
    setTypedCode('');
    setPin('');
    setAgain('');
    setNewCode('');
    setRevealed(false);
    feedback.clear();
    setStage(recovered.current ? 'done' : 'code');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useBackGuard(stage === 'show' || stage === 'confirm', () => setLeaving(true));

  const toNewPin = () => {
    if (!normalizeRecoveryCode(typedCode)) return feedback.show({ ok: false, reason: 'invalid-code' }, 'code');
    feedback.clear();
    setStage('newpin');
  };
  const toAgain = () => {
    const policy = validateNewPin(pin);
    if (!policy.ok) return feedback.show({ ok: false, reason: policy.reason }, 'pin');
    feedback.clear();
    setStage('again');
  };
  const recover = async () => {
    if (again !== pin) {
      setAgain('');
      return feedback.show({ ok: false, reason: 'mismatch' }, 'pin');
    }
    setBusy(true);
    const result = await recoverWithCode(typedCode, pin);
    setBusy(false);
    setPin('');
    setAgain('');
    if (!result.ok) {
      setStage('code');
      return feedback.show(result, 'code');
    }
    recovered.current = true;
    feedback.clear();
    setTypedCode('');
    setNewCode(result.recoveryCode);
    setRevealed(false);
    setStage('show');
  };

  if (stage === 'confirm') {
    return (
      <ConfirmCodeFlow
        title={t('prConfirmTitle')}
        body={t('pmConfirmCodeBody')}
        onDone={() => {
          setNewCode('');
          setStage('done');
        }}
        onBack={newCode ? () => setStage('show') : undefined}
      />
    );
  }

  let title = t('prTitle');
  let blurb: string | undefined = t('prBody');
  let content: ReactNode;
  if (stage === 'code') {
    content = (
      <Card>
        <RecoveryCodeField value={typedCode} onChange={setTypedCode} onSubmit={toNewPin} disabled={feedback.paused} />
        <ErrorLine text={feedback.text()} />
        <Button label={t('psNext')} onPress={toNewPin} disabled={feedback.paused || typedCode.length < 29} />
        <Button tone="soft" label={t('prBackToPin')} onPress={onBack} />
      </Card>
    );
  } else if (stage === 'newpin') {
    title = t('prNewPinTitle');
    blurb = t('psCreateBody');
    content = (
      <Card>
        <PinEntry label={t('pgPinLabel')} value={pin} onChange={setPin} onSubmit={toAgain}>
          <ErrorLine text={feedback.text()} />
          <Button label={t('psNext')} onPress={toAgain} disabled={pin.length < 6} />
          <Button tone="soft" label={t('psBack')} onPress={() => { feedback.clear(); setStage('code'); }} />
        </PinEntry>
      </Card>
    );
  } else if (stage === 'again') {
    title = t('psConfirmTitle');
    blurb = t('psConfirmBody');
    content = (
      <Card>
        <PinEntry label={t('pgPinLabel')} value={again} onChange={setAgain} onSubmit={() => void recover()} disabled={busy}>
          <ErrorLine text={feedback.text()} />
          <Button label={t('psNext')} onPress={() => void recover()} disabled={busy || again.length < 6} />
        </PinEntry>
      </Card>
    );
  } else if (stage === 'done') {
    title = t('prDoneTitle');
    blurb = t('prDoneBody');
    content = (
      <Card>
        <Button label={t('prToUnlock')} onPress={onBack} />
      </Card>
    );
  } else {
    title = t('prNewCodeTitle');
    blurb = t('prNewCodeBody');
    content = null;
  }

  return (
    <>
      <Frame title={title} body={blurb} onClear={clearAll}>
        {(caps) =>
          stage === 'show' ? (
            <Card>
              <RecoveryCodeDisplay code={newCode} revealed={revealed} onReveal={() => setRevealed(true)} onHide={() => setRevealed(false)} />
              <CodeNotes caps={caps} />
              <Button label={t('psCodeSaved')} onPress={() => { setRevealed(false); setStage('confirm'); }} />
            </Card>
          ) : (
            content
          )
        }
      </Frame>
      <LeaveDialog
        visible={leaving}
        onStay={() => setLeaving(false)}
        onLeave={() => {
          setLeaving(false);
          clearAll();
          onBack();
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------
// an unconfirmed recovery code: before anything else in the parent area, confirm the code that was saved, or issue another

export function UnconfirmedCodeGuard() {
  const { t } = useT();
  const [stage, setStage] = useState<'choose' | 'have' | 'replace'>('choose');
  const back = () => setStage('choose');
  if (stage === 'have') {
    return <ConfirmCodeFlow title={t('pgdTypeTitle')} body={t('pmConfirmCodeBody')} onDone={back} onBack={back} />;
  }
  if (stage === 'replace') {
    return (
      <ReplacementCodeFlow
        pinTitle={t('pgdPinTitle')}
        pinBody={t('pgdPinBody')}
        confirmTitle={t('prConfirmTitle')}
        confirmBody={t('pmConfirmCodeBody')}
        onDone={back}
        onCancel={back}
      />
    );
  }
  return (
    <Frame title={t('pgdTitle')} body={t('pgdBody')} onClear={() => {}}>
      <Card>
        <Button label={t('pgdHave')} onPress={() => setStage('have')} />
        <Button tone="mint" label={t('pgdNew')} onPress={() => setStage('replace')} />
        <Button tone="soft" label={t('pmLockNow')} onPress={lockParentArea} />
      </Card>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------------------
// management (the parent area is open and the recovery code is confirmed)

export function ManageHome() {
  const { t } = useT();
  const router = useRouter();
  const [view, setView] = useState<'home' | 'change' | 'code'>('home');
  const [notice, setNotice] = useState<string | null>(null);
  const home = () => setView('home');
  if (view === 'change') {
    return (
      <ChangePinFlow
        onDone={() => {
          setNotice(t('pmChanged'));
          home();
        }}
        onCancel={home}
      />
    );
  }
  if (view === 'code') {
    return (
      <ReplacementCodeFlow
        pinTitle={t('pmNewCodeTitle')}
        pinBody={t('pmNewCodeBody')}
        confirmTitle={t('pmNewCodeTitle')}
        confirmBody={t('pmConfirmCodeBody')}
        onDone={() => {
          setNotice(t('pmCodeConfirmed'));
          home();
        }}
        onCancel={home}
      />
    );
  }
  return (
    <Frame title={t('pmTitle')} body={t('pmOn')} onClear={() => setNotice(null)}>
      <Card>
        {notice ? (
          <ThemedText type="small" accessibilityLiveRegion="polite">
            {notice}
          </ThemedText>
        ) : null}
        <Button label={t('pmChange')} onPress={() => { setNotice(null); setView('change'); }} />
        <Button tone="mint" label={t('pmNewCode')} onPress={() => { setNotice(null); setView('code'); }} />
        <Button tone="soft" label={t('pmLockNow')} onPress={lockParentArea} />
        <Button tone="soft" label={t('pmBackDashboard')} onPress={() => router.replace('/parent')} />
      </Card>
      <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
        {t('pgHonest')}
      </ThemedText>
    </Frame>
  );
}

const styles = StyleSheet.create({
  heading: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.two },
  center: { textAlign: 'center' },
  banner: { backgroundColor: '#FFE08A', borderRadius: 12, padding: Spacing.two, alignItems: 'center' },
  // Short landscape: the words (about a third) beside the card (two thirds), both starting at the top so a heading is never
  // scrolled away from its own controls.
  sideBySide: { flexDirection: 'row', gap: Spacing.three, alignItems: 'flex-start' },
  sideLeft: { flex: 2, minWidth: 0, gap: Spacing.two },
  sideRight: { flex: 3, minWidth: 0, gap: Spacing.three },
});
