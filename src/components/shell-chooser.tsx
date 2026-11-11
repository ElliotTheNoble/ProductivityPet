import { useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useActiveProfileId } from '@/hooks/use-active-profile';
import { getHouseholdIntegrity, hasAnyChildRecord, useHousehold } from '@/utils/household';
import { MAIN_PROFILE_ID } from '@/utils/profiles';

// Family mode only (src/app/_layout.tsx loads this file only behind the flag): which shell the open profile gets.
//  - Main, in a household that has at least one child record, is the PIN-protected Parent Dashboard: a small separate shell that mounts
//    none of the game (see @/components/parent-shell.tsx), so Main's own pet, tasks, journal and shop are neither loaded nor changed.
//  - Every other profile (a child; or Main when there is no child record at all, which is the ordinary single-user app) gets the game
//    shell, exactly as before. `renderGame` is only called for them.
// The choice is made once each time a profile is entered (the caller keys this component by the profile), so adding the first child from
// Main does not swap the screen under the person's hands: it takes effect the next time Main is entered. While Main's household is
// still being read nothing is mounted.
export function ShellChooser({ renderGame }: { renderGame: () => ReactNode }) {
  const profileId = useActiveProfileId();
  const household = useHousehold();
  const decision = useRef<'dashboard' | 'game' | null>(null);
  if (decision.current === null) {
    if (profileId !== MAIN_PROFILE_ID) decision.current = 'game';
    else if (household) decision.current = hasAnyChildRecord(household, getHouseholdIntegrity()) ? 'dashboard' : 'game';
  }
  if (decision.current === null) return <View style={styles.pending} />;
  if (decision.current === 'game') return <>{renderGame()}</>;
  // Loaded only when it is used: the parent shell and the dashboard are not part of the game's start-up.
  const { ParentShell } = require('@/components/parent-shell') as typeof import('@/components/parent-shell');
  return <ParentShell />;
}

const styles = StyleSheet.create({
  pending: { flex: 1 },
});
