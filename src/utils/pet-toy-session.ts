import { useSyncExternalStore } from 'react';

import { TOY_SESSION_MS } from '@/utils/toys/toy-config';

// A toy session is TEMPORARY: the toy shows near the pet for TOY_SESSION_MS (about 60 s) and then disappears. It is
// never saved (a refresh simply ends it) and never becomes Home decoration. At most one session per
// pet at a time. The Happiness reward is granted by playWithToy() in pet-family.ts when a session
// starts, so showing/hiding it here can never award anything.
export type ToySession = { petId: string; toyId: string; startedAt: number; endsAt: number };

const sessions = new Map<string, ToySession>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getToySession(petId: string, now = Date.now()): ToySession | null {
  const s = sessions.get(petId);
  return s && s.endsAt > now ? s : null;
}

export function startToySession(petId: string, toyId: string, durationMs = TOY_SESSION_MS): boolean {
  if (getToySession(petId)) return false; // never two overlapping sessions for one pet
  const now = Date.now();
  sessions.set(petId, { petId, toyId, startedAt: now, endsAt: now + durationMs });
  timers.set(
    petId,
    setTimeout(() => endToySession(petId), durationMs),
  );
  emit();
  return true;
}

// Ends every session and cancels every timer (used when the active profile changes: sessions belong to pets).
export function resetToySessions(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  if (sessions.size > 0) {
    sessions.clear();
    emit();
  }
}

export function endToySession(petId: string): void {
  const t = timers.get(petId);
  if (t) clearTimeout(t);
  timers.delete(petId);
  if (sessions.delete(petId)) emit();
}

// Live session for a pet (null when none / expired). The snapshot is the stored session object itself
// (stable until the session changes), so React re-renders exactly when a session starts or ends.
export function useToySession(petId: string | null | undefined): ToySession | null {
  return useSyncExternalStore(
    subscribe,
    () => (petId ? getToySession(petId) : null),
    () => null,
  );
}
