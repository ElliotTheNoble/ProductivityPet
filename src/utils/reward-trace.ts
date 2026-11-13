import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';

// DEVELOPMENT ONLY (never in a release build, and only with family mode on): a short line in the Metro terminal each time the child's session
// looks for Paw Token rewards to collect ("LOG [reward-trace] ..."), so a reward that did not arrive can be told apart from one that did on a real
// phone: did the collection run at all, how many approved rewards were waiting, and what happened to each one.
// It carries only fixed words and numbers: never a task title, a name, a PIN or a balance.
export type RewardTraceEvent = 'collect:start' | 'collect:skipped' | 'collect:task' | 'collect:end' | 'review:read';
export type RewardTraceWord = 'released' | 'main' | 'not-a-child' | 'unreadable' | 'paid' | 'already' | 'failed' | 'marked' | 'mark-failed' | 'left-profile';
export type RewardTraceData = Record<string, number | boolean | RewardTraceWord>;

export function rewardTrace(event: RewardTraceEvent, data: RewardTraceData = {}): void {
  if (!(__DEV__ && FAMILY_MODE_ENABLED)) return;
  console.log(`[reward-trace] ${event} ${JSON.stringify(data)}`);
}
