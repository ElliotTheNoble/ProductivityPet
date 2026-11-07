import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, AppState, Platform } from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { ThemedText } from '@/components/themed-text';
import { useActiveProfileId } from '@/hooks/use-active-profile';
import { useT, type StringKey } from '@/i18n';
import { hasAnyChildRecord, useHousehold } from '@/utils/household';
import {
  notifyUserActivity,
  startIdleSession,
  stopIdleSession,
  useIdleSnapshot,
  type IdleController,
} from '@/utils/idle-session';
import { MAIN_PROFILE_ID } from '@/utils/profiles';
import { listUnfinishedWork, subscribeToUnfinishedWork, type UnfinishedKind } from '@/utils/unfinished-work';

// Runs the 10-minute inactivity rule while a profile is open (family mode only: @/components/family-gate.tsx, which is loaded only
// behind the flag, mounts this next to the app). It only runs when the household has at least one child record (archived ones count:
// archiving every child never turns the rule off for Main). It reports the person's interactions, follows the app to the background
// and back, and shows the "Still playing?" warning and, if leaving does not work, the failed-return dialog. The arithmetic and the
// leave itself are in @/utils/idle-session.ts and @/utils/family-session.ts.

const KIND_TEXT: Record<UnfinishedKind, StringKey> = {
  'kitty-catch': 'pcKindKitty',
  'memory-match': 'pcKindMemory',
  bathing: 'pcKindBathing',
  'task-draft': 'pcKindTaskDraft',
  'task-edit': 'pcKindTaskEdit',
  journal: 'pcKindJournal',
};

const FAILURE_TEXT: Record<string, StringKey> = {
  'unsaved-changes': 'pcFailSave',
  storage: 'pcFailSave',
  timeout: 'pcFailSlow',
  busy: 'pcFailBusy',
};

// Web: what counts as the person doing something. Listening happens in the capture phase and passively, so it never interferes with a
// button, a gesture or a screen reader. A mouse that has not moved does not count (a layout change under a still pointer makes the
// browser send a move with no movement), and scrolling counts only when the person did it (wheel, touch, keys), not a script. A
// `click` counts too, because a screen reader (or a switch device) activating a control sends a click without any pointer press; a
// click made by a script (not trusted) does not.
function trackWebInteractions(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const opts = { capture: true, passive: true } as const;
  const plain = () => notifyUserActivity();
  const moved = (event: Event) => {
    const e = event as PointerEvent;
    if (e.movementX !== 0 || e.movementY !== 0 || e.pointerType === 'touch') notifyUserActivity();
  };
  const clicked = (event: Event) => {
    if (event.isTrusted !== false) notifyUserActivity();
  };
  const names = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'touchmove'] as const;
  for (const name of names) document.addEventListener(name, plain, opts);
  document.addEventListener('pointermove', moved, opts);
  document.addEventListener('click', clicked, opts);
  return () => {
    for (const name of names) document.removeEventListener(name, plain, opts);
    document.removeEventListener('pointermove', moved, opts);
    document.removeEventListener('click', clicked, opts);
  };
}

export function IdleGuard() {
  const { t } = useT();
  const household = useHousehold();
  const profileId = useActiveProfileId();
  const enabled = household !== null && hasAnyChildRecord(household);
  const [controller, setController] = useState<IdleController | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const idle = startIdleSession();
    setController(idle);
    idle.appState(AppState.currentState); // already away when the rule starts (anything but background or inactive is ignored)
    const sub = AppState.addEventListener('change', (state) => idle.appState(state));
    const stopWeb = Platform.OS === 'web' ? trackWebInteractions() : undefined;
    return () => {
      sub.remove();
      stopWeb?.();
      stopIdleSession(idle);
      setController(null);
    };
  }, [enabled]);

  const snapshot = useIdleSnapshot(controller);
  const work = useSyncExternalStore(subscribeToUnfinishedWork, listUnfinishedWork, listUnfinishedWork);

  // Screen readers are told ONCE, the moment the question appears (the dialog itself is also a modal with a focusable button). Only the
  // phase starting the warning triggers it: a re-render of the app, or a changed text function, never announces it again.
  const titleRef = useRef(t('idleTitle'));
  titleRef.current = t('idleTitle');
  useEffect(() => {
    if (snapshot.phase === 'warning') AccessibilityInfo.announceForAccessibility?.(titleRef.current);
  }, [snapshot.phase]);

  if (!controller || !household) return null;
  const isMain = profileId === MAIN_PROFILE_ID;
  const name = isMain ? t('fpMain') : (household.children.find((c) => c.id === profileId)?.nickname ?? '');

  if (snapshot.phase === 'warning') {
    return (
      <ConfirmModal
        visible
        singleAction
        title={t('idleTitle')}
        confirmLabel={t('idleContinue')}
        onConfirm={() => controller.continuePlaying()}
        onCancel={() => controller.continuePlaying()}>
        <ThemedText type="small">{t('idleBody')}</ThemedText>
        {work.length > 0 ? (
          <>
            <ThemedText type="small">{t('idleUnfinishedIntro')}</ThemedText>
            {work.map((kind) => (
              <ThemedText key={kind} type="smallBold">
                {`• ${t(KIND_TEXT[kind])}`}
              </ThemedText>
            ))}
            <ThemedText type="small">{t('idleSaved')}</ThemedText>
          </>
        ) : null}
      </ConfirmModal>
    );
  }

  if (snapshot.phase === 'failed') {
    return (
      <ConfirmModal
        visible
        title={t('pcFailTitle')}
        confirmLabel={t('pcTryAgain')}
        cancelLabel={t('pcKeepPlaying')}
        onConfirm={() => controller.retry()}
        onCancel={() => controller.keepPlaying()}>
        <ThemedText type="small">{t(FAILURE_TEXT[snapshot.failure ?? ''] ?? 'pcFailOther', { name })}</ThemedText>
      </ConfirmModal>
    );
  }

  return null;
}
