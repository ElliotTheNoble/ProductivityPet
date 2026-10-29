import { useEffect, useState } from 'react';

import {
  ensureFamilyLoaded,
  peekFamily,
  subscribeToFamily,
  type FamilyState,
} from '@/utils/pet-family';

// React access to the pet family (every pet plus the shared wallet). Returns
// null only until the saved family has loaded, then stays live: it updates
// when a pet is adopted, switched, changes health, or is resurrected.
export function usePetFamily(): FamilyState | null {
  const [family, setFamily] = useState<FamilyState | null>(() => peekFamily());
  useEffect(() => {
    let cancelled = false;
    ensureFamilyLoaded()
      .then((loaded) => {
        if (!cancelled) setFamily(peekFamily() ?? loaded);
      })
      .catch(() => {});
    const off = subscribeToFamily(setFamily);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return family;
}

// The id of the currently selected pet (null until loaded). Screens that
// load per-pet data once (like the worn hat and bow) re-load it when this
// changes.
export function useSelectedPetId(): string | null {
  const family = usePetFamily();
  return family ? family.selectedPetId : null;
}
