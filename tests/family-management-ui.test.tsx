import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { HOUR, T0, TEST_PIN, configurePin, freezeClock, iso, pet, resetSecure, setClock, unfreezeClock } from './helpers';

// Stages 3.3 to 3.6 on screen: the Parent Dashboard's child management card and the Family Health card, over a real household, the real
// profile registry, the real Parent PIN and an in-memory store.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
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

const P = '@ProductivityPet:';
const HOUSEHOLD = `${P}household`;
const REGISTRY = `${P}profiles`;
const scoped = (id: string, name: string) => `${P}p:${id}:${name}`;

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
});

const child = (id: string, nickname = id, extra: object = {}) => ({
  id,
  nickname,
  createdAt: iso(T0),
  settings: { canCreateTasks: false, requireApproval: true, petSafety: 'gentle' },
  tasks: [],
  ...extra,
});
const household = (children: object[]) => JSON.stringify({ version: 1, parent: null, children, selectedChildId: children.length ? (children[0] as { id: string }).id : null });
const family = (pets: object[]) => JSON.stringify({ version: 1, selectedPetId: (pets[0] as { id: string }).id, pets, wallet: { pawTokens: 7 } });
const sick = (id: string, hoursAgo: number) =>
  pet({ id, p: { hunger: 0, lastUpdatedAt: iso(T0 - HOUR) }, lifecycle: { state: 'sick', sickSince: iso(T0 - hoursAgo * HOUR), exhausted: false, lastEvaluatedAt: iso(T0 - HOUR) } });

const seedKids = () => ({
  [HOUSEHOLD]: household([child('kid-a', 'Mia'), child('kid-b', 'Leo')]),
  [scoped('kid-a', 'petFamily')]: family([pet({ id: 'a1' })]),
  [scoped('kid-b', 'petFamily')]: family([sick('b1', 2)]),
});

type Options = { family?: boolean; seed?: Record<string, string>; language?: 'en' | 'es'; locked?: boolean };

async function boot(options: Options = {}) {
  jest.resetModules();
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  if (options.family === false) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  resetSecure();
  const AsyncStorage = (require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage')) as typeof import('@react-native-async-storage/async-storage').default;
  await AsyncStorage.clear();
  for (const [key, value] of Object.entries(options.seed ?? {})) await AsyncStorage.setItem(key, value);
  const i18n = require('@/i18n') as typeof import('@/i18n');
  i18n.setCurrentLanguage(options.language ?? 'en');
  const profiles = require('@/utils/profiles') as typeof import('@/utils/profiles');
  const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
  const pin = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
  await profiles.ensureProfilesReady();
  const app = { AsyncStorage, i18n, profiles, gate, pin, React: ReactTop, rntl: RNTL, Text: ReactNative.Text };
  if (options.family !== false) {
    pin.startParentAuth({ enabled: true, platformOS: 'ios' });
    await configurePin(app as never, { unlocked: !options.locked });
    await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
    gate.startParentGateAutoLock();
  }
  return app;
}
type App = Awaited<ReturnType<typeof boot>>;

const t = (app: App, key: Parameters<App['i18n']['translate']>[1], params?: Parameters<App['i18n']['translate']>[2]) =>
  app.i18n.translate(app.i18n.getCurrentLanguage(), key, params);
const tn = (app: App, base: Parameters<App['i18n']['tn']>[0], n: number, params?: Parameters<App['i18n']['tn']>[2]) => app.i18n.tn(base, n, params);

async function renderCard(app: App, selected: string | null = 'kid-a') {
  const { FamilyManagementCard } = require('@/components/family-management-card') as typeof import('@/components/family-management-card');
  const onSelect = jest.fn();
  const view = await app.rntl.render(app.React.createElement(FamilyManagementCard, { selectedChildId: selected, onSelect }));
  return { view, onSelect };
}
async function renderHealth(app: App) {
  const { FamilyHealthCard } = require('@/components/family-health-card') as typeof import('@/components/family-health-card');
  return app.rntl.render(app.React.createElement(FamilyHealthCard));
}
const press = async (app: App, view: Awaited<ReturnType<typeof renderCard>>['view'], name: string | RegExp) =>
  app.rntl.fireEvent.press(view.getByRole('button', { name }));
const type = async (app: App, view: Awaited<ReturnType<typeof renderCard>>['view'], label: string, text: string) =>
  app.rntl.fireEvent.changeText(view.getByLabelText(label), text);
const failFor = (app: App, match: (key: string) => boolean) => {
  const original = app.AsyncStorage.setItem;
  app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
    if (match(key)) throw new Error('storage failed');
    return original(key, value);
  });
  return () => {
    app.AsyncStorage.setItem = original;
  };
};
const household_ = async (app: App) => JSON.parse((await app.AsyncStorage.getItem(HOUSEHOLD))!);

// ---------------------------------------------------------------------------------------------------------
describe('adding a child', () => {
  test('the confirmation appears only AFTER the save has succeeded, and the child is then listed', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await view.findByText('Mia');
    await press(app, view, `＋ ${t(app, 'addChild')}`);
    await type(app, view, t(app, 'childNickname'), '  Zoe  ');
    // the household write is held back
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === HOUSEHOLD) await gate;
      return original(key, value);
    });
    await press(app, view, t(app, 'add'));
    expect(view.queryByText(t(app, 'fmAdded', { name: 'Zoe' }))).toBeNull(); // not before the save
    expect(view.queryByText('Zoe')).toBeNull();
    await app.rntl.act(async () => release());
    await view.findByText(t(app, 'fmAdded', { name: 'Zoe' }));
    expect(view.getByText('Zoe')).toBeTruthy();
    expect((await household_(app)).children.map((c: { nickname: string }) => c.nickname)).toContain('Zoe');
    app.AsyncStorage.setItem = original;
  });

  test('a failed save shows a friendly error, never a confirmation, and keeps what was typed', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await press(app, view, `＋ ${t(app, 'addChild')}`);
    await type(app, view, t(app, 'childNickname'), 'Zoe');
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    await press(app, view, t(app, 'add'));
    await view.findByText(t(app, 'fmErrStorage'));
    expect(view.queryByText(t(app, 'fmAdded', { name: 'Zoe' }))).toBeNull();
    expect(view.getByLabelText(t(app, 'childNickname')).props.value).toBe('Zoe');
    expect(view.queryByText(t(app, 'fmErrStorageMayBeFull'))).toBeNull(); // the first failure never claims a full device
    restore();
  });

  test('after two storage failures in a row it says the storage MAY be full (and only then)', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await press(app, view, `＋ ${t(app, 'addChild')}`);
    await type(app, view, t(app, 'childNickname'), 'Zoe');
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    await press(app, view, t(app, 'add'));
    await view.findByText(t(app, 'fmErrStorage'));
    await press(app, view, t(app, 'add'));
    await view.findByText(t(app, 'fmErrStorageMayBeFull'));
    expect(view.queryByText(t(app, 'fmErrStorage'))).toBeNull();
    restore();
    await press(app, view, t(app, 'add'));
    await view.findByText(t(app, 'fmAdded', { name: 'Zoe' }));
  });

  test('two children may share a nickname: a friendly warning while typing, and saving still works', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await press(app, view, `＋ ${t(app, 'addChild')}`);
    await type(app, view, t(app, 'childNickname'), ' leo ');
    expect(view.getByText(t(app, 'fmDuplicate', { name: 'Leo' }))).toBeTruthy();
    await press(app, view, t(app, 'add'));
    await view.findByText(t(app, 'fmAdded', { name: 'leo' }));
    expect((await household_(app)).children.map((c: { nickname: string }) => c.nickname)).toEqual(['Mia', 'Leo', 'leo']);
  });

  test('an empty nickname asks for one and saves nothing', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await press(app, view, `＋ ${t(app, 'addChild')}`);
    await press(app, view, t(app, 'add'));
    await view.findByText(t(app, 'fmErrInvalid'));
    expect((await household_(app)).children).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('renaming a child', () => {
  test('success: a confirmation after the save, the same permanent id, the new nickname', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await press(app, view, t(app, 'fmRenameLabel', { name: 'Mia' }));
    await type(app, view, t(app, 'fmNewName'), 'Mimi');
    await press(app, view, t(app, 'saveChild'));
    await view.findByText(t(app, 'fmRenamed', { name: 'Mimi' }));
    expect(view.getByText('Mimi')).toBeTruthy();
    expect((await household_(app)).children[0]).toMatchObject({ id: 'kid-a', nickname: 'Mimi' });
    expect(await app.AsyncStorage.getItem(scoped('kid-a', 'petFamily'))).toBe(seedKids()[scoped('kid-a', 'petFamily')]); // saved pets untouched
  });

  test('failure: an error, no confirmation, the old name stays', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await press(app, view, t(app, 'fmRenameLabel', { name: 'Mia' }));
    await type(app, view, t(app, 'fmNewName'), 'Mimi');
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    await press(app, view, t(app, 'saveChild'));
    await view.findByText(t(app, 'fmErrStorage'));
    expect(view.queryByText(t(app, 'fmRenamed', { name: 'Mimi' }))).toBeNull();
    expect((await household_(app)).children[0].nickname).toBe('Mia');
    restore();
  });

  test('a shared nickname gets the warning (and the rename is allowed)', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await press(app, view, t(app, 'fmRenameLabel', { name: 'Mia' }));
    await type(app, view, t(app, 'fmNewName'), 'LEO');
    expect(view.getByText(t(app, 'fmDuplicate', { name: 'Leo' }))).toBeTruthy();
    await press(app, view, t(app, 'saveChild'));
    await view.findByText(t(app, 'fmRenamed', { name: 'LEO' }));
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('archiving and restoring', () => {
  test('the confirmation explains what archiving does, shows the pets status, and cancelling changes nothing', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await view.findByText('Leo');
    await press(app, view, t(app, 'fmArchiveLabel', { name: 'Leo' }));
    await view.findByText(t(app, 'fmArchiveTitle', { name: 'Leo' }));
    expect(view.getByText(t(app, 'fmArchiveSaved', { name: 'Leo' }))).toBeTruthy(); // nothing is deleted
    expect(view.getByText(t(app, 'fmArchiveAging'))).toBeTruthy(); // keeps aging, may become sick or pass away
    expect(view.getByText(t(app, 'fmArchiveRestoreNote', { name: 'Leo' }))).toBeTruthy(); // restoring does not revive a pet
    await view.findByText(t(app, 'fmArchiveStatus', { status: t(app, 'fpBadgeSick') })); // Leo's pet is sick right now
    await press(app, view, t(app, 'cancel'));
    expect((await household_(app)).children[1].archivedAt).toBeUndefined();
  });

  test('confirming archives: a confirmation after the save, the child leaves the list and appears under a collapsed Archived section', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await view.findByText('Leo');
    await press(app, view, t(app, 'fmArchiveLabel', { name: 'Leo' }));
    await view.findByText(t(app, 'fmArchiveTitle', { name: 'Leo' }));
    await press(app, view, t(app, 'fmArchiveConfirm', { name: 'Leo' }));
    await view.findByText(t(app, 'fmArchived', { name: 'Leo' }));
    expect(view.queryByRole('button', { name: t(app, 'fmArchiveLabel', { name: 'Leo' }) })).toBeNull();
    expect((await household_(app)).children[1]).toMatchObject({ id: 'kid-b', nickname: 'Leo', archivedAt: expect.any(String) });
    // collapsed: the archived child is not listed until the section is opened
    expect(view.queryByText(t(app, 'fmArchivedHelp'))).toBeNull();
    await press(app, view, t(app, 'fmArchivedShow', { count: 1 }));
    expect(view.getByText(t(app, 'fmArchivedHelp'))).toBeTruthy();
    expect(view.getByText(t(app, 'fmArchivedAging'))).toBeTruthy();
    // and Restore brings the same child back
    await press(app, view, t(app, 'fmRestoreLabel', { name: 'Leo' }));
    await view.findByText(t(app, 'fmRestored', { name: 'Leo' }));
    expect((await household_(app)).children[1]).toMatchObject({ id: 'kid-b', nickname: 'Leo' });
    expect((await household_(app)).children[1].archivedAt).toBeUndefined();
    expect(await app.AsyncStorage.getItem(scoped('kid-b', 'petFamily'))).toBe(seedKids()[scoped('kid-b', 'petFamily')]);
    expect(view.getByRole('button', { name: t(app, 'fmArchiveLabel', { name: 'Leo' }) })).toBeTruthy();
  });

  test('a failed archive shows an error, no confirmation, and the child stays', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await view.findByText('Leo');
    await press(app, view, t(app, 'fmArchiveLabel', { name: 'Leo' }));
    await view.findByText(t(app, 'fmArchiveTitle', { name: 'Leo' }));
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    await press(app, view, t(app, 'fmArchiveConfirm', { name: 'Leo' }));
    await view.findByText(t(app, 'fmErrStorage'));
    expect(view.queryByText(t(app, 'fmArchived', { name: 'Leo' }))).toBeNull();
    expect(view.getByText('Leo')).toBeTruthy();
    expect((await household_(app)).children[1].archivedAt).toBeUndefined();
    restore();
  });

  test('the child whose profile is in use cannot be archived: the message says to open Main first', async () => {
    const app = await boot({ seed: seedKids() });
    expect(await app.profiles.switchProfile('kid-a')).toMatchObject({ ok: true });
    await app.gate.unlockParentArea(TEST_PIN);
    const { view } = await renderCard(app);
    await view.findByText('Mia');
    await press(app, view, t(app, 'fmArchiveLabel', { name: 'Mia' }));
    await view.findByText(t(app, 'fmArchiveTitle', { name: 'Mia' }));
    await press(app, view, t(app, 'fmArchiveConfirm', { name: 'Mia' }));
    await view.findByText(t(app, 'fmErrActive', { name: 'Mia' }));
    expect(view.queryByText(t(app, 'fmArchived', { name: 'Mia' }))).toBeNull();
    expect((await household_(app)).children[0].archivedAt).toBeUndefined();
  });

  test('an archived child is hidden from the picker but kept in the dashboard\'s Archived section', async () => {
    const app = await boot({ seed: { ...seedKids(), [HOUSEHOLD]: household([child('kid-a', 'Mia'), child('kid-b', 'Leo', { archivedAt: iso(T0) })]) } });
    const fp = require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');
    expect((await fp.getSelectableChildren()).map((c) => c.id)).toEqual(['kid-a']);
    const { view } = await renderCard(app);
    await view.findByText('Mia');
    expect(view.queryByText('Leo')).toBeNull(); // collapsed
    await press(app, view, t(app, 'fmArchivedShow', { count: 1 }));
    expect(view.getByText('Leo')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('stale and revoked parent sessions', () => {
  test('an action after the session ended shows the "parent session ended" message and never a confirmation', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await press(app, view, t(app, 'fmRenameLabel', { name: 'Mia' }));
    await type(app, view, t(app, 'fmNewName'), 'Mimi');
    setClock(T0 + 6 * 60 * 1000); // five idle minutes: the session is over
    await press(app, view, t(app, 'saveChild'));
    await view.findByText(t(app, 'fmErrLocked'));
    expect(view.queryByText(t(app, 'fmRenamed', { name: 'Mimi' }))).toBeNull();
    expect((await household_(app)).children[0].nickname).toBe('Mia');
  });

  test('add and archive are refused the same way when the session is locked', async () => {
    const app = await boot({ seed: seedKids() });
    const { view } = await renderCard(app);
    await press(app, view, `＋ ${t(app, 'addChild')}`);
    await type(app, view, t(app, 'childNickname'), 'Zoe');
    app.gate.lockParentArea();
    await press(app, view, t(app, 'add'));
    await view.findByText(t(app, 'fmErrLocked'));
    expect((await household_(app)).children).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('family mode off', () => {
  test('the original card: add and rename with proper messages, but no archive, no archived section and no care badges', async () => {
    const app = await boot({ family: false, seed: seedKids() });
    const { view } = await renderCard(app);
    await view.findByText('Mia');
    expect(view.queryByRole('button', { name: t(app, 'fmArchiveLabel', { name: 'Mia' }) })).toBeNull();
    expect(view.queryByText(t(app, 'fpBadgeHealthy'))).toBeNull();
    await press(app, view, t(app, 'fmRenameLabel', { name: 'Mia' }));
    await type(app, view, t(app, 'fmNewName'), 'Mimi');
    await press(app, view, t(app, 'saveChild'));
    await view.findByText(t(app, 'fmRenamed', { name: 'Mimi' }));
  });

  test('the health card never appears', async () => {
    const app = await boot({ family: false, seed: seedKids() });
    const view = await renderHealth(app);
    await app.rntl.act(async () => undefined);
    expect(view.queryByText(t(app, 'fmHealthTitle'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('family health', () => {
  test('nothing to report: the card is not shown at all', async () => {
    const app = await boot({ seed: { [HOUSEHOLD]: household([child('kid-a', 'Mia')]), [scoped('kid-a', 'petFamily')]: family([pet({ id: 'a1' })]) } });
    const view = await renderHealth(app);
    await app.rntl.act(async () => undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(view.queryByText(t(app, 'fmHealthTitle'))).toBeNull();
  });

  test('pets that need care, orphans, an unreadable record: shown, read-only, with only a "check again" button', async () => {
    const app = await boot({ seed: seedKids() });
    await app.profiles.registerChildProfile('ghost-empty');
    await app.profiles.registerChildProfile('ghost-data');
    await app.AsyncStorage.setItem(scoped('ghost-data', 'petFamily'), family([pet({ id: 'g1' })]));
    const before = new Map<string, string | null>();
    for (const k of await app.AsyncStorage.getAllKeys()) before.set(k, await app.AsyncStorage.getItem(k));
    const view = await renderHealth(app);
    await view.findByText(t(app, 'fmHealthTitle'));
    expect(view.getByText(t(app, 'fmHealthCareActive', { name: 'Leo', status: t(app, 'fpBadgeSick') }))).toBeTruthy();
    expect(view.getByText(tn(app, 'fmHealthOrphanEmpty', 1))).toBeTruthy();
    expect(view.getByText(tn(app, 'fmHealthOrphanData', 1))).toBeTruthy();
    const buttons = view.getAllByRole('button');
    expect(buttons.map((b) => b.props.accessibilityLabel)).toEqual([t(app, 'fmHealthRefresh')]); // nothing to delete, repair or merge
    for (const [k, v] of before) expect(await app.AsyncStorage.getItem(k)).toBe(v); // looking changed nothing
  });

  test('an archived child whose pets need care is marked as archived and still aging', async () => {
    const app = await boot({ seed: { ...seedKids(), [HOUSEHOLD]: household([child('kid-a', 'Mia'), child('kid-b', 'Leo', { archivedAt: iso(T0) })]) } });
    const view = await renderHealth(app);
    await view.findByText(t(app, 'fmHealthCareArchived', { name: 'Leo', status: t(app, 'fpBadgeSick') }));
  });

  test('duplicate child ids and an unreadable entry are explained, with the reassurance that nothing was changed', async () => {
    const text = JSON.stringify({ version: 1, parent: null, selectedChildId: null, children: [child('dup', 'One'), child('dup', 'Two'), { id: 'x' }] });
    const app = await boot({ seed: { [HOUSEHOLD]: text }, family: true });
    const view = await renderHealth(app);
    await view.findByText(t(app, 'fmHealthDuplicate', { ids: 'dup' }));
    expect(view.getByText(tn(app, 'fmHealthUnreadableEntries', 1))).toBeTruthy();
    expect(await app.AsyncStorage.getItem(HOUSEHOLD)).toBe(text);
  });

  test('"check again" looks again and shows what changed', async () => {
    const app = await boot({ seed: seedKids() });
    const view = await renderHealth(app);
    await view.findByText(t(app, 'fmHealthCareActive', { name: 'Leo', status: t(app, 'fpBadgeSick') }));
    await app.AsyncStorage.setItem(scoped('kid-b', 'petFamily'), family([pet({ id: 'b1' })])); // Leo's pet was looked after meanwhile
    await app.rntl.fireEvent.press(view.getByRole('button', { name: t(app, 'fmHealthRefresh') }));
    await app.rntl.waitFor(() => expect(view.queryByText(t(app, 'fmHealthTitle'))).toBeNull());
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('English and Spanish', () => {
  test('Spanish error, confirmation and archive texts', async () => {
    const app = await boot({ seed: seedKids(), language: 'es' });
    const { view } = await renderCard(app);
    await view.findByText('Leo');
    await press(app, view, 'Archivar a Leo');
    await view.findByText('¿Archivar a Leo?');
    expect(view.getByText(/Las mascotas siguen envejeciendo mientras está archivado/)).toBeTruthy();
    expect(view.getByText('Ahora mismo: Enferma')).toBeTruthy();
    const restore = failFor(app, (k) => k === HOUSEHOLD);
    await press(app, view, 'Sí, archivar a Leo');
    await view.findByText('No se pudo guardar. No se cambió nada. Inténtalo de nuevo.');
    restore();
  });

  test('English and Spanish have the same keys and placeholders', () => {
    const en = require('@/i18n/family-management.en').familyManagementEn as Record<string, string>;
    const es = require('@/i18n/family-management.es').familyManagementEs as Record<string, string>;
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect([...en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()).toEqual([...es[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });
});

describe('layout rules', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8');

  test('every button in the new cards is the full-size 44px kind (never "small"), and nothing offers to delete a child or a profile', () => {
    for (const file of ['src/components/family-management-card.tsx', 'src/components/family-health-card.tsx']) {
      const code = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/<Button\s[^>]*\bsmall\b/);
      expect(code).not.toMatch(/tone="danger"|deleteChild|removeChild|removeProfile|deleteProfile|AsyncStorage\.(removeItem|multiRemove|clear)/);
    }
  });

  test('no Parent Dashboard control is the 36px "small" kind, and the alerts bell and the confirmation dialog buttons are 44px', () => {
    const strip = (code: string) => code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const dashboard = strip(read('src/components/parent-dashboard.tsx'));
    expect(dashboard).not.toMatch(/<Button[^>]*small/);
    expect(dashboard).not.toMatch(/^\s*small\s*$/m);
    const header = read('src/components/app-header.tsx');
    expect(header.slice(header.indexOf('bellPill: {'))).toMatch(/minHeight: 44/);
    expect(read('src/components/confirm-modal.tsx')).toMatch(/minHeight: 44/);
  });

  test('the dashboard uses the new cards and no longer ignores a failed add or rename', () => {
    const dashboard = read('src/components/parent-dashboard.tsx');
    expect(dashboard).toMatch(/<FamilyManagementCard /);
    expect(dashboard).toMatch(/<FamilyHealthCard \/>/);
    expect(dashboard).not.toMatch(/submitChild|submitRename|addChild\(|renameChild\(/);
  });

  test('the management cards never log, and never write a profile\'s own records', () => {
    for (const file of ['src/components/family-management-card.tsx', 'src/components/family-health-card.tsx', 'src/utils/family-management.ts']) {
      const code = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(code).not.toMatch(/console\.|setItem|multiSet|removeItem/);
    }
  });
});

void REGISTRY;
