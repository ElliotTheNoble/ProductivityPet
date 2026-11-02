import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// The household: a local parent profile and the child profiles a parent manages. Saved in its OWN storage key
// (`@ProductivityPet:household`); it never touches the pet family, the global task list, Paw Tokens, the Shop
// or Pet Pawadise data.
//
// IMPORTANT design choices (see features.md):
//  - Child tasks are kept INSIDE each child's profile, not in the global task list, because the global list
//    pays Paw Tokens and pet growth the moment a task is marked complete. A task that is waiting for a parent's
//    approval therefore can never pay anything early.
//  - Nothing here grants rewards yet: approving a task only changes its state. Connecting approvals to rewards
//    needs per-child pets first (not built; see features.md "next integration step").
//  - These are local profiles, not secure accounts: there is no password or lock.

const HOUSEHOLD_KEY = '@ProductivityPet:household';

export type PetSafety = 'gentle' | 'classic';

export type ChildSettings = {
  canCreateTasks: boolean;
  // When true, a child finishing a task makes it 'pending' (waiting for a parent) instead of 'completed'.
  requireApproval: boolean;
  // Saved only: NOT enforced yet (pets are not separated per child; see features.md).
  petSafety: PetSafety;
};

// assigned  - waiting for the child to do it
// pending   - the child says it is done; a parent still has to approve (no reward)
// approved  - a parent approved a pending task
// completed - done by a child whose tasks don't need approval
export type HouseholdTaskStatus = 'assigned' | 'pending' | 'approved' | 'completed';

export type HouseholdTask = {
  id: string;
  text: string;
  createdBy: 'parent' | 'child';
  status: HouseholdTaskStatus;
  createdAt: string;
  submittedAt?: string;
  decidedAt?: string;
};

export type ChildProfile = {
  // Unique and permanent. Future per-child pet ownership will key off this id.
  id: string;
  nickname: string;
  createdAt: string;
  settings: ChildSettings;
  tasks: HouseholdTask[];
};

export type ParentProfile = { displayName: string; familyName: string };

export type Household = {
  version: 1;
  parent: ParentProfile | null;
  children: ChildProfile[];
  selectedChildId: string | null;
};

export const DEFAULT_CHILD_SETTINGS: ChildSettings = { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' };

const MAX_NAME = 40;
const MAX_TASK = 120;

let state: Household | null = null;
let loadPromise: Promise<Household> | null = null;
let writeChain: Promise<boolean> = Promise.resolve(true);
const listeners = new Set<(h: Household) => void>();

function emptyHousehold(): Household {
  return { version: 1, parent: null, children: [], selectedChildId: null };
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function normalizeTask(raw: unknown): HouseholdTask | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text = clean(r.text, MAX_TASK);
  if (typeof r.id !== 'string' || !r.id || !text) return null;
  const status: HouseholdTaskStatus =
    r.status === 'pending' || r.status === 'approved' || r.status === 'completed' ? r.status : 'assigned';
  return {
    id: r.id,
    text,
    createdBy: r.createdBy === 'child' ? 'child' : 'parent',
    status,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    submittedAt: typeof r.submittedAt === 'string' ? r.submittedAt : undefined,
    decidedAt: typeof r.decidedAt === 'string' ? r.decidedAt : undefined,
  };
}

function normalize(raw: unknown): Household {
  const out = emptyHousehold();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  if (r.parent && typeof r.parent === 'object') {
    const p = r.parent as Record<string, unknown>;
    const displayName = clean(p.displayName, MAX_NAME);
    if (displayName) out.parent = { displayName, familyName: clean(p.familyName, MAX_NAME) };
  }
  const seen = new Set<string>();
  if (Array.isArray(r.children)) {
    for (const c of r.children) {
      if (!c || typeof c !== 'object') continue;
      const cr = c as Record<string, unknown>;
      const nickname = clean(cr.nickname, MAX_NAME);
      if (typeof cr.id !== 'string' || !cr.id || !nickname || seen.has(cr.id)) continue;
      seen.add(cr.id);
      const s = (cr.settings && typeof cr.settings === 'object' ? cr.settings : {}) as Record<string, unknown>;
      out.children.push({
        id: cr.id,
        nickname,
        createdAt: typeof cr.createdAt === 'string' ? cr.createdAt : new Date().toISOString(),
        settings: {
          canCreateTasks: s.canCreateTasks === true,
          requireApproval: s.requireApproval === false ? false : true,
          petSafety: s.petSafety === 'classic' ? 'classic' : 'gentle',
        },
        tasks: (Array.isArray(cr.tasks) ? cr.tasks : []).map(normalizeTask).filter((t): t is HouseholdTask => t !== null),
      });
    }
  }
  out.selectedChildId =
    typeof r.selectedChildId === 'string' && out.children.some((c) => c.id === r.selectedChildId)
      ? r.selectedChildId
      : (out.children[0]?.id ?? null);
  return out;
}

export function ensureHouseholdLoaded(): Promise<Household> {
  if (state) return Promise.resolve(state);
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(HOUSEHOLD_KEY)
      .then((stored) => {
        let parsed: unknown = null;
        try {
          parsed = stored ? JSON.parse(stored) : null;
        } catch {
          parsed = null;
        }
        state = state ?? normalize(parsed);
        return state;
      })
      .catch(() => {
        state = state ?? emptyHousehold();
        return state;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

export function peekHousehold(): Household | null {
  return state;
}

function persist(): Promise<boolean> {
  const snapshot = JSON.stringify(state);
  writeChain = writeChain.then(() =>
    AsyncStorage.setItem(HOUSEHOLD_KEY, snapshot).then(
      () => true,
      () => false
    )
  );
  return writeChain;
}

function commit(next: Household): void {
  state = next;
  void persist();
  listeners.forEach((l) => l(next));
}

export function subscribeToHousehold(l: (h: Household) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useHousehold(): Household | null {
  const [h, setH] = useState<Household | null>(() => peekHousehold());
  useEffect(() => {
    let cancelled = false;
    ensureHouseholdLoaded()
      .then((v) => {
        if (!cancelled) setH(peekHousehold() ?? v);
      })
      .catch(() => {});
    const off = subscribeToHousehold(setH);
    return () => {
      cancelled = true;
      off();
    };
  }, []);
  return h;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateChildIn(h: Household, childId: string, fn: (c: ChildProfile) => ChildProfile): Household {
  return { ...h, children: h.children.map((c) => (c.id === childId ? fn(c) : c)) };
}

// ---- parent ----

export type ActionResult = { ok: true; id?: string } | { ok: false; reason: 'invalid' | 'not-found' | 'not-allowed' | 'wrong-state' };

export async function saveParentProfile(displayName: string, familyName: string): Promise<ActionResult> {
  const name = clean(displayName, MAX_NAME);
  if (!name) return { ok: false, reason: 'invalid' };
  const h = await ensureHouseholdLoaded();
  commit({ ...h, parent: { displayName: name, familyName: clean(familyName, MAX_NAME) } });
  return { ok: true };
}

// ---- children ----

export async function addChild(nickname: string): Promise<ActionResult> {
  const name = clean(nickname, MAX_NAME);
  if (!name) return { ok: false, reason: 'invalid' };
  const h = await ensureHouseholdLoaded();
  const child: ChildProfile = {
    id: newId('child'),
    nickname: name,
    createdAt: new Date().toISOString(),
    settings: { ...DEFAULT_CHILD_SETTINGS },
    tasks: [],
  };
  commit({ ...h, children: [...h.children, child], selectedChildId: child.id });
  return { ok: true, id: child.id };
}

export async function renameChild(childId: string, nickname: string): Promise<ActionResult> {
  const name = clean(nickname, MAX_NAME);
  if (!name) return { ok: false, reason: 'invalid' };
  const h = await ensureHouseholdLoaded();
  if (!h.children.some((c) => c.id === childId)) return { ok: false, reason: 'not-found' };
  commit(updateChildIn(h, childId, (c) => ({ ...c, nickname: name })));
  return { ok: true };
}

export async function selectChild(childId: string): Promise<void> {
  const h = await ensureHouseholdLoaded();
  if (h.selectedChildId === childId || !h.children.some((c) => c.id === childId)) return;
  commit({ ...h, selectedChildId: childId });
}

export async function updateChildSettings(childId: string, patch: Partial<ChildSettings>): Promise<ActionResult> {
  const h = await ensureHouseholdLoaded();
  if (!h.children.some((c) => c.id === childId)) return { ok: false, reason: 'not-found' };
  commit(updateChildIn(h, childId, (c) => ({ ...c, settings: { ...c.settings, ...patch } })));
  return { ok: true };
}

// ---- tasks ----

// A parent assigns a task; or (createdBy 'child', only when allowed in the child's settings) the child adds one.
export async function addTask(childId: string, text: string, createdBy: 'parent' | 'child'): Promise<ActionResult> {
  const t = clean(text, MAX_TASK);
  if (!t) return { ok: false, reason: 'invalid' };
  const h = await ensureHouseholdLoaded();
  const child = h.children.find((c) => c.id === childId);
  if (!child) return { ok: false, reason: 'not-found' };
  if (createdBy === 'child' && !child.settings.canCreateTasks) return { ok: false, reason: 'not-allowed' };
  const task: HouseholdTask = { id: newId('task'), text: t, createdBy, status: 'assigned', createdAt: new Date().toISOString() };
  commit(updateChildIn(h, childId, (c) => ({ ...c, tasks: [...c.tasks, task] })));
  return { ok: true, id: task.id };
}

// The CHILD side: "I did it". With approval required the task becomes 'pending' (no reward, waits for a
// parent); otherwise it is simply 'completed'. There is no child screen yet, so the dashboard only offers this
// as a clearly labelled preview for testing.
export async function markTaskDone(childId: string, taskId: string): Promise<ActionResult> {
  const h = await ensureHouseholdLoaded();
  const child = h.children.find((c) => c.id === childId);
  const task = child?.tasks.find((t) => t.id === taskId);
  if (!child || !task) return { ok: false, reason: 'not-found' };
  if (task.status !== 'assigned') return { ok: false, reason: 'wrong-state' };
  const now = new Date().toISOString();
  const status: HouseholdTaskStatus = child.settings.requireApproval ? 'pending' : 'completed';
  commit(updateChildIn(h, childId, (c) => ({
    ...c,
    tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, status, submittedAt: now, decidedAt: status === 'completed' ? now : undefined } : t)),
  })));
  return { ok: true };
}

// The PARENT side. These only exist in the Parent Dashboard; no child-facing code calls them.
export async function approveTask(childId: string, taskId: string): Promise<ActionResult> {
  const h = await ensureHouseholdLoaded();
  const task = h.children.find((c) => c.id === childId)?.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, reason: 'not-found' };
  if (task.status !== 'pending') return { ok: false, reason: 'wrong-state' };
  const now = new Date().toISOString();
  commit(updateChildIn(h, childId, (c) => ({
    ...c,
    tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, status: 'approved', decidedAt: now } : t)),
  })));
  return { ok: true };
}

export async function sendTaskBack(childId: string, taskId: string): Promise<ActionResult> {
  const h = await ensureHouseholdLoaded();
  const task = h.children.find((c) => c.id === childId)?.tasks.find((t) => t.id === taskId);
  if (!task) return { ok: false, reason: 'not-found' };
  if (task.status !== 'pending') return { ok: false, reason: 'wrong-state' };
  commit(updateChildIn(h, childId, (c) => ({
    ...c,
    tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, status: 'assigned', submittedAt: undefined, decidedAt: undefined } : t)),
  })));
  return { ok: true };
}

export async function deleteTask(childId: string, taskId: string): Promise<ActionResult> {
  const h = await ensureHouseholdLoaded();
  if (!h.children.find((c) => c.id === childId)?.tasks.some((t) => t.id === taskId)) return { ok: false, reason: 'not-found' };
  commit(updateChildIn(h, childId, (c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== taskId) })));
  return { ok: true };
}

export function tasksByStatus(child: ChildProfile) {
  return {
    assigned: child.tasks.filter((t) => t.status === 'assigned'),
    pending: child.tasks.filter((t) => t.status === 'pending'),
    completed: child.tasks.filter((t) => t.status === 'approved' || t.status === 'completed'),
  };
}
