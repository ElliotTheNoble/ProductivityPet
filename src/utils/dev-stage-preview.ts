import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEV_ENABLE_STAGE_PREVIEW } from '@/utils/dev-flags';
import { peekFamily, subscribeToFamily } from '@/utils/pet-family';

// Lets a developer preview any growth stage (Egg/Hatchling/Baby/Young/Adult)
// on a pet — see the clickable stage icons in @/components/pet-progress.tsx.
// This is a DISPLAY-ONLY override: nothing here reads or writes growth
// credit, paidStageIndex, hatch dates, needs, or any other real progression
// data, so previewing a stage never grows or hatches a pet. Screens apply it
// on top of the real stage (displayedStage in src/app/index.tsx,
// src/components/room-detail-screen.tsx, shop-screen.tsx and stats-screen.tsx);
// gameplay eligibility (feeding, playing, resting, poop...) keeps using the
// REAL stage, so a real Egg never gets care or mini-games just because a
// different stage is being previewed.
//
// PER PET: each pet has its own preview (keyed by its stable id). The
// functions below always mean "the SELECTED pet's preview", and listeners are
// told whenever that value changes — including when the player switches to
// another pet, so Kitty 1 can preview Adult while Kitty 2 previews Baby and
// switching between them shows the right one each time. "Reset to Actual
// Stage" clears only the selected pet's preview.
//
// DEVELOPMENT ONLY: it does nothing (always "no preview", nothing saved) in a
// production build (__DEV__ false) or when DEV_ENABLE_STAGE_PREVIEW is off, so
// preview state can't leak into normal play.
//
// Persisted so the choices survive a refresh (BUG-020), under a NEW key. The
// old single global preview (@ProductivityPet:devPreviewStageIndex) belonged
// to no particular pet, so it is deliberately not carried over.

const STORAGE_KEY = '@ProductivityPet:devPreviewStageIndexByPet';

function isEnabled(): boolean {
  return DEV_ENABLE_STAGE_PREVIEW && __DEV__;
}

let previews: Record<string, number> = {};
const listeners = new Set<(index: number | null) => void>();
let lastNotified: number | null = null;

function currentIndex(): number | null {
  if (!isEnabled()) return null;
  const petId = peekFamily()?.selectedPetId;
  if (!petId) return null;
  const value = previews[petId];
  return typeof value === 'number' ? value : null;
}

// Tells listeners the selected pet's preview, but only when it actually changed.
function notifyIfChanged(): void {
  const index = currentIndex();
  if (index === lastNotified) return;
  lastNotified = index;
  listeners.forEach((listener) => listener(index));
}

if (isEnabled()) {
  AsyncStorage.getItem(STORAGE_KEY)
    .then((stored) => {
      if (!stored) return;
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      const next: Record<string, number> = {};
      for (const [petId, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isInteger(value) && value >= 0) next[petId] = value;
      }
      previews = { ...next, ...previews };
      notifyIfChanged();
    })
    .catch(() => {
      // No saved previews, or storage unavailable: start with none.
    });
  // Switching the selected pet (or the family finishing loading) changes which
  // preview applies.
  subscribeToFamily(() => notifyIfChanged());
}

export function getDevPreviewStageIndex(): number | null {
  return currentIndex();
}

// index === null clears the SELECTED pet's preview (back to its real stage).
export function setDevPreviewStageIndex(index: number | null): void {
  if (!isEnabled()) return;
  const petId = peekFamily()?.selectedPetId;
  if (!petId) return;
  const next = { ...previews };
  if (index === null) delete next[petId];
  else next[petId] = index;
  previews = next;
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(previews)).catch(() => {});
  notifyIfChanged();
}

// The listener receives the selected pet's preview index (or null) whenever it
// changes — from a click, or from switching pets.
export function subscribeToDevPreviewStageIndex(listener: (index: number | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
