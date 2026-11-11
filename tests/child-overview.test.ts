import { HOUR, T0, configurePin, flush, freezeClock, iso, loadApp, pet, unfreezeClock, type App } from './helpers';

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

// The data behind the Parent Dashboard: who the active children are and how their pets are doing, read-only, behind the parent session.

const P = '@ProductivityPet:';
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;

beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const family = (pets: object[]) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens: 0 } });
const H = () => require('@/utils/household') as typeof import('@/utils/household');
const FP = () => require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');
const O = () => require('@/utils/child-overview') as typeof import('@/utils/child-overview');

async function bootFamily(options: { unlocked?: boolean } = {}): Promise<{ app: App; ids: Record<string, string> }> {
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const ids: Record<string, string> = {};
  for (const name of ['Billy', 'Sarah']) {
    const added = await H().addChild(name);
    if (!added.ok || !added.id) throw new Error('child not added');
    ids[name] = added.id;
  }
  await FP().reconcileFamilyProfiles();
  if (options.unlocked === false) app.gate.lockParentArea();
  return { app, ids };
}

describe('the list of children', () => {
  test('real active children only, by name, nothing hardcoded', async () => {
    const { ids } = await bootFamily();
    const result = await O().readDashboardChildren();
    expect(result).toEqual({
      status: 'ok',
      children: [
        { id: ids.Billy, nickname: 'Billy' },
        { id: ids.Sarah, nickname: 'Sarah' },
      ],
    });
  });

  test('an archived child is not listed, and comes back when restored', async () => {
    const { ids } = await bootFamily();
    expect(await H().setChildArchived(ids.Sarah, true)).toMatchObject({ ok: true });
    expect(await O().readDashboardChildren()).toEqual({ status: 'ok', children: [{ id: ids.Billy, nickname: 'Billy' }] });
    expect(await H().setChildArchived(ids.Sarah, false)).toMatchObject({ ok: true });
    const again = await O().readDashboardChildren();
    expect(again.status === 'ok' && again.children.map((c) => c.nickname)).toEqual(['Billy', 'Sarah']);
  });

  test('with the parent area locked nothing is listed', async () => {
    await bootFamily({ unlocked: false });
    expect(await O().readDashboardChildren()).toEqual({ status: 'not-allowed' });
  });

  test('no children: an empty list, not an error', async () => {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const app = await loadApp();
    await app.profiles.ensureProfilesReady();
    await configurePin(app, { unlocked: true });
    expect(await O().readDashboardChildren()).toEqual({ status: 'ok', children: [] });
  });
});

describe('the read-only overview of one child', () => {
  test('pets by name and how they are doing, worked out now on a copy', async () => {
    const { app, ids } = await bootFamily();
    const happy = pet({ id: 'pet-a', name: 'Biscuit' });
    const hungry = pet({ id: 'pet-b', name: 'Luna', p: { hunger: 20 } });
    const sick = pet({
      id: 'pet-c',
      name: 'Shadow',
      p: { hunger: 0, lastUpdatedAt: iso(T0 - HOUR) },
      lifecycle: { state: 'sick', sickSince: iso(T0 - 2 * HOUR), exhausted: false, lastEvaluatedAt: iso(T0 - HOUR) },
    });
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), family([happy, hungry, sick]));
    const result = await O().readChildOverview(ids.Billy);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.nickname).toBe('Billy');
    expect(result.pets.map((p) => [p.label, p.state])).toEqual([
      ['Biscuit', 'healthy'],
      ['Luna', 'needs-care'],
      ['Shadow', expect.stringMatching(/^(sick|critical)$/)],
    ]);
  });

  test('a pet in Pet Pawadise and a pet that passed away are named as such', async () => {
    const { app, ids } = await bootFamily();
    const retired = pet({ id: 'pet-r', name: 'Old Friend', retired: { since: iso(T0 - 5 * HOUR) } });
    const gone = pet({ id: 'pet-d', name: 'Gone', lifecycle: { state: 'deceased', exhausted: false, lastEvaluatedAt: iso(T0) } });
    await app.AsyncStorage.setItem(scoped(ids.Sarah, 'petFamily'), family([retired, gone]));
    const result = await O().readChildOverview(ids.Sarah);
    expect(result.status === 'ok' && result.pets.map((p) => p.state)).toEqual(['pawadise', 'deceased']);
  });

  test('a child who has not played yet is "not started"; a damaged record is "unreadable", never guessed', async () => {
    const { app, ids } = await bootFamily();
    expect(await O().readChildOverview(ids.Billy)).toEqual({ status: 'not-started', childId: ids.Billy, nickname: 'Billy' });
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), '{ not json');
    expect(await O().readChildOverview(ids.Billy)).toEqual({ status: 'unreadable' });
  });

  test('Main, unknown ids and archived children are refused, and their records are not even read', async () => {
    const { app, ids } = await bootFamily();
    await app.AsyncStorage.setItem(`${P}petFamily`, family([pet({ id: 'main-pet', name: 'MainPet' })]));
    await app.AsyncStorage.setItem(scoped(ids.Sarah, 'petFamily'), family([pet({ id: 'pet-s', name: 'Sprout' })]));
    expect(await H().setChildArchived(ids.Sarah, true)).toMatchObject({ ok: true });
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    getItem.mockClear();
    for (const id of ['main', 'nobody', '', '../x', ids.Sarah]) expect(await O().readChildOverview(id)).toEqual({ status: 'not-a-child' });
    expect(getItem.mock.calls.some(([key]) => String(key).includes('petFamily'))).toBe(false);
  });

  test('with the parent area locked nothing is read', async () => {
    const { app, ids } = await bootFamily({ unlocked: false });
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), family([pet({ id: 'pet-a', name: 'Biscuit' })]));
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    getItem.mockClear();
    expect(await O().readChildOverview(ids.Billy)).toEqual({ status: 'not-allowed' });
    expect(getItem.mock.calls.some(([key]) => String(key).includes('petFamily'))).toBe(false);
  });
});

describe('looking changes nothing, and reads nothing private', () => {
  test('no write of any kind, storage identical afterwards, and no journal, task list, purchase or token record is ever read', async () => {
    const { app, ids } = await bootFamily();
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'petFamily'), family([pet({ id: 'pet-a', name: 'Biscuit' })]));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'journal'), JSON.stringify([{ id: 'j', dateISO: '2026-03-01', text: 'PRIVATE-WORDS', createdAt: iso(T0), updatedAt: iso(T0) }]));
    await app.AsyncStorage.setItem(scoped(ids.Billy, 'tasks'), JSON.stringify([{ id: 't', text: 'SECRET-TASK' }]));
    await flush();
    const before = await app.dump();
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    const removeItem = jest.spyOn(app.AsyncStorage, 'removeItem');
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    for (const spy of [setItem, removeItem, getItem]) spy.mockClear();

    const children = await O().readDashboardChildren();
    const overview = await O().readChildOverview(ids.Billy);
    await O().readChildOverview(ids.Sarah);
    await flush();
    const readKeys = getItem.mock.calls.map(([key]) => String(key)); // before this test's own dump below reads everything

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(await app.dump()).toEqual(before);
    expect(readKeys.filter((key) => /journal|tasks|ownedShopItems|tokenEarnings|mood/.test(key))).toEqual([]);
    expect(JSON.stringify([children, overview])).not.toMatch(/PRIVATE-WORDS|SECRET-TASK/);
  });

  test('the module reads one record per child and writes nothing (source check)', () => {
    const code = (require('fs').readFileSync(require('path').resolve('src/utils/child-overview.ts'), 'utf8') as string).replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/setItem|removeItem|mergeItem|writeScoped|switchProfile|registerProfileStore|getReflections|journal|task-storage/i);
    expect(code.match(/getItem\(/g)).toHaveLength(1);
  });
});
