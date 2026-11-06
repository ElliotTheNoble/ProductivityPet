import { registerProfileStore } from '@/utils/profiles';

// What a person is in the middle of right now that is NOT saved anywhere, so that leaving the profile can say so first (Stage 4.2).
// Memory only, on purpose: nothing here is ever written to storage, and no draft-saving exists (what is lost, stays lost: the
// person is asked before it happens). A screen registers a kind while it holds something unfinished (see
// @/hooks/use-unfinished-work.ts) and lets go when it is finished, cancelled or closed (unmounted). The registry is also emptied when
// the profile changes or is released, so nothing can carry over to the next person.
//
// Tracked: a Kitty Catch round in play, a Memory Match round in play, a bath started but not finished, a task being written, a task
// being edited (its text, date or time changed), a mood-journal reflection with changes that were not saved.
// NOT tracked (cannot say reliably, or not a child's screen): the other fields of the task editor (repeat, reminder, room, kind), the
// Parent Dashboard's forms, and the welcome / PIN flows (those are parent-only screens behind the Parent Gate).

export type UnfinishedKind = 'kitty-catch' | 'memory-match' | 'bathing' | 'task-draft' | 'task-edit' | 'journal';

// The order the kinds are listed in.
const ORDER: readonly UnfinishedKind[] = ['kitty-catch', 'memory-match', 'bathing', 'task-draft', 'task-edit', 'journal'];

let nextId = 1;
const entries = new Map<number, UnfinishedKind>();
const listeners = new Set<() => void>();
let snapshot: readonly UnfinishedKind[] = [];

function refresh(): void {
  const present = new Set(entries.values());
  const next = ORDER.filter((kind) => present.has(kind));
  const same = next.length === snapshot.length && next.every((kind, i) => kind === snapshot[i]);
  if (same) return;
  snapshot = next; // a new array only when something changed (what useSyncExternalStore needs)
  listeners.forEach((listener) => listener());
}

// Marks `kind` as unfinished. Returns the function that lets go again (safe to call more than once, and after the registry was
// emptied by a profile change).
export function registerUnfinishedWork(kind: UnfinishedKind): () => void {
  const id = nextId++;
  entries.set(id, kind);
  refresh();
  return () => {
    if (entries.delete(id)) refresh();
  };
}

// The kinds of unfinished work right now (each once, in a fixed order). The same array object until something changes.
export function listUnfinishedWork(): readonly UnfinishedKind[] {
  return snapshot;
}

export function subscribeToUnfinishedWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearUnfinishedWork(): void {
  if (entries.size === 0) return;
  entries.clear();
  refresh();
}

// Nothing of one profile's unfinished work may carry over to the next one.
registerProfileStore({ name: 'unfinished-work', reset: () => clearUnfinishedWork() });
