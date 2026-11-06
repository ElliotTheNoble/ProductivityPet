import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { Button, Card, Field } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT, type StringKey } from '@/i18n';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { BADGE_LABEL, BADGE_LOOK, avatarFor, badgeFor, type BadgeKind } from '@/utils/family-picker-model';
import { peekProfileCare, type CareSummary } from '@/utils/family-profiles';
import {
  archiveChild,
  createChild,
  findSameNickname,
  getArchiveSummary,
  renameChildSafe,
  restoreChild,
  type ManageFailure,
  type ManageResult,
} from '@/utils/family-management';
import { isChildArchived, tasksByStatus, useHousehold, type ChildProfile } from '@/utils/household';

// The Parent Dashboard's child management: add, rename, (family mode) archive and restore, with a clear message whenever something does
// not work. A success message is shown ONLY after the change was really saved (the household writes and reads back first); a failure
// always says that nothing was changed. Archive needs an explicit confirmation that says what archiving does and does not do. Two
// children may share a nickname: that only gets a friendly warning.
//
// The permanent profile id never changes, and nothing here touches a child's pets, tasks, tokens, inventory or any saved record.
// With family mode off this is the original card (add, rename, select) with proper error messages: no archive, no care badges.

const FAILURE_TEXT: Record<ManageFailure, StringKey> = {
  invalid: 'fmErrInvalid',
  'not-found': 'fmErrNotFound',
  'not-allowed': 'fmErrOther',
  'wrong-state': 'fmErrOther',
  storage: 'fmErrStorage',
  conflict: 'fmErrConflict',
  blocked: 'fmErrBlocked',
  'pin-required': 'fmErrPinRequired',
  locked: 'fmErrLocked',
  unconfirmed: 'fmErrUnconfirmed',
  unavailable: 'fmErrUnavailable',
  'active-profile': 'fmErrActive',
};

type Notice = { kind: 'success' | 'error'; text: string } | null;

export function FamilyManagementCard({ selectedChildId, onSelect }: { selectedChildId: string | null; onSelect: (id: string) => void }) {
  const { t } = useT();
  const household = useHousehold();
  const [notice, setNotice] = useState<Notice>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [confirming, setConfirming] = useState<{ child: ChildProfile; summary: CareSummary | 'loading' } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const children = household?.children ?? [];
  const active = useMemo(() => children.filter((c) => !isChildArchived(c)), [children]);
  const archived = useMemo(() => children.filter((c) => isChildArchived(c)), [children]);
  const care = useCareBadges(FAMILY_MODE_ENABLED ? children : []);

  if (!household) return null;

  const failure = (result: Extract<ManageResult, { ok: false }>, name?: string): string => {
    if (result.reason === 'storage' && result.storageMayBeFull) return t('fmErrStorageMayBeFull');
    return t(FAILURE_TEXT[result.reason], { name: name ?? '' });
  };
  const duplicateOf = (name: string, exceptId?: string) => findSameNickname(household, name, exceptId);

  // One action at a time; the message is set from the RESULT, never before it.
  const run = async (action: () => Promise<ManageResult>, onOk: (result: Extract<ManageResult, { ok: true }>) => void, name?: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await action();
    if (!mounted.current) return;
    setBusy(false);
    if (result.ok) onOk(result);
    else setNotice({ kind: 'error', text: failure(result, name) });
  };

  const submitAdd = () => {
    const name = newName.trim().replace(/\s+/g, ' ');
    if (!name) return setNotice({ kind: 'error', text: t('fmErrInvalid') });
    void run(
      () => createChild(name),
      () => {
        setNotice({ kind: 'success', text: t('fmAdded', { name }) });
        setNewName('');
        setAdding(false);
      }
    );
  };
  const submitRename = (child: ChildProfile) => {
    const name = renameText.trim().replace(/\s+/g, ' ');
    if (!name) return setNotice({ kind: 'error', text: t('fmErrInvalid') });
    void run(
      () => renameChildSafe(child.id, name),
      () => {
        setNotice({ kind: 'success', text: t('fmRenamed', { name }) });
        setRenaming(null);
      },
      child.nickname
    );
  };
  const openArchive = async (child: ChildProfile) => {
    setNotice(null);
    setConfirming({ child, summary: 'loading' });
    const summary = await getArchiveSummary(child.id);
    if (mounted.current) setConfirming((current) => (current && current.child.id === child.id ? { child, summary } : current));
  };
  const confirmArchive = () => {
    if (!confirming) return;
    const child = confirming.child;
    void run(
      () => archiveChild(child.id),
      () => {
        setConfirming(null);
        setNotice({ kind: 'success', text: t('fmArchived', { name: child.nickname }) });
      },
      child.nickname
    ).then(() => {
      if (mounted.current) setConfirming(null); // on a failure the message is shown on the card
    });
  };
  const doRestore = (child: ChildProfile) =>
    void run(
      () => restoreChild(child.id),
      () => setNotice({ kind: 'success', text: t('fmRestored', { name: child.nickname }) }),
      child.nickname
    );

  const addDuplicate = adding ? duplicateOf(newName) : null;
  const renameDuplicate = renaming ? duplicateOf(renameText, renaming) : null;

  return (
    <Card title={t('childProfiles')}>
      {notice ? (
        <View
          accessibilityRole={notice.kind === 'error' ? 'alert' : undefined}
          accessibilityLiveRegion={notice.kind === 'error' ? 'assertive' : 'polite'}
          style={[styles.notice, notice.kind === 'error' ? styles.noticeError : styles.noticeOk]}>
          {notice.kind === 'error' ? <ThemedText type="smallBold">{t('fmErrorTitle')}</ThemedText> : null}
          <ThemedText type="small">{notice.text}</ThemedText>
          <View style={styles.row}>
            <Button tone="soft" label={t('fmDismiss')} onPress={() => setNotice(null)} />
          </View>
        </View>
      ) : null}

      {active.length === 0 ? (
        <View style={styles.empty}>
          <ThemedText type="smallBold">{t('noChildrenTitle')}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t('noChildrenText')}
          </ThemedText>
        </View>
      ) : (
        active.map((child) => {
          const selected = child.id === selectedChildId;
          const pending = tasksByStatus(child).pending.length;
          return (
            <View key={child.id} style={[styles.childRow, selected && styles.childRowSelected]}>
              {renaming === child.id ? (
                <View style={styles.editBlock}>
                  <Field label={t('fmNewName')} value={renameText} onChangeText={setRenameText} maxLength={40} />
                  {renameDuplicate ? <Warning text={t('fmDuplicate', { name: renameDuplicate.nickname })} /> : null}
                  <View style={styles.row}>
                    <Button label={t('saveChild')} onPress={() => submitRename(child)} disabled={busy} />
                    <Button label={t('cancel')} tone="soft" onPress={() => setRenaming(null)} disabled={busy} />
                  </View>
                </View>
              ) : (
                <>
                  <ChildIdentity child={child} badge={FAMILY_MODE_ENABLED ? badgeFor(care[child.id]) : undefined}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {`${child.tasks.length} ${t('tasksWord')} · ${t('pendingApprovals')}: ${pending}`}
                    </ThemedText>
                  </ChildIdentity>
                  <View style={styles.buttons}>
                    <Button
                      tone={selected ? 'mint' : 'soft'}
                      label={selected ? t('selected') : t('select')}
                      accessibilityLabel={t('fmSelectLabel', { name: child.nickname })}
                      onPress={() => onSelect(child.id)}
                    />
                    <Button
                      tone="soft"
                      label={t('fmRename')}
                      accessibilityLabel={t('fmRenameLabel', { name: child.nickname })}
                      disabled={busy}
                      onPress={() => {
                        setRenameText(child.nickname);
                        setRenaming(child.id);
                        setNotice(null);
                      }}
                    />
                    {FAMILY_MODE_ENABLED ? (
                      <Button
                        tone="soft"
                        label={t('fmArchive')}
                        accessibilityLabel={t('fmArchiveLabel', { name: child.nickname })}
                        disabled={busy}
                        onPress={() => void openArchive(child)}
                      />
                    ) : null}
                  </View>
                </>
              )}
            </View>
          );
        })
      )}

      {adding ? (
        <View style={styles.editBlock}>
          <Field label={t('childNickname')} placeholder={t('childNicknamePlaceholder')} value={newName} onChangeText={setNewName} maxLength={40} />
          {addDuplicate ? <Warning text={t('fmDuplicate', { name: addDuplicate.nickname })} /> : null}
          <View style={styles.row}>
            <Button label={t('add')} onPress={submitAdd} disabled={busy} />
            <Button label={t('cancel')} tone="soft" onPress={() => setAdding(false)} disabled={busy} />
          </View>
        </View>
      ) : (
        <Button
          label={`＋ ${t('addChild')}`}
          disabled={busy}
          onPress={() => {
            setNotice(null);
            setAdding(true);
          }}
        />
      )}

      {FAMILY_MODE_ENABLED && archived.length > 0 ? (
        <View style={styles.archivedBlock}>
          <Button
            tone="soft"
            label={t(showArchived ? 'fmArchivedHide' : 'fmArchivedShow', { count: archived.length })}
            onPress={() => setShowArchived((v) => !v)}
          />
          {showArchived ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                {t('fmArchivedHelp')}
              </ThemedText>
              {archived.map((child) => (
                <View key={child.id} style={styles.childRow}>
                  <ChildIdentity child={child} badge={badgeFor(care[child.id])}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t('fmArchivedAging')}
                    </ThemedText>
                  </ChildIdentity>
                  <View style={styles.buttons}>
                    <Button
                      tone="mint"
                      label={t('fmRestore')}
                      accessibilityLabel={t('fmRestoreLabel', { name: child.nickname })}
                      disabled={busy}
                      onPress={() => doRestore(child)}
                    />
                  </View>
                </View>
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      <ConfirmModal
        visible={!!confirming}
        title={confirming ? t('fmArchiveTitle', { name: confirming.child.nickname }) : ''}
        confirmLabel={confirming ? t('fmArchiveConfirm', { name: confirming.child.nickname }) : ''}
        busy={busy}
        onConfirm={confirmArchive}
        onCancel={() => !busy && setConfirming(null)}>
        {confirming ? (
          <>
            <ThemedText type="small">{t('fmArchiveSaved', { name: confirming.child.nickname })}</ThemedText>
            <ThemedText type="small">{t('fmArchiveAging')}</ThemedText>
            <ThemedText type="small">{t('fmArchiveRestoreNote', { name: confirming.child.nickname })}</ThemedText>
            <ThemedText type="smallBold">
              {confirming.summary === 'loading' || confirming.summary.status === 'unreadable'
                ? t('fmArchiveStatusUnknown')
                : t('fmArchiveStatus', { status: t(BADGE_LABEL[badgeFor(confirming.summary)]) })}
            </ThemedText>
          </>
        ) : null}
      </ConfirmModal>
    </Card>
  );
}

function Warning({ text }: { text: string }) {
  return (
    <View style={styles.warning} accessibilityLiveRegion="polite">
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

function ChildIdentity({ child, badge, children }: { child: ChildProfile; badge?: BadgeKind; children?: React.ReactNode }) {
  const avatar = avatarFor(child.id);
  const { t } = useT();
  return (
    <View style={styles.identity}>
      <View style={[styles.avatar, { backgroundColor: avatar.fill }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <ThemedText style={styles.avatarEmoji}>{avatar.emoji}</ThemedText>
      </View>
      <View style={styles.childInfo}>
        <ThemedText type="smallBold" style={styles.childName}>
          {child.nickname}
        </ThemedText>
        {children}
        {badge ? (
          <View style={[styles.badge, { backgroundColor: BADGE_LOOK[badge].fill, borderColor: BADGE_LOOK[badge].edge }]}>
            <ThemedText style={styles.badgeIcon} accessibilityElementsHidden importantForAccessibility="no">
              {BADGE_LOOK[badge].icon}
            </ThemedText>
            <ThemedText type="smallBold" style={styles.badgeText}>
              {t(BADGE_LABEL[badge])}
            </ThemedText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

// Read-only care badges for the children shown (family mode only): one read of each child's saved pets, advanced on a copy.
function useCareBadges(children: ChildProfile[]): Record<string, CareSummary> {
  const [care, setCare] = useState<Record<string, CareSummary>>({});
  const key = children.map((c) => c.id).join('|');
  const load = useCallback(async () => {
    const entries = await Promise.all(children.map(async (c) => [c.id, await peekProfileCare(c.id)] as const));
    return Object.fromEntries(entries);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (children.length === 0) return;
    let cancelled = false;
    void load().then((next) => {
      if (!cancelled) setCare(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load, children.length]);
  return care;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', alignItems: 'center' },
  empty: { gap: 2 },
  notice: { borderRadius: Spacing.three, borderWidth: 2, padding: Spacing.three, gap: Spacing.two },
  noticeOk: { backgroundColor: '#E3F6EC', borderColor: '#7FD9B6' },
  noticeError: { backgroundColor: '#FFE9E9', borderColor: '#F2B5B5' },
  warning: { backgroundColor: '#FFF4E3', borderColor: '#F0B86E', borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.two },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', padding: Spacing.two, borderRadius: Spacing.three, borderWidth: 2, borderColor: 'transparent' },
  childRowSelected: { borderColor: '#A78BDB', backgroundColor: 'rgba(228, 218, 247, 0.6)' },
  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flex: 1, minWidth: 200 },
  childInfo: { flex: 1, minWidth: 0, gap: 2, alignItems: 'flex-start' },
  childName: { fontSize: 17, lineHeight: 22 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 26, lineHeight: 32, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', maxWidth: '100%', flexShrink: 1 },
  editBlock: { flex: 1, minWidth: 220, gap: Spacing.two },
  archivedBlock: { gap: Spacing.two, marginTop: Spacing.one },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: Spacing.one, maxWidth: '100%', paddingHorizontal: Spacing.two, paddingVertical: Spacing.half + 2, borderRadius: Spacing.four, borderWidth: 2 },
  badgeIcon: { fontSize: 13, lineHeight: 18 },
  badgeText: { flexShrink: 1, fontSize: 12, lineHeight: 16 },
});
