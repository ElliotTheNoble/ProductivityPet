// TEMPORARY, dev-only — see DEV_ENABLE_STAGE_PREVIEW in @/utils/dev-flags.ts
// and the clickable stage icons in @/components/pet-progress.tsx.
//
// Shared, in-memory (NEVER persisted to AsyncStorage) preview-stage state —
// a plain module-level variable + listener set, same pattern as
// cachedProfile/petProfileListeners in @/utils/pet-profile.ts. This exists
// so the stage previewed from Home's Pet Progress panel ALSO applies when
// navigating to a Room Detail page (Study Room, Gym, Bedroom, Kitchen) —
// each is a separate route/component that unmounts Home (and any
// component-local React state with it) on navigation, so plain useState
// alone can't survive the trip the way this module-level value does. A
// page reload clears it back to null (the real stage) the same way
// cachedProfile's own in-memory cache clears, since nothing here ever
// touches disk.
let previewStageIndex: number | null = null;
const listeners = new Set<(index: number | null) => void>();

export function getDevPreviewStageIndex(): number | null {
  return previewStageIndex;
}

export function setDevPreviewStageIndex(index: number | null): void {
  previewStageIndex = index;
  listeners.forEach((listener) => listener(index));
}

export function subscribeToDevPreviewStageIndex(listener: (index: number | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
