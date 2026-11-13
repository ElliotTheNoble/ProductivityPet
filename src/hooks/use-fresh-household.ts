import { useEffect } from 'react';
import { AppState } from 'react-native';

import { refreshHousehold } from '@/utils/household';

// For the parent screens: look at the SAVED household when the screen opens and whenever the app comes back to the foreground, so the screen never
// shows an older copy than what is saved (see refreshHousehold in @/utils/household.ts). It only reads; it changes nothing.
export function useFreshHousehold(): void {
  useEffect(() => {
    void refreshHousehold();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshHousehold();
    });
    return () => subscription.remove();
  }, []);
}
