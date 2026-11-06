import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { ThemedText } from '@/components/themed-text';
import { hoverLift } from '@/constants/hover';
import { Spacing } from '@/constants/theme';
import { useActiveProfileId } from '@/hooks/use-active-profile';
import { useT, type StringKey } from '@/i18n';
import { avatarFor } from '@/utils/family-picker-model';
import { leaveProfile, type LeaveResult } from '@/utils/family-session';
import { hasAnyChildRecord, useHousehold } from '@/utils/household';
import { MAIN_PROFILE_ID } from '@/utils/profiles';
import { listUnfinishedWork, subscribeToUnfinishedWork, type UnfinishedKind } from '@/utils/unfinished-work';

// The "who is playing" chip in the app header (family mode only; the header loads this file only behind the flag, see
// @/components/app-header.tsx). It shows the current profile and, when tapped, goes back to the "Who's playing today?" picker through
// leaveProfile (@/utils/family-session.ts): the parent area locks first, pending saves finish, the app is covered while that
// happens, and nothing is reported as done unless it really was. It never opens Main or a parent-only screen: the picker asks for
// the Parent PIN itself.
//
// If something unfinished and unsaved would be lost (see @/utils/unfinished-work.ts) the person is asked first, naming exactly what.
// With nothing unfinished it switches straight away. If leaving fails the profile stays open, with a friendly message that says
// nothing was lost, and a choice to try again or keep playing.

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

const MAIN_AVATAR = { emoji: '🏠', fill: '#E6DDF6' };

type Dialog = { kind: 'confirm'; work: readonly UnfinishedKind[] } | { kind: 'failed'; reason: string } | null;

export function ProfileChip() {
  const { t } = useT();
  const { width } = useWindowDimensions();
  const profileId = useActiveProfileId();
  const household = useHousehold();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [leaving, setLeaving] = useState(false);
  const mounted = useRef(true);
  const working = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Kept in step so the dialog is always about the work that exists right now.
  useSyncExternalStore(subscribeToUnfinishedWork, listUnfinishedWork, listUnfinishedWork);

  // Nothing to switch to when the household has no child record at all: the app is the single-user app and has no picker.
  if (!household || !hasAnyChildRecord(household)) return null;
  const isMain = profileId === MAIN_PROFILE_ID;
  const childRecord = household.children.find((c) => c.id === profileId);
  if (!isMain && !childRecord) return null; // an unknown profile is never labelled as someone else
  const name = isMain ? t('fpMain') : (childRecord?.nickname ?? '');
  const avatar = isMain ? MAIN_AVATAR : avatarFor(profileId);
  // Long names are cut with "…" rather than pushing the Paw Token balance, the title or the navigation out of place.
  const maxWidth = Math.max(160, Math.min(240, width - 2 * Spacing.three));

  async function leave() {
    if (working.current) return;
    working.current = true;
    setDialog(null);
    setLeaving(true);
    let result: LeaveResult;
    try {
      result = await leaveProfile();
    } catch {
      result = { ok: false, reason: 'storage' };
    }
    working.current = false;
    if (!mounted.current) return; // it worked: the app (and this chip) is gone and the picker is showing
    setLeaving(false);
    if (!result.ok) setDialog({ kind: 'failed', reason: result.reason });
  }

  function onPress() {
    if (working.current) return;
    const work = listUnfinishedWork();
    if (work.length > 0) setDialog({ kind: 'confirm', work: [...work] });
    else void leave();
  }

  return (
    <>
      <Pressable
        onPress={onPress}
        disabled={leaving}
        accessibilityRole="button"
        accessibilityLabel={t('pcLabel', { name })}
        accessibilityHint={t('pcHint')}
        style={(state) => [state.pressed && styles.pressed, hoverLift(state, true)]}>
        <View style={[styles.chip, { maxWidth }]}>
          <View style={[styles.avatar, { backgroundColor: avatar.fill }]}>
            <ThemedText style={styles.avatarEmoji}>{avatar.emoji}</ThemedText>
          </View>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
            {name}
          </ThemedText>
          <Ionicons name="swap-horizontal" size={16} color="#6B4FA0" accessibilityElementsHidden importantForAccessibility="no" />
        </View>
      </Pressable>

      {dialog?.kind === 'confirm' ? (
        <ConfirmModal
          visible
          title={t('pcConfirmTitle')}
          confirmLabel={t('pcConfirmSwitch')}
          cancelLabel={t('pcCancel')}
          onConfirm={() => void leave()}
          onCancel={() => setDialog(null)}>
          <ThemedText type="small">{t('pcConfirmIntro')}</ThemedText>
          {dialog.work.map((kind) => (
            <ThemedText key={kind} type="smallBold">
              {`• ${t(KIND_TEXT[kind])}`}
            </ThemedText>
          ))}
          <ThemedText type="small">{t('pcConfirmSaved')}</ThemedText>
        </ConfirmModal>
      ) : null}

      {dialog?.kind === 'failed' ? (
        <ConfirmModal
          visible
          title={t('pcFailTitle')}
          confirmLabel={t('pcTryAgain')}
          cancelLabel={t('pcKeepPlaying')}
          onConfirm={() => void leave()}
          onCancel={() => setDialog(null)}>
          <ThemedText type="small">{t(FAILURE_TEXT[dialog.reason] ?? 'pcFailOther', { name })}</ThemedText>
        </ConfirmModal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    paddingLeft: Spacing.one + 2,
    paddingRight: Spacing.three,
    borderRadius: Spacing.five,
    borderWidth: 2,
    borderColor: '#C9B6EC',
    backgroundColor: '#EFE9FA',
  },
  pressed: { opacity: 0.85 },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 18, lineHeight: 24, textAlign: 'center' },
  // flexShrink lets a long nickname give way (cut with an ellipsis) instead of growing the chip.
  name: { flexShrink: 1, color: '#46306E' },
});
