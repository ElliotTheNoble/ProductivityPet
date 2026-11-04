import { useEffect, useState } from 'react';

import {
  getParentAccess,
  getSessionRemainingMs,
  hasPinVerifier,
  subscribeToParentAccess,
  type ParentAccess,
} from '@/utils/parent-gate';

// The current state of the parent area ('checking' until it is known; never treated as open while checking). It updates
// when the area is unlocked or locked, and by itself when a pause ends or an open session runs out.
export function useParentAccess(): ParentAccess {
  // With no PIN checker registered (every install while family mode is off) the area is open from the very first frame,
  // exactly as before the gate existed; otherwise nothing is shown until the state is known.
  const [access, setAccess] = useState<ParentAccess>(() => (hasPinVerifier() ? { state: 'checking' } : { state: 'unprotected' }));
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = async () => {
      const next = await getParentAccess();
      if (cancelled) return;
      setAccess(next);
      if (timer) clearTimeout(timer);
      timer = null;
      const wait = next.state === 'cooldown' ? next.remainingMs : next.state === 'unlocked' ? getSessionRemainingMs() : 0;
      if (wait > 0) timer = setTimeout(() => void refresh(), Math.min(wait + 50, 60_000));
    };
    void refresh();
    const off = subscribeToParentAccess(() => void refresh());
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      off();
    };
  }, []);
  return access;
}
