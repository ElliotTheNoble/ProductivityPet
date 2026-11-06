import { useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { FAMILY_BACKGROUND } from '@/components/family-ui';
import { UnconfirmedCodeGuard } from '@/components/parent-pin-flows';
import { useParentAuthStatus } from '@/hooks/use-parent-auth-status';

// Inside an OPEN parent area: while the recovery code is unconfirmed (a recovery or a new code that was never typed back,
// for example because the app was closed first) nothing parent-only is shown until the parent either types back the code
// they saved or creates a replacement with their PIN. It is never a dead end: as long as the parent knows their PIN a
// replacement can always be issued, and it never shows an older code.
//
// The check is made once each time the parent area is opened. Once the parent area has been shown with a confirmed code, a
// later "unconfirmed" (the parent asked for a replacement code from the management page) must NOT swap the screen away: that
// would unmount the replacement flow and lose the code that was just shown. Locking unmounts this gate, so the next unlock
// checks again.
export function RecoveryGate({ children }: { children: ReactNode }) {
  const status = useParentAuthStatus();
  const passed = useRef(false);
  if (status.loading) return <View style={styles.blank} />;
  if (status.state === 'ready' && status.recovery === 'unconfirmed' && !passed.current) return <UnconfirmedCodeGuard />;
  passed.current = true;
  return <>{children}</>;
}

const styles = StyleSheet.create({ blank: { flex: 1, backgroundColor: FAMILY_BACKGROUND } });
