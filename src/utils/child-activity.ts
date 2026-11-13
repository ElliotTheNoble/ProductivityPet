import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  TOKEN_SOURCES,
  buildAssignedSummary,
  buildMilestones,
  buildStreak,
  buildTaskStatus,
  buildTokenSummary,
  type ActivityInput,
  type AssignedSummary,
  type Milestone,
  type TaskStatus,
  type TokenSummary,
} from '@/utils/child-activity-model';
import { getSelectableChildren } from '@/utils/family-profiles';
import { ensureHouseholdLoaded, finishedDateISO } from '@/utils/household';
import { FAMILY_KEY_NAME, getPetLabel, parseSavedFamily } from '@/utils/pet-family';
import { checkParentAction } from '@/utils/parent-session';
import { ensureProfilesReady, scopedKeyFor } from '@/utils/profiles';
import type { TokenEvent } from '@/utils/token-history';
import { dateToISO, normalizeTask, type Task } from '@/utils/tasks';

// What the Parent Dashboard may read of ONE child for the Tasks, Accomplishments and Activity History sections. Rules (same as the other
// parent-side readers, see @/utils/child-overview.ts):
//  - a verified parent session has to be open right now;
//  - only an ACTIVE child (not archived, a registered unique profile) can be read; Main is never readable here;
//  - it reads exactly four of that child's own saved records with getItem (tasks, Paw Token earnings, owned shop items, pets) plus the
//    household's list of tasks assigned by the parent, and nothing else: never a journal, a mood record or anything of Main;
//  - it writes nothing, caches nothing, switches no profile and loads no game store; the numbers are worked out on copies;
//  - a record that cannot be read is reported as unreadable, one that is not there as "none". Nothing is ever guessed.

type Section<T> = { state: 'none' } | { state: 'unreadable' } | { state: 'ok'; value: T };

export type ChildActivity = {
  status: 'ok';
  childId: string;
  nickname: string;
  today: string;
  tasks: Section<{ status: TaskStatus; skippedEntries: number }>;
  assigned: AssignedSummary;
  tokens: Section<TokenSummary & { events: TokenEvent[]; balance: number | null }>;
  milestones: Section<Milestone[]>;
  streak: { current: number; longest: number; undated: number } | null;
  itemsOwned: Section<number>;
  // What the activity history is built from (see buildActivity); null parts mean that record is missing or unreadable.
  activityInput: ActivityInput;
};

export type ChildActivityResult = ChildActivity | { status: 'not-allowed' } | { status: 'not-a-child' } | { status: 'unreadable' };

async function readJson(key: string): Promise<Section<unknown>> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(key);
  } catch {
    return { state: 'unreadable' };
  }
  if (raw === null) return { state: 'none' };
  try {
    return { state: 'ok', value: JSON.parse(raw) as unknown };
  } catch {
    return { state: 'unreadable' };
  }
}

function parseTasks(value: unknown): { tasks: Task[]; skipped: number } {
  if (!Array.isArray(value)) return { tasks: [], skipped: 0 };
  const tasks: Task[] = [];
  let skipped = 0;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || typeof (raw as { id?: unknown }).id !== 'string' || typeof (raw as { text?: unknown }).text !== 'string') {
      skipped += 1;
      continue;
    }
    // An empty fallback date: a record with no usable date stays "no due date" instead of being given one.
    tasks.push(normalizeTask(raw, ''));
  }
  return { tasks, skipped };
}

function parseTokens(value: unknown): { events: TokenEvent[]; startedAt: string } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { startedAt?: unknown; events?: unknown };
  if (typeof record.startedAt !== 'string' || !Array.isArray(record.events)) return null;
  const events = record.events.filter(
    (e): e is TokenEvent =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as TokenEvent).id === 'string' &&
      typeof (e as TokenEvent).at === 'string' &&
      typeof (e as TokenEvent).dateISO === 'string' &&
      typeof (e as TokenEvent).amount === 'number' &&
      (TOKEN_SOURCES as readonly string[]).includes((e as TokenEvent).source)
  );
  return { events, startedAt: record.startedAt };
}

// The date the child's first saved pet was created (null when there is no readable pet record).
function firstPetISO(family: ReturnType<typeof parseSavedFamily>): string | null {
  const dates = (family?.pets ?? [])
    .map((pet) => new Date(pet.createdAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .map((date) => dateToISO(date))
    .sort();
  return dates.length > 0 ? dates[0] : null;
}

export async function readChildActivity(childId: string, now: Date = new Date()): Promise<ChildActivityResult> {
  const check = await checkParentAction('children');
  if (!check.ok) return { status: 'not-allowed' };
  try {
    await ensureProfilesReady();
    const child = (await getSelectableChildren()).find((c) => c.id === childId);
    if (!child) return { status: 'not-a-child' };
    const today = dateToISO(now);

    const [tasksRaw, tokensRaw, ownedRaw, familyRaw] = await Promise.all([
      readJson(scopedKeyFor(childId, 'tasks')),
      readJson(scopedKeyFor(childId, 'tokenEarnings')),
      readJson(scopedKeyFor(childId, 'ownedShopItems')),
      readJson(scopedKeyFor(childId, FAMILY_KEY_NAME)),
    ]);

    let parsedTasks: Task[] = [];
    let tasks: ChildActivity['tasks'];
    if (tasksRaw.state !== 'ok') tasks = tasksRaw;
    else if (!Array.isArray(tasksRaw.value)) tasks = { state: 'unreadable' };
    else {
      const parsed = parseTasks(tasksRaw.value);
      parsedTasks = parsed.tasks;
      tasks = { state: 'ok', value: { status: buildTaskStatus(parsed.tasks, today), skippedEntries: parsed.skipped } };
    }

    let family: ReturnType<typeof parseSavedFamily> = null;
    let milestones: ChildActivity['milestones'];
    if (familyRaw.state !== 'ok') milestones = familyRaw;
    else {
      family = parseSavedFamily(familyRaw.value);
      milestones = family
        ? { state: 'ok', value: buildMilestones(family.pets.map((pet) => ({ id: pet.id, label: getPetLabel(pet, family!.pets), events: pet.events }))) }
        : { state: 'unreadable' };
    }

    let tokens: ChildActivity['tokens'];
    let tokenSource: ActivityInput['tokens'] = null;
    if (tokensRaw.state !== 'ok') tokens = tokensRaw;
    else {
      const parsed = parseTokens(tokensRaw.value);
      if (!parsed) tokens = { state: 'unreadable' };
      else {
        const summary = buildTokenSummary(parsed.events, parsed.startedAt);
        tokens = { state: 'ok', value: { ...summary, events: parsed.events, balance: family ? family.wallet.pawTokens : null } };
        tokenSource = { events: parsed.events, startedISO: summary.startedISO };
      }
    }

    let itemsOwned: ChildActivity['itemsOwned'];
    if (ownedRaw.state !== 'ok') itemsOwned = ownedRaw;
    else itemsOwned = Array.isArray(ownedRaw.value) ? { state: 'ok', value: ownedRaw.value.filter((id) => typeof id === 'string').length } : { state: 'unreadable' };

    const household = await ensureHouseholdLoaded();
    const record = household.children.find((c) => c.id === childId);

    return {
      status: 'ok',
      childId,
      nickname: child.nickname,
      today,
      tasks,
      assigned: buildAssignedSummary(record?.tasks ?? []),
      tokens,
      milestones,
      // no saved tasks at all is a streak of 0 days (true); a task list that could not be read says nothing (null)
      streak: tasks.state === 'ok' ? buildStreak(parsedTasks, today) : tasks.state === 'none' ? { current: 0, longest: 0, undated: 0 } : null,
      itemsOwned,
      activityInput: {
        tasks: parsedTasks,
        tokens: tokenSource,
        milestones: milestones.state === 'ok' ? milestones.value : [],
        firstPetISO: firstPetISO(family),
        householdDone: (record?.tasks ?? []).map(finishedDateISO).filter((date): date is string => date !== null),
      },
    };
  } catch {
    return { status: 'unreadable' };
  }
}
