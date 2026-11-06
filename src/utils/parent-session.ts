import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { getParentAccess } from '@/utils/parent-gate';

// The one question every parent-only ACTION asks, at the moment it runs: "is a verified parent session open right now?". Screens
// are protected by the Parent Gate, but a screen can be stale (a session that ended while a form was open, an app that went to the
// background, a route reached through the browser history), so the data layer asks again. Fails closed: anything unknown is "no".
//
//   level 'children' child management (add, rename, archive): a Parent PIN has to EXIST, whatever the household looks like
//   level 'parent'   every other parent-only action (tasks, settings, the parent profile, restarting the family set-up): the same,
//                    except that a household with NO child record at all and no PIN yet stays open, because that is exactly how
//                    the first set-up (parent profile, then PIN, then the first child) has always worked
//
// With family mode off (every real user and release build) nothing is checked and nothing PIN-related is even loaded: the
// original single-user app is unchanged.
//
// Results: 'pin-required' no PIN exists (or an unfinished setup, which protects nothing); 'locked' a PIN exists but the parent area
// is not open (never opened, ended, paused, backgrounded, or the PIN cannot be found or read); 'unconfirmed' the PIN is open but
// its recovery code was never confirmed (an interrupted setup or recovery); 'unavailable' it could not be checked.
export type ParentActionLevel = 'children' | 'parent';
export type ParentCheckFailure = 'pin-required' | 'locked' | 'unconfirmed' | 'unavailable';
export type ParentCheck = { ok: true } | { ok: false; reason: ParentCheckFailure };

export async function checkParentAction(level: ParentActionLevel): Promise<ParentCheck> {
  if (!FAMILY_MODE_ENABLED) return { ok: true };
  try {
    const access = await getParentAccess();
    switch (access.state) {
      case 'unprotected': {
        if (level === 'children') return { ok: false, reason: 'pin-required' };
        const { householdHasChildren } = require('@/utils/household') as typeof import('@/utils/household');
        return (await householdHasChildren()) ? { ok: false, reason: 'pin-required' } : { ok: true };
      }
      case 'unlocked': {
        const pin = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
        return (await pin.getRecoveryStatus()) === 'confirmed' ? { ok: true } : { ok: false, reason: 'unconfirmed' };
      }
      default:
        return { ok: false, reason: 'locked' }; // checking, locked, cooldown
    }
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
