import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { ensureProfilesReady, registerProfileStore, scopedKey, trackOperation, writeScoped } from '@/utils/profiles';

// Postcards from Pet Pawadise: small keepsakes a retired pet can send home. This file is only the
// permanent COLLECTION (data structure + storage). Nothing here schedules postcards, and no postcard
// artwork exists yet, so the collection is empty for now.
//
// Rules the structure enforces:
//  - every postcard belongs to a pet by its unique id (`petId`), and has its own unique id (`id`);
//  - a postcard is kept in ITS OWN saved list, not on the pet record, so it stays in the Pet Album
//    forever — even if the pet later comes home, and independent of any pet state;
//  - adding the same postcard id twice never creates a second record (the first one is kept, so a
//    postcard's received date can't be rewritten).
//
// Future code that sends a postcard just calls addPostcard({...}) with a fresh unique id (for example
// `${petId}:${postcardKey}`), a title and message, an image key from pawadise-postcard-art.ts (or null)
// and the date it was received.

const POSTCARDS_KEY_NAME = 'pawadisePostcards'; // belongs to the active profile (see @/utils/profiles.ts)

export type PawadisePostcard = {
  id: string;
  petId: string;
  // Key into POSTCARD_IMAGES (see pawadise-postcard-art.ts), or null for a postcard without a picture.
  image: string | null;
  title: string;
  message: string;
  receivedAt: string; // ISO date-time
};

export type AddPostcardResult = { ok: true } | { ok: false; reason: 'duplicate' | 'invalid' | 'storage' };

let postcards: PawadisePostcard[] | null = null;
let loadPromise: Promise<PawadisePostcard[]> | null = null;
let writeChain: Promise<boolean> = Promise.resolve(true);
const listeners = new Set<(list: PawadisePostcard[]) => void>();

function nonEmpty(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function normalize(raw: unknown): PawadisePostcard[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: PawadisePostcard[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!nonEmpty(r.id) || !nonEmpty(r.petId) || !nonEmpty(r.title) || typeof r.message !== 'string') continue;
    if (typeof r.receivedAt !== 'string' || Number.isNaN(new Date(r.receivedAt).getTime())) continue;
    if (seen.has(r.id)) continue; // a duplicate id in storage is dropped, the first one wins
    seen.add(r.id);
    out.push({
      id: r.id,
      petId: r.petId,
      image: typeof r.image === 'string' && r.image ? r.image : null,
      title: r.title,
      message: r.message,
      receivedAt: r.receivedAt,
    });
  }
  return out;
}

export function ensurePostcardsLoaded(): Promise<PawadisePostcard[]> {
  if (postcards) return Promise.resolve(postcards);
  if (!loadPromise) {
    loadPromise = trackOperation(ensureProfilesReady()
      .then(() => AsyncStorage.getItem(scopedKey(POSTCARDS_KEY_NAME)))
      .then((stored) => {
        let parsed: unknown = null;
        try {
          parsed = stored ? JSON.parse(stored) : null;
        } catch {
          parsed = null;
        }
        // If a postcard was added while loading, keep it (and never lose the stored ones).
        const loaded = normalize(parsed);
        const merged = postcards ? normalize([...loaded, ...postcards]) : loaded;
        postcards = merged;
        return merged;
      })
      .catch(() => {
        postcards = postcards ?? [];
        return postcards;
      }))
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

export function peekPostcards(): PawadisePostcard[] | null {
  return postcards;
}

// Newest first.
export function sortPostcards(list: PawadisePostcard[]): PawadisePostcard[] {
  return [...list].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0));
}

function persist(): Promise<boolean> {
  const snapshot = JSON.stringify(postcards ?? []);
  const key = scopedKey(POSTCARDS_KEY_NAME); // fixed now: a queued write never lands in another profile's collection
  writeChain = writeChain.then(() => writeScoped(key, snapshot));
  return writeChain;
}

export function addPostcard(input: PawadisePostcard): Promise<AddPostcardResult> {
  return trackOperation(doAddPostcard(input));
}

async function doAddPostcard(input: PawadisePostcard): Promise<AddPostcardResult> {
  const valid = normalize([input]);
  if (valid.length === 0) return { ok: false, reason: 'invalid' };
  const current = await ensurePostcardsLoaded();
  if (current.some((p) => p.id === valid[0].id)) return { ok: false, reason: 'duplicate' };
  const previous = current;
  postcards = [...current, valid[0]];
  const saved = await persist();
  if (!saved) {
    postcards = previous;
    listeners.forEach((l) => l(previous));
    return { ok: false, reason: 'storage' };
  }
  const next = postcards;
  listeners.forEach((l) => l(next));
  return { ok: true };
}

export function subscribeToPostcards(listener: (list: PawadisePostcard[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The permanent collection (null until loaded). Stays live when a postcard is added.
export function usePawadisePostcards(): PawadisePostcard[] | null {
  const [list, setList] = useState<PawadisePostcard[] | null>(() => peekPostcards());
  useEffect(() => {
    let cancelled = false;
    ensurePostcardsLoaded()
      .then((loaded) => {
        if (!cancelled) setList(peekPostcards() ?? loaded);
      })
      .catch(() => {});
    const off = subscribeToPostcards(setList);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return list;
}

// Profile switching: wait for queued saves, then forget this profile's postcards.
registerProfileStore({
  name: 'pawadise-postcards',
  settle: () => writeChain,
  reset: () => {
    postcards = null;
    loadPromise = null;
  },
});
