import { DAY, HOUR, T0, configurePin, freezeClock, iso, loadApp, pet, unfreezeClock, type App } from './helpers';
import { buildFamilyCarePlan } from '@/utils/family-care-plan';

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));

// Stage 4.5d: the READ-ONLY input side of the family-care plan, over a real in-memory storage and the real profile registry. What can
// never happen here: a write of any kind, an archived child being read, a profile being loaded into the app's stores, or the active
// profile changing.

jest.mock('expo-notifications', () => ({
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'scheduled-id'),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
}));

const P = '@ProductivityPet:';
const HOUSEHOLD = `${P}household`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const MAIN_FAMILY = `${P}petFamily`;
const MAIN_SETTINGS = `${P}petAlertSettings`;

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.clearAllMocks();
});

const child = (id: string, nickname: string, extra: object = {}) => ({
  id,
  nickname,
  createdAt: iso(T0),
  settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' },
  tasks: [],
  ...extra,
});
const savedFamily = (petId: string, p: Parameters<typeof pet>[0] = {}) =>
  JSON.stringify({ version: 1, selectedPetId: petId, pets: [pet({ id: petId, name: `Name of ${petId}`, ...p })], wallet: { pawTokens: 7 } });
const alertsOn = JSON.stringify({ notifications: true, vibration: true, flash: false });
const alertsOff = JSON.stringify({ notifications: false, vibration: true, flash: false });
const hungry = { p: { hunger: 10 } };

async function boot(seed: Record<string, string>, children: object[] = []): Promise<App> {
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app = await loadApp({ ...seed, [HOUSEHOLD]: JSON.stringify({ version: 1, parent: null, children, selectedChildId: null }) });
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const fp = require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');
  await fp.reconcileFamilyProfiles(); // gives every household child its profile (registry records only)
  return app;
}
const IN = () => require('@/utils/family-care-input') as typeof import('@/utils/family-care-input');

// Everything stored, as one comparable value.
async function everything(app: App): Promise<string> {
  return JSON.stringify([...(await app.dump()).entries()].sort(([a], [b]) => a.localeCompare(b)));
}
// Records every storage call, from now on.
function spy(app: App) {
  const calls: { method: string; key: string }[] = [];
  for (const method of ['getItem', 'setItem', 'removeItem', 'mergeItem', 'multiSet', 'multiRemove', 'multiMerge', 'clear', 'multiGet', 'getAllKeys'] as const) {
    const original = app.AsyncStorage[method]?.bind(app.AsyncStorage);
    if (!original) continue;
    app.AsyncStorage[method] = jest.fn(async (...args: unknown[]) => {
      calls.push({ method, key: typeof args[0] === 'string' ? args[0] : JSON.stringify(args[0] ?? '') });
      return original(...args);
    });
  }
  return calls;
}
const WRITES = ['setItem', 'removeItem', 'mergeItem', 'multiSet', 'multiRemove', 'multiMerge', 'clear'];

describe('reading a profile', () => {
  test('Main with alerts on: its upcoming care events, readable', async () => {
    const app = await boot({ [MAIN_FAMILY]: savedFamily('m1', hungry), [MAIN_SETTINGS]: alertsOn });
    const input = await IN().readProfileCareInput('main', 'main', new Date(T0));
    expect(input).toMatchObject({ profileId: 'main', kind: 'main', archived: false, alertsEnabled: true, readable: true });
    expect(input.events.map((e) => e.urgency)).toEqual(['normal', 'critical']);
    expect(input.events[1].atMs - input.events[0].atMs).toBe(24 * HOUR);
    expect(app.family.peekFamily()).toBeNull(); // nothing was loaded into the app's stores
  });

  test('a child, from its own scoped records', async () => {
    await boot({ [scoped('kid-a', 'petFamily')]: savedFamily('a1', hungry), [scoped('kid-a', 'petAlertSettings')]: alertsOn }, [child('kid-a', 'Mia')]);
    const input = await IN().readProfileCareInput('kid-a', 'child', new Date(T0));
    expect(input).toMatchObject({ profileId: 'kid-a', kind: 'child', alertsEnabled: true, readable: true });
    expect(input.events).toHaveLength(2);
  });

  test('a profile never mixes with another: Main\'s pets do not appear for a child, and the other way round', async () => {
    await boot(
      { [MAIN_FAMILY]: savedFamily('m1', { p: { hunger: 10 } }), [MAIN_SETTINGS]: alertsOn, [scoped('kid-a', 'petAlertSettings')]: alertsOn },
      [child('kid-a', 'Mia')]
    );
    const kid = await IN().readProfileCareInput('kid-a', 'child', new Date(T0)); // the child has settings on but no pets saved yet
    expect(kid.events).toEqual([]);
    expect(kid.readable).toBe(true);
  });

  test('alerts off: the profile is reported off and its pets are not even read', async () => {
    const app = await boot({ [scoped('kid-a', 'petFamily')]: savedFamily('a1', hungry), [scoped('kid-a', 'petAlertSettings')]: alertsOff }, [child('kid-a', 'Mia')]);
    const calls = spy(app);
    const input = await IN().readProfileCareInput('kid-a', 'child', new Date(T0));
    expect(input).toMatchObject({ alertsEnabled: false, readable: true, events: [] });
    expect(calls.map((c) => c.key)).not.toContain(scoped('kid-a', 'petFamily'));
  });

  test('no saved alert setting at all means off', async () => {
    await boot({ [scoped('kid-a', 'petFamily')]: savedFamily('a1', hungry) }, [child('kid-a', 'Mia')]);
    expect((await IN().readProfileCareInput('kid-a', 'child', new Date(T0))).alertsEnabled).toBe(false);
  });

  test('a child who has never opened the app has no pets: readable, no events', async () => {
    await boot({ [scoped('kid-a', 'petAlertSettings')]: alertsOn }, [child('kid-a', 'Mia')]);
    expect(await IN().readProfileCareInput('kid-a', 'child', new Date(T0))).toMatchObject({ readable: true, alertsEnabled: true, events: [] });
  });

  test('a damaged pet record, and a record that cannot be read, are "unreadable" and never "healthy"', async () => {
    const app = await boot(
      { [scoped('kid-a', 'petFamily')]: '{not json', [scoped('kid-a', 'petAlertSettings')]: alertsOn, [scoped('kid-b', 'petFamily')]: savedFamily('b1', hungry), [scoped('kid-b', 'petAlertSettings')]: alertsOn },
      [child('kid-a', 'Mia'), child('kid-b', 'Leo')]
    );
    expect(await IN().readProfileCareInput('kid-a', 'child', new Date(T0))).toMatchObject({ readable: false, events: [] });
    const original = app.AsyncStorage.getItem.bind(app.AsyncStorage);
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === scoped('kid-b', 'petFamily')) throw new Error('read failed');
      return original(key);
    });
    expect(await IN().readProfileCareInput('kid-b', 'child', new Date(T0))).toMatchObject({ readable: false, events: [] });
  });

  test('a setting that cannot be read counts as off', async () => {
    const app = await boot({ [scoped('kid-a', 'petFamily')]: savedFamily('a1', hungry), [scoped('kid-a', 'petAlertSettings')]: alertsOn }, [child('kid-a', 'Mia')]);
    const original = app.AsyncStorage.getItem.bind(app.AsyncStorage);
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === scoped('kid-a', 'petAlertSettings')) throw new Error('read failed');
      return original(key);
    });
    expect(await IN().readProfileCareInput('kid-a', 'child', new Date(T0))).toMatchObject({ alertsEnabled: false, events: [] });
  });

  test('an unknown profile id reads nothing and is unreadable', async () => {
    const app = await boot({});
    const calls = spy(app);
    expect(await IN().readProfileCareInput('nobody', 'child', new Date(T0))).toMatchObject({ readable: false, alertsEnabled: false, events: [] });
    expect(calls.filter((c) => c.key.includes('nobody'))).toEqual([]);
  });

  test('pets are caught up to the time given: a pet that fell sick while closed gives only the critical event', async () => {
    await boot({ [scoped('kid-a', 'petFamily')]: savedFamily('a1', hungry), [scoped('kid-a', 'petAlertSettings')]: alertsOn }, [child('kid-a', 'Mia')]);
    const input = await IN().readProfileCareInput('kid-a', 'child', new Date(T0 + 20 * HOUR));
    expect(input.events.map((e) => e.urgency)).toEqual(['critical']);
  });
});

describe('reading the family', () => {
  const kids = [child('kid-a', 'Mia'), child('kid-b', 'Leo'), child('kid-old', 'Maximilian', { archivedAt: iso(T0 - DAY) })];
  const seed = {
    [MAIN_FAMILY]: savedFamily('m1', hungry),
    [MAIN_SETTINGS]: alertsOn,
    [scoped('kid-a', 'petFamily')]: savedFamily('a1', hungry),
    [scoped('kid-a', 'petAlertSettings')]: alertsOn,
    [scoped('kid-b', 'petFamily')]: savedFamily('b1', hungry),
    [scoped('kid-b', 'petAlertSettings')]: alertsOff,
    [scoped('kid-old', 'petFamily')]: savedFamily('o1', hungry),
    [scoped('kid-old', 'petAlertSettings')]: alertsOn,
  };

  test('Main and the children the picker would offer; an archived child is not in the list and none of its records are read', async () => {
    const app = await boot(seed, kids);
    const calls = spy(app);
    const inputs = await IN().readFamilyCareInputs(new Date(T0));
    expect(inputs.map((i) => i.profileId).sort()).toEqual(['kid-a', 'kid-b', 'main']);
    expect(inputs.find((i) => i.profileId === 'main')?.kind).toBe('main');
    expect(calls.filter((c) => c.key.includes('kid-old'))).toEqual([]);
  });

  test('reading changes nothing: no write of any kind, every stored byte identical, the active profile and registry unchanged', async () => {
    const app = await boot(seed, kids);
    const before = await everything(app);
    const status = JSON.stringify(app.profiles.getProfilesStatus());
    const calls = spy(app);
    await IN().readFamilyCareInputs(new Date(T0 + 50 * HOUR)); // a long way ahead: pets would change if they were saved
    expect(calls.filter((c) => WRITES.includes(c.method))).toEqual([]);
    expect(await everything(app)).toBe(before);
    expect(JSON.stringify(app.profiles.getProfilesStatus())).toBe(status);
    expect(app.family.peekFamily()).toBeNull();
  });

  test('restoring an archived child makes it eligible again, with its pets exactly as saved', async () => {
    const app = await boot(seed, kids);
    const petsBefore = (await app.dump()).get(scoped('kid-old', 'petFamily'));
    expect((await IN().readFamilyCareInputs(new Date(T0))).map((i) => i.profileId)).not.toContain('kid-old');
    const household = JSON.parse((await app.dump()).get(HOUSEHOLD)!);
    household.children = household.children.map((c: { id: string }) => (c.id === 'kid-old' ? { ...c, archivedAt: undefined } : c));
    await app.AsyncStorage.setItem(HOUSEHOLD, JSON.stringify(household));
    jest.resetModules(); // as after a restart: the household is read again from storage
    const again = await loadApp(undefined, await app.dump());
    await again.profiles.ensureProfilesReady();
    const inputs = await (require('@/utils/family-care-input') as typeof import('@/utils/family-care-input')).readFamilyCareInputs(new Date(T0));
    expect(inputs.map((i) => i.profileId)).toContain('kid-old');
    expect((await again.dump()).get(scoped('kid-old', 'petFamily'))).toBe(petsBefore);
  });

  test('end to end with the builder: archived, open and alerts-off profiles are left out, and the result names no one', async () => {
    await boot(seed, kids);
    const inputs = await IN().readFamilyCareInputs(new Date(T0));
    const atPicker = buildFamilyCarePlan(inputs, { now: T0, openProfileId: null, language: 'en' });
    expect(atPicker.report.included.sort()).toEqual(['kid-a', 'main']); // kid-b has alerts off, kid-old is archived (never read)
    const whileMainIsOpen = buildFamilyCarePlan(inputs, { now: T0, openProfileId: 'main', language: 'es' });
    expect(whileMainIsOpen.report.included).toEqual(['kid-a']);
    expect(whileMainIsOpen.report.skipped).toContainEqual({ profileId: 'main', reason: 'open' });
    for (const plan of [atPicker, whileMainIsOpen]) {
      const text = JSON.stringify(plan.notifications);
      for (const secret of ['Mia', 'Leo', 'Maximilian', 'kid-a', 'kid-b', 'kid-old', 'Name of', 'm1', 'a1']) expect(text).not.toContain(secret);
    }
    expect(whileMainIsOpen.notifications[0].body).toBe('Una mascota necesita cuidados. Abre ProductivityPet.');
    // Main's and kid-a's identical hungry pets fall sick at the same moment: ONE notification (and one critical one a day later)
    expect(atPicker.notifications.map((n) => n.urgency)).toEqual(['normal', 'critical']);
  });
});
