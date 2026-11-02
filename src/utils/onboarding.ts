import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { DEFAULT_LANGUAGE, isLanguageCode, setCurrentLanguage, type LanguageCode } from '@/i18n';

// First-launch onboarding state. It lives in ITS OWN storage key and never reads from or writes to any pet,
// task, token, shop or Pawadise data, so it can't reset or migrate anything.
//
// status:
//   'pending'   - a brand-new install that still has to go through the welcome flow (saved IMMEDIATELY on the
//                 first launch, so a refresh in the middle of onboarding resumes it instead of mistaking the
//                 pet the app creates at launch for an existing player's data);
//   'existing'  - someone who already had saved data when this feature arrived: never forced into onboarding
//                 (they can start it any time from the Pet Care & Alerts page);
//   'skipped'   - the player chose "Skip for now" (same as existing: the app is used as it was);
//   'completed' - onboarding finished (with `mode`).

const ONBOARDING_KEY = '@ProductivityPet:onboarding';

// Keys that prove the app was used before this feature existed.
const EXISTING_DATA_KEYS = [
  '@ProductivityPet:petFamily',
  '@ProductivityPet:petProfile',
  '@ProductivityPet:tasks',
  '@ProductivityPet:tokenEarnings',
  '@ProductivityPet:ownedShopItems',
  '@ProductivityPet:mood',
  '@ProductivityPet:moodLog',
  '@ProductivityPet:journal',
];

export type OnboardingStatus = 'pending' | 'existing' | 'skipped' | 'completed';
export type UserMode = 'parent' | 'child' | 'independent';
export type OnboardingStep = 'language' | 'mode' | 'profile';

export type OnboardingState = {
  version: 1;
  status: OnboardingStatus;
  language: LanguageCode;
  mode: UserMode | null;
  // Where a half-finished welcome flow resumes after a refresh.
  step: OnboardingStep;
  updatedAt: string;
};

let state: OnboardingState | null = null;
let loadPromise: Promise<OnboardingState> | null = null;
let writeChain: Promise<boolean> = Promise.resolve(true);
const listeners = new Set<(s: OnboardingState) => void>();

function normalize(raw: unknown): OnboardingState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const status: OnboardingStatus | null =
    r.status === 'pending' || r.status === 'existing' || r.status === 'skipped' || r.status === 'completed' ? r.status : null;
  if (!status) return null;
  return {
    version: 1,
    status,
    language: isLanguageCode(r.language) ? r.language : DEFAULT_LANGUAGE,
    mode: r.mode === 'parent' || r.mode === 'child' || r.mode === 'independent' ? r.mode : null,
    step: r.step === 'mode' || r.step === 'profile' ? r.step : 'language',
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  };
}

function persist(): Promise<boolean> {
  const snapshot = JSON.stringify(state);
  writeChain = writeChain.then(() =>
    AsyncStorage.setItem(ONBOARDING_KEY, snapshot).then(
      () => true,
      () => false
    )
  );
  return writeChain;
}

function set(next: OnboardingState): void {
  state = { ...next, updatedAt: new Date().toISOString() };
  setCurrentLanguage(state.language);
  void persist();
  listeners.forEach((l) => l(state as OnboardingState));
}

async function load(): Promise<OnboardingState> {
  let saved: OnboardingState | null = null;
  try {
    const stored = await AsyncStorage.getItem(ONBOARDING_KEY);
    saved = stored ? normalize(JSON.parse(stored)) : null;
  } catch {
    saved = null;
  }
  if (saved) {
    state = saved;
    setCurrentLanguage(saved.language);
    return saved;
  }
  // First time this feature runs on this device: decide ONCE whether it is a new install or an existing player.
  let hasData = false;
  try {
    const found = await Promise.all(EXISTING_DATA_KEYS.map((k) => AsyncStorage.getItem(k)));
    hasData = found.some((v) => v !== null && v !== undefined);
  } catch {
    // If storage can't be read, be safe: never force onboarding on someone who might have data.
    hasData = true;
  }
  const first: OnboardingState = {
    version: 1,
    status: hasData ? 'existing' : 'pending',
    language: DEFAULT_LANGUAGE,
    mode: null,
    step: 'language',
    updatedAt: new Date().toISOString(),
  };
  state = first;
  void persist();
  return first;
}

// Call as EARLY as possible (the root layout does it when it loads, before the pet data is created), because
// the answer to "is this a fresh install?" is read from what is in storage at that moment.
export function ensureOnboardingLoaded(): Promise<OnboardingState> {
  if (state) return Promise.resolve(state);
  if (!loadPromise) loadPromise = load();
  return loadPromise;
}

export function peekOnboarding(): OnboardingState | null {
  return state;
}

export function subscribeToOnboarding(l: (s: OnboardingState) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useOnboarding(): OnboardingState | null {
  const [s, setS] = useState<OnboardingState | null>(() => peekOnboarding());
  useEffect(() => {
    let cancelled = false;
    ensureOnboardingLoaded()
      .then((v) => {
        if (!cancelled) setS(peekOnboarding() ?? v);
      })
      .catch(() => {});
    const off = subscribeToOnboarding(setS);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return s;
}

// ---- actions ----

export async function setLanguage(language: LanguageCode): Promise<void> {
  const s = await ensureOnboardingLoaded();
  set({ ...s, language });
}

export async function setStep(step: OnboardingStep): Promise<void> {
  const s = await ensureOnboardingLoaded();
  set({ ...s, step });
}

export async function chooseMode(mode: UserMode): Promise<void> {
  const s = await ensureOnboardingLoaded();
  set({ ...s, mode, step: mode === 'parent' ? 'profile' : 'mode' });
}

// Used by a player who already had data (or chose to skip) to run the welcome flow again.
export async function restartOnboarding(): Promise<void> {
  const s = await ensureOnboardingLoaded();
  set({ ...s, status: 'pending', mode: null, step: 'language' });
}

export async function skipOnboarding(): Promise<void> {
  const s = await ensureOnboardingLoaded();
  set({ ...s, status: 'skipped' });
}

export async function completeOnboarding(mode: UserMode): Promise<void> {
  const s = await ensureOnboardingLoaded();
  set({ ...s, status: 'completed', mode });
}
