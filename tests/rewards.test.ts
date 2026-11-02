import type { Task } from '@/utils/tasks';
import { T0, UNITS, fixture, flush, freezeClock, iso, loadApp, unfreezeClock, type App } from './helpers';

const FAMILY_KEY = '@ProductivityPet:petFamily';
const AWARDED_KEY = '@ProductivityPet:awardedTaskTokens';
const BISCUIT = 'pet-1700000000000';

function task(id: string, over: Partial<Task> = {}): Task {
  return { id, text: id, category: 'Home' as Task['category'], important: false, kind: 'task', date: '2026-03-10', completed: false, ...over };
}

// A family of `n` healthy pets (1..3) with a known wallet, so rewards are easy to read.
function family(n: number, tokens = 0): Record<string, unknown> {
  const base = fixture('family-v1-mixed')[FAMILY_KEY] as any;
  const pets = base.pets.slice(0, n).map((p: any) => ({
    ...p,
    lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: iso(T0) },
    profile: { ...p.profile, hunger: 90, cleanliness: 90, happiness: 90, energy: 90 },
    events: p.events.filter((e: any) => e.type === 'adopted' || e.type === 'hatched'),
  }));
  return { [FAMILY_KEY]: { ...base, pets, selectedPetId: pets[0].id, wallet: { pawTokens: tokens } } };
}

// Starts the app with the "already paid" record created (the normal state after first launch).
async function start(n = 1, tokens = 0, awarded: string[] = []): Promise<App> {
  const app = await loadApp({ ...family(n, tokens), [AWARDED_KEY]: awarded });
  await app.family.ensureFamilyLoaded();
  return app;
}
const wallet = (app: App) => app.family.getWalletBalance();
const growth = (app: App, id = BISCUIT) => app.family.peekFamily()!.pets.find((p) => p.id === id)!.growthUnits;
const earnedEvents = async (app: App) => (await app.history.getTokenHistory()).events;

beforeEach(() => freezeClock(T0));
afterEach(() => unfreezeClock());

describe('Paw Token rewards for completed tasks', () => {
  test('a regular task pays 10 and an important task pays 15 (one living pet)', async () => {
    const app = await start(1, 100);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true }), task('b', { completed: true, important: true })]);
    expect(wallet(app)).toBe(100 + 10 + 15);
  });

  test('each task also grows the pet by exactly one task of growth', async () => {
    const app = await start(1);
    const before = growth(app);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true }), task('b', { completed: true })]);
    expect(growth(app)).toBe(before + 2 * UNITS);
  });

  test('more living pets earn more tokens per task, and growth is shared', async () => {
    const two = await start(2);
    await two.tokens.reconcilePawTokenEarnings([task('a', { completed: true }), task('b', { completed: true, important: true })]);
    expect(wallet(two)).toBe(20 + 30);
    const three = await start(3);
    const before = three.family.peekFamily()!.pets.map((p) => p.growthUnits);
    await three.tokens.reconcilePawTokenEarnings([task('a', { completed: true }), task('b', { completed: true, important: true })]);
    expect(wallet(three)).toBe(30 + 45);
    three.family.peekFamily()!.pets.forEach((p, i) => expect(p.growthUnits - before[i]).toBe(2 * (UNITS / 3)));
  });

  test('an appointment pays a flat 5 and gives no growth; birthdays pay nothing', async () => {
    const app = await start(1);
    const before = growth(app);
    await app.tokens.reconcilePawTokenEarnings([
      task('appt', { kind: 'event', completed: true, important: true }),
      task('bday', { kind: 'birthday', completed: true, repeat: { kind: 'yearly' }, completedDates: ['2026-03-10'] }),
    ]);
    expect(wallet(app)).toBe(5);
    expect(growth(app)).toBe(before);
  });

  test('sick pets still earn the player tokens, but receive no growth', async () => {
    const seed = family(1) as any;
    seed[FAMILY_KEY].pets[0].lifecycle = { state: 'sick', sickSince: iso(T0 - HOURS(1)), exhausted: false, lastEvaluatedAt: iso(T0) };
    seed[FAMILY_KEY].pets[0].profile.hunger = 0;
    const app = await loadApp({ ...seed, [AWARDED_KEY]: [] });
    await app.family.ensureFamilyLoaded();
    const before = growth(app);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true })]);
    expect(wallet(app)).toBe(10);
    expect(growth(app)).toBe(before);
  });
});

describe('duplicate reward prevention', () => {
  test('reconciling the same completed task again pays nothing more', async () => {
    const app = await start(1);
    const list = [task('a', { completed: true })];
    await app.tokens.reconcilePawTokenEarnings(list);
    await app.tokens.reconcilePawTokenEarnings(list);
    await app.tokens.reconcilePawTokenEarnings([...list]);
    expect(wallet(app)).toBe(10);
  });

  test('un-checking and re-checking a task never pays twice', async () => {
    const app = await start(1);
    const before = growth(app);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true })]);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: false })]);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true })]);
    expect(wallet(app)).toBe(10);
    expect(growth(app)).toBe(before + UNITS);
  });

  test('un-checking through the real toggle function also leaves the reward alone', async () => {
    const app = await start(1);
    let list = [task('a')];
    list = app.tasks.toggleTaskOccurrence(list, 'a', '2026-03-10');
    await app.tokens.reconcilePawTokenEarnings(list);
    list = app.tasks.toggleTaskOccurrence(list, 'a', '2026-03-10');
    await app.tokens.reconcilePawTokenEarnings(list);
    list = app.tasks.toggleTaskOccurrence(list, 'a', '2026-03-10');
    await app.tokens.reconcilePawTokenEarnings(list);
    expect(wallet(app)).toBe(10);
  });

  test('a repeating task pays once per day, not once per task', async () => {
    const app = await start(1);
    const daily = (dates: string[]) => task('daily', { repeat: { kind: 'daily' }, completedDates: dates });
    await app.tokens.reconcilePawTokenEarnings([daily(['2026-03-10'])]);
    await app.tokens.reconcilePawTokenEarnings([daily(['2026-03-10', '2026-03-11'])]);
    await app.tokens.reconcilePawTokenEarnings([daily(['2026-03-10', '2026-03-11'])]);
    await app.tokens.reconcilePawTokenEarnings([daily(['2026-03-11'])]); // un-checked the 10th
    await app.tokens.reconcilePawTokenEarnings([daily(['2026-03-10', '2026-03-11'])]); // checked it again
    expect(wallet(app)).toBe(20);
  });

  test('deleting a paid task and creating one with the same id does not pay again', async () => {
    const app = await start(1);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true })]);
    await app.tokens.reconcilePawTokenEarnings([]);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true })]);
    expect(wallet(app)).toBe(10);
  });

  test('overlapping calls (screen load + a quick edit) pay once', async () => {
    const app = await start(1);
    const list = [task('a', { completed: true }), task('b', { completed: true })];
    await Promise.all(Array.from({ length: 6 }, () => app.tokens.reconcilePawTokenEarnings(list)));
    expect(wallet(app)).toBe(20);
  });

  test('closing and reopening the app does not pay again', async () => {
    const first = await start(1);
    const list = [task('a', { completed: true })];
    await first.tokens.reconcilePawTokenEarnings(list);
    await flush();
    const reopened = await loadApp(undefined, await first.dump());
    await reopened.family.ensureFamilyLoaded();
    await reopened.tokens.reconcilePawTokenEarnings(list);
    expect(wallet(reopened)).toBe(10);
    expect(JSON.parse((await reopened.dump()).get(AWARDED_KEY)!)).toEqual(['a']);
  });

  test('the paid-keys record only ever grows', async () => {
    const app = await start(1, 0, ['old']);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true })]);
    await app.tokens.reconcilePawTokenEarnings([]);
    await flush();
    expect(JSON.parse((await app.dump()).get(AWARDED_KEY)!).sort()).toEqual(['a', 'old']);
  });

  test('tasks completed before the reward system existed are recorded, not paid (first run only)', async () => {
    const app = await loadApp(family(1)); // no paid-keys record yet
    await app.family.ensureFamilyLoaded();
    await app.tokens.reconcilePawTokenEarnings([task('old1', { completed: true }), task('old2', { completed: true })]);
    expect(wallet(app)).toBe(0);
    await flush();
    expect(JSON.parse((await app.dump()).get(AWARDED_KEY)!).sort()).toEqual(['old1', 'old2']);
    await app.tokens.reconcilePawTokenEarnings([task('old1', { completed: true }), task('new', { completed: true })]);
    expect(wallet(app)).toBe(10);
  });

  test('the earnings history logs each reward once, with a stable id', async () => {
    const app = await start(1);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true, important: true })]);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true, important: true })]);
    const events = await earnedEvents(app);
    expect(events.map((e) => [e.id, e.amount, e.source, e.refId])).toEqual([['earn:a', 15, 'task', 'a']]);
    await app.history.recordTokenEarning({ id: 'earn:a', amount: 15, source: 'task' });
    expect(await earnedEvents(app)).toHaveLength(1);
  });

  test('a failed save of the paid-keys record still cannot double-pay within the session', async () => {
    const app = await start(1);
    jest.spyOn(app.AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true })]);
    await app.tokens.reconcilePawTokenEarnings([task('a', { completed: true })]);
    expect(wallet(app)).toBe(10);
  });
});

describe('reward-history health (BUG-069)', () => {
  const done = (...ids: string[]) => ids.map((id) => task(id, { completed: true }));
  const backups = async (app: App) => [...(await app.dump()).keys()].filter((k) => k.startsWith(`${AWARDED_KEY}.corrupt-`));

  test.each([
    ['not JSON at all', '{ corrupt'],
    ['a list cut off in the middle', '["a","b","c'],
    ['valid JSON that is not a list', '{"a":true}'],
    ['the word null', 'null'],
  ])('corrupt record (%s): nothing is paid again, the original is kept, the record is rebuilt', async (_name, bad) => {
    const app = await loadApp({ ...family(1, 100), [AWARDED_KEY]: bad });
    await app.family.ensureFamilyLoaded();
    await app.tokens.reconcilePawTokenEarnings(done('a', 'b'));
    expect(wallet(app)).toBe(100); // legitimate balance kept, nothing paid again
    await flush();
    const saved = await backups(app);
    expect(saved).toHaveLength(1);
    expect((await app.dump()).get(saved[0])).toBe(bad);
    expect(app.tokens.getRewardHistoryStatus()).toEqual({ state: 'recovered-corrupt', backupKey: saved[0] });
    // The record is valid again and already holds what is completed...
    expect(JSON.parse((await app.dump()).get(AWARDED_KEY)!)).toEqual(expect.arrayContaining(['a', 'b']));
    // ...so rewards work normally from here on: a NEW completion pays, old ones never do.
    await app.tokens.reconcilePawTokenEarnings(done('a', 'b', 'c'));
    await app.tokens.reconcilePawTokenEarnings(done('a', 'b', 'c'));
    expect(wallet(app)).toBe(110);
  });

  test('keys that can still be read from a damaged record are kept (a task done earlier and since un-checked)', async () => {
    const app = await loadApp({ ...family(1), [AWARDED_KEY]: '["old1","old2","old3' });
    await app.family.ensureFamilyLoaded();
    await app.tokens.reconcilePawTokenEarnings(done('x'));
    await app.tokens.reconcilePawTokenEarnings(done('x', 'old1', 'old2'));
    expect(wallet(app)).toBe(0);
  });

  test('a restart after recovery does not recover (or pay) a second time', async () => {
    const first = await loadApp({ ...family(1), [AWARDED_KEY]: '{ corrupt' });
    await first.family.ensureFamilyLoaded();
    await first.tokens.reconcilePawTokenEarnings(done('a'));
    await flush();
    const reopened = await loadApp(undefined, await first.dump());
    await reopened.family.ensureFamilyLoaded();
    await reopened.tokens.reconcilePawTokenEarnings(done('a'));
    expect(wallet(reopened)).toBe(0);
    expect(reopened.tokens.getRewardHistoryStatus()).toEqual({ state: 'ok' });
    expect(await backups(reopened)).toHaveLength(1);
  });

  test('if the original cannot be preserved, nothing is paid and nothing is overwritten; a later call recovers', async () => {
    const app = await loadApp({ ...family(1), [AWARDED_KEY]: '{ corrupt' });
    await app.family.ensureFamilyLoaded();
    const realSet = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn().mockRejectedValue(new Error('disk full'));
    await app.tokens.reconcilePawTokenEarnings(done('a'));
    expect(wallet(app)).toBe(0);
    expect(app.tokens.getRewardHistoryStatus()).toEqual({ state: 'unreadable' });
    expect((await app.dump()).get(AWARDED_KEY)).toBe('{ corrupt');
    app.AsyncStorage.setItem = realSet;
    await app.tokens.reconcilePawTokenEarnings(done('a'));
    expect(wallet(app)).toBe(0);
    expect(app.tokens.getRewardHistoryStatus()?.state).toBe('recovered-corrupt');
  });

  test('if the record cannot be READ, nothing is paid or written, and the next call works normally', async () => {
    const first = await start(1, 0, ['a']);
    const again = await loadApp(undefined, await first.dump());
    await again.family.ensureFamilyLoaded();
    const realGet = again.AsyncStorage.getItem;
    again.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === AWARDED_KEY) throw new Error('read error');
      return realGet(key);
    });
    await again.tokens.reconcilePawTokenEarnings(done('a', 'b'));
    expect(wallet(again)).toBe(0);
    expect(again.tokens.getRewardHistoryStatus()).toEqual({ state: 'unreadable' });
    expect(JSON.parse((await realGet(AWARDED_KEY))!)).toEqual(['a']); // not overwritten
    again.AsyncStorage.getItem = realGet;
    await again.tokens.reconcilePawTokenEarnings(done('a', 'b'));
    expect(wallet(again)).toBe(10); // only 'b' is new
    expect(again.tokens.getRewardHistoryStatus()).toEqual({ state: 'ok' });
  });

  test('valid record: unchanged, status ok, no backup', async () => {
    const app = await start(1, 50, ['a']);
    await app.tokens.reconcilePawTokenEarnings(done('a', 'b'));
    expect(wallet(app)).toBe(60);
    expect(app.tokens.getRewardHistoryStatus()).toEqual({ state: 'ok' });
    expect(await backups(app)).toHaveLength(0);
  });

  test('a valid empty list is a valid record (everything completed is new)', async () => {
    const app = await start(1, 0, []);
    await app.tokens.reconcilePawTokenEarnings(done('a'));
    expect(wallet(app)).toBe(10);
  });

  test('missing record, new player: recorded as new, first completion pays', async () => {
    const app = await loadApp(family(1));
    await app.family.ensureFamilyLoaded();
    await app.tokens.reconcilePawTokenEarnings([]);
    expect(app.tokens.getRewardHistoryStatus()).toEqual({ state: 'new-player' });
    await app.tokens.reconcilePawTokenEarnings(done('a'));
    expect(wallet(app)).toBe(10);
  });

  test('missing record, returning player (tasks done, or earnings history exists): nothing paid again', async () => {
    const withTasks = await loadApp(family(1));
    await withTasks.family.ensureFamilyLoaded();
    await withTasks.tokens.reconcilePawTokenEarnings(done('a'));
    expect(wallet(withTasks)).toBe(0);
    expect(withTasks.tokens.getRewardHistoryStatus()).toEqual({ state: 'recovered-missing' });

    const history = {
      startedAt: iso(T0 - 1000),
      events: [{ id: 'earn:z', at: iso(T0 - 1000), dateISO: '2026-03-09', amount: 10, source: 'task' }],
    };
    const withHistory = await loadApp({ ...family(1), '@ProductivityPet:tokenEarnings': history });
    await withHistory.family.ensureFamilyLoaded();
    await withHistory.tokens.reconcilePawTokenEarnings([]);
    expect(withHistory.tokens.getRewardHistoryStatus()).toEqual({ state: 'recovered-missing' });
  });

  test('earned tokens and every other saved value are never removed by recovery', async () => {
    const app = await loadApp({ ...family(1, 640), [AWARDED_KEY]: '[[[' });
    await app.family.ensureFamilyLoaded();
    await flush();
    const before = (await app.dump()).get(FAMILY_KEY);
    await app.tokens.reconcilePawTokenEarnings(done('a', 'b', 'c'));
    expect(wallet(app)).toBe(640);
    await flush();
    expect((await app.dump()).get(FAMILY_KEY)).toBe(before);
  });
});

function HOURS(n: number) {
  return n * 3_600_000;
}
