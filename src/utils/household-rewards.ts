import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { ensureHouseholdLoaded, getHouseholdIntegrity, isChildArchived, markRewardCollected, rewardOwed, subscribeToHousehold } from '@/utils/household';
import { awardHouseholdTaskReward } from '@/utils/paw-tokens';
import { MAIN_PROFILE_ID, getActiveProfileId, isProfileReleased } from '@/utils/profiles';
import { rewardTrace } from '@/utils/reward-trace';

// Collecting the Paw Tokens of tasks a parent approved.
//
// Why the CHILD's profile collects them: a profile's wallet is part of that profile's own storage and is held in memory only while the profile
// is open (changing it from outside would be overwritten by the open profile's next save, or race with it). The household record, which the
// parent changes, is device-level. So approving a task is ONE saved change in the household (status 'approved', with the reward the task
// carries), and the child's own session then pays it, once, into the child's own wallet using the same earnings code as everything else
// (see awardHouseholdTaskReward in @/utils/paw-tokens.ts), and marks the task collected.
//
// No duplicate payment is possible: the credit and the note "this task was paid" are ONE write in the child's own family record (see
// creditHouseholdReward in @/utils/pet-family.ts), so an interrupted save leaves both or neither. The collected mark in the household is only
// bookkeeping: whatever happens (a refresh, a restart, a failed save), a task is paid at most once, and a mark that could not be saved is tried
// again later without paying again. A reward whose save failed is not marked collected, so it is retried.
//
// Only the active CHILD of the household collects, and only that child's own approved tasks. Main, an archived child, an unknown profile and
// two records sharing an id collect nothing.

let chain: Promise<unknown> = Promise.resolve();

// Pays every approved, uncollected reward of the child who is playing right now. Resolves to the number of tokens added now.
export function collectHouseholdRewards(): Promise<number> {
  const run = async (): Promise<number> => {
    if (!FAMILY_MODE_ENABLED) return 0;
    if (isProfileReleased()) {
      rewardTrace('collect:skipped', { why: 'released' });
      return 0;
    }
    const profileId = getActiveProfileId();
    if (profileId === MAIN_PROFILE_ID) {
      rewardTrace('collect:skipped', { why: 'main' });
      return 0;
    }
    const household = await ensureHouseholdLoaded();
    const integrity = getHouseholdIntegrity();
    if (integrity.loadFailed || integrity.duplicateChildIds.includes(profileId)) {
      rewardTrace('collect:skipped', { why: 'unreadable' });
      return 0;
    }
    const child = household.children.find((c) => c.id === profileId);
    if (!child || isChildArchived(child)) {
      rewardTrace('collect:skipped', { why: 'not-a-child' });
      return 0;
    }
    const owed = child.tasks.filter(rewardOwed);
    rewardTrace('collect:start', { owed: owed.length, approved: child.tasks.filter((t) => t.status === 'approved').length });
    let added = 0;
    for (const task of owed) {
      if (getActiveProfileId() !== profileId) {
        rewardTrace('collect:task', { result: 'left-profile' });
        break; // the child left while this ran: nothing is paid into another profile
      }
      const result = await awardHouseholdTaskReward(task.id, task.reward as number);
      if (result === 'failed') {
        rewardTrace('collect:task', { result: 'failed' });
        continue; // nothing was paid; the next call tries again
      }
      if (result === 'paid') added += task.reward as number;
      const marked = await markRewardCollected(child.id, task.id); // bookkeeping only: if it fails, the next call finds the task already paid and just marks it
      rewardTrace('collect:task', { result, marked: marked.ok });
    }
    rewardTrace('collect:end', { added });
    return added;
  };
  const next = chain.then(run, run);
  chain = next.catch(() => 0);
  return next.catch(() => 0);
}

// Keeps collecting while the app is open: once now and after every household change (a parent approving while the child's session is open
// somewhere else, a reload...). Returns the stop function.
export function startHouseholdRewardCollection(): () => void {
  if (!FAMILY_MODE_ENABLED) return () => undefined;
  void collectHouseholdRewards();
  return subscribeToHousehold(() => {
    void collectHouseholdRewards();
  });
}
