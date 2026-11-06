import type { StringKey } from '@/i18n';
import type { ParentAuthStatus } from '@/hooks/use-parent-auth-status';
import { getParentAccess, type ParentAccess } from '@/utils/parent-gate';
import { getHouseholdIntegrity, ensureHouseholdLoaded, hasAnyChildRecord, listActiveChildren, reloadHousehold, type ChildProfile } from '@/utils/household';
import { getSelectableChildren, reconcileFamilyProfiles, type CareSummary } from '@/utils/family-profiles';
import { ensureProfilesReady, getProfilesStatus, type SwitchResult } from '@/utils/profiles';

// The logic behind the family picker that needs no screen: who is offered, what each care badge says, what a failed switch is
// called, and what each child's avatar looks like. Nothing here writes anything, and nothing here loads any profile's game data.

// ---------------------------------------------------------------------------------------------------------
// who is offered, on a cold start

export type PickerProblem = 'safe-mode' | 'household-unreadable' | 'children-not-ready' | null;

export type PickerDecision =
  // Nobody to choose between (the household has NO child record at all): the app opens exactly as it always has.
  | { kind: 'skip' }
  // The picker is shown. `children` is empty when `problem` says the players cannot be offered right now.
  | { kind: 'picker'; children: ChildProfile[]; problem: PickerProblem };

// Looks at the registry and the household and decides whether the picker is needed. It only reads, plus the idempotent
// reconciliation that adds missing registry records for household children (see @/utils/family-profiles.ts). It never
// rejects: anything unexpected becomes the "household unreadable" problem, never an empty "nobody here" (which would open Main).
export async function decidePicker(): Promise<PickerDecision> {
  try {
    await ensureProfilesReady();
    await reconcileFamilyProfiles().catch(() => undefined);
    let household = await ensureHouseholdLoaded();
    if (getHouseholdIntegrity().loadFailed && (await reloadHousehold())) household = await ensureHouseholdLoaded(); // a retry after a failed read
    if (getHouseholdIntegrity().loadFailed) return { kind: 'picker', children: [], problem: 'household-unreadable' };
    const active = listActiveChildren(household);
    // The picker (and with it the Parent PIN for Main) is skipped ONLY when the household has no child record at all. Archiving every
    // child must never take away the protection of Main (Stage 4 decision), so a household whose children are all archived (or
    // whose records cannot be offered, for example duplicate ids) still shows the picker, with Main behind the PIN and nobody else
    // on offer. A household that has children but cannot offer them right now (storage in safe mode, a profile that could not be
    // linked yet) shows the picker with the reason: it must never fall through to opening Main without the PIN.
    const anyChild = hasAnyChildRecord(household, getHouseholdIntegrity());
    if (getProfilesStatus().state !== 'ready') {
      return anyChild ? { kind: 'picker', children: [], problem: 'safe-mode' } : { kind: 'skip' };
    }
    if (!anyChild) return { kind: 'skip' };
    const children = active.length > 0 ? await getSelectableChildren() : [];
    return { kind: 'picker', children, problem: children.length < active.length ? 'children-not-ready' : null };
  } catch {
    return { kind: 'picker', children: [], problem: 'household-unreadable' };
  }
}

// ---------------------------------------------------------------------------------------------------------
// care badges

export type BadgeKind = 'checking' | 'healthy' | 'needs-care' | 'sick' | 'critical' | 'deceased' | 'new' | 'unreadable';

// `undefined` = not worked out yet. An unreadable record is NEVER shown as healthy, and neither is a record still being read.
export function badgeFor(summary: CareSummary | undefined): BadgeKind {
  if (!summary) return 'checking';
  if (summary.status === 'not-started') return 'new';
  if (summary.status === 'unreadable') return 'unreadable';
  switch (summary.worst) {
    case 'critical':
      return 'critical';
    case 'sick':
      return 'sick';
    case 'deceased':
      return 'deceased';
    case 'needs-care':
      return 'needs-care';
    default:
      return 'healthy';
  }
}

export const BADGE_LABEL: Record<BadgeKind, StringKey> = {
  checking: 'fpBadgeChecking',
  healthy: 'fpBadgeHealthy',
  'needs-care': 'fpBadgeNeedsCare',
  sick: 'fpBadgeSick',
  critical: 'fpBadgeCritical',
  deceased: 'fpBadgeDeceased',
  new: 'fpBadgeNew',
  unreadable: 'fpBadgeUnreadable',
};

// Pastel fill, a darker edge and a small picture for each badge. The words always say the same thing: colour is never the only signal.
export const BADGE_LOOK: Record<BadgeKind, { fill: string; edge: string; icon: string }> = {
  checking: { fill: '#F1ECF7', edge: '#D9CFE6', icon: '⏳' },
  healthy: { fill: '#D6F2E4', edge: '#7FD9B6', icon: '😊' },
  'needs-care': { fill: '#FCE9C9', edge: '#F0B86E', icon: '🥣' },
  sick: { fill: '#FBD9B8', edge: '#E69A5B', icon: '🤒' },
  critical: { fill: '#F9C9C9', edge: '#D96B6B', icon: '🚨' },
  deceased: { fill: '#E4DAF7', edge: '#A78BDB', icon: '🕊️' },
  new: { fill: '#D4EAF6', edge: '#7DB8D6', icon: '🥚' },
  unreadable: { fill: '#E9E5EE', edge: '#A99FB5', icon: '❔' },
};

// ---------------------------------------------------------------------------------------------------------
// a failed switch

export type SwitchFailureReason = Extract<SwitchResult, { ok: false }>['reason'];

export const SWITCH_FAILURE_TEXT: Record<SwitchFailureReason, StringKey> = {
  timeout: 'fpErrTimeout',
  'unsaved-changes': 'fpErrUnsaved',
  storage: 'fpErrStorage',
  busy: 'fpErrBusy',
  conflict: 'fpErrConflict',
  'unknown-profile': 'fpErrUnknown',
  unavailable: 'fpErrUnavailable',
};

// ---------------------------------------------------------------------------------------------------------
// avatars: a friendly pastel picture per child, worked out from the child's permanent id (so it never changes and nothing is stored)

const AVATARS: { emoji: string; fill: string }[] = [
  { emoji: '🐱', fill: '#FBD9B8' },
  { emoji: '🐶', fill: '#CFE8D9' },
  { emoji: '🐰', fill: '#F7C9DB' },
  { emoji: '🐻', fill: '#E4DAF7' },
  { emoji: '🦊', fill: '#FCEBB0' },
  { emoji: '🐼', fill: '#CBE3F0' },
  { emoji: '🐸', fill: '#D4EDC9' },
  { emoji: '🦄', fill: '#E8D5F2' },
  { emoji: '🐨', fill: '#D9E3F5' },
  { emoji: '🦁', fill: '#FBE3B0' },
  { emoji: '🐯', fill: '#FAD7C4' },
  { emoji: '🐹', fill: '#F2DCC9' },
];

export function avatarFor(id: string): { emoji: string; fill: string } {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}

// ---------------------------------------------------------------------------------------------------------
// may Main (and the parent-only "Add a child") be entered? Fails closed: only a Parent PIN that exists, is usable and has its
// recovery code confirmed lets the picker ask for it. Nothing here creates, resets or repairs a PIN.
//
//  'allowed'          a working PIN exists: the picker asks for it (or the parent area is already open from that PIN)
//  'no-pin'           no PIN was ever set up (or an unfinished setup, which protects nothing): Main stays locked
//  'unconfirmed'      a PIN exists but its recovery code was never confirmed (an interrupted setup or recovery)
//  'verifier-missing' family data says a PIN exists but it cannot be found or read (a restore, a new device, damaged storage)
//  'unavailable'      the PIN system cannot run here (no secure storage, or not started)
//  'checking'         not known yet (nothing is allowed meanwhile)
export type MainEntry = 'checking' | 'allowed' | 'no-pin' | 'unconfirmed' | 'verifier-missing' | 'unavailable';

export function mainEntry(access: ParentAccess, auth: ParentAuthStatus): MainEntry {
  if (access.state === 'checking' || auth.loading) return 'checking';
  if (auth.state === 'verifier-missing' || (access.state === 'locked' && access.reason === 'verifier-missing')) return 'verifier-missing';
  if (auth.state === 'unsupported' || auth.state === 'off') return 'unavailable';
  if (auth.state === 'none' || auth.state === 'pending' || access.state === 'unprotected') return 'no-pin';
  if (auth.state === 'ready' && auth.recovery !== 'confirmed') return 'unconfirmed';
  return auth.state === 'ready' ? 'allowed' : 'unavailable';
}

// The last check before Main is entered, whatever screen asked: the parent area is open because a PIN was really verified in
// this session, and that PIN's recovery code is confirmed. Anything else (including an error) is "no".
export async function parentSessionVerified(): Promise<boolean> {
  try {
    if ((await getParentAccess()).state !== 'unlocked') return false;
    const pin = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
    return (await pin.getRecoveryStatus()) === 'confirmed';
  } catch {
    return false;
  }
}
