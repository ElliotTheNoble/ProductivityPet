import { DAY, HOUR, T0, UNITS, fixture, flush, freezeClock, iso, loadApp, setClock, unfreezeClock, type App } from './helpers';

const FAMILY_KEY = '@ProductivityPet:petFamily';
const BISCUIT = 'pet-1700000000000'; // healthy adult
const MOCHI = 'pet-1700000000001'; // sick
const LUNA = 'pet-1700000000002'; // critical
const SHADOW = 'pet-1700000000003'; // deceased
const SUNNY = 'pet-1700000000004'; // retired in Pawadise

type SeedPet = { id: string; [k: string]: unknown };
type SeedFamily = { pets: SeedPet[]; wallet: { pawTokens: number }; [k: string]: unknown };

// The "mixed" real-shaped save, optionally trimmed to some pets / a different wallet. Never touches the file.
function mixedSeed(opts: { keep?: string[]; tokens?: number } = {}): Record<string, unknown> {
  const raw = fixture('family-v1-mixed');
  const family = raw[FAMILY_KEY] as SeedFamily;
  if (opts.keep) family.pets = family.pets.filter((p) => opts.keep!.includes(p.id));
  if (opts.tokens !== undefined) family.wallet.pawTokens = opts.tokens;
  return { [FAMILY_KEY]: family };
}

const byId = (s: { pets: { id: string }[] }, id: string) => s.pets.find((p) => p.id === id)! as any;

beforeEach(() => freezeClock(T0));
afterEach(() => unfreezeClock());

describe('loading a real-shaped multi-pet save', () => {
  test('nothing changes when no time has passed; retired and deceased pets are untouched', async () => {
    const seed = mixedSeed();
    const app = await loadApp(seed);
    const s = await app.family.ensureFamilyLoaded();
    expect(s.pets.map((p) => p.id)).toEqual([BISCUIT, MOCHI, LUNA, SHADOW, SUNNY]);
    expect(s.wallet.pawTokens).toBe(640);
    expect(s.supplies).toEqual({ washcloth: 2, medicine: 1 });
    expect(s.toys).toEqual({ 'yarn-ball': 1 });
    expect(app.family.getLivingPets(s).map((p) => p.id)).toEqual([BISCUIT, MOCHI, LUNA]);
    expect(app.family.getRetiredPets(s).map((p) => p.id)).toEqual([SUNNY]);
    expect(app.family.canAdoptMore(s)).toBe(false);
    expect(byId(s, SHADOW).lifecycle.state).toBe('deceased');
  });

  test('time passes while the app is closed: critical pet dies at its exact deadline, others keep their clocks', async () => {
    const app = await loadApp(mixedSeed());
    const seenNotices: string[] = [];
    app.family.subscribeToLifecycle((n) => seenNotices.push(`${n.petId}:${n.type}:${n.live}`));
    setClock(T0 + 80 * HOUR);
    const s = await app.family.ensureFamilyLoaded();
    const luna = byId(s, LUNA);
    expect(luna.lifecycle.state).toBe('deceased');
    expect(luna.lifecycle.diedAt).toBe(iso(T0 - 30 * HOUR + 96 * HOUR));
    expect(luna.events.map((e: any) => e.id)).toContain(`died:${iso(T0 + 66 * HOUR)}`);
    const mochi = byId(s, MOCHI);
    expect(mochi.lifecycle.state).toBe('critical');
    expect(mochi.lifecycle.sickSince).toBe(iso(T0 - 2 * HOUR));
    expect(mochi.lifecycle.criticalSince).toBe(iso(T0 + 22 * HOUR));
    expect(seenNotices).toContain(`${LUNA}:died:false`);
    // Wallet, supplies, and the already-deceased / retired pets are not affected by elapsed time.
    expect(s.wallet.pawTokens).toBe(640);
    const original = (fixture('family-v1-mixed')[FAMILY_KEY] as SeedFamily).pets;
    expect(byId(s, SHADOW)).toMatchObject({ lifecycle: original.find((p) => p.id === SHADOW)!.lifecycle });
    expect(byId(s, SUNNY).retired).toEqual({ since: iso(T0 - 5 * DAY) });
    expect(byId(s, SUNNY).profile.hunger).toBe(55);
    expect(byId(s, SUNNY).lifecycle.state).toBe('healthy');
  });

  test('reopening twice (restart) does not duplicate events or move deadlines', async () => {
    const first = await loadApp(mixedSeed());
    setClock(T0 + 200 * HOUR);
    const a = await first.family.ensureFamilyLoaded();
    await flush();
    const saved = await first.dump();
    const second = await loadApp(undefined, saved);
    const b = await second.family.ensureFamilyLoaded();
    for (const p of a.pets) {
      const q = byId(b, p.id);
      expect(q.events.map((e: any) => e.id)).toEqual(p.events.map((e) => e.id));
      expect(q.lifecycle.state).toBe(p.lifecycle.state);
      expect(q.lifecycle.diedAt).toBe(p.lifecycle.diedAt);
    }
    expect(b.wallet.pawTokens).toBe(a.wallet.pawTokens);
  });

  test('a clock set far into the past does not rewind or revive anyone', async () => {
    const app = await loadApp(mixedSeed());
    setClock(T0 + 200 * HOUR);
    const s1 = await app.family.ensureFamilyLoaded();
    const before = JSON.stringify(s1.pets.map((p) => [p.id, p.lifecycle.state, p.lifecycle.diedAt, p.events.length]));
    setClock(T0 - 90 * DAY);
    app.family.advanceAllPets(new Date(), true);
    const s2 = app.family.peekFamily()!;
    expect(JSON.stringify(s2.pets.map((p) => [p.id, p.lifecycle.state, p.lifecycle.diedAt, p.events.length]))).toBe(before);
  });

  test('the original fixture object is never modified by loading', async () => {
    const before = JSON.stringify(fixture('family-v1-mixed'));
    const app = await loadApp(mixedSeed());
    await app.family.ensureFamilyLoaded();
    expect(JSON.stringify(fixture('family-v1-mixed'))).toBe(before);
  });
});

describe('migrating the original single-pet save', () => {
  test('creates pet #1 with the same id the album used, tasks -> growth, tokens -> wallet, grace for a 0 need', async () => {
    const legacy = fixture('legacy-single-pet');
    const legacyKeys = Object.keys(legacy);
    const app = await loadApp(legacy);
    const before = await app.dump();
    const s = await app.family.ensureFamilyLoaded();
    await flush();
    const pet = s.pets[0];
    expect(s.pets).toHaveLength(1);
    expect(pet.id).toBe(`pet-${Date.parse('2026-01-05T12:00:00.000Z')}`);
    expect(s.selectedPetId).toBe(pet.id);
    // 12 plain tasks + 3 daily occurrences count; the appointment does not.
    expect(pet.tasksCounted).toBe(15);
    expect(pet.growthUnits).toBe(15 * UNITS);
    expect(s.wallet.pawTokens).toBe(275);
    expect(pet.equipped.hat).toBe('hat-1');
    expect(pet.events.map((e) => e.type)).toEqual(['adopted', 'hatched', 'sick']);
    // Grace: hunger was already 0, so sickness starts now and nothing can die on first launch.
    expect(pet.lifecycle.state).toBe('sick');
    expect(pet.lifecycle.sickSince).toBe(iso(T0));
    // The migrated record was written, and every old key is left exactly as it was.
    const after = await app.dump();
    expect(after.has(FAMILY_KEY)).toBe(true);
    for (const key of legacyKeys) expect(after.get(key)).toBe(before.get(key));
  });

  test('migration is not repeated on the next launch', async () => {
    const first = await loadApp(fixture('legacy-single-pet'));
    const a = await first.family.ensureFamilyLoaded();
    await flush();
    const second = await loadApp(undefined, await first.dump());
    const b = await second.family.ensureFamilyLoaded();
    expect(b.pets.map((p) => p.id)).toEqual(a.pets.map((p) => p.id));
    expect(b.wallet.pawTokens).toBe(275);
  });

  test('with nothing saved at all, a fresh install gets one new egg', async () => {
    const app = await loadApp();
    const s = await app.family.ensureFamilyLoaded();
    expect(s.pets).toHaveLength(1);
    expect(s.pets[0].growthUnits).toBe(0);
    expect(s.wallet.pawTokens).toBe(0);
  });
});

describe('unreadable saved data', () => {
  test('a corrupt family record is copied aside before anything is rewritten', async () => {
    const app = await loadApp({ [FAMILY_KEY]: '{ this is not json' });
    await app.family.ensureFamilyLoaded();
    await flush();
    const dump = await app.dump();
    const copies = [...dump.keys()].filter((k) => k.startsWith(`${FAMILY_KEY}.corrupt-`));
    expect(copies).toHaveLength(1);
    expect(dump.get(copies[0])).toBe('{ this is not json');
  });

  test('a record whose pets are all invalid is also kept aside', async () => {
    const app = await loadApp({ [FAMILY_KEY]: { version: 1, pets: [{ nope: true }], wallet: { pawTokens: 999 } } });
    await app.family.ensureFamilyLoaded();
    await flush();
    const dump = await app.dump();
    expect([...dump.keys()].some((k) => k.startsWith(`${FAMILY_KEY}.corrupt-`))).toBe(true);
  });

  test('bad wallet / supplies / growth values are repaired, not trusted', async () => {
    const family = (mixedSeed({ keep: [BISCUIT] })[FAMILY_KEY] as SeedFamily);
    (family.wallet as any).pawTokens = -50;
    (family as any).supplies = { washcloth: -3, medicine: 2.9 };
    (family as any).toys = { a: 0, b: 2.7, c: 'x' };
    (family.pets[0] as any).growthUnits = -10;
    const app = await loadApp({ [FAMILY_KEY]: family });
    const s = await app.family.ensureFamilyLoaded();
    expect(s.wallet.pawTokens).toBe(0);
    expect(s.supplies).toEqual({ washcloth: 0, medicine: 2 });
    expect(s.toys).toEqual({ b: 2 });
    expect(s.pets[0].growthUnits).toBe(0);
  });
});

describe('resurrection', () => {
  const twoPets = () => mixedSeed({ keep: [BISCUIT, SHADOW] });

  test('charges exactly 500 and revives the same pet in one save', async () => {
    const app = await loadApp(twoPets());
    const s0 = await app.family.ensureFamilyLoaded();
    const dead = byId(s0, SHADOW);
    const result = await app.family.resurrectPet(SHADOW);
    expect(result).toEqual({ ok: true });
    const s = app.family.peekFamily()!;
    expect(s.wallet.pawTokens).toBe(140);
    const pet = byId(s, SHADOW);
    expect(pet.lifecycle).toEqual({ state: 'healthy', exhausted: false, lastEvaluatedAt: iso(T0) });
    expect([pet.profile.hunger, pet.profile.cleanliness, pet.profile.happiness, pet.profile.energy]).toEqual([75, 75, 75, 75]);
    expect(pet.profile.poopPiles).toEqual([]);
    // Identity, history and progress are kept; no growth for the time it was gone.
    expect(pet.name).toBe('Shadow');
    expect(pet.equipped).toEqual(dead.equipped);
    expect(pet.growthUnits).toBe(dead.growthUnits);
    expect(pet.peak).toEqual(dead.peak);
    expect(pet.createdAt).toBe(dead.createdAt);
    expect(pet.events.map((e: any) => e.type)).toEqual(['adopted', 'hatched', 'died', 'resurrected']);
    expect(pet.events[3].id).toBe(`resurrected:${iso(T0)}`);
    expect(pet.revival).toEqual({ startedAt: iso(T0), done: false });
    await flush();
    const stored = await app.read('petFamily');
    expect(stored.wallet.pawTokens).toBe(140);
    expect(stored.pets.find((p: any) => p.id === SHADOW).lifecycle.state).toBe('healthy');
  });

  test('exactly 500 tokens is enough (balance 0 afterwards); 499 is not', async () => {
    const ok = await loadApp(mixedSeed({ keep: [BISCUIT, SHADOW], tokens: 500 }));
    await ok.family.ensureFamilyLoaded();
    expect(await ok.family.resurrectPet(SHADOW)).toEqual({ ok: true });
    expect(ok.family.getWalletBalance()).toBe(0);

    const short = await loadApp(mixedSeed({ keep: [BISCUIT, SHADOW], tokens: 499 }));
    await short.family.ensureFamilyLoaded();
    expect(await short.family.resurrectPet(SHADOW)).toEqual({ ok: false, reason: 'insufficient', missing: 1 });
    expect(short.family.getWalletBalance()).toBe(499);
    expect(byId(short.family.peekFamily()!, SHADOW).lifecycle.state).toBe('deceased');
  });

  test('no charge when all three living slots are full (a retired pet does not hold a slot)', async () => {
    const app = await loadApp(mixedSeed()); // Biscuit, Mochi, Luna living + Shadow dead + Sunny retired
    await app.family.ensureFamilyLoaded();
    expect(await app.family.resurrectPet(SHADOW)).toEqual({ ok: false, reason: 'no-slot' });
    expect(app.family.getWalletBalance()).toBe(640);
  });

  test('a living pet cannot be "resurrected" or charged', async () => {
    const app = await loadApp(twoPets());
    await app.family.ensureFamilyLoaded();
    expect(await app.family.resurrectPet(BISCUIT)).toEqual({ ok: false, reason: 'not-deceased' });
    expect(await app.family.resurrectPet('pet-missing')).toEqual({ ok: false, reason: 'not-deceased' });
    expect(app.family.getWalletBalance()).toBe(640);
  });

  test('double tap / duplicate calls charge once', async () => {
    const app = await loadApp(twoPets());
    await app.family.ensureFamilyLoaded();
    const results = await Promise.all([app.family.resurrectPet(SHADOW), app.family.resurrectPet(SHADOW)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(app.family.getWalletBalance()).toBe(140);
    expect(await app.family.resurrectPet(SHADOW)).toEqual({ ok: false, reason: 'not-deceased' });
    expect(app.family.getWalletBalance()).toBe(140);
  });

  test('if saving fails nothing is charged and the pet stays deceased', async () => {
    const app = await loadApp(twoPets());
    await app.family.ensureFamilyLoaded();
    await flush();
    jest.spyOn(app.AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));
    expect(await app.family.resurrectPet(SHADOW)).toEqual({ ok: false, reason: 'storage' });
    expect(app.family.getWalletBalance()).toBe(640);
    expect(byId(app.family.peekFamily()!, SHADOW).lifecycle.state).toBe('deceased');
  });

  test('a resurrected pet is a normal pet again: it can get sick later, from the new clock', async () => {
    const app = await loadApp(twoPets());
    await app.family.ensureFamilyLoaded();
    await app.family.resurrectPet(SHADOW);
    setClock(T0 + 100 * HOUR);
    app.family.advanceAllPets(new Date(), true);
    const pet = byId(app.family.peekFamily()!, SHADOW);
    expect(pet.growthUnits).toBe(42 * UNITS);
    expect(pet.events.map((e: any) => e.type).filter((t: string) => t === 'died')).toHaveLength(1); // the old death only
  });
});

describe('adoption and Pet Pawadise', () => {
  test('adoption adds one egg, selects it, and leaves everything else alone', async () => {
    const app = await loadApp(mixedSeed({ keep: [BISCUIT, SHADOW] }));
    const before = await app.family.ensureFamilyLoaded();
    const r = await app.family.adoptNewEgg();
    expect(r.ok).toBe(true);
    const s = app.family.peekFamily()!;
    expect(s.pets).toHaveLength(3);
    const egg = s.pets[2];
    expect(s.selectedPetId).toBe(egg.id);
    expect(egg.growthUnits).toBe(0);
    expect(egg.events.map((e) => e.type)).toEqual(['adopted']);
    expect(s.wallet.pawTokens).toBe(640);
    expect(s.pets[0]).toEqual(before.pets[0]);
  });

  test('at most 3 living pets; repeated taps do not add extras', async () => {
    const app = await loadApp(mixedSeed());
    await app.family.ensureFamilyLoaded();
    expect(await app.family.adoptNewEgg()).toEqual({ ok: false, reason: 'limit' });
    const two = await loadApp(mixedSeed({ keep: [BISCUIT, MOCHI] }));
    await two.family.ensureFamilyLoaded();
    const both = await Promise.all([two.family.adoptNewEgg(), two.family.adoptNewEgg()]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(two.family.peekFamily()!.pets).toHaveLength(3);
  });

  test('a failed save rolls the adoption back', async () => {
    const app = await loadApp(mixedSeed({ keep: [BISCUIT] }));
    await app.family.ensureFamilyLoaded();
    await flush();
    jest.spyOn(app.AsyncStorage, 'setItem').mockRejectedValue(new Error('disk full'));
    expect(await app.family.adoptNewEgg()).toEqual({ ok: false, reason: 'storage' });
    expect(app.family.peekFamily()!.pets).toHaveLength(1);
  });

  test('retire freezes the pet and frees a slot; returning home does not count the time away', async () => {
    const app = await loadApp(mixedSeed({ keep: [BISCUIT, MOCHI] }));
    await app.family.ensureFamilyLoaded();
    // Mochi is sick; Biscuit is healthy and hatched, so Biscuit can go.
    expect(await app.family.retirePet(MOCHI)).toEqual({ ok: false, reason: 'not-healthy' });
    expect(await app.family.retirePet(BISCUIT)).toEqual({ ok: true });
    let s = app.family.peekFamily()!;
    expect(byId(s, BISCUIT).retired).toEqual({ since: iso(T0) });
    expect(s.selectedPetId).toBe(MOCHI);
    expect(app.family.getLivingPets(s)).toHaveLength(1);
    const frozen = JSON.stringify(byId(s, BISCUIT).profile);
    setClock(T0 + 30 * DAY);
    app.family.advanceAllPets(new Date(), true);
    s = app.family.peekFamily()!;
    expect(JSON.stringify(byId(s, BISCUIT).profile)).toBe(frozen);
    expect(byId(s, BISCUIT).lifecycle.state).toBe('healthy');
    expect(await app.family.returnPetHome(BISCUIT)).toEqual({ ok: true });
    s = app.family.peekFamily()!;
    const home = byId(s, BISCUIT);
    expect(home.retired).toBeUndefined();
    expect(home.profile.hunger).toBe(80); // time in Pawadise never counted
    expect(home.lifecycle.state).toBe('healthy');
    expect(home.events.map((e: any) => e.type).slice(-2)).toEqual(['retired', 'returned']);
  });

  test('the last pet at home cannot be retired; eggs cannot be retired; return needs a free slot', async () => {
    const only = await loadApp(mixedSeed({ keep: [BISCUIT] }));
    await only.family.ensureFamilyLoaded();
    expect(await only.family.retirePet(BISCUIT)).toEqual({ ok: false, reason: 'last-pet' });
    const full = await loadApp(mixedSeed());
    await full.family.ensureFamilyLoaded();
    expect(await full.family.returnPetHome(SUNNY)).toEqual({ ok: false, reason: 'no-slot' });
    expect(await full.family.returnPetHome(BISCUIT)).toEqual({ ok: false, reason: 'not-retired' });
  });
});

describe('growth from tasks', () => {
  const award = async (app: App, n: number) => {
    await app.family.ensureFamilyLoaded();
    app.family.awardGrowthForTasks(n, new Date());
    return app.family.peekFamily()!;
  };

  test('one task is shared between healthy living pets with no rounding loss; sick/critical/deceased/retired get none', async () => {
    const app = await loadApp(mixedSeed());
    const before = await app.family.ensureFamilyLoaded();
    const s = await award(app, 1);
    // 3 living pets -> 9240 units each, but only the healthy one (Biscuit) receives it.
    expect(byId(s, BISCUIT).growthUnits).toBe(byId(before, BISCUIT).growthUnits + 9240);
    expect(byId(s, MOCHI).growthUnits).toBe(byId(before, MOCHI).growthUnits);
    expect(byId(s, LUNA).growthUnits).toBe(byId(before, LUNA).growthUnits);
    expect(byId(s, SHADOW).growthUnits).toBe(byId(before, SHADOW).growthUnits);
    expect(byId(s, SUNNY).growthUnits).toBe(byId(before, SUNNY).growthUnits);
    expect(byId(s, MOCHI).tasksCounted).toBe(byId(before, MOCHI).tasksCounted + 1);
    expect(byId(s, SHADOW).tasksCounted).toBe(byId(before, SHADOW).tasksCounted);
  });

  test.each([1, 2, 3])('with %i healthy pets the shares add up to exactly one task', async (n) => {
    const ids = [BISCUIT, MOCHI, LUNA].slice(0, n);
    const family = mixedSeed({ keep: ids })[FAMILY_KEY] as SeedFamily;
    for (const p of family.pets as any[]) {
      p.lifecycle = { state: 'healthy', exhausted: false, lastEvaluatedAt: iso(T0) };
      p.profile = { ...p.profile, hunger: 90, cleanliness: 90, happiness: 90 };
    }
    const app = await loadApp({ [FAMILY_KEY]: family });
    const before = await app.family.ensureFamilyLoaded();
    const s = await award(app, 2);
    const gained = s.pets.reduce((sum, p, i) => sum + (p.growthUnits - before.pets[i].growthUnits), 0);
    expect(gained).toBe(2 * UNITS);
  });

  test('an egg that reaches 10 tasks records its hatch moment once', async () => {
    const family = mixedSeed({ keep: [BISCUIT] })[FAMILY_KEY] as SeedFamily;
    const egg = family.pets[0] as any;
    Object.assign(egg, { growthUnits: 10 * UNITS - 100, tasksCounted: 9, events: [], peak: { stageIndex: 0, level: 1 } });
    egg.profile = { ...egg.profile, hatchedAt: '', paidStageIndex: 0 };
    const app = await loadApp({ [FAMILY_KEY]: family });
    const s = await award(app, 1);
    const hatched = byId(s, BISCUIT);
    expect(hatched.profile.hatchedAt).toBe(iso(T0));
    expect(hatched.events.map((e: any) => e.id)).toEqual([`hatched:${iso(T0)}`]);
    expect(hatched.peak).toEqual({ stageIndex: 1, level: 2 });
    app.family.awardGrowthForTasks(1, new Date());
    expect(byId(app.family.peekFamily()!, BISCUIT).events).toHaveLength(1);
  });

  test('zero or negative task counts change nothing', async () => {
    const app = await loadApp(mixedSeed());
    const before = await app.family.ensureFamilyLoaded();
    app.family.awardGrowthForTasks(0);
    app.family.awardGrowthForTasks(-3);
    expect(app.family.peekFamily()).toBe(before);
  });
});
