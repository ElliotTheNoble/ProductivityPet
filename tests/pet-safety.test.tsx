import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { HOUR, T0, TEST_PIN, configurePin, freezeClock, iso, loadApp, pet, unfreezeClock, type App } from './helpers';

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
jest.mock('expo-local-authentication', () => ({
  getEnrolledLevelAsync: jest.fn(async () => 2),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));
jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'scheduled-id'),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
}));
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => '/parent', useLocalSearchParams: () => ({}), Link: 'Link' }));

// Pet Safety: Gentle (a pet can get hungry, tired, dirty and sick but never passes away) and Classic (the original rules, paid resurrection
// included), per child. Every profile's pets already live in that profile's own record; the mode only decides how a pet is evaluated.
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const H = () => require('@/utils/household') as typeof import('@/utils/household');
const S = () => require('@/utils/pet-safety') as typeof import('@/utils/pet-safety');
const core = () => require('@/utils/pet-lifecycle-core') as typeof import('@/utils/pet-lifecycle-core');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const P = '@ProductivityPet:';
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const enter = async (app: App, id: string) => expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });

// A hatched pet that has been sick for `hours` hours (needs at 0), saved as the family record of a profile.
const sickPet = (id: string, hours: number, at = T0) =>
  pet(
    {
      id,
      lifecycle: { state: hours >= 24 ? 'critical' : 'sick', sickSince: iso(at - hours * HOUR), criticalSince: hours >= 24 ? iso(at - (hours - 24) * HOUR) : undefined, exhausted: false, lastEvaluatedAt: iso(at - 1000) },
      p: { hunger: 0, cleanliness: 0, happiness: 0, lastUpdatedAt: iso(at - 1000) },
    },
    at
  );
const familyJson = (pets: object[]) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens: 120 } });

async function boot(modes: { billy?: 'gentle' | 'classic'; sarah?: 'gentle' | 'classic' } = {}, seedPets: { billy?: object; sarah?: object } = {}) {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app: App = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const ids: Record<string, string> = {};
  for (const name of ['Billy', 'Sarah']) {
    const added = await H().addChild(name);
    if (!added.ok || !added.id) throw new Error('child not added');
    ids[name] = added.id;
  }
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  // A mode chosen "long ago" (ten days before T0), so a Classic child is not still inside the 72 hours that follow a switch to Classic.
  jest.setSystemTime(T0 - 240 * HOUR);
  await app.gate.unlockParentArea(TEST_PIN);
  if (modes.billy) await H().updateChildSettings(ids.Billy, { petSafety: modes.billy });
  if (modes.sarah) await H().updateChildSettings(ids.Sarah, { petSafety: modes.sarah });
  jest.setSystemTime(T0);
  await app.gate.unlockParentArea(TEST_PIN);
  if (seedPets.billy) await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), familyJson([seedPets.billy]));
  if (seedPets.sarah) await app.AsyncStorage.setItem(scoped(ids.Sarah, 'petFamily'), familyJson([seedPets.sarah]));
  return { app, ids };
}
const petOf = (app: App) => app.family.peekFamily()!.pets[0];

describe('the rules (pure)', () => {
  test('Classic: a pet sick for 96 hours passes away, exactly when it always did', async () => {
    await boot();
    const classic = S().CLASSIC_RULES;
    const alive = core().advancePet(sickPet('a', 95), new Date(T0), false, classic);
    expect(alive.lifecycle.state).toBe('critical');
    const dead = core().advancePet(sickPet('a', 96), new Date(T0), false, classic);
    expect(dead.lifecycle.state).toBe('deceased');
    expect(dead.lifecycle.diedAt).toBe(iso(T0));
  });

  test('Gentle: the same pet, even after days and weeks, stays critical and alive; it is still sick and still needs care', async () => {
    await boot();
    const gentle = S().rulesForSettings({ petSafety: 'gentle' });
    for (const hours of [96, 200, 24 * 30]) {
      const result = core().advancePet(sickPet('a', hours), new Date(T0), false, gentle);
      expect(result.lifecycle.state).toBe('critical');
      expect(result.lifecycle.diedAt).toBeUndefined();
      expect(result.events.some((e) => e.type === 'died')).toBe(false);
      expect(result.profile.hunger).toBe(0); // nothing was refilled
    }
  });

  test('Gentle: needs keep falling exactly as before (hunger, cleanliness, happiness, energy) and a need at zero makes the pet sick, not dead', async () => {
    await boot();
    const healthy = pet({ lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: iso(T0) }, p: { hunger: 40, cleanliness: 40, happiness: 40, energy: 100, lastUpdatedAt: iso(T0) } });
    const gentle = S().rulesForSettings({ petSafety: 'gentle' });
    const later = new Date(T0 + 6 * HOUR);
    const g = core().advancePet(healthy, later, false, gentle);
    const c = core().advancePet(healthy, later, false, S().CLASSIC_RULES);
    expect(g.profile.hunger).toBeLessThan(40);
    expect(g.profile.cleanliness).toBeLessThan(40);
    expect(g.profile.happiness).toBeLessThan(40);
    expect({ h: g.profile.hunger, c: g.profile.cleanliness, a: g.profile.happiness, e: g.profile.energy }).toEqual({ h: c.profile.hunger, c: c.profile.cleanliness, a: c.profile.happiness, e: c.profile.energy }); // same decay in both modes
    const starving = pet({ lifecycle: { state: 'healthy', exhausted: false, lastEvaluatedAt: iso(T0) }, p: { hunger: 1, cleanliness: 90, happiness: 90, lastUpdatedAt: iso(T0) } });
    const sick = core().advancePet(starving, new Date(T0 + 48 * HOUR), false, gentle);
    expect(sick.lifecycle.state === 'sick' || sick.lifecycle.state === 'critical').toBe(true);
    expect(sick.lifecycle.state).not.toBe('deceased');
  });

  test('Gentle pets still recover for free when cared for (all three needs back to 50), exactly as in Classic', async () => {
    await boot();
    const gentle = S().rulesForSettings({ petSafety: 'gentle' });
    const critical = sickPet('a', 200);
    const cared = { ...critical, profile: { ...critical.profile, hunger: 80, cleanliness: 80, happiness: 80 } };
    expect(core().reevaluatePet(cared, new Date(T0), gentle).lifecycle.state).toBe('healthy');
  });

  test('Gentle to Classic: a pet that was sick for 200 hours while Gentle does NOT pass away the moment the mode changes; Classic applies going forward', async () => {
    await boot();
    const switchedAt = T0;
    const classicNow = S().rulesForSettings({ petSafety: 'classic', petSafetyChangedAt: iso(switchedAt) });
    expect(classicNow).toEqual({ gentle: false, classicSince: switchedAt });
    expect(core().advancePet(sickPet('a', 200), new Date(T0), false, classicNow).lifecycle.state).toBe('critical'); // right at the switch: alive
    expect(core().advancePet(sickPet('a', 200), new Date(T0 + 71 * HOUR), false, classicNow).lifecycle.state).toBe('critical'); // still inside the 72 hours
    const dead = core().advancePet(sickPet('a', 200), new Date(T0 + 72 * HOUR), false, classicNow);
    expect(dead.lifecycle.state).toBe('deceased'); // Classic rules, going forward
    expect(dead.lifecycle.diedAt).toBe(iso(T0 + 72 * HOUR));
  });

  test('a Classic child that was never switched keeps the original timing exactly (no floor)', async () => {
    await boot();
    const rules = S().rulesForSettings({ petSafety: 'classic' }); // chosen before this existed: no change time saved
    expect(rules).toEqual({ gentle: false, classicSince: null });
    expect(core().advancePet(sickPet('a', 96), new Date(T0), false, rules).lifecycle.state).toBe('deceased');
  });

  test('Classic to Gentle: an already critical pet simply stops being at risk; nothing is reset', async () => {
    await boot();
    const gentle = S().rulesForSettings({ petSafety: 'gentle' });
    const critical = sickPet('a', 90);
    const later = core().advancePet(critical, new Date(T0 + 40 * HOUR), false, gentle);
    expect(later.lifecycle.state).toBe('critical');
    expect(later.lifecycle.sickSince).toBe(critical.lifecycle.sickSince); // the episode is not restarted
    expect(later.growthUnits).toBe(critical.growthUnits);
  });

  test('a pet that has ALREADY passed away is never revived or changed by either mode', async () => {
    await boot();
    const dead = { ...sickPet('a', 120), lifecycle: { state: 'deceased' as const, exhausted: false, lastEvaluatedAt: iso(T0), diedAt: iso(T0 - HOUR) } };
    for (const rules of [S().CLASSIC_RULES, S().rulesForSettings({ petSafety: 'gentle' })]) {
      expect(core().advancePet(dead, new Date(T0 + 500 * HOUR), false, rules)).toBe(dead);
    }
  });

  test('family mode off, Main and anything unknown: off and Main are Classic; unknown (an unread household or a missing child) fails safe as Gentle', async () => {
    const { ids } = await boot();
    expect(S().safetyRulesForProfile('main')).toEqual(S().CLASSIC_RULES);
    expect(S().safetyRulesForProfile('nobody-by-that-id')).toMatchObject({ gentle: true }); // unknown child: never a death
    expect(S().safetyRulesForProfile(ids.Billy)).toMatchObject({ gentle: true }); // the default for a child
  });
});

describe('each child has their own pet and their own mode', () => {
  test('Billy Gentle and Sarah Classic with the same neglected pet: Billy\'s pet lives, Sarah\'s passes away; each only in their own profile', async () => {
    const { app, ids } = await boot({ billy: 'gentle', sarah: 'classic' }, { billy: sickPet('b-pet', 100), sarah: sickPet('s-pet', 100) });
    await enter(app, ids.Billy);
    await app.family.ensureFamilyLoaded();
    app.family.advanceAllPets(new Date(T0), true);
    expect(petOf(app).id).toBe('b-pet');
    expect(petOf(app).lifecycle.state).toBe('critical');
    await enter(app, ids.Sarah);
    await app.family.ensureFamilyLoaded();
    app.family.advanceAllPets(new Date(T0), true);
    expect(petOf(app).id).toBe('s-pet');
    expect(petOf(app).lifecycle.state).toBe('deceased');
    await enter(app, ids.Billy);
    await app.family.ensureFamilyLoaded();
    expect(petOf(app).id).toBe('b-pet');
    expect(petOf(app).lifecycle.state).toBe('critical'); // coming back: still Billy's own, still alive
  });

  test('changing Billy\'s mode changes nothing for Sarah, Main or any saved pet record', async () => {
    const { app, ids } = await boot({ billy: 'gentle', sarah: 'classic' }, { billy: sickPet('b-pet', 100), sarah: sickPet('s-pet', 10) });
    const before = await app.dump();
    await H().updateChildSettings(ids.Billy, { petSafety: 'classic' });
    expect(S().safetyRulesForProfile(ids.Sarah)).toEqual({ gentle: false, classicSince: T0 - 240 * HOUR }); // exactly what it was
    expect(S().safetyRulesForProfile('main')).toEqual(S().CLASSIC_RULES);
    const after = await app.dump();
    for (const key of [scoped(ids.Billy, 'petFamily'), scoped(ids.Sarah, 'petFamily'), `${P}petFamily`, `${P}awardedTaskTokens`, `${P}tokenEarnings`]) {
      expect([key, after.get(key)]).toEqual([key, before.get(key)]); // pets, wallets and growth are byte-for-byte as they were
    }
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Sarah)!.settings.petSafetyChangedAt).toBe(iso(T0 - 240 * HOUR)); // Sarah's own record is untouched
  });

  test('switching to Classic records WHEN (so the rules know), choosing the mode a child already has changes nothing', async () => {
    const { app, ids } = await boot();
    const settings = () => H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.settings;
    expect(settings().petSafetyChangedAt).toBeUndefined();
    await H().updateChildSettings(ids.Billy, { petSafety: 'gentle' }); // already gentle
    expect(settings().petSafetyChangedAt).toBeUndefined();
    jest.setSystemTime(T0 + HOUR);
    await app.gate.unlockParentArea(TEST_PIN); // a time jump ends the parent session
    await H().updateChildSettings(ids.Billy, { petSafety: 'classic' });
    expect(settings().petSafetyChangedAt).toBe(iso(T0 + HOUR));
    jest.setSystemTime(T0 + 2 * HOUR);
    await app.gate.unlockParentArea(TEST_PIN);
    await H().updateChildSettings(ids.Billy, { petSafety: 'classic' }); // again: the time of the real change stays
    expect(settings().petSafetyChangedAt).toBe(iso(T0 + HOUR));
    expect(S().safetyRulesForProfile(ids.Billy)).toEqual({ gentle: false, classicSince: T0 + HOUR });
  });

  test('the mode, and each pet, survive a restart and a profile switch', async () => {
    const { app, ids } = await boot({ billy: 'classic', sarah: 'gentle' }, { billy: sickPet('b-pet', 10), sarah: sickPet('s-pet', 100) });
    const kept = await app.dump();
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const again = await loadApp(undefined, kept);
    await again.profiles.ensureProfilesReady();
    await H().ensureHouseholdLoaded();
    expect(S().safetyRulesForProfile(ids.Billy)).toMatchObject({ gentle: false });
    expect(S().safetyRulesForProfile(ids.Sarah)).toMatchObject({ gentle: true });
    expect(await again.profiles.switchProfile(ids.Sarah)).toMatchObject({ ok: true });
    await again.family.ensureFamilyLoaded();
    again.family.advanceAllPets(new Date(T0), true);
    expect(again.family.peekFamily()!.pets[0].lifecycle.state).toBe('critical'); // Sarah (Gentle), neglected for 100 hours: alive
    expect(await again.profiles.switchProfile(ids.Billy)).toMatchObject({ ok: true });
    await again.family.ensureFamilyLoaded();
    expect(again.family.peekFamily()!.pets[0].id).toBe('b-pet');
  });

  test('parent-only: with the parent area locked the mode cannot be changed', async () => {
    const { app, ids } = await boot({ billy: 'gentle' });
    app.gate.lockParentArea();
    const result = await H().updateChildSettings(ids.Billy, { petSafety: 'classic' });
    expect(result.ok).toBe(false);
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.settings.petSafety).toBe('gentle');
  });

  test('children cannot change it: no child-facing code can reach the setting (source check)', () => {
    for (const file of ['src/components/assigned-task-views.tsx', 'src/utils/assigned-tasks.ts', 'src/components/room-detail-screen.tsx', 'src/app/index.tsx', 'src/app/tasks.tsx']) {
      expect([file, code(file).includes('updateChildSettings')]).toEqual([file, false]);
    }
    expect(code('src/components/parent-dashboard.tsx')).toMatch(/updateChildSettings\(child\.id, \{ petSafety: 'classic' \}\)/);
  });

  test('a parent-side reader judges a child by THAT child\'s mode, not the mode of whoever is open', async () => {
    const { app, ids } = await boot({ billy: 'gentle', sarah: 'classic' }, { billy: sickPet('b-pet', 100), sarah: sickPet('s-pet', 100) });
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    const care = require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');
    const billy = await care.peekProfileCare(ids.Billy, new Date(T0));
    const sarah = await care.peekProfileCare(ids.Sarah, new Date(T0));
    expect(billy).toMatchObject({ status: 'ok', deceased: 0, critical: 1 });
    expect(sarah).toMatchObject({ status: 'ok', deceased: 1 });
    const overview = require('@/utils/child-overview') as typeof import('@/utils/child-overview');
    const b = await overview.readChildOverview(ids.Billy, new Date(T0));
    expect(JSON.stringify(b)).toContain('critical');
    expect(JSON.stringify(b)).not.toContain('deceased');
    const s = await overview.readChildOverview(ids.Sarah, new Date(T0));
    expect(JSON.stringify(s)).toContain('deceased');
  });
});

describe('resurrection and the wallet are untouched', () => {
  test('Classic: the paid resurrection works as before (500 Paw Tokens), and a pet that has already passed away is not revived or charged by switching modes', async () => {
    const dead = { ...sickPet('s-pet', 120), lifecycle: { state: 'deceased' as const, exhausted: false, lastEvaluatedAt: iso(T0), diedAt: iso(T0 - HOUR) } };
    const { app, ids } = await boot({ sarah: 'classic' }, { sarah: dead });
    await enter(app, ids.Sarah);
    await app.family.ensureFamilyLoaded();
    expect(petOf(app).lifecycle.state).toBe('deceased');
    const wallet = app.family.getWalletBalance();
    await H().updateChildSettings(ids.Sarah, { petSafety: 'gentle' }); // switching modes does not revive or charge
    app.family.advanceAllPets(new Date(T0 + HOUR), true);
    expect(petOf(app).lifecycle.state).toBe('deceased');
    expect(app.family.getWalletBalance()).toBe(wallet);
    const refused = await app.family.resurrectPet('s-pet');
    expect(refused).toMatchObject({ ok: false, reason: 'insufficient' }); // 120 < 500: the existing paid rule, unchanged
    expect(code('src/utils/pet-family-config.ts')).toMatch(/RESURRECTION_COST = 500/);
  });

  test('the lifecycle numbers and the resurrection code are untouched (source check)', () => {
    const config = code('src/utils/pet-family-config.ts');
    expect(config).toMatch(/SICK_TO_CRITICAL_HOURS = 24/);
    expect(config).toMatch(/CRITICAL_TO_DEATH_HOURS = 72/);
    expect(config).toMatch(/RESURRECTION_RESTORED_NEED_VALUE = 75/);
  });
});

describe('Parent Dashboard: Pet Safety', () => {
  async function dashboard(language: 'en' | 'es' = 'en') {
    const ctx = await boot();
    i18n().setCurrentLanguage(language);
    await enter(ctx.app, 'main');
    await H().selectChild(ctx.ids.Billy);
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
    return ctx;
  }
  const words = (): string => {
    const out: string[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      for (const c of (node as { children?: unknown[] }).children ?? []) {
        if (typeof c === 'string') out.push(c);
        else walk(c);
      }
    };
    const tree = RNTL.screen.toJSON();
    for (const root of Array.isArray(tree) ? tree : [tree]) walk(root);
    return out.join(' | ');
  };

  test('the "not enforced yet" warning and its info button are gone; both modes are offered, the chosen one highlighted', async () => {
    const { ids } = await dashboard();
    expect(RNTL.screen.queryByTestId('pet-safety-info')).toBeNull();
    expect(words()).not.toMatch(/not enforced|NOT enforced|not separated per child/i);
    expect(words()).toContain(en('gentleMode'));
    expect(words()).toContain(en('classicMode'));
    const gentle = RNTL.screen.getAllByRole('button').find((b) => String(b.props.accessibilityLabel ?? '').includes(en('gentleMode')))!;
    const classic = RNTL.screen.getAllByRole('button').find((b) => String(b.props.accessibilityLabel ?? '').includes(en('classicMode')))!;
    expect(gentle.props.accessibilityState).toMatchObject({ selected: true });
    expect(classic.props.accessibilityState).toMatchObject({ selected: false });
    await RNTL.fireEvent.press(classic);
    await settle();
    expect(H().peekHousehold()!.children.find((c) => c.id === ids.Billy)!.settings.petSafety).toBe('classic');
    const classicAfter = RNTL.screen.getAllByRole('button').find((b) => String(b.props.accessibilityLabel ?? '').includes(en('classicMode')))!;
    expect(classicAfter.props.accessibilityState).toMatchObject({ selected: true });
    expect(S().safetyRulesForProfile(ids.Billy)).toMatchObject({ gentle: false });
  });

  test('the descriptions say what each mode really does, in English and Spanish', () => {
    expect(en('gentleDesc')).toMatch(/cannot permanently die/i);
    expect(en('gentleDesc')).not.toMatch(/Recommended/);
    expect(en('classicDesc')).toMatch(/passing away/i);
    expect(en('classicDesc')).toMatch(/resurrection/i);
    expect(es('gentleDesc')).toMatch(/no pueden morir/i);
    expect(es('classicDesc')).toMatch(/resurrecci/i);
    for (const lang of ['en', 'es'] as const) expect(JSON.stringify(require(`@/i18n/${lang}`))).not.toContain('petSafetyNotEnforced');
  });
});
