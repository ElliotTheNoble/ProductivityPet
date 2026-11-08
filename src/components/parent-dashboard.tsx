import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, ChoiceCard, Field, PageShell, ToggleRow } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { FamilyHealthCard } from '@/components/family-health-card';
import { NotificationCleanupNotice } from '@/components/notification-cleanup-notice';
import { FamilyManagementCard } from '@/components/family-management-card';
import { ParentPinCard } from '@/components/parent-pin-card';
import { LANGUAGES, useT, type LanguageCode, type StringKey, getLocale } from '@/i18n';
import {
  addTask,
  approveTask,
  deleteTask,
  listActiveChildren,
  markTaskDone,
  saveParentProfile,
  selectChild,
  sendTaskBack,
  tasksByStatus,
  updateChildSettings,
  useHousehold,
  type ChildProfile,
  type HouseholdTask,
} from '@/utils/household';
import { setLanguage, useOnboarding } from '@/utils/onboarding';

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
  const { t } = useT();
  const household = useHousehold();
  const onboarding = useOnboarding();
  const [taskText, setTaskText] = useState('');
  const [editingParent, setEditingParent] = useState(false);
  const [pName, setPName] = useState('');
  const [pFamily, setPFamily] = useState('');
  const [note, setNote] = useState<StringKey | null>(null);

  if (!household || !onboarding) return <PageShell>{null}</PageShell>;

  // The children shown for tasks and settings are the ACTIVE ones (an archived child is managed in the family card below).
  const children = listActiveChildren(household);
  const child: ChildProfile | null = children.find((c) => c.id === household.selectedChildId) ?? null;
  const groups = child ? tasksByStatus(child) : null;

  async function submitTask(by: 'parent' | 'child') {
    if (!child) return;
    const r = await addTask(child.id, taskText, by);
    if (r.ok) {
      setTaskText('');
      setNote(null);
    } else if (r.reason === 'not-allowed') setNote('noteChildCreateOff');
  }

  function TaskRow({ task, kind }: { task: HouseholdTask; kind: 'assigned' | 'pending' | 'completed' }) {
    if (!child) return null;
    return (
      <View style={styles.taskRow}>
        <View style={styles.taskText}>
          <ThemedText type="smallBold">{task.text}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {kind === 'pending'
              ? `${t('waitingForApproval')} · ${formatDate(task.submittedAt)}`
              : kind === 'completed'
                ? `${task.status === 'approved' ? t('approvedOn') : t('completedTasks')} · ${formatDate(task.decidedAt)}`
                : task.createdBy === 'child'
                  ? t('createdByChild')
                  : t('createdByParent')}
          </ThemedText>
        </View>
        <View style={styles.taskButtons}>
          {kind === 'pending' ? (
            <>
              <Button tone="mint" label={t('approve')} accessibilityLabel={`${t('approve')}: ${task.text}`} onPress={() => void approveTask(child.id, task.id)} />
              <Button tone="soft" label={t('sendBack')} accessibilityLabel={`${t('sendBack')}: ${task.text}`} onPress={() => void sendTaskBack(child.id, task.id)} />
            </>
          ) : null}
          {kind === 'assigned' ? (
            <>
              <Button tone="soft" label={t('previewAsChild')} accessibilityLabel={`${t('previewAsChild')}: ${task.text}`} onPress={() => void markTaskDone(child.id, task.id)} />
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
    <PageShell maxWidth={900}>
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

      {!child ? (
        <Card>
          <ThemedText type="small" themeColor="textSecondary">
            {children.length === 0 ? t('noChildrenText') : t('selectChildFirst')}
          </ThemedText>
        </Card>
      ) : (
        <>
          <ThemedText style={styles.sectionTitle}>{child.nickname}</ThemedText>

          <Card title={t('assignedTasks')}>
            {groups!.assigned.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('noAssigned')}
              </ThemedText>
            ) : (
              groups!.assigned.map((task) => <TaskRow key={task.id} task={task} kind="assigned" />)
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {t('previewNote')}
            </ThemedText>
          </Card>

          <Card title={t('pendingApprovals')} color="#FFF4E3">
            {groups!.pending.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('noPending')}
              </ThemedText>
            ) : (
              groups!.pending.map((task) => <TaskRow key={task.id} task={task} kind="pending" />)
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {t('rewardsNote')}
            </ThemedText>
          </Card>

          <Card title={t('completedTasks')}>
            {groups!.completed.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t('noCompleted')}
              </ThemedText>
            ) : (
              groups!.completed.map((task) => <TaskRow key={task.id} task={task} kind="completed" />)
            )}
          </Card>

          <Card title={t('addTask')}>
            <Field label={t('taskPlaceholder')} placeholder={t('taskPlaceholder')} value={taskText} onChangeText={setTaskText} maxLength={120} />
            <View style={styles.row}>
              <Button label={t('assign')} onPress={() => void submitTask('parent')} disabled={!taskText.trim()} />
              {child.settings.canCreateTasks ? (
                <Button label={`${t('previewAsChild')}: ${t('add')}`} tone="soft" onPress={() => void submitTask('child')} disabled={!taskText.trim()} />
              ) : null}
            </View>
            {note ? (
              <ThemedText type="small" accessibilityRole="alert">
                {t(note)}
              </ThemedText>
            ) : null}
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
              help={t('requireApprovalHelp')}
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
            <ThemedText type="smallBold" style={styles.notice}>
              {t('petSafetyNotEnforced')}
            </ThemedText>
          </Card>
        </>
      )}

      <Card title={t('languageSettings')}>
        {LANGUAGES.map((l) => (
          <ChoiceCard key={l.code} title={l.nativeName} selected={onboarding.language === l.code} onPress={() => void setLanguage(l.code as LanguageCode)} />
        ))}
        <ThemedText type="small" themeColor="textSecondary">
          {t('languageNote')}
        </ThemedText>
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
  notice: { color: '#8A5A00' },
});
