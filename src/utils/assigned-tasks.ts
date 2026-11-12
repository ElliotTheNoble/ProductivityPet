import { useActiveProfileId } from '@/hooks/use-active-profile';
import { ASSIGNABLE_ROOMS } from '@/utils/assigned-task-room';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { getHouseholdIntegrity, isChildArchived, markTaskDone, peekHousehold, undoTaskSubmission, useHousehold, type Household } from '@/utils/household';
import { MAIN_PROFILE_ID, getActiveProfileId, isProfileReleased } from '@/utils/profiles';
import type { RoomSlug } from '@/utils/rooms';

// The CHILD side of the tasks a parent assigns (Phase 2, Step 4A). A child's game shows the tasks assigned to THIS child, in the room the
// parent chose, and lets the child hand one in. Rules:
//  - only the active profile's own assignments are ever returned: another child's tasks, Main's and anything of the parent's profile
//    never leave this file (the household record is read through assignedTasksFor, which looks at one child only);
//  - an archived child, a duplicated id, Main and a profile that is not a child get nothing;
//  - only tasks a PARENT assigned count ("from my parent"); done ones (approved / completed) are not outstanding;
//  - these tasks are NOT copied into the child's own task list, so they never touch the personal task list, its streaks or its Stats, and
//    one task can only ever be one record (the household one), so it cannot be listed or counted twice;
//  - handing a task in uses the existing household flow unchanged (markTaskDone: pending when the child's setting needs a parent's
//    approval, completed otherwise). Nothing is paid here (rewards come in a later step).

// to-do: assigned, never handed in or sent back. sent-back: a parent asked for another try. waiting: handed in, waiting for the parent.
export type AssignedState = 'to-do' | 'sent-back' | 'waiting';

export type AssignedTaskView = { id: string; text: string; room: RoomSlug | null; state: AssignedState };

export type RoomKey = RoomSlug | 'anywhere';
export const ROOM_KEYS: readonly RoomKey[] = [...ASSIGNABLE_ROOMS, 'anywhere'];

const NONE: AssignedTaskView[] = [];

// The assigned, not yet finished tasks of ONE child, in the order the parent added them.
export function assignedTasksFor(household: Household | null, profileId: string, duplicateIds: readonly string[] = []): AssignedTaskView[] {
  if (!household || profileId === MAIN_PROFILE_ID || duplicateIds.includes(profileId)) return NONE;
  const child = household.children.find((c) => c.id === profileId);
  if (!child || isChildArchived(child)) return NONE;
  const seen = new Set<string>();
  const out: AssignedTaskView[] = [];
  for (const task of child.tasks) {
    if (task.createdBy !== 'parent' || seen.has(task.id)) continue;
    if (task.status !== 'assigned' && task.status !== 'pending') continue;
    seen.add(task.id);
    out.push({
      id: task.id,
      text: task.text,
      room: task.room ?? null,
      state: task.status === 'pending' ? 'waiting' : task.returnedAt ? 'sent-back' : 'to-do',
    });
  }
  return out;
}

// What needs the child to act: to do, or sent back. Waiting-for-parent tasks are not outstanding for the child.
export const isOutstanding = (view: AssignedTaskView): boolean => view.state !== 'waiting';

export function outstandingByRoom(views: readonly AssignedTaskView[]): Record<RoomKey, number> {
  const counts = Object.fromEntries(ROOM_KEYS.map((key) => [key, 0])) as Record<RoomKey, number>;
  for (const view of views) if (isOutstanding(view)) counts[view.room ?? 'anywhere'] += 1;
  return counts;
}

export const outstandingTotal = (views: readonly AssignedTaskView[]): number => views.filter(isOutstanding).length;

export const viewsForRoom = (views: readonly AssignedTaskView[], room: RoomKey): AssignedTaskView[] => views.filter((view) => (view.room ?? 'anywhere') === room);

// Is the profile playing right now a child of the household (family mode on, a known, not archived child)? The child's simplified Home card and
// Tasks tab follow this; Main, a single-player profile and anything unknown keep the screens exactly as they were.
export function useIsChildProfile(): boolean {
  const household = useHousehold();
  const profileId = useActiveProfileId();
  if (!FAMILY_MODE_ENABLED || !household || profileId === MAIN_PROFILE_ID || getHouseholdIntegrity().duplicateChildIds.includes(profileId)) return false;
  const child = household.children.find((c) => c.id === profileId);
  return !!child && !isChildArchived(child);
}

// The active child's assignments, kept live (it follows the household as it changes).
export function useAssignedTasks(): AssignedTaskView[] {
  const household = useHousehold();
  const profileId = useActiveProfileId();
  if (!FAMILY_MODE_ENABLED) return NONE;
  return assignedTasksFor(household, profileId, getHouseholdIntegrity().duplicateChildIds);
}

export type SubmitResult = 'sent' | 'not-yours' | 'failed';

// The child hands in one of THEIR OWN tasks. Anything that is not an outstanding task of the active child is refused without touching
// anything. Handing in the same task twice cannot make a second record: the household flow only accepts a task that is 'assigned'.
export async function submitAssignedTask(taskId: string): Promise<SubmitResult> {
  if (!FAMILY_MODE_ENABLED || isProfileReleased()) return 'not-yours';
  const profileId = getActiveProfileId();
  const mine = assignedTasksFor(peekHousehold(), profileId, getHouseholdIntegrity().duplicateChildIds).find((view) => view.id === taskId);
  if (!mine || mine.state === 'waiting') return 'not-yours';
  const result = await markTaskDone(profileId, taskId);
  return result.ok ? 'sent' : 'failed';
}

export type UndoResult = 'undone' | 'not-yours' | 'too-late';

// The child takes back THEIR OWN hand-in while it is still waiting for the parent. Refused (nothing changes) for anyone else's task, for a
// task that is not waiting, and for one the parent already approved. It only moves the task back to to-do / sent-back: it never touches an
// approval, a reward or Paw Tokens, and an undo at the same moment as a parent's approval cannot both succeed (one household step).
export async function undoAssignedTask(taskId: string): Promise<UndoResult> {
  if (!FAMILY_MODE_ENABLED || isProfileReleased()) return 'not-yours';
  const profileId = getActiveProfileId();
  const mine = assignedTasksFor(peekHousehold(), profileId, getHouseholdIntegrity().duplicateChildIds).find((view) => view.id === taskId);
  if (!mine) return 'not-yours'; // not this child's task, or it is already approved or completed (finished tasks are not in the list)
  if (mine.state !== 'waiting') return 'too-late';
  const result = await undoTaskSubmission(profileId, taskId);
  return result.ok ? 'undone' : 'too-late';
}
