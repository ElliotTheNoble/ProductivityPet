import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, ChoiceCard, Field, PageShell, ToggleRow } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { FamilyHealthCard } from '@/components/family-health-card';
import { NotificationCleanupNotice } from '@/components/notification-cleanup-notice';
import { FamilyManagementCard } from '@/components/family-management-card';
import { ParentPinCard } from '@/components/parent-pin-card';
import { RewardStepper } from '@/components/reward-stepper';
import { useFreshHousehold } from '@/hooks/use-fresh-household';
import { useRouteParams } from '@/hooks/use-route-params';
import { useTodayISO } from '@/hooks/use-today';
import { rewardTrace } from '@/utils/reward-trace';
import { useFocusPulse } from '@/components/assigned-task-views';
import { LANGUAGES, useT, type LanguageCode, type StringKey, getLocale } from '@/i18n';
import {
  addTask,
  approveTask,
  DEFAULT_REWARD_SETTINGS,
  deleteTask,
  finishedDateISO,
  getRewardSettings,
  isChildArchived,
  listActiveChildren,
  rewardOwed,
  resetRewardSettings,
  saveParentProfile,
  selectChild,
  sendTaskBack,
  setRewardSettings,
  tasksByStatus,
  updateChildSettings,
  updateTaskReward,
  useHousehold,
  type RewardSettings,
  type ChildProfile,
  type HouseholdTask,
} from '@/utils/household';
import { ASSIGNABLE_ROOMS } from '@/utils/assigned-task-room';
import { setLanguage, useOnboarding } from '@/utils/onboarding';
import { ROOMS, type RoomSlug } from '@/utils/rooms';

// The Parent Dashboard: oversight and organisation, not pet gameplay. It shows the local parent profile, a list of
// child profiles (Add / Edit / Select), and for the selected child: assigned tasks, pending approvals, completed
// tasks, Add Task, child settings and Pet Safety; plus language settings.
//
// What is real: profiles, settings and task states are saved. What is NOT connected yet: approving a task does not
// pay Paw Tokens or pet growth, and Pet Safety isn't enforced (see features.md). The dashboard says so on screen.

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' });
}

export function ParentDashboard() {
  const router = useRouter();
  const { t, tn } = useT();
  const household = useHousehold();
  const onboarding = useOnboarding();
  useFreshHousehold(); // what is saved, whatever happened while this screen was away
  const today = useTodayISO(); // follows the local date, so "completed today" empties itself at midnight
  // Opened from the overview's "Assigned by you" / "Waiting for your approval": which child, which part (tasks or pending), maybe one task, and a
  // fresh `focus` value for each tap. The child is selected here (the dashboard's own selection: nobody starts playing), the page scrolls to the
  // list (or the task) and it lights up for a moment.
  const params = useRouteParams();
  const focusToken = params.focus;
  const lit = useFocusPulse(focusToken);
  const scrollerRef = useRef<ScrollView | null>(null);
  const listRef = useRef<View | null>(null);
  const pendingRef = useRef<View | null>(null);
  const rowRefs = useRef<Record<string, View | null>>({});
  const [taskText, setTaskText] = useState('');
  // The room a task is assigned to (none = anywhere).
  const [taskRoom, setTaskRoom] = useState<RoomSlug | undefined>(undefined);
  // The kind of the task being assigned and its reward: null = the household's current default for that kind (it follows the kind until the
  // parent changes the amount).
  const [taskImportant, setTaskImportant] = useState(false);
  const [taskReward, setTaskReward] = useState<number | null>(null);
  // The household's default amounts being edited (null = nothing edited: the saved amounts show), and the message after a save.
  const [rewardDraft, setRewardDraft] = useState<RewardSettings | null>(null);
  const [rewardMessage, setRewardMessage] = useState<'rwSaved' | 'rwDefaultSet' | 'rwFailed' | null>(null);
  // The task whose kind / reward is being edited, and the values being edited.
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editImportant, setEditImportant] = useState(false);
  const [editReward, setEditReward] = useState(0);
  const [editFailed, setEditFailed] = useState(false);
  const [editingParent, setEditingParent] = useState(false);
  const [pName, setPName] = useState('');
  const [pFamily, setPFamily] = useState('');

  // 1. select the child the parent came for (only an active child can be selected; the household checks the parent session again)
  const wantedChild = params.child;
  const householdSelected = household?.selectedChildId;
  useEffect(() => {
    if (!focusToken || !wantedChild || !household || householdSelected === wantedChild) return;
    if (household.children.some((c) => c.id === wantedChild && !isChildArchived(c))) void selectChild(wantedChild);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken, wantedChild, householdSelected]);
  // 2. once that child's list is on screen, bring the task (or the list) into view
  const listReady = !!household && householdSelected === (wantedChild ?? householdSelected);
  useEffect(() => {
    if (!focusToken || !listReady) return;
    const timer = setTimeout(() => {
      const scroll = scrollerRef.current as (ScrollView & { getInnerViewRef?: () => unknown }) | null;
      // a task, else (for "Needs approval") the pending part, else the whole list
      const target = (params.task ? rowRefs.current[params.task] : null) ?? (params.section === 'pending' ? pendingRef.current : null) ?? listRef.current;
      if (!scroll || !target) return;
      try {
        target.measureLayout((scroll.getInnerViewRef?.() ?? scroll) as never, (_x, y) => scroll.scrollTo({ y: Math.max(0, y - Spacing.three), animated: true }), () => {});
      } catch {
        // scrolling is a nicety: the list is on the page either way
      }
    }, 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken, listReady, params.task, params.section]);

  // Development only: what Family Settings found for the selected child (counts and the approval setting, no names), so a task that is not where it
  // should be can be told apart on a phone: a status that is not 'pending' (for example the approval setting is Off, which finishes a task at once)
  // versus a screen showing an older copy.
  const selectedForTrace = household?.children.find((c) => c.id === household.selectedChildId);
  const traceKey = selectedForTrace ? `${selectedForTrace.id}|${selectedForTrace.tasks.map((t) => t.status).join(',')}|${selectedForTrace.settings.requireApproval}` : '';
  useEffect(() => {
    if (!selectedForTrace) return;
    const count = (status: string) => selectedForTrace.tasks.filter((t) => t.status === status).length;
    rewardTrace('review:read', { pending: count('pending'), assigned: count('assigned'), approved: count('approved'), completed: count('completed'), requireApproval: selectedForTrace.settings.requireApproval });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceKey]);

  if (!household || !onboarding) return <PageShell>{null}</PageShell>;

  // The children shown for tasks and settings are the ACTIVE ones (an archived child is managed in the family card below).
  const children = listActiveChildren(household);
  const child: ChildProfile | null = children.find((c) => c.id === household.selectedChildId) ?? null;
  const groups = child ? tasksByStatus(child) : null;
  // Only what was finished TODAY (the day a parent approved it). Older finished tasks stay saved and are counted in Activity History.
  const completedToday = groups ? groups.completed.filter((task) => finishedDateISO(task) === today) : [];
  const rewards = getRewardSettings(household);
  const draft = rewardDraft ?? rewards;
  const draftChanged = draft.regular !== rewards.regular || draft.important !== rewards.important;
  const newTaskReward = taskReward ?? rewards[taskImportant ? 'important' : 'regular'];
  const kindName = (important: boolean) => t(important ? 'rwKindImportant' : 'rwKindRegular');

  // "Save": the amounts on screen are kept for new tasks (tasks already assigned keep theirs).
  async function saveRewards() {
    const r = await setRewardSettings(draft);
    setRewardMessage(r.ok ? 'rwSaved' : 'rwFailed');
    if (r.ok) setRewardDraft(null);
  }
  // "Set as Default": the ORIGINAL amounts (Regular 5, Important 10), saved at once. Whatever was being edited and not saved is dropped, never
  // saved: the message says so.
  async function setAsDefault() {
    const r = await resetRewardSettings();
    setRewardMessage(r.ok ? 'rwDefaultSet' : 'rwFailed');
    if (r.ok) setRewardDraft(null);
  }
  const atOriginal = draft.regular === DEFAULT_REWARD_SETTINGS.regular && draft.important === DEFAULT_REWARD_SETTINGS.important && rewards.regular === DEFAULT_REWARD_SETTINGS.regular && rewards.important === DEFAULT_REWARD_SETTINGS.important;
  async function saveTaskReward(taskId: string) {
    if (!child) return;
    const r = await updateTaskReward(child.id, taskId, { important: editImportant, reward: editReward });
    if (r.ok) {
      setEditingTaskId(null);
      setEditFailed(false);
    } else setEditFailed(true);
  }

  async function submitTask() {
    if (!child) return;
    const r = await addTask(child.id, taskText, 'parent', taskRoom, { important: taskImportant, reward: newTaskReward });
    if (r.ok) {
      setTaskText('');
      setTaskRoom(undefined);
      setTaskImportant(false);
      setTaskReward(null);
    }
  }

  function TaskRow({ task, kind }: { task: HouseholdTask; kind: 'assigned' | 'pending' | 'completed' }) {
    if (!child) return null;
    const litRow = lit && params.task === task.id;
    return (
      <View ref={(node) => { rowRefs.current[task.id] = node; }} style={[styles.taskRow, litRow && styles.lit]} testID={`task-row-${task.id}`}>
        <View style={styles.taskText}>
          <ThemedText type="smallBold">{task.text}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {kind === 'pending'
              ? `${t('waitingForApproval')} · ${formatDate(task.submittedAt)}${task.room ? ` · ${t('atParentRoomLine', { room: ROOMS[task.room].name })}` : ''}`
              : kind === 'completed'
                ? `${task.status === 'approved' ? t('approvedOn') : t('completedTasks')} · ${formatDate(task.decidedAt)}`
                : task.createdBy === 'child'
                  ? t('createdByChild')
                  : `${task.returnedAt ? `${t('atParentSentBack')} · ` : ''}${t('createdByParent')}${task.room ? ` · ${t('atParentRoomLine', { room: ROOMS[task.room].name })}` : ''}`}
          </ThemedText>
          {task.createdBy === 'parent' && typeof task.reward === 'number' ? (
            <ThemedText type="small" themeColor="textSecondary" testID={`reward-line-${task.id}`}>
              {task.status === 'approved' && task.rewardPaidAt
                ? t('rwGiven', { tokens: tn('rwTokens', task.reward) })
                : rewardOwed(task)
                  ? t('rwOwed', { tokens: tn('rwTokens', task.reward), name: child.nickname })
                  : t('rwTaskLine', { kind: kindName(task.important === true), tokens: tn('rwTokens', task.reward) })}
            </ThemedText>
          ) : null}
          {editingTaskId === task.id ? (
            <View style={styles.editBox} testID={`reward-edit-${task.id}`}>
              <View style={styles.row} accessibilityRole="radiogroup">
                {[false, true].map((important) => (
                  <Button key={String(important)} small label={kindName(important)} tone={editImportant === important ? 'mint' : 'soft'} accessibilityLabel={`${t('rwKindLabel')}: ${kindName(important)}`} onPress={() => { setEditImportant(important); setEditReward(rewards[important ? 'important' : 'regular']); }} />
                ))}
              </View>
              <RewardStepper value={editReward} onChange={setEditReward} kind={kindName(editImportant)} />
              <View style={styles.row}>
                <Button small label={t('rwEditSave')} onPress={() => void saveTaskReward(task.id)} />
                <Button small tone="soft" label={t('cancel')} onPress={() => { setEditingTaskId(null); setEditFailed(false); }} />
              </View>
              {editFailed ? <ThemedText type="small" accessibilityRole="alert">{t('rwFailed')}</ThemedText> : null}
            </View>
          ) : null}
        </View>
        <View style={styles.taskButtons}>
          {(kind === 'pending' || kind === 'assigned') && task.createdBy === 'parent' && editingTaskId !== task.id ? (
            <Button tone="soft" small label={t('rwEdit')} accessibilityLabel={`${t('rwEdit')}: ${task.text}`} onPress={() => { setEditingTaskId(task.id); setEditImportant(task.important === true); setEditReward(typeof task.reward === 'number' ? task.reward : rewards[task.important === true ? 'important' : 'regular']); setEditFailed(false); }} />
          ) : null}
          {kind === 'pending' ? (
            <>
              <Button tone="mint" label={t('approve')} accessibilityLabel={`${t('approve')}: ${task.text}`} onPress={() => void approveTask(child.id, task.id)} />
              <Button tone="soft" label={t('sendBack')} accessibilityLabel={`${t('sendBack')}: ${task.text}`} onPress={() => void sendTaskBack(child.id, task.id)} />
            </>
          ) : null}
          {kind === 'assigned' ? (
            <>
              <Button tone="danger" label={t('deleteTask')} accessibilityLabel={`${t('deleteTask')}: ${task.text}`} onPress={() => void deleteTask(child.id, task.id)} />
            </>
          ) : null}
          {kind === 'completed' ? (
            <Button tone="danger" label={t('deleteTask')} accessibilityLabel={`${t('deleteTask')}: ${task.text}`} onPress={() => void deleteTask(child.id, task.id)} />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <PageShell maxWidth={900} scrollerRef={scrollerRef}>
      <View style={styles.head}>
        <ThemedText style={styles.title}>{t('dashboardTitle')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {household.parent
            ? `${household.parent.displayName}${household.parent.familyName ? ` · ${household.parent.familyName}` : ''}`
            : t('dashboardFor')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t('localProfileNote')}
        </ThemedText>
      </View>

      {/* Parent PIN (renders nothing unless family mode is on) */}
      <ParentPinCard />

      {/* Parent profile */}
      <Card title={t('parentProfile')}>
        {editingParent ? (
          <>
            <Field label={t('parentNameLabel')} value={pName} onChangeText={setPName} maxLength={40} />
            <Field label={t('familyNameLabel')} value={pFamily} onChangeText={setPFamily} maxLength={40} />
            <View style={styles.row}>
              <Button
                label={t('save')}
                onPress={async () => {
                  const r = await saveParentProfile(pName, pFamily);
                  if (r.ok) setEditingParent(false);
                }}
              />
              <Button label={t('cancel')} tone="soft" onPress={() => setEditingParent(false)} />
            </View>
          </>
        ) : (
          <View style={styles.row}>
            <ThemedText type="smallBold">{household.parent?.displayName ?? '—'}</ThemedText>
            <Button
              tone="soft"
              label={t('editParent')}
              onPress={() => {
                setPName(household.parent?.displayName ?? '');
                setPFamily(household.parent?.familyName ?? '');
                setEditingParent(true);
              }}
            />
          </View>
        )}
      </Card>

      {/* Child profiles: add, rename, archive and restore, with clear messages (see family-management-card.tsx) */}
      <FamilyManagementCard selectedChildId={household.selectedChildId} onSelect={(id) => void selectChild(id)} />

      {/* Family health: only shown when something needs a look (family mode only) */}
      <FamilyHealthCard />

      {/* Private notifications of an earlier profile that could not be confirmed as cleared (family mode only) */}
      <NotificationCleanupNotice />

      {/* Paw Token rewards: the household's default amounts for new tasks (parent-only: saving needs the unlocked parent area) */}
      <Card title={t('rwTitle')}>
        <ThemedText type="small">{t('rwRegular')}</ThemedText>
        <RewardStepper value={draft.regular} onChange={(v) => { setRewardMessage(null); setRewardDraft({ ...draft, regular: v }); }} kind={t('rwRegular')} />
        <ThemedText type="small">{t('rwImportant')}</ThemedText>
        <RewardStepper value={draft.important} onChange={(v) => { setRewardMessage(null); setRewardDraft({ ...draft, important: v }); }} kind={t('rwImportant')} />
        <View style={styles.row}>
          <Button label={t('rwSave')} disabled={!draftChanged} onPress={() => void saveRewards()} />
          <Button tone="soft" label={t('rwSetDefault')} disabled={atOriginal} onPress={() => void setAsDefault()} />
        </View>
        {rewardMessage ? (
          <ThemedText type="small" accessibilityRole="alert">
            {t(rewardMessage)}
          </ThemedText>
        ) : null}
      </Card>

      {!child ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {children.length === 0 ? t('noChildrenText') : t('selectChildFirst')}
          </ThemedText>
        </Card>
      ) : (
        <>
          <ThemedText style={styles.sectionTitle}>{child.nickname}</ThemedText>

          {/* One list: what is waiting for the parent's review first (Approve / Try again right there), then what is still to do or sent back. */}
          <View ref={listRef} collapsable={false} testID="child-tasks-list" style={lit && !params.task && !(params.section === 'pending' && groups!.pending.length > 0) ? styles.litList : undefined}>
          <Card title={t('hhTitle', { name: child.nickname })} color={groups!.pending.length > 0 ? '#FFF4E3' : undefined}>
            {groups!.pending.length === 0 && groups!.assigned.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('hhNone')}
              </ThemedText>
            ) : null}
            {groups!.pending.length > 0 ? (
              // The pending approvals: Approve and Send back on each, lit for a moment when the parent came from "Needs approval".
              <View ref={pendingRef} collapsable={false} testID="pending-approvals" style={[styles.pendingBlock, lit && !params.task && params.section === 'pending' && styles.litList]}>
                <ThemedText type="smallBold">{t('hhWaiting')}</ThemedText>
                {groups!.pending.map((task) => (
                  <TaskRow key={task.id} task={task} kind="pending" />
                ))}
              </View>
            ) : null}
            {groups!.assigned.length > 0 ? (
              <>
                <ThemedText type="smallBold">{t('hhToDo')}</ThemedText>
                {groups!.assigned.map((task) => (
                  <TaskRow key={task.id} task={task} kind="assigned" />
                ))}
              </>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              {t('rewardsNote')}
            </ThemedText>
          </Card>
          </View>

          <Card title={t('completedToday')}>
            {completedToday.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('noCompleted')}
              </ThemedText>
            ) : (
              completedToday.map((task) => <TaskRow key={task.id} task={task} kind="completed" />)
            )}
          </Card>

          <Card title={t('addTask')}>
            <Field label={t('taskPlaceholder')} placeholder={t('taskPlaceholder')} value={taskText} onChangeText={setTaskText} maxLength={120} />
            <ThemedText type="smallBold">{t('atRoomPick')}</ThemedText>
            <View style={styles.row} accessibilityRole="radiogroup">
              <Button label={t('atAnyRoom')} small tone={taskRoom === undefined ? 'mint' : 'soft'} onPress={() => setTaskRoom(undefined)} accessibilityLabel={`${t('atRoomPick')}: ${t('atAnyRoom')}`} />
              {ASSIGNABLE_ROOMS.map((slug) => (
                <Button key={slug} label={ROOMS[slug].name} small tone={taskRoom === slug ? 'mint' : 'soft'} onPress={() => setTaskRoom(slug)} accessibilityLabel={`${t('atRoomPick')}: ${ROOMS[slug].name}`} />
              ))}
            </View>
            <ThemedText type="smallBold">{t('rwKindLabel')}</ThemedText>
            <View style={styles.row} accessibilityRole="radiogroup">
              {[false, true].map((important) => (
                <Button key={String(important)} small label={kindName(important)} tone={taskImportant === important ? 'mint' : 'soft'} accessibilityLabel={`${t('rwKindLabel')}: ${kindName(important)}`} onPress={() => { setTaskImportant(important); setTaskReward(null); }} />
              ))}
            </View>
            <ThemedText type="smallBold">{t('rwRewardLabel')}</ThemedText>
            <RewardStepper value={newTaskReward} onChange={setTaskReward} kind={kindName(taskImportant)} />
            <View style={styles.row}>
              <Button label={t('assign')} onPress={() => void submitTask()} disabled={!taskText.trim()} />
            </View>
          </Card>

          <Card title={t('childSettings')}>
            <ToggleRow
              label={t('childCanCreate')}
              value={child.settings.canCreateTasks}
              onLabel={t('on')}
              offLabel={t('off')}
              onChange={(v) => void updateChildSettings(child.id, { canCreateTasks: v })}
            />
            <ToggleRow
              label={t('requireApproval')}
              value={child.settings.requireApproval}
              onLabel={t('on')}
              offLabel={t('off')}
              onChange={(v) => void updateChildSettings(child.id, { requireApproval: v })}
            />
          </Card>

          <Card title={t('petSafety')}>
            <ChoiceCard
              title={t('gentleMode')}
              description={t('gentleDesc')}
              selected={child.settings.petSafety === 'gentle'}
              onPress={() => void updateChildSettings(child.id, { petSafety: 'gentle' })}
            />
            <ChoiceCard
              title={t('classicMode')}
              description={t('classicDesc')}
              selected={child.settings.petSafety === 'classic'}
              onPress={() => void updateChildSettings(child.id, { petSafety: 'classic' })}
            />
          </Card>
        </>
      )}

      <Card title={t('languageSettings')}>
        {LANGUAGES.map((l) => (
          <ChoiceCard key={l.code} title={l.nativeName} selected={onboarding.language === l.code} onPress={() => void setLanguage(l.code as LanguageCode)} />
        ))}
      </Card>

      <View style={styles.row}>
        <Button label={t('back')} tone="soft" onPress={() => router.replace('/')} />
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  head: { gap: 2, paddingTop: Spacing.two },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  sectionTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', marginTop: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', alignItems: 'center' },
  empty: { gap: 2 },
  childRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', padding: Spacing.two, borderRadius: Spacing.three, borderWidth: 2, borderColor: 'transparent' },
  childRowSelected: { borderColor: '#A78BDB', backgroundColor: 'rgba(228, 218, 247, 0.6)' },
  childInfo: { flex: 1, minWidth: 140, gap: 2 },
  childName: { fontSize: 17, lineHeight: 22 },
  editRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, flexWrap: 'wrap', flex: 1 },
  editField: { flexGrow: 1, minWidth: 180 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', paddingVertical: Spacing.one, borderBottomWidth: 1, borderColor: 'rgba(150,130,160,0.2)' },
  taskText: { flex: 1, minWidth: 160, gap: 2 },
  taskButtons: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', maxWidth: '100%', flexShrink: 1 },
  editBox: { gap: Spacing.one, paddingVertical: Spacing.one },
  lit: { backgroundColor: '#FFF1B8', borderRadius: Spacing.two },
  pendingBlock: { gap: Spacing.one, padding: Spacing.one },
  litList: { borderRadius: Spacing.four, borderWidth: 2, borderColor: '#F2C94C' },
});
