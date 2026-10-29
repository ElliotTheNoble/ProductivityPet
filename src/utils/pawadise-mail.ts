import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

import {
  ensureFamilyLoaded,
  getPetSpecies,
  getRetiredPets,
  peekFamily,
  subscribeToFamily,
} from '@/utils/pet-family';
import { POSTCARD_DESIGNS_BY_SPECIES, type PostcardDesign } from '@/utils/pawadise-art';
import { addPostcard, ensurePostcardsLoaded } from '@/utils/pawadise-postcards';

// Surprise postcards from Pet Pawadise: delivery scheduling and the mail that has arrived but is still
// unopened. Only pets CURRENTLY retired in Pawadise send postcards.
//
// Scheduling is wall-clock and saved (so it survives restarts and doesn't need the app to stay open):
// every retired pet has a saved `nextAt`, 2-5 days (random) after it retired or after its last delivery.
// Whenever the app starts, returns to the foreground, or once a minute, runPawadiseDeliveries() checks
// what is due. A long absence never builds a backlog: each pet gets AT MOST ONE postcard per check, and
// its next time is measured from NOW, not from the missed time.
//
// Delivery puts the postcard in `pending` (saved). It becomes part of the pet's permanent scrapbook
// (pawadise-postcards.ts) when the player opens it (openPendingMail), so unopened mail is never lost and
// can't be double-counted: the postcard id is created once at delivery and addPostcard ignores repeats.

const MAIL_KEY = '@ProductivityPet:pawadiseMail';

// ---- tunable numbers ----
export const PAWADISE_MIN_DELIVERY_DAYS = 2;
export const PAWADISE_MAX_DELIVERY_DAYS = 5;
// No new mail is delivered while this many postcards are already waiting unopened.
export const PAWADISE_MAX_PENDING = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

export type PendingMail = {
  // Becomes the postcard's id when it is opened.
  id: string;
  petId: string;
  // The design key saved as the postcard's `image` (see pawadise-art.ts).
  designKey: string;
  title: string;
  message: string;
  arrivedAt: string;
};

type MailState = {
  version: 1;
  // petId -> when its next postcard is due.
  schedule: Record<string, { nextAt: string }>;
  pending: PendingMail[];
};

let mail: MailState | null = null;
let loadPromise: Promise<MailState> | null = null;
let writeChain: Promise<boolean> = Promise.resolve(true);
const listeners = new Set<() => void>();

function emptyState(): MailState {
  return { version: 1, schedule: {}, pending: [] };
}

function normalize(raw: unknown): MailState {
  const out = emptyState();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.schedule && typeof r.schedule === 'object') {
    for (const [petId, v] of Object.entries(r.schedule as Record<string, unknown>)) {
      const nextAt = (v as { nextAt?: unknown } | null)?.nextAt;
      if (petId && typeof nextAt === 'string' && !Number.isNaN(new Date(nextAt).getTime())) out.schedule[petId] = { nextAt };
    }
  }
  if (Array.isArray(r.pending)) {
    const seen = new Set<string>();
    for (const item of r.pending) {
      if (!item || typeof item !== 'object') continue;
      const p = item as Record<string, unknown>;
      if (typeof p.id !== 'string' || !p.id || seen.has(p.id)) continue;
      if (typeof p.petId !== 'string' || !p.petId || typeof p.designKey !== 'string' || !p.designKey) continue;
      if (typeof p.arrivedAt !== 'string' || Number.isNaN(new Date(p.arrivedAt).getTime())) continue;
      seen.add(p.id);
      out.pending.push({
        id: p.id,
        petId: p.petId,
        designKey: p.designKey,
        title: typeof p.title === 'string' && p.title ? p.title : 'Greetings from Pawadise!',
        message: typeof p.message === 'string' ? p.message : '',
        arrivedAt: p.arrivedAt,
      });
    }
  }
  return out;
}

export function ensureMailLoaded(): Promise<MailState> {
  if (mail) return Promise.resolve(mail);
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(MAIL_KEY)
      .then((stored) => {
        let parsed: unknown = null;
        try {
          parsed = stored ? JSON.parse(stored) : null;
        } catch {
          parsed = null;
        }
        mail = mail ?? normalize(parsed);
        return mail;
      })
      .catch(() => {
        mail = mail ?? emptyState();
        return mail;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

function persist(): Promise<boolean> {
  const snapshot = JSON.stringify(mail ?? emptyState());
  writeChain = writeChain.then(() =>
    AsyncStorage.setItem(MAIL_KEY, snapshot).then(
      () => true,
      () => false
    )
  );
  return writeChain;
}

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const NO_MAIL: PendingMail[] = [];

// Mail that has arrived but is not opened yet, oldest first (null state = none). Stable until it changes.
export function getPendingMail(): PendingMail[] {
  return mail?.pending ?? NO_MAIL;
}

export function usePendingMail(): PendingMail[] {
  return useSyncExternalStore(subscribe, getPendingMail, () => NO_MAIL);
}

// ---- scheduling ----

export function randomDeliveryDelayMs(rng: () => number = Math.random): number {
  const days = PAWADISE_MIN_DELIVERY_DAYS + rng() * (PAWADISE_MAX_DELIVERY_DAYS - PAWADISE_MIN_DELIVERY_DAYS);
  return Math.round(days * DAY_MS);
}

// Picks a design this pet hasn't had yet (counting its saved postcards and its unopened mail). Only when
// every design has been used does the cycle start over.
export function chooseDesign(
  petId: string,
  designs: PostcardDesign[],
  usedKeys: Set<string>,
  rng: () => number = Math.random
): PostcardDesign | null {
  if (designs.length === 0) return null;
  const unused = designs.filter((d) => !usedKeys.has(d.key));
  const pool = unused.length > 0 ? unused : designs;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

function newMailId(petId: string, now: Date): string {
  return `pawadise-${petId}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
}

let running = false;

// Brings the saved schedule up to date and delivers whatever is due. Returns how many postcards arrived.
// Safe to call as often as you like (it never runs twice at once and saves only when something changed).
export async function runPawadiseDeliveries(
  now: Date = new Date(),
  rng: () => number = Math.random,
  options: { force?: boolean } = {}
): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    const family = await ensureFamilyLoaded();
    const current = await ensureMailLoaded();
    const collection = await ensurePostcardsLoaded();
    const live = peekFamily() ?? family;
    const retired = getRetiredPets(live).filter((p) => (POSTCARD_DESIGNS_BY_SPECIES[getPetSpecies(p)] ?? []).length > 0);
    const retiredIds = new Set(retired.map((p) => p.id));

    const schedule: Record<string, { nextAt: string }> = {};
    let changed = false;
    // Only retired pets keep (or get) a schedule; a pet that came home loses its schedule.
    for (const pet of retired) {
      const existing = current.schedule[pet.id];
      if (existing) schedule[pet.id] = existing;
      else {
        schedule[pet.id] = { nextAt: new Date(now.getTime() + randomDeliveryDelayMs(rng)).toISOString() };
        changed = true;
      }
    }
    for (const id of Object.keys(current.schedule)) if (!retiredIds.has(id)) changed = true;

    let pending = current.pending;
    let delivered = 0;
    for (const pet of retired) {
      const dueAt = new Date(schedule[pet.id].nextAt).getTime();
      if (!options.force && dueAt > now.getTime()) continue;
      // Always move the next time forward from NOW, so a long absence can never cause a backlog.
      schedule[pet.id] = { nextAt: new Date(now.getTime() + randomDeliveryDelayMs(rng)).toISOString() };
      changed = true;
      if (pending.length >= PAWADISE_MAX_PENDING) continue;
      if (pending.some((p) => p.petId === pet.id)) continue; // one unopened postcard per pet at a time
      const used = new Set<string>();
      for (const c of collection) if (c.petId === pet.id && c.image) used.add(c.image);
      for (const p of pending) if (p.petId === pet.id) used.add(p.designKey);
      const picked = chooseDesign(pet.id, POSTCARD_DESIGNS_BY_SPECIES[getPetSpecies(pet)] ?? [], used, rng);
      if (!picked) continue;
      pending = [
        ...pending,
        {
          id: newMailId(pet.id, now),
          petId: pet.id,
          designKey: picked.key,
          title: 'Greetings from Pawadise!',
          message: '',
          arrivedAt: now.toISOString(),
        },
      ];
      delivered += 1;
    }

    if (!changed && delivered === 0) return 0;
    const previous = current;
    mail = { version: 1, schedule, pending };
    const saved = await persist();
    if (!saved) {
      // Nothing reached storage: undo, so the same delivery is simply tried again later.
      mail = previous;
      return 0;
    }
    if (delivered > 0) emit();
    return delivered;
  } finally {
    running = false;
  }
}

const opening = new Set<string>();

// Opens one pending postcard: it is saved to the sending pet's permanent scrapbook FIRST, then removed
// from the pending list, so a crash in between can only repeat the (ignored) duplicate add. Returns the
// saved postcard, or null if it could not be saved (the mail then stays pending).
export async function openPendingMail(id: string) {
  if (opening.has(id)) return null;
  opening.add(id);
  try {
    const current = await ensureMailLoaded();
    const item = current.pending.find((p) => p.id === id);
    if (!item) return null;
    const card = {
      id: item.id,
      petId: item.petId,
      image: item.designKey,
      title: item.title,
      message: item.message,
      receivedAt: item.arrivedAt,
    };
    const added = await addPostcard(card);
    if (!added.ok && added.reason !== 'duplicate') return null;
    const previous = current;
    mail = { ...current, pending: current.pending.filter((p) => p.id !== id) };
    const saved = await persist();
    if (!saved) {
      mail = previous; // the postcard is already safe; it will just be offered again (and ignored as a duplicate)
      return card;
    }
    emit();
    return card;
  } finally {
    opening.delete(id);
  }
}

// ---- running it ----

// Starts the checks: at launch, whenever the app comes back to the foreground, once a minute while open, and
// right after the family changes (so a pet that just retired gets its first schedule).
export function startPawadiseMail(): () => void {
  const run = () => {
    void runPawadiseDeliveries().catch(() => {});
  };
  run();
  const interval = setInterval(run, 60000);
  const sub = AppState.addEventListener('change', (next) => {
    if (next === 'active') run();
  });
  const off = subscribeToFamily(() => run());
  return () => {
    clearInterval(interval);
    sub.remove();
    off();
  };
}

// ---- developer testing (development builds only) ----

// Makes every retired pet's next delivery due right now, then checks.
export async function devDeliverPawadiseMailNow(): Promise<string> {
  if (!__DEV__) return 'Developer tools are only available in development builds.';
  const family = await ensureFamilyLoaded();
  const retired = getRetiredPets(peekFamily() ?? family);
  if (retired.length === 0) return 'No pet is retired in Pawadise, so nothing can be delivered.';
  const n = await runPawadiseDeliveries(new Date(), Math.random, { force: true });
  return n > 0 ? `${n} postcard${n === 1 ? '' : 's'} arrived. Check Home.` : 'Nothing delivered (mail already waiting, or the limit is reached).';
}

