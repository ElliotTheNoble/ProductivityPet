import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { checkParentAction, type ParentActionLevel } from '@/utils/parent-session';
import { registerChildProfile, trackOperation } from '@/utils/profiles';

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
//  - A child's `id` is permanent and is ALSO the id of that child's storage profile (see @/utils/profiles.ts): the child's
//    pets, tasks, tokens and every other personal record live under it. Changing or reusing an id would point at someone
//    else's data, so ids are never edited, and two records with the same id are never merged (see "integrity" below).
//
// How a change is saved (M2 Stage 1): the new household is written and read back FIRST, and only then does the in-memory copy
// change, so a failed save is reported as a failure and never looks like it worked. A write is only made over the revision it
// was built from (`revision` counts writes), so a second browser tab holding an older copy cannot overwrite newer data: the
// write is refused, the newer copy is adopted and the one change is tried again once, then it is a "conflict". Saves are tracked
// (see trackOperation in @/utils/profiles.ts), so leaving a profile waits for them. Nothing is ever dropped silently:
//  - entries that cannot be understood, or an unreadable file, are copied to `<key>.corrupt-<time>` before the first change is saved;
//  - two children with the same id make the household read-only ("blocked") until a parent resolves it;
//  - if the household could not be read at all, nothing is written over it.

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
  // Unique and permanent. It is also the child's storage profile id (their pets, tasks, tokens...).
  id: string;
  nickname: string;
  createdAt: string;
  settings: ChildSettings;
  tasks: HouseholdTask[];
  // Set when a parent archives the child: hidden from the family picker, nothing is deleted, and the child's pets keep
  // aging by the clock like any unused profile. Absent = active.
  archivedAt?: string;
};

export type ParentProfile = { displayName: string; familyName: string };

export type Household = {
  version: 1;
  parent: ParentProfile | null;
  children: ChildProfile[];
  selectedChildId: string | null;
  // Number of times this household has been saved (absent = 0). See the note above about stale copies.
  revision?: number;
};

export const DEFAULT_CHILD_SETTINGS: ChildSettings = { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' };

const MAX_NAME = 40;
const MAX_TASK = 120;

let state: Household | null = null;
let loadPromise: Promise<Household> | null = null;
let changeChain: Promise<unknown> = Promise.resolve();
const listeners = new Set<(h: Household) => void>();

// What the last read found. Not saved.
export type HouseholdIntegrity = {
  // The stored household could not be read at all (nothing is written until it can be).
  loadFailed: boolean;
  // Ids that appear on more than one child record. Those children are not selectable and the household is read-only.
  duplicateChildIds: string[];
  // Entries that were not understood (a child, a task...). They are copied aside before the first save.
  unreadableEntries: number;
};

const CLEAN_INTEGRITY: HouseholdIntegrity = { loadFailed: false, duplicateChildIds: [], unreadableEntries: 0 };
let integrity: HouseholdIntegrity = CLEAN_INTEGRITY;
// The text the household had when it was read, kept while an unreadable part still has to be copied aside.
let rawToPreserve: string | null = null;

export function getHouseholdIntegrity(): HouseholdIntegrity {
  return integrity;
}

function emptyHousehold(): Household {
  return { version: 1, parent: null, children: [], selectedChildId: null, revision: 0 };
}

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

// Does this household have ANY child record (active or archived)? An unreadable household or one with duplicate ids counts as "yes":
// when it is not known, it is treated as having children. Used to decide whether parent-only routes and actions fail closed
// while no Parent PIN exists (see @/utils/parent-session.ts).
export function hasAnyChildRecord(h: Household, info: HouseholdIntegrity = integrity): boolean {
  return info.loadFailed || info.duplicateChildIds.length > 0 || h.children.length > 0;
}

export async function householdHasChildren(): Promise<boolean> {
  const h = await ensureHouseholdLoaded();
  return hasAnyChildRecord(h, integrity);
}

export function isChildArchived(child: ChildProfile): boolean {
  return typeof child.archivedAt === 'string';
}

// The children a family picker may offer: not archived, and not one of two records sharing an id.
export function listActiveChildren(h: Household, duplicateIds: readonly string[] = integrity.duplicateChildIds): ChildProfile[] {
  return h.children.filter((c) => !isChildArchived(c) && !duplicateIds.includes(c.id));
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

type Normalized = { household: Household; duplicateChildIds: string[]; unreadableEntries: number };

function normalize(raw: unknown): Normalized {
  const out = emptyHousehold();
  const duplicateChildIds: string[] = [];
  let unreadableEntries = 0;
  if (!raw || typeof raw !== 'object') return { household: out, duplicateChildIds, unreadableEntries };
  const r = raw as Record<string, unknown>;
  if (typeof r.revision === 'number' && Number.isInteger(r.revision) && r.revision >= 0) out.revision = r.revision;
  if (r.parent && typeof r.parent === 'object') {
    const p = r.parent as Record<string, unknown>;
    const displayName = clean(p.displayName, MAX_NAME);
    if (displayName) out.parent = { displayName, familyName: clean(p.familyName, MAX_NAME) };
    else unreadableEntries += 1;
  }
  const seen = new Set<string>();
  if (Array.isArray(r.children)) {
    for (const c of r.children) {
      if (!c || typeof c !== 'object') {
        unreadableEntries += 1;
        continue;
      }
      const cr = c as Record<string, unknown>;
      const nickname = clean(cr.nickname, MAX_NAME);
      if (typeof cr.id !== 'string' || !cr.id || !nickname) {
        unreadableEntries += 1;
        continue;
      }
      if (seen.has(cr.id)) {
        // Never merged and never picked between: the first one stays visible, the id is reported, and nothing is saved.
        if (!duplicateChildIds.includes(cr.id)) duplicateChildIds.push(cr.id);
        continue;
      }
      seen.add(cr.id);
      const s = (cr.settings && typeof cr.settings === 'object' ? cr.settings : {}) as Record<string, unknown>;
      const rawTasks = Array.isArray(cr.tasks) ? cr.tasks : [];
      const tasks = rawTasks.map(normalizeTask).filter((t): t is HouseholdTask => t !== null);
      unreadableEntries += rawTasks.length - tasks.length;
      out.children.push({
        id: cr.id,
        nickname,
        createdAt: typeof cr.createdAt === 'string' ? cr.createdAt : new Date().toISOString(),
        settings: {
          canCreateTasks: s.canCreateTasks === true,
          requireApproval: s.requireApproval === false ? false : true,
          petSafety: s.petSafety === 'classic' ? 'classic' : 'gentle',
        },
        tasks,
        archivedAt: typeof cr.archivedAt === 'string' && cr.archivedAt ? cr.archivedAt : undefined,
      });
    }
  }
  const selectable = (id: unknown) => out.children.some((c) => c.id === id && !isChildArchived(c));
  out.selectedChildId =
    typeof r.selectedChildId === 'string' && selectable(r.selectedChildId)
      ? r.selectedChildId
      : (out.children.find((c) => !isChildArchived(c))?.id ?? null);
  return { household: out, duplicateChildIds, unreadableEntries };
}

function adopt(stored: string | null): Household {
  let parsed: unknown = null;
  let unreadableFile = false;
  try {
    parsed = stored ? JSON.parse(stored) : null;
  } catch {
    unreadableFile = true;
  }
  const result = normalize(parsed);
  integrity = {
    loadFailed: false,
    duplicateChildIds: result.duplicateChildIds,
    unreadableEntries: result.unreadableEntries + (unreadableFile ? 1 : 0),
  };
  rawToPreserve = stored !== null && integrity.unreadableEntries > 0 ? stored : null;
  state = result.household;
  return state;
}

function failToLoad(): Household {
  // Nothing was read. Show an empty household, but never write it over whatever is stored.
  integrity = { ...CLEAN_INTEGRITY, loadFailed: true };
  rawToPreserve = null;
  state = emptyHousehold();
  return state;
}

export function ensureHouseholdLoaded(): Promise<Household> {
  if (state) return Promise.resolve(state);
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(HOUSEHOLD_KEY)
      .then((stored) => state ?? adopt(stored))
      .catch(() => state ?? failToLoad())
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

export function peekHousehold(): Household | null {
  return state;
}

// Reads the stored household again (after a conflict, or to retry a failed read). Returns false when it could not be read.
export async function reloadHousehold(): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(HOUSEHOLD_KEY);
    const next = adopt(stored);
    listeners.forEach((l) => l(next));
    return true;
  } catch {
    if (!state) failToLoad();
    return false;
  }
}

function revisionOf(raw: string | null): number | 'unreadable' {
  if (raw === null) return 0;
  try {
    const parsed = JSON.parse(raw) as { revision?: unknown } | null;
    if (!parsed || typeof parsed !== 'object') return 'unreadable';
    return typeof parsed.revision === 'number' && Number.isInteger(parsed.revision) && parsed.revision >= 0 ? parsed.revision : 0;
  } catch {
    return 'unreadable';
  }
}

type SaveOutcome = { status: 'ok'; saved: Household } | { status: 'failed' | 'conflict' } | { status: 'denied'; reason: ActionFailure };

// Writes `next` over the revision the in-memory copy has, and reads it back. Never changes the in-memory copy.
// `recheck` (a parent-only action) is asked once more after the storage has been read and just before anything is written: the last
// moment a revoked session can still stop the write.
function save(next: Household, recheck?: () => Promise<ActionResult | null>): Promise<SaveOutcome> {
  return trackOperation(
    (async (): Promise<SaveOutcome> => {
      let raw: string | null;
      try {
        raw = await AsyncStorage.getItem(HOUSEHOLD_KEY);
      } catch {
        return { status: 'failed' };
      }
      const storedRevision = revisionOf(raw);
      // Text that is there but cannot be read is not ours to overwrite without a copy; the copy is made below.
      const mine = state?.revision ?? 0;
      if (storedRevision !== 'unreadable' && storedRevision !== mine) return { status: 'conflict' };
      if (recheck) {
        const denied = await recheck(); // before even the safety copy below is written
        if (denied && !denied.ok) return { status: 'denied', reason: denied.reason };
      }
      if (raw !== null && (storedRevision === 'unreadable' || rawToPreserve !== null)) {
        const keep = rawToPreserve ?? raw;
        const copyKey = `${HOUSEHOLD_KEY}.corrupt-${Date.now()}`;
        try {
          await AsyncStorage.setItem(copyKey, keep);
          if ((await AsyncStorage.getItem(copyKey)) !== keep) return { status: 'failed' };
        } catch {
          return { status: 'failed' };
        }
        rawToPreserve = null;
      }
      if (recheck) {
        const denied = await recheck();
        if (denied && !denied.ok) return { status: 'denied', reason: denied.reason };
      }
      const saved: Household = { ...next, revision: (storedRevision === 'unreadable' ? mine : storedRevision) + 1 };
      const json = JSON.stringify(saved);
      try {
        await AsyncStorage.setItem(HOUSEHOLD_KEY, json);
        if ((await AsyncStorage.getItem(HOUSEHOLD_KEY)) !== json) return { status: 'conflict' }; // another tab wrote in between
      } catch {
        return { status: 'failed' };
      }
      return { status: 'ok', saved };
    })()
  );
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

// ---- results ----

export type ActionFailure =
  | 'invalid'
  | 'not-found'
  | 'not-allowed'
  | 'wrong-state'
  // the change could not be saved (nothing changed), or the household could not be read
  | 'storage'
  // another tab saved a newer household first; nothing was overwritten
  | 'conflict'
  // two children share an id, so the household is read-only until a parent resolves it
  | 'blocked'
  // family mode: the Parent PIN has to be set up first / the parent area has to be unlocked (a verified parent session is checked
  // when every parent-only action runs) / the PIN's recovery code was never confirmed / the check itself could not be made
  | 'pin-required'
  | 'locked'
  | 'unconfirmed'
  // family profiles are unavailable (profile storage is in safe mode)
  | 'unavailable';
export type ActionResult = { ok: true; id?: string } | { ok: false; reason: ActionFailure };

type Plan = { ok: true; next: Household; id?: string } | { ok: false; reason: ActionFailure };

// Applies one change: wait for earlier changes, build the new household from the CURRENT one, check (for a parent-only action, `level`)
// that a verified parent session is open RIGHT NOW, save it (checked and read back), and only then update memory and tell the
// screens. After a conflict the newer household is adopted and the change is built again from it, once.
function change(build: (h: Household) => Plan, level?: ParentActionLevel): Promise<ActionResult> {
  const run = async (): Promise<ActionResult> => {
    let h = await ensureHouseholdLoaded();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (integrity.loadFailed && !(await reloadHousehold())) return { ok: false, reason: 'storage' };
      h = state ?? h;
      if (integrity.duplicateChildIds.length > 0) return { ok: false, reason: 'blocked' };
      const plan = build(h);
      if (!plan.ok) return plan;
      if (level) {
        // The last look before anything is written: a session that ended, a paused or backgrounded app or a missing PIN means no.
        const denied = await requireParent(level);
        if (denied) return denied;
      }
      if (plan.next === h) return plan.id === undefined ? { ok: true } : { ok: true, id: plan.id }; // nothing to change: nothing to save
      const outcome = await save(plan.next, level ? () => requireParent(level) : undefined);
      if (outcome.status === 'denied') return { ok: false, reason: outcome.reason };
      if (outcome.status === 'ok') {
        state = outcome.saved;
        integrity = { ...integrity, unreadableEntries: 0 }; // what could not be understood was copied aside, and is no longer in the saved copy
        listeners.forEach((l) => l(outcome.saved));
        return plan.id === undefined ? { ok: true } : { ok: true, id: plan.id };
      }
      if (outcome.status === 'failed') return { ok: false, reason: 'storage' };
      if (!(await reloadHousehold())) return { ok: false, reason: 'conflict' };
    }
    return { ok: false, reason: 'conflict' };
  };
  const result = changeChain.then(run, run);
  changeChain = result.catch(() => {});
  return result;
}

// In family mode every parent-only action needs a verified parent session at the moment it runs (see @/utils/parent-session.ts for the
// two levels). With family mode off nothing changes: these actions behave exactly as before.
async function requireParent(level: ParentActionLevel): Promise<ActionResult | null> {
  const check = await checkParentAction(level);
  return check.ok ? null : { ok: false, reason: check.reason };
}

// ---- parent ----

export async function saveParentProfile(displayName: string, familyName: string): Promise<ActionResult> {
  const name = clean(displayName, MAX_NAME);
  if (!name) return { ok: false, reason: 'invalid' };
  return change((h) => ({ ok: true, next: { ...h, parent: { displayName: name, familyName: clean(familyName, MAX_NAME) } } }), 'parent');
}

// ---- children ----

// Creates a child. In family mode the storage profile is registered FIRST (a registry record only; no child data exists yet),
// then the household record is saved. If the second step fails, the first leaves an empty profile with no household record: it is
// invisible (the picker only offers children that have a household record), nothing is lost, and trying again makes a new id,
// so no child ever appears twice. Reconciliation (@/utils/family-profiles.ts) reports such leftovers and never deletes them.
export async function addChild(nickname: string): Promise<ActionResult> {
  const name = clean(nickname, MAX_NAME);
  if (!name) return { ok: false, reason: 'invalid' };
  const denied = await requireParent('children'); // before the profile is registered, so a refusal leaves nothing behind
  if (denied) return denied;
  const id = newId('child');
  if (FAMILY_MODE_ENABLED) {
    const registered = await registerChildProfile(id);
    if (!registered.ok) {
      return { ok: false, reason: registered.reason === 'unavailable' ? 'unavailable' : registered.reason === 'conflict' ? 'conflict' : 'storage' };
    }
  }
  return change((h) => {
    if (h.children.some((c) => c.id === id)) return { ok: false, reason: 'conflict' }; // an id is never reused
    const child: ChildProfile = {
      id,
      nickname: name,
      createdAt: new Date().toISOString(),
      settings: { ...DEFAULT_CHILD_SETTINGS },
      tasks: [],
    };
    return { ok: true, id, next: { ...h, children: [...h.children, child], selectedChildId: child.id } };
  }, 'children');
}

export async function renameChild(childId: string, nickname: string): Promise<ActionResult> {
  const name = clean(nickname, MAX_NAME);
  if (!name) return { ok: false, reason: 'invalid' };
  const denied = await requireParent('children');
  if (denied) return denied;
  return change(
    (h) =>
      h.children.some((c) => c.id === childId)
        ? { ok: true, next: updateChildIn(h, childId, (c) => ({ ...c, nickname: name })) }
        : { ok: false, reason: 'not-found' },
    'children'
  );
}

// Archives or restores a child. Nothing is deleted: the child's profile and every saved record stay exactly as they are, and
// their pets keep aging by the clock (the app cannot pause them). No screen offers this yet.
export async function setChildArchived(childId: string, archived: boolean): Promise<ActionResult> {
  const denied = await requireParent('children');
  if (denied) return denied;
  return change((h) => {
    const child = h.children.find((c) => c.id === childId);
    if (!child) return { ok: false, reason: 'not-found' };
    if (isChildArchived(child) === archived) return { ok: true, next: h };
    const updated = updateChildIn(h, childId, (c) => ({ ...c, archivedAt: archived ? new Date().toISOString() : undefined }));
    const stillSelectable = updated.children.some((c) => c.id === updated.selectedChildId && !isChildArchived(c));
    return {
      ok: true,
      next: stillSelectable ? updated : { ...updated, selectedChildId: updated.children.find((c) => !isChildArchived(c))?.id ?? null },
    };
  }, 'children');
}

export async function selectChild(childId: string): Promise<void> {
  await change((h) =>
    h.selectedChildId === childId || !h.children.some((c) => c.id === childId && !isChildArchived(c))
      ? { ok: true, next: h }
      : { ok: true, next: { ...h, selectedChildId: childId } },
    'parent'
  );
}

export async function updateChildSettings(childId: string, patch: Partial<ChildSettings>): Promise<ActionResult> {
  return change((h) =>
    h.children.some((c) => c.id === childId)
      ? { ok: true, next: updateChildIn(h, childId, (c) => ({ ...c, settings: { ...c.settings, ...patch } })) }
      : { ok: false, reason: 'not-found' },
    'parent'
  );
}

// ---- tasks ----

// A parent assigns a task; or (createdBy 'child', only when allowed in the child's settings) the child adds one.
export async function addTask(childId: string, text: string, createdBy: 'parent' | 'child'): Promise<ActionResult> {
  const t = clean(text, MAX_TASK);
  if (!t) return { ok: false, reason: 'invalid' };
  return change((h) => {
    const child = h.children.find((c) => c.id === childId);
    if (!child) return { ok: false, reason: 'not-found' };
    if (createdBy === 'child' && !child.settings.canCreateTasks) return { ok: false, reason: 'not-allowed' };
    const task: HouseholdTask = { id: newId('task'), text: t, createdBy, status: 'assigned', createdAt: new Date().toISOString() };
    return { ok: true, id: task.id, next: updateChildIn(h, childId, (c) => ({ ...c, tasks: [...c.tasks, task] })) };
  }, createdBy === 'parent' ? 'parent' : undefined); // a task a child adds (when allowed) is the child's own action
}

// The CHILD side: "I did it". With approval required the task becomes 'pending' (no reward, waits for a
// parent); otherwise it is simply 'completed'. There is no child screen yet, so the dashboard only offers this
// as a clearly labelled preview for testing.
export async function markTaskDone(childId: string, taskId: string): Promise<ActionResult> {
  return change((h) => {
    const child = h.children.find((c) => c.id === childId);
    const task = child?.tasks.find((t) => t.id === taskId);
    if (!child || !task) return { ok: false, reason: 'not-found' };
    if (task.status !== 'assigned') return { ok: false, reason: 'wrong-state' };
    const now = new Date().toISOString();
    const status: HouseholdTaskStatus = child.settings.requireApproval ? 'pending' : 'completed';
    return {
      ok: true,
      next: updateChildIn(h, childId, (c) => ({
        ...c,
        tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, status, submittedAt: now, decidedAt: status === 'completed' ? now : undefined } : t)),
      })),
    };
  });
}

// The PARENT side. These only exist in the Parent Dashboard; no child-facing code calls them.
export async function approveTask(childId: string, taskId: string): Promise<ActionResult> {
  return change((h) => {
    const task = h.children.find((c) => c.id === childId)?.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, reason: 'not-found' };
    if (task.status !== 'pending') return { ok: false, reason: 'wrong-state' };
    const now = new Date().toISOString();
    return {
      ok: true,
      next: updateChildIn(h, childId, (c) => ({
        ...c,
        tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, status: 'approved', decidedAt: now } : t)),
      })),
    };
  }, 'parent');
}

export async function sendTaskBack(childId: string, taskId: string): Promise<ActionResult> {
  return change((h) => {
    const task = h.children.find((c) => c.id === childId)?.tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, reason: 'not-found' };
    if (task.status !== 'pending') return { ok: false, reason: 'wrong-state' };
    return {
      ok: true,
      next: updateChildIn(h, childId, (c) => ({
        ...c,
        tasks: c.tasks.map((t) => (t.id === taskId ? { ...t, status: 'assigned', submittedAt: undefined, decidedAt: undefined } : t)),
      })),
    };
  }, 'parent');
}

export async function deleteTask(childId: string, taskId: string): Promise<ActionResult> {
  return change((h) =>
    h.children.find((c) => c.id === childId)?.tasks.some((t) => t.id === taskId)
      ? { ok: true, next: updateChildIn(h, childId, (c) => ({ ...c, tasks: c.tasks.filter((t) => t.id !== taskId) })) }
      : { ok: false, reason: 'not-found' },
    'parent'
  );
}

export function tasksByStatus(child: ChildProfile) {
  return {
    assigned: child.tasks.filter((t) => t.status === 'assigned'),
    pending: child.tasks.filter((t) => t.status === 'pending'),
    completed: child.tasks.filter((t) => t.status === 'approved' || t.status === 'completed'),
  };
}
