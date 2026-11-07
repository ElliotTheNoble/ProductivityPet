import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { FamilyPicker } from '@/components/family-picker';
import { IdleGuard } from '@/components/idle-guard';
import { FAMILY_BACKGROUND } from '@/components/family-ui';
import { LeavingCover } from '@/components/leaving-cover';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';
import { decidePicker, type PickerDecision } from '@/utils/family-picker-model';
import { markProfileChosen, useLeavingProfile, useProfileChosen } from '@/utils/family-session';
import { notifyUserActivity } from '@/utils/idle-session';

// Wraps the whole app in family mode (see src/app/_layout.tsx, which loads this file only when the flag is on). Until a profile
// has been chosen on the picker, `children` (the app shell) is simply NOT rendered: no profile's game stores are read, no pet
// catch-up runs, no rewards, mail or notifications are started for anybody. When nobody has to be chosen (no active child) the
// app opens exactly as it always has.
// `inert` is a web attribute (react-native-web passes it on); native ignores it.
const UNREACHABLE_PROPS = {
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
  'aria-hidden': true,
  inert: true,
} as const;

// Native: every touch that starts, moves or ends anywhere in the app counts as the person being there, and so does a CLICK: a screen
// reader activating a control (TalkBack's "click", a hardware keyboard's Enter on Android) arrives as a click event, not as a touch,
// and React Native's own Pressable answers it through the same event (see Pressability's onClick). These are capture handlers on the
// container, so they only LOOK: they never claim the touch or the click, and buttons, gestures and screen readers are unaffected.
// (iOS VoiceOver's double tap produces real touches at the control, so the touch handlers see it. The web listens to the document
// instead, see @/components/idle-guard.tsx.)
const NATIVE_TOUCH_TRACKING = {
  onTouchStartCapture: () => notifyUserActivity(),
  onTouchMoveCapture: () => notifyUserActivity(),
  onTouchEndCapture: () => notifyUserActivity(),
  onClickCapture: () => notifyUserActivity(),
};

export function FamilyGate({ children }: { children: ReactNode }) {
  const chosen = useProfileChosen();
  const leaving = useLeavingProfile();
  useRestoreWebFocus(leaving);
  const [decision, setDecision] = useState<PickerDecision | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (chosen) return;
    let cancelled = false;
    setDecision(null);
    void decidePicker().then((next) => {
      if (cancelled) return;
      if (next.kind === 'skip') markProfileChosen();
      else setDecision(next);
    });
    return () => {
      cancelled = true;
    };
  }, [chosen, attempt]);

  // While a profile is being left, a neutral cover goes OVER the app (see @/components/leaving-cover.tsx) and the app underneath is
  // taken out of reach completely: no touch, mouse or keyboard focus (`inert` and no pointer events), and hidden from screen readers
  // (iOS, Android and the web each have their own switch for that). When leaving fails it all comes back, for the same profile.
  if (chosen) {
    return (
      <>
        <View
          style={[styles.app, leaving && styles.unreachable]}
          {...(leaving ? UNREACHABLE_PROPS : null)}
          {...(Platform.OS === 'web' ? null : NATIVE_TOUCH_TRACKING)}>
          {children}
        </View>
        <IdleGuard />
        {leaving ? <LeavingCover /> : null}
      </>
    );
  }
  if (!decision || decision.kind !== 'picker') return <Waiting />;
  return <FamilyPicker decision={decision} onRetry={() => setAttempt((n) => n + 1)} />;
}

// On the web, remembers which control had the keyboard focus when leaving began and gives it back if leaving fails (the app comes
// back exactly as it was, so the person can carry on with the keyboard where they were).
function useRestoreWebFocus(leaving: boolean): void {
  const before = useRef<Element | null>(null);
  const was = useRef(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (leaving && !was.current) before.current = document.activeElement;
    if (!leaving && was.current) {
      const element = before.current as (HTMLElement & { isConnected: boolean }) | null;
      before.current = null;
      if (element && element.isConnected && typeof element.focus === 'function') element.focus();
    }
    was.current = leaving;
  }, [leaving]);
}

// Shown for a moment while the family list is read. Deliberately not the app: nothing of any profile is on it.
function Waiting() {
  const { t } = useT();
  return (
    <View style={styles.page} accessibilityRole="progressbar" accessibilityLabel={t('fpLoading')}>
      <ActivityIndicator size="large" color="#A78BDB" />
      <ThemedText type="small" themeColor="textSecondary">
        {t('fpLoading')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  unreachable: { pointerEvents: 'none' },
  page: { flex: 1, backgroundColor: FAMILY_BACKGROUND, alignItems: 'center', justifyContent: 'center', gap: Spacing.two },
});
