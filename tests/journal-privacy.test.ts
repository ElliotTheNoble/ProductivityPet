import { T0, configurePin, flush, freezeClock, iso, loadApp, unfreezeClock, type App } from './helpers';

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

// Journal privacy (Phase 1): every entry is private unless its owner explicitly shared it; a parent can only ever read shared entries of
// a real child profile, through one filtered reader. These tests are about what must never leak and what must never be lost.

const P = '@ProductivityPet:';
const MAIN_JOURNAL = `${P}journal`;
const childJournal = (id: string) => `${P}p:${id}:journal`;
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;

beforeEach(() => freezeClock(T0));
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const entry = (id: string, dateISO: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  dateISO,
  text,
  createdAt: iso(T0),
  updatedAt: iso(T0),
  ...extra,
});

// ---------------------------------------------------------------------------------------------------------
describe('the setting on an entry', () => {
  test('only the exact value "shared" means shared; everything else is private', async () => {
    const app = await loadApp();
    for (const value of ['Shared', 'SHARED', ' shared', true, 1, 'public', 'yes', null, undefined, {}, [], 'private', '']) {
      expect(app.journal.isShared({ visibility: value })).toBe(false);
    }
    expect(app.journal.isShared({ visibility: 'shared' })).toBe(true);
    expect(app.journal.isShared({})).toBe(false);
  });

  test('a new entry is private, and saving without a choice never shares it', async () => {
    const app = await loadApp();
    await app.journal.saveReflection('2026-03-10', 'a new one');
    await app.journal.saveReflection('2026-03-11', 'another', undefined);
    await flush();
    const stored = JSON.parse((await app.dump()).get(MAIN_JOURNAL)!);
    expect(stored.map((r: { visibility: string }) => r.visibility)).toEqual(['private', 'private']);
  });

  test('an entry saved as shared is stored as shared; editing its text keeps it shared; the owner can still change it', async () => {
    const app = await loadApp();
    await app.journal.saveReflection('2026-03-10', 'for my parent', 'shared');
    await app.journal.saveReflection('2026-03-10', 'for my parent, edited');
    await flush();
    const [stored] = JSON.parse((await app.dump()).get(MAIN_JOURNAL)!);
    expect(stored).toMatchObject({ text: 'for my parent, edited', visibility: 'shared' });
  });
});

describe('entries written before this existed', () => {
  test('they read as private and loading never rewrites the stored record', async () => {
    const legacy = JSON.stringify([entry('a', '2026-03-01', 'old secret'), entry('b', '2026-03-02', 'older secret')]);
    const app = await loadApp({ [MAIN_JOURNAL]: legacy });
    const list = await app.journal.getReflections();
    expect(list).toHaveLength(2);
    expect(list.every((r) => !app.journal.isShared(r))).toBe(true);
    await flush();
    expect((await app.dump()).get(MAIN_JOURNAL)).toBe(legacy); // byte for byte what was there
  });

  test('saving text on an old entry keeps it private and changes nothing else about the other entries', async () => {
    const other = entry('b', '2026-03-02', 'untouched');
    const app = await loadApp({ [MAIN_JOURNAL]: JSON.stringify([entry('a', '2026-03-01', 'old'), other]) });
    await app.journal.saveReflection('2026-03-01', 'old, edited');
    await flush();
    const stored = JSON.parse((await app.dump()).get(MAIN_JOURNAL)!);
    expect(stored.find((r: { id: string }) => r.id === 'a')).toMatchObject({ text: 'old, edited', visibility: 'private' });
    expect(stored.find((r: { id: string }) => r.id === 'b')).toEqual(other);
  });

  test('a damaged setting is private, and an unrelated edit repairs it to private (never to shared)', async () => {
    const app = await loadApp({ [MAIN_JOURNAL]: JSON.stringify([entry('a', '2026-03-01', 'x', { visibility: 'Shared' })]) });
    expect(app.journal.isShared((await app.journal.getReflections())[0])).toBe(false);
    await app.journal.saveReflection('2026-03-01', 'x2');
    await flush();
    expect(JSON.parse((await app.dump()).get(MAIN_JOURNAL)!)[0].visibility).toBe('private');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('making a shared entry private', () => {
  const seed = (extra: Record<string, unknown> = {}) => ({
    [MAIN_JOURNAL]: JSON.stringify([entry('a', '2026-03-01', 'my words', { visibility: 'shared', ...extra })]),
  });

  test('only the setting changes: the text and its dates stay, and the result is confirmed against what is stored', async () => {
    const app = await loadApp(seed());
    expect(await app.journal.setReflectionVisibility('2026-03-01', 'private')).toBe(true);
    await flush();
    const [stored] = JSON.parse((await app.dump()).get(MAIN_JOURNAL)!);
    expect(stored).toEqual(entry('a', '2026-03-01', 'my words', { visibility: 'private' }));
    expect((await app.journal.getReflections())[0].visibility).toBe('private');
  });

  test('when the write fails nothing changes, in memory or in storage, and it says so', async () => {
    const app = await loadApp(seed());
    await app.journal.getReflections();
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === MAIN_JOURNAL) throw new Error('disk full');
      return original(key, value);
    });
    expect(await app.journal.setReflectionVisibility('2026-03-01', 'private')).toBe(false);
    app.AsyncStorage.setItem = original;
    expect(app.journal.isShared((await app.journal.getReflections())[0])).toBe(true); // memory still says shared, like storage
    expect(JSON.parse((await app.dump()).get(MAIN_JOURNAL)!)[0].visibility).toBe('shared');
  });

  test('when what is stored afterwards is not private, it is not reported as done', async () => {
    const app = await loadApp(seed());
    await app.journal.getReflections();
    const originalGet = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => (key === MAIN_JOURNAL ? seed()[MAIN_JOURNAL] : originalGet(key)));
    expect(await app.journal.setReflectionVisibility('2026-03-01', 'private')).toBe(false);
    app.AsyncStorage.getItem = originalGet;
    expect(app.journal.isShared((await app.journal.getReflections())[0])).toBe(true);
  });

  test('already private, or no such entry: nothing is written', async () => {
    const app = await loadApp({ [MAIN_JOURNAL]: JSON.stringify([entry('a', '2026-03-01', 'x')]) });
    const before = (await app.dump()).get(MAIN_JOURNAL);
    expect(await app.journal.setReflectionVisibility('2026-03-01', 'private')).toBe(true);
    expect(await app.journal.setReflectionVisibility('2030-01-01', 'private')).toBe(false);
    await flush();
    expect((await app.dump()).get(MAIN_JOURNAL)).toBe(before);
  });

  test('a text save and a privacy change made together cannot overwrite each other', async () => {
    const app = await loadApp(seed());
    await app.journal.getReflections();
    const [saved, changed] = await Promise.all([
      app.journal.saveReflection('2026-03-01', 'new words'),
      app.journal.setReflectionVisibility('2026-03-01', 'private'),
    ]);
    expect(saved && changed).toBe(true);
    await flush();
    expect(JSON.parse((await app.dump()).get(MAIN_JOURNAL)!)[0]).toMatchObject({ text: 'new words', visibility: 'private' });
  });

  test('a save that makes a shared entry private is confirmed too, and a failed one does not look private', async () => {
    const app = await loadApp(seed());
    await app.journal.getReflections();
    const original = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
      if (key === MAIN_JOURNAL) throw new Error('disk full');
      return original(key, value);
    });
    expect(await app.journal.saveReflection('2026-03-01', 'edited', 'private')).toBe(false);
    app.AsyncStorage.setItem = original;
    expect(app.journal.isShared((await app.journal.getReflections())[0])).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
// What a parent can read
describe('the shared-journal reader', () => {
  async function bootFamily(options: { unlocked?: boolean } = {}): Promise<{ app: App; childId: string }> {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const app = await loadApp();
    await app.profiles.ensureProfilesReady();
    await configurePin(app, { unlocked: true });
    const household = require('@/utils/household') as typeof import('@/utils/household');
    const added = await household.addChild('Mia');
    if (!added.ok || !added.id) throw new Error('child not added');
    const profiles = require('@/utils/family-profiles') as typeof import('@/utils/family-profiles');
    await profiles.reconcileFamilyProfiles();
    if (options.unlocked === false) app.gate.lockParentArea();
    return { app, childId: added.id };
  }
  const reader = () => require('@/utils/journal-sharing') as typeof import('@/utils/journal-sharing');

  const MIXED = [
    entry('1', '2026-03-01', 'PRIVATE-ONE'),
    entry('2', '2026-03-02', 'SHARED-TWO', { visibility: 'shared' }),
    entry('3', '2026-03-03', 'PRIVATE-EXPLICIT', { visibility: 'private' }),
    entry('4', '2026-03-04', 'PRIVATE-CAPS', { visibility: 'Shared' }),
    entry('5', '2026-03-05', 'PRIVATE-TRUE', { visibility: true }),
    entry('6', '2026-03-06', 'SHARED-SIX', { visibility: 'shared' }),
    entry('7', '2026-03-07', 'PRIVATE-NULL', { visibility: null }),
  ];

  test('a parent gets exactly the shared entries, newest first, and not one word of the private ones', async () => {
    const { app, childId } = await bootFamily();
    await app.AsyncStorage.setItem(childJournal(childId), JSON.stringify(MIXED));
    const result = await reader().readSharedJournal(childId);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.entries.map((e) => e.text)).toEqual(['SHARED-SIX', 'SHARED-TWO']);
    expect(Object.keys(result.entries[0]).sort()).toEqual(['dateISO', 'id', 'text', 'updatedAt']);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE/);
  });

  test('it changes nothing: no write, nothing cached, the active profile and its stores are untouched', async () => {
    const { app, childId } = await bootFamily();
    await app.AsyncStorage.setItem(childJournal(childId), JSON.stringify(MIXED));
    const active = app.profiles.getActiveProfileId();
    const before = await app.dump();
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    const removeItem = jest.spyOn(app.AsyncStorage, 'removeItem');
    setItem.mockClear();
    removeItem.mockClear();
    await reader().readSharedJournal(childId);
    await reader().readSharedJournal(childId);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(app.profiles.getActiveProfileId()).toBe(active);
    expect(await app.dump()).toEqual(before);
    // the active profile's own journal cache never saw the child's entries
    expect(await app.journal.getReflections()).toEqual([]);
  });

  test('Main (the parent\'s own space) and unknown ids are refused, and their journal is never even read', async () => {
    const { app } = await bootFamily();
    await app.AsyncStorage.setItem(MAIN_JOURNAL, JSON.stringify([entry('m', '2026-03-01', 'MAIN-SECRET', { visibility: 'shared' })]));
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    getItem.mockClear();
    for (const id of ['main', 'nobody', '', '../x', 'p:main']) {
      expect(await reader().readSharedJournal(id)).toEqual({ status: 'not-a-child' });
    }
    expect(getItem.mock.calls.some(([key]) => String(key).endsWith(':journal'))).toBe(false);
  });

  test('with the parent area locked, nothing is read at all', async () => {
    const { app, childId } = await bootFamily({ unlocked: false });
    await app.AsyncStorage.setItem(childJournal(childId), JSON.stringify(MIXED));
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    getItem.mockClear();
    expect(await reader().readSharedJournal(childId)).toEqual({ status: 'not-allowed' });
    expect(getItem.mock.calls.some(([key]) => String(key).endsWith(':journal'))).toBe(false);
  });

  test('a child with no journal yet has an empty list; a damaged record is reported, never guessed', async () => {
    const { app, childId } = await bootFamily();
    expect(await reader().readSharedJournal(childId)).toEqual({ status: 'ok', entries: [] });
    await app.AsyncStorage.setItem(childJournal(childId), '{ not json');
    expect(await reader().readSharedJournal(childId)).toEqual({ status: 'unreadable' });
    await app.AsyncStorage.setItem(childJournal(childId), JSON.stringify({ not: 'a list' }));
    expect(await reader().readSharedJournal(childId)).toEqual({ status: 'unreadable' });
    await app.AsyncStorage.setItem(childJournal(childId), JSON.stringify(['x', null, 5, entry('9', '2026-03-09', 'ok', { visibility: 'shared' })]));
    expect(await reader().readSharedJournal(childId)).toMatchObject({ status: 'ok', entries: [{ text: 'ok' }] });
  });

  test('an archived child cannot be read while archived, nothing of the journal is read or changed, and restoring brings the shared entries back', async () => {
    const { app, childId } = await bootFamily();
    const raw = JSON.stringify(MIXED);
    await app.AsyncStorage.setItem(childJournal(childId), raw);
    const household = require('@/utils/household') as typeof import('@/utils/household');
    expect(await household.setChildArchived(childId, true)).toMatchObject({ ok: true });
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    getItem.mockClear();
    expect(await reader().readSharedJournal(childId)).toEqual({ status: 'not-a-child' });
    expect(getItem.mock.calls.some(([key]) => String(key).endsWith(':journal'))).toBe(false);
    expect((await app.dump()).get(childJournal(childId))).toBe(raw); // preserved byte for byte
    expect(await household.setChildArchived(childId, false)).toMatchObject({ ok: true });
    const restored = await reader().readSharedJournal(childId);
    expect(restored.status === 'ok' && restored.entries.map((e) => e.text)).toEqual(['SHARED-SIX', 'SHARED-TWO']);
    expect(JSON.stringify(restored)).not.toMatch(/PRIVATE/);
  });

  test('one child never sees another child\'s entries', async () => {
    const { app, childId } = await bootFamily();
    const household = require('@/utils/household') as typeof import('@/utils/household');
    const second = await household.addChild('Leo');
    if (!second.ok || !second.id) throw new Error('second child not added');
    await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
    await app.AsyncStorage.setItem(childJournal(childId), JSON.stringify([entry('a', '2026-03-01', 'MIA-SHARED', { visibility: 'shared' })]));
    await app.AsyncStorage.setItem(childJournal(second.id), JSON.stringify([entry('b', '2026-03-01', 'LEO-SHARED', { visibility: 'shared' })]));
    const mia = await reader().readSharedJournal(childId);
    const leo = await reader().readSharedJournal(second.id);
    expect(JSON.stringify(mia)).toContain('MIA-SHARED');
    expect(JSON.stringify(mia)).not.toContain('LEO');
    expect(JSON.stringify(leo)).not.toContain('MIA');
  });
});

// ---------------------------------------------------------------------------------------------------------
// The code itself: nothing else may reach another profile's journal.
describe('where the journal may be read', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8');
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.resolve(dir), { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) => {
      const rel = `${dir}/${e.name}`;
      return e.isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
    });
  const files: string[] = walk('src');

  test('only the journal store, the shared reader and the two screens of the profile\'s OWN journal import the journal module', () => {
    const importers = files.filter((f) => /from '@\/utils\/journal'/.test(read(f))).sort();
    expect(importers).toEqual([
      'src/components/mood-journey-screen.tsx',
      'src/components/year-review-screen.tsx',
      'src/utils/journal-sharing.ts',
    ]);
  });

  test('only the journal store and the shared reader name the journal storage key', () => {
    const users = files.filter((f) => /JOURNAL_KEY_NAME|'journal'\s*\)/.test(read(f).replace(/\/\/.*$/gm, ''))).sort();
    expect(users).toEqual(['src/utils/journal-sharing.ts', 'src/utils/journal.ts']);
  });

  test('every parent-facing file gets journal text only from the shared reader', () => {
    const parentFacing = files.filter((f) => /\/(parent-[a-z-]+|family-[a-z-]+|household|notifications?|native-notifications|notification-[a-z-]+)\.tsx?$/.test(f));
    expect(parentFacing.length).toBeGreaterThan(8);
    for (const file of parentFacing) {
      const code = read(file);
      expect(code).not.toMatch(/from '@\/utils\/journal'/);
      expect(code).not.toMatch(/getReflections|saveReflection|Reflection\b/);
    }
  });

  test('the shared reader reads one stored record and writes nothing', () => {
    const code = read('src/utils/journal-sharing.ts').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/setItem|removeItem|mergeItem|writeScoped|switchProfile|registerProfileStore|getReflections/);
    expect(code.match(/getItem\(/g)).toHaveLength(1);
    expect(code).toMatch(/isShared\(r\)/);
  });
});
