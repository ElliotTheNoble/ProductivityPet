import { useEffect } from 'react';

import { registerUnfinishedWork, type UnfinishedKind } from '@/utils/unfinished-work';

// Declares that this screen holds something unfinished (and unsaved) of `kind` while `active` is true. It is released when `active`
// turns false (finished, saved or cancelled) and when the screen goes away (unmount), so it can never outlive what it describes.
export function useUnfinishedWork(kind: UnfinishedKind, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return registerUnfinishedWork(kind);
  }, [kind, active]);
}
