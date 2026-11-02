import { useSyncExternalStore } from 'react';

import { getActiveProfileId, subscribeToActiveProfile } from '@/utils/profiles';

// The id of the profile whose data the app is showing. The app shell is keyed by it (see app/_layout.tsx), so a
// profile switch remounts every screen and nothing from the previous profile can stay on screen.
export function useActiveProfileId(): string {
  return useSyncExternalStore(subscribeToActiveProfile, getActiveProfileId, getActiveProfileId);
}
