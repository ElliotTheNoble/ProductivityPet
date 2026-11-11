import { createContext, useContext } from 'react';

// True for everything rendered inside the Parent Dashboard's shell (see @/components/parent-shell.tsx). The shell already has the way to
// switch profile (which locks the parent area), so the parent screens do not repeat their own "Parent area unlocked / Lock now" bar there.
// The PIN protection itself is unchanged: this only hides that bar.
export const InParentShellContext = createContext(false);

export function useInParentShell(): boolean {
  return useContext(InParentShellContext);
}
