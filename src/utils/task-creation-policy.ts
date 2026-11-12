import { useActiveProfileId } from '@/hooks/use-active-profile';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { getHouseholdIntegrity, isChildArchived, peekHousehold, useHousehold, type Household } from '@/utils/household';
import { MAIN_PROFILE_ID, getActiveProfileId, isProfileReleased } from '@/utils/profiles';
import type { Task } from '@/utils/tasks';

// WHO MAY CREATE PERSONAL TASKS (the tasks in a profile's own task list: the Tasks screen, the rooms). One rule, asked by every place that
// shows a way to add one AND by every place that would save one, so a hidden button is never the only thing standing in the way.
//  - Family mode off (every user today): nobody is restricted, nothing changes.
//  - The original Main profile, which is an adult's (or the single player's) own space: never restricted. Its saved tasks are never touched.
//  - A child's profile: NOT allowed by default. A parent will later be able to allow it per child (ChildSettings.allowPersonalTasks, which
//    has no screen yet: absent means "not allowed"). Until then a child plays with the tasks their parent assigns and the tasks they
//    already have; nothing existing is removed.
//  - Anything unknown (nobody open, an archived or unreadable child record, a profile that is neither Main nor a child): not allowed.
export function mayCreatePersonalTasks(household: Household | null, profileId: string | null, duplicateIds: readonly string[] = []): boolean {
  if (!FAMILY_MODE_ENABLED) return true;
  if (profileId === null) return false;
  if (profileId === MAIN_PROFILE_ID) return true;
  if (!household || duplicateIds.includes(profileId)) return false;
  const child = household.children.find((c) => c.id === profileId);
  return !!child && !isChildArchived(child) && child.settings.allowPersonalTasks === true;
}

// For handlers: may the profile that is open RIGHT NOW create a personal task?
export function canCreatePersonalTasksNow(): boolean {
  if (!FAMILY_MODE_ENABLED) return true;
  return mayCreatePersonalTasks(peekHousehold(), isProfileReleased() ? null : getActiveProfileId(), getHouseholdIntegrity().duplicateChildIds);
}

// For screens: the same answer, kept live.
export function useCanCreatePersonalTasks(): boolean {
  const household = useHousehold();
  const profileId = useActiveProfileId();
  if (!FAMILY_MODE_ENABLED) return true;
  return mayCreatePersonalTasks(household, profileId, getHouseholdIntegrity().duplicateChildIds);
}

// The save-time guard: of a list about to be saved, drops any task that is NEW compared with what is saved now, when this profile may not
// create tasks. Everything that already exists (edits, completions, deletions of existing tasks) passes through untouched. `previous` null
// means nothing is known yet, which cannot happen for a screen that read the list first; nothing is dropped then.
export function withoutDisallowedAdditions(previous: readonly Task[] | null, next: Task[]): Task[] {
  if (previous === null || canCreatePersonalTasksNow()) return next;
  const known = new Set(previous.map((task) => task.id));
  const kept = next.filter((task) => known.has(task.id));
  return kept.length === next.length ? next : kept;
}
