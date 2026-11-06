import { useEffect, useState } from 'react';

import { hasPinVerifier, subscribeToParentAccess } from '@/utils/parent-gate';
import type { RecoveryStatus } from '@/utils/parent-pin';

// What the Parent PIN screens need to know, in one place. It loads the PIN module only when a PIN checker is registered
// (family mode on), so with family mode off nothing here loads anything.
export type ParentAuthStatus = {
  loading: boolean;
  // 'off' = family mode is off (no PIN checker is registered at all).
  state: 'off' | 'unsupported' | 'none' | 'pending' | 'ready' | 'verifier-missing';
  recovery: RecoveryStatus;
};

const LOADING: ParentAuthStatus = { loading: true, state: 'off', recovery: 'none' };

export function useParentAuthStatus(): ParentAuthStatus {
  const [status, setStatus] = useState<ParentAuthStatus>(() => (hasPinVerifier() ? LOADING : { loading: false, state: 'off', recovery: 'none' }));
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      if (!hasPinVerifier()) {
        if (!cancelled) setStatus({ loading: false, state: 'off', recovery: 'none' });
        return;
      }
      const pin = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
      const [auth, recovery] = await Promise.all([pin.getAuthState(), pin.getRecoveryStatus()]);
      if (cancelled) return;
      const state: ParentAuthStatus['state'] =
        auth.kind === 'none' ? (auth.pending ? 'pending' : 'none') : auth.kind;
      setStatus({ loading: false, state, recovery });
    };
    void refresh();
    const off = subscribeToParentAccess(() => void refresh());
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return status;
}
