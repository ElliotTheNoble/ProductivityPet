import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Card, FAMILY_BACKGROUND } from '@/components/family-ui';
import { PinEntry } from '@/components/pin-entry';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { hoverLift } from '@/constants/hover';
import { useParentAccess } from '@/hooks/use-parent-access';
import { useParentAuthStatus } from '@/hooks/use-parent-auth-status';
import { useSensitiveScreen } from '@/hooks/use-sensitive-screen';
import { useT } from '@/i18n';
import { peekProfileCare, type CareSummary } from '@/utils/family-profiles';
import {
  BADGE_LABEL,
  BADGE_LOOK,
  SWITCH_FAILURE_TEXT,
  avatarFor,
  badgeFor,
  decidePicker,
  mainEntry,
  parentSessionVerified,
  type BadgeKind,
  type MainEntry,
  type PickerDecision,
  type PickerProblem,
} from '@/utils/family-picker-model';
import { markProfileChosen } from '@/utils/family-session';
import type { ChildProfile } from '@/utils/household';
import { PIN_FORMAT, formatRemaining, openParentSession, unlockParentArea } from '@/utils/parent-gate';
import { MAIN_PROFILE_ID, retryProfileInitialization, switchProfile } from '@/utils/profiles';

// "Who's playing today?" (family mode only; see @/components/family-gate.tsx). It is shown INSTEAD of the app on a cold start, so no
// profile's game data has been loaded when it appears. Everything a child does here is choosing their own card; Main (the parent's
// own profile) and "Add a child" need the Parent PIN, which is checked by the existing parent gate (@/utils/parent-gate.ts), not by
// anything in this file. The picker never says a profile was opened before the switch has really succeeded, and it never shows
// the care state of a pet as healthy unless it was read and was healthy.

const REFRESH_MS = 60_000;

// Why Main stays closed, in plain words (children can still play in every case).
const MAIN_BLOCKED_TEXT = {
  'no-pin': 'fpMainNoPin',
  unconfirmed: 'fpMainUnconfirmed',
  'verifier-missing': 'fpMainMissingShort',
  unavailable: 'fpMainUnavailable',
} as const;
const ADD_BLOCKED_TEXT = {
  'no-pin': 'fpAddChildNeedsPin',
  unconfirmed: 'fpAddChildBlocked',
  'verifier-missing': 'fpAddChildMissing',
  unavailable: 'fpAddChildBlocked',
} as const;

type Purpose = 'main' | 'add';
type View_ = { kind: 'grid' } | { kind: 'pin'; purpose: Purpose } | { kind: 'recovery' } | { kind: 'claim' };
type Busy = { label: string } | null;
type Failure = { text: string; retry: () => void } | null;

export function FamilyPicker({ decision, onRetry }: { decision: Extract<PickerDecision, { kind: 'picker' }>; onRetry: () => void }) {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const access = useParentAccess();
  const auth = useParentAuthStatus();
  const entry = mainEntry(access, auth);
  const [children, setChildren] = useState<ChildProfile[]>(decision.children);
  const [problem, setProblem] = useState<PickerProblem>(decision.problem);
  const [care, setCare] = useState<Record<string, CareSummary>>({});
  const [view, setView] = useState<View_>({ kind: 'grid' });
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const mounted = useRef(true);
  const busyRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Care badges: read-only, for Main and every offered child. A record that cannot be read says so; it is never shown as healthy.
  const ids = useMemo(() => [MAIN_PROFILE_ID, ...children.map((c) => c.id)], [children]);
  const loadCare = useCallback(async () => {
    const entries = await Promise.all(ids.map(async (id) => [id, await peekProfileCare(id)] as const));
    if (mounted.current) setCare(Object.fromEntries(entries));
  }, [ids]);
  useEffect(() => {
    void loadCare();
  }, [loadCare]);

  // The list and the badges are looked at again while the picker is open: time passes for every pet, and another window or a
  // parent may have changed the family. After a failed switch they are refreshed too.
  const refresh = useCallback(async () => {
    const next = await decidePicker();
    if (!mounted.current) return;
    if (next.kind === 'picker') {
      setChildren(next.children);
      setProblem(next.problem);
    }
    void loadCare();
  }, [loadCare]);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [refresh]);

  // The ONLY place a profile is entered. `then` is only ever '/parent' (the parent-only "Add a child" path). `parentProven` is true
  // when the Parent PIN was just entered (or its session was open) for this very entry.
  const enter = useCallback(
    async (target: { id: string; label: string }, options: { then?: '/parent'; parentProven?: boolean } = {}) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy({ label: target.label });
      setFailure(null);
      // Whatever screen asked, Main is only ever entered while a PIN verified in this session has the parent area open.
      if (target.id === MAIN_PROFILE_ID && !(await parentSessionVerified())) {
        busyRef.current = false;
        if (!mounted.current) return;
        setBusy(null);
        setView({ kind: 'grid' });
        setFailure({ text: t('fpErrMainLocked'), retry: () => setFailure(null) });
        return;
      }
      // Nobody has a profile open yet, so this cannot touch anyone's reminders: if the last clean-up of private notifications is not
      // verified, try once more (bounded) before the profile starts. It never blocks the entry.
      if (Platform.OS !== 'web') await (require('@/utils/family-notifications') as typeof import('@/utils/family-notifications')).prepareForProfileEntry();
      const result = await switchProfile(target.id);
      busyRef.current = false;
      if (!result.ok) {
        if (!mounted.current) return;
        setBusy(null);
        setView({ kind: 'grid' });
        setFailure({ text: t(SWITCH_FAILURE_TEXT[result.reason]), retry: () => void enter(target, options) });
        void refresh();
        return;
      }
      // The parent entered the PIN a moment ago. A profile change locks the parent area, but not when the saved pointer already
      // named Main (nothing was switched), so the same moment is handled the same way every time: the session that PIN opened
      // is open again (it still ends on idle, on going to the background and on the next profile change).
      if (options.parentProven) openParentSession();
      markProfileChosen({ then: options.then });
    },
    [refresh, t]
  );

  const openMain = (purpose: Purpose) => {
    // Fails closed: with no working, confirmed Parent PIN Main cannot be entered at all (nothing creates or resets a PIN here).
    if (busyRef.current || entry !== 'allowed') return;
    const then = purpose === 'add' ? ('/parent' as const) : undefined;
    // An open parent session is a PIN entered moments ago. Otherwise the PIN is asked, and what it opens is fixed here: Main.
    if (access.state === 'unlocked') {
      void enter({ id: MAIN_PROFILE_ID, label: t('fpSwitchingMain') }, { then, parentProven: true });
      return;
    }
    setFailure(null);
    setView({ kind: 'pin', purpose });
  };

  if (busy) return <Switching label={busy.label} />;

  if (view.kind === 'recovery') {
    const { RecoveryFlow } = require('@/components/parent-pin-flows') as typeof import('@/components/parent-pin-flows');
    return <RecoveryFlow onBack={() => setView({ kind: 'pin', purpose: 'main' })} />;
  }

  if (view.kind === 'claim') {
    // The protected first setup of the Parent PIN (device security check first). It is not inside the app's navigation, so it is told
    // where to go: back to the picker, which then looks at the PIN again.
    const { ParentSetupClaim } = require('@/components/parent-setup-claim') as typeof import('@/components/parent-setup-claim');
    const back = () => {
      setView({ kind: 'grid' });
      void refresh();
    };
    return <ParentSetupClaim onLeave={back} onFinished={back} />;
  }

  if (view.kind === 'pin') {
    return (
      <PinPrompt
        purpose={view.purpose}
        onCancel={() => setView({ kind: 'grid' })}
        onForgot={() => setView({ kind: 'recovery' })}
        onUnlocked={() => void enter({ id: MAIN_PROFILE_ID, label: t('fpSwitchingMain') }, { then: view.purpose === 'add' ? '/parent' : undefined, parentProven: true })}
      />
    );
  }

  const columns = width >= 900 ? 3 : width >= 560 ? 2 : 1;
  const basis = columns === 3 ? '31%' : columns === 2 ? '48%' : '100%';
  const mainStatus = t(BADGE_LABEL[badgeFor(care[MAIN_PROFILE_ID])]);
  const mainBlocked = entry !== 'allowed' && entry !== 'checking';
  const mainSub = mainBlocked
    ? t(MAIN_BLOCKED_TEXT[entry as Exclude<MainEntry, 'allowed' | 'checking'>])
    : access.state === 'cooldown'
      ? t('fpMainLocked', { time: formatRemaining(access.remainingMs) })
      : t('fpMainSubProtected');
  const addDisabled = entry !== 'allowed';
  const addHint = mainBlocked ? t(ADD_BLOCKED_TEXT[entry as Exclude<MainEntry, 'allowed' | 'checking'>]) : t('fpAddChildSub');

  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.column}>
            <View style={styles.heading}>
              <ThemedText style={styles.paw}>🐾</ThemedText>
              <ThemedText type="subtitle" accessibilityRole="header" style={styles.center}>
                {t('fpTitle')}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                {t('fpSubtitle')}
              </ThemedText>
            </View>

            {failure ? (
              <View accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.failure}>
                <ThemedText type="smallBold">{t('fpErrorTitle')}</ThemedText>
                <ThemedText type="small">{failure.text}</ThemedText>
                <View style={styles.failureButtons}>
                  <Button label={t('fpRetry')} onPress={failure.retry} />
                  <Button tone="soft" label={t('fpCancel')} onPress={() => setFailure(null)} />
                </View>
              </View>
            ) : null}

            {problem ? <ProblemCard problem={problem} onRetry={onRetryProblem(problem, onRetry)} /> : null}

            {entry === 'no-pin' ? (
              <View style={styles.setupHint}>
                <ThemedText type="small">{t('pkPickerHint')}</ThemedText>
                <Button tone="mint" label={t('pkPickerButton')} onPress={() => setView({ kind: 'claim' })} />
              </View>
            ) : null}

            <View style={styles.grid}>
              {children.map((child) => {
                const badge = badgeFor(care[child.id]);
                const status = t(BADGE_LABEL[badge]);
                const avatar = avatarFor(child.id);
                return (
                  <ProfileCard
                    key={child.id}
                    basis={basis}
                    emoji={avatar.emoji}
                    fill={avatar.fill}
                    name={child.nickname}
                    badge={badge}
                    label={t('fpCardLabel', { name: child.nickname, status })}
                    onPress={() => void enter({ id: child.id, label: t('fpSwitching', { name: child.nickname }) })}
                  />
                );
              })}

              <ProfileCard
                basis={basis}
                emoji="🏠"
                fill="#E4DAF7"
                name={t('fpMain')}
                sub={mainSub}
                lock
                badge={mainBlocked ? undefined : badgeFor(care[MAIN_PROFILE_ID])}
                disabled={entry !== 'allowed'}
                accent
                label={t('fpMainCardLabel', { status: mainStatus, hint: mainSub })}
                onPress={() => openMain('main')}
              />

              <ProfileCard
                basis={basis}
                emoji="＋"
                fill="#FFFFFF"
                name={t('fpAddChild')}
                sub={addHint}
                dashed
                disabled={addDisabled}
                label={t('fpAddChildLabel', { hint: addHint })}
                onPress={() => openMain('add')}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function onRetryProblem(problem: Exclude<PickerProblem, null>, reload: () => void) {
  return async () => {
    if (problem === 'safe-mode') await retryProfileInitialization();
    reload();
  };
}

// ---------------------------------------------------------------------------------------------------------

const PROBLEM_TEXT = {
  'safe-mode': { title: 'fpSafeModeTitle', body: 'fpSafeModeBody' },
  'household-unreadable': { title: 'fpHouseholdUnreadableTitle', body: 'fpHouseholdUnreadableBody' },
  'children-not-ready': { title: 'fpChildrenNotReadyTitle', body: 'fpChildrenNotReadyBody' },
} as const;

function ProblemCard({ problem, onRetry }: { problem: Exclude<PickerProblem, null>; onRetry: () => void | Promise<void> }) {
  const { t } = useT();
  return (
    <View accessibilityRole="alert" style={styles.failure}>
      <ThemedText type="smallBold">{t(PROBLEM_TEXT[problem].title)}</ThemedText>
      <ThemedText type="small">{t(PROBLEM_TEXT[problem].body)}</ThemedText>
      <View style={styles.failureButtons}>
        <Button label={t('fpRetry')} onPress={() => void onRetry()} />
      </View>
    </View>
  );
}

function CareBadge({ kind }: { kind: BadgeKind }) {
  const { t } = useT();
  const look = BADGE_LOOK[kind];
  return (
    <View style={[styles.badge, { backgroundColor: look.fill, borderColor: look.edge }]}>
      <ThemedText style={styles.badgeIcon} accessibilityElementsHidden importantForAccessibility="no">
        {look.icon}
      </ThemedText>
      <ThemedText type="smallBold" style={styles.badgeText}>
        {t(BADGE_LABEL[kind])}
      </ThemedText>
    </View>
  );
}

function ProfileCard({
  basis,
  emoji,
  fill,
  name,
  sub,
  badge,
  lock,
  dashed,
  accent,
  disabled,
  label,
  onPress,
}: {
  basis: string;
  emoji: string;
  fill: string;
  name: string;
  sub?: string;
  badge?: BadgeKind;
  lock?: boolean;
  dashed?: boolean;
  accent?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={(state) => [
        styles.cardWrap,
        { flexBasis: basis as never },
        state.pressed && styles.pressed,
        disabled && styles.disabled,
        hoverLift(state, !disabled),
        (state as { focused?: boolean }).focused === true && styles.focused,
      ]}>
      <View style={[styles.card, accent && styles.cardAccent, dashed && styles.cardDashed]}>
        <View style={[styles.avatar, { backgroundColor: fill }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <ThemedText style={styles.avatarEmoji}>{emoji}</ThemedText>
        </View>
        <View style={styles.cardText}>
          <View style={styles.nameRow}>
            <ThemedText style={styles.name}>{name}</ThemedText>
            {lock ? (
              <ThemedText style={styles.lockIcon} accessibilityElementsHidden importantForAccessibility="no">
                🔒
              </ThemedText>
            ) : null}
          </View>
          {sub ? (
            <ThemedText type="small" themeColor="textSecondary">
              {sub}
            </ThemedText>
          ) : null}
          {badge ? <CareBadge kind={badge} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function Switching({ label }: { label: string }) {
  return (
    <View style={[styles.page, styles.centered]}>
      <View style={styles.switching} accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityLabel={label}>
        <ActivityIndicator size="large" color="#A78BDB" />
        <ThemedText type="subtitle" style={styles.center}>
          {label}
        </ThemedText>
      </View>
    </View>
  );
}

// The Parent PIN prompt. It checks nothing itself: the PIN goes to the existing parent gate (@/utils/parent-gate.ts), which counts
// wrong tries, pauses after too many (also across restarts) and handles a missing PIN. `purpose` was fixed when the card was
// tapped; a correct PIN calls onUnlocked, which enters Main (and nothing else).
function PinPrompt({
  purpose,
  onUnlocked,
  onCancel,
  onForgot,
}: {
  purpose: Purpose;
  onUnlocked: () => void;
  onCancel: () => void;
  onForgot: () => void;
}) {
  const { t, tn } = useT();
  const access = useParentAccess();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<
    { kind: 'wrong'; triesLeft: number } | { kind: 'format' } | { kind: 'unavailable' } | null
  >(null);
  const [localUntil, setLocalUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const clearPin = useCallback(() => setPin(''), []);
  useSensitiveScreen(clearPin); // the digits are wiped when the app goes to the background; screenshots are blocked where possible

  const accessUntil = useMemo(() => (access.state === 'cooldown' ? Date.now() + access.remainingMs : 0), [access]);
  const remaining = Math.max(accessUntil, localUntil) - now;
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
    if (result.ok) {
      // "ok" must come from a PIN that was really verified (a gate with no PIN also says ok): check the session itself.
      if (await parentSessionVerified()) onUnlocked();
      else setFeedback({ kind: 'unavailable' });
      return;
    }
    const at = Date.now();
    setNow(at);
    if (result.reason === 'cooldown') setLocalUntil(at + result.remainingMs);
    else if (result.reason === 'wrong') {
      if (result.cooldownMs > 0) setLocalUntil(at + result.cooldownMs);
      setFeedback({ kind: 'wrong', triesLeft: result.triesLeft });
    } else if (result.reason === 'invalid-format') setFeedback({ kind: 'format' });
    else setFeedback({ kind: 'unavailable' });
  }

  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={[styles.column, styles.pinColumn]}>
            <View style={styles.heading}>
              <ThemedText style={styles.paw}>🔒</ThemedText>
              <ThemedText type="subtitle" accessibilityRole="header" style={styles.center}>
                {t('fpPinTitle')}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                {purpose === 'add' ? t('fpPinBodyAdd') : t('fpPinBodyMain')}
              </ThemedText>
            </View>
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
                <Button tone="soft" label={t('fpCancel')} onPress={onCancel} />
              </PinEntry>
            </Card>
            <View style={styles.forgot}>
              <Button tone="soft" label={t('prStart')} onPress={onForgot} />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: FAMILY_BACKGROUND },
  centered: { alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
  safe: { flex: 1 },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.five, alignItems: 'center' },
  column: { width: '100%', maxWidth: 960, gap: Spacing.three },
  pinColumn: { maxWidth: 520 },
  heading: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.two },
  paw: { fontSize: 40, lineHeight: 48 },
  center: { textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, justifyContent: 'center' },
  // minWidth 0: on the narrowest screen with the largest text a card must shrink to the screen, never push past its edge.
  cardWrap: { flexGrow: 1, minWidth: 0 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 96,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  cardAccent: { borderColor: '#CDBDF0', backgroundColor: '#F6F1FD' },
  cardDashed: { borderStyle: 'dashed', borderColor: '#CDBDF0', backgroundColor: 'rgba(255,255,255,0.6)' },
  cardText: { flex: 1, minWidth: 0, gap: Spacing.one, alignItems: 'flex-start' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one, alignSelf: 'stretch' },
  name: { flexShrink: 1, fontSize: 21, lineHeight: 27, fontWeight: '800' },
  lockIcon: { fontSize: 16, lineHeight: 22 },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 34, lineHeight: 42, textAlign: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one,
    maxWidth: '100%',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half + 2,
    borderRadius: Spacing.four,
    borderWidth: 2,
  },
  badgeIcon: { fontSize: 14, lineHeight: 20 },
  badgeText: { flexShrink: 1, fontSize: 13, lineHeight: 18 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.6 },
  focused: { outlineColor: '#6F4FB8', outlineStyle: 'solid', outlineWidth: 3, outlineOffset: 2, borderRadius: Spacing.four },
  setupHint: { backgroundColor: 'rgba(255,255,255,0.8)', borderColor: '#CDBDF0', borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  failure: { backgroundColor: '#FFE9E9', borderColor: '#F2B5B5', borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  failureButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  switching: { alignItems: 'center', gap: Spacing.three, maxWidth: 420 },
  forgot: { alignItems: 'center' },
});
