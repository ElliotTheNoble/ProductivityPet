import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { previewOf } from '@/components/child-journal-section';
import { T0, configurePin, freezeClock, iso, loadApp, unfreezeClock, type App } from './helpers';

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

// Shared Journals on a child's overview: only entries the child explicitly shared, read-only, read again every time, behind the existing
// parent session. 2026-03-02 is a Monday (the test clock is 2026-03-10).
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    useRouter: () => mockRouter,
    usePathname: () => '/dashboard',
    Redirect: () => null,
    Slot: () => R.createElement(require('@/app/dashboard').default),
    ThemeProvider: ({ children }: { children: unknown }) => children,
    DarkTheme: {},
    DefaultTheme: {},
  };
});

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

const entry = (id: string, dateISO: string, text: string, extra: Record<string, unknown> = {}) => ({ id, dateISO, text, createdAt: iso(T0), updatedAt: iso(T0), ...extra });
const shared = (id: string, dateISO: string, text: string) => entry(id, dateISO, text, { visibility: 'shared' });
const dayN = (n: number) => new Date(Date.UTC(2025, 0, 1 + n)).toISOString().slice(0, 10);

async function boot(language: 'en' | 'es' = 'en') {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app: App = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const household = require('@/utils/household') as typeof import('@/utils/household');
  const ids: Record<string, string> = {};
  for (const name of ['Billy', 'Sarah']) {
    const added = await household.addChild(name);
    if (!added.ok || !added.id) throw new Error('child not added');
    ids[name] = added.id;
  }
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  (require('@/i18n') as typeof import('@/i18n')).setCurrentLanguage(language);
  return { app, ids, household };
}

const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 25; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const press = (name: string | RegExp) => RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name }));
const setJournal = (app: App, id: string, entries: unknown) => app.AsyncStorage.setItem(scoped(id, 'journal'), typeof entries === 'string' ? entries : JSON.stringify(entries));

async function openChild(name: string, say: typeof en = en) {
  const { ShellChooser } = require('@/components/shell-chooser') as typeof import('@/components/shell-chooser');
  await RNTL.render(<ShellChooser renderGame={() => <ReactNative.Text>GAME</ReactNative.Text>} />);
  await settle();
  await RNTL.screen.findByText(name);
  await press(say('phOpenChild', { name }));
  await settle();
}
const bodyText = () => JSON.stringify(RNTL.screen.toJSON());
// only the words on screen (not style or accessibility property names)
const wordsOnScreen = (): string => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    for (const child of (node as { children?: unknown[] }).children ?? []) {
      if (typeof child === 'string') out.push(child);
      else walk(child);
    }
  };
  const tree = RNTL.screen.toJSON();
  for (const root of Array.isArray(tree) ? tree : [tree]) walk(root);
  return out.join(' | ');
};
const card = (date: string) => RNTL.screen.getByRole('button', { name: en('pjOpenEntry', { date }) });
const cardsShown = () => RNTL.screen.queryAllByRole('button', { name: /^Read the entry from / });

describe('which entries a parent sees', () => {
  const MIXED = [
    entry('1', '2026-03-01', 'PRIVATE-ONE'),
    shared('2', '2026-03-02', 'A happy day at the park with my friends.'),
    entry('3', '2026-03-03', 'PRIVATE-EXPLICIT', { visibility: 'private' }),
    entry('4', '2026-03-04', 'PRIVATE-CAPS', { visibility: 'Shared' }),
    entry('5', '2026-03-05', 'PRIVATE-TRUE', { visibility: true }),
    shared('6', '2026-03-06', 'We baked cookies.'),
    entry('7', '2026-03-07', 'PRIVATE-NULL', { visibility: null }),
  ];

  test('only the explicitly shared ones: weekday and date, a short preview, newest first; nothing about the private ones appears anywhere', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, MIXED);
    await openChild('Billy');
    const labels = cardsShown().map((b) => String(b.props.accessibilityLabel));
    expect(labels).toEqual([en('pjOpenEntry', { date: 'Fri, Mar 6' }), en('pjOpenEntry', { date: 'Mon, Mar 2' })]);
    expect(RNTL.screen.getByText('We baked cookies.')).toBeTruthy();
    expect(RNTL.screen.getByText('A happy day at the park with my friends.')).toBeTruthy();
    const all = bodyText();
    expect(all).not.toMatch(/PRIVATE/);
    for (const privateDate of ['Sun, Mar 1', 'Tue, Mar 3', 'Wed, Mar 4', 'Thu, Mar 5', 'Sat, Mar 7']) expect(all).not.toContain(privateDate);
    expect(wordsOnScreen()).not.toMatch(/hidden|private|7 entries|5 (entries|private)/i); // no count of anything private
  });

  test('"nothing shared" looks exactly the same whether the child wrote nothing or kept everything private', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Sarah, [entry('a', '2026-03-01', 'PRIVATE-A'), entry('b', '2026-03-02', 'PRIVATE-B', { visibility: 'private' })]);
    await openChild('Sarah');
    const allPrivate = bodyText().replace(/Sarah/g, 'NAME');
    expect(RNTL.screen.getByText(en('pjEmpty', { name: 'Sarah' }))).toBeTruthy();
    await RNTL.cleanup();
    await app.AsyncStorage.removeItem(scoped(ids.Sarah, 'journal'));
    await openChild('Sarah');
    expect(RNTL.screen.getByText(en('pjEmpty', { name: 'Sarah' }))).toBeTruthy();
    expect(bodyText().replace(/Sarah/g, 'NAME')).toBe(allPrivate); // identical, character for character
  });

  test('damaged records: a short error for an unreadable journal, damaged or unclear entries are skipped, never shown', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, '{ not json');
    await openChild('Billy');
    expect(RNTL.screen.getByText(en('pjUnreadable'))).toBeTruthy();
    await RNTL.cleanup();
    await setJournal(app, ids.Billy, ['x', null, 5, { visibility: 'shared' }, { id: 'n', visibility: 'shared', text: 'no date' }, shared('ok', '2026-03-02', 'Fine.')]);
    await openChild('Billy');
    expect(cardsShown()).toHaveLength(1);
    expect(RNTL.screen.getByText('Fine.')).toBeTruthy();
    expect(bodyText()).not.toContain('no date');
  });
});

describe('long lists: the first 50, then Show more; only shared entries are ever counted', () => {
  test('120 shared entries: 50, then 100, then all 120 and no button', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, Array.from({ length: 120 }, (_, i) => shared(`s${i}`, dayN(i), `Entry number ${i}`)));
    await openChild('Billy');
    expect(cardsShown()).toHaveLength(50);
    await press(en('pjShowMore'));
    expect(cardsShown()).toHaveLength(100);
    await press(en('pjShowMore'));
    expect(cardsShown()).toHaveLength(120);
    expect(RNTL.screen.queryByRole('button', { name: en('pjShowMore') })).toBeNull();
  });

  test('60 shared among 100 private: the private ones change nothing about what is shown or offered', async () => {
    const { app, ids } = await boot();
    const entries = [
      ...Array.from({ length: 60 }, (_, i) => shared(`s${i}`, dayN(i * 2), `Shared ${i}`)),
      ...Array.from({ length: 100 }, (_, i) => entry(`p${i}`, dayN(i * 2 + 1), `PRIVATE-${i}`)),
    ];
    await setJournal(app, ids.Billy, entries);
    await openChild('Billy');
    expect(cardsShown()).toHaveLength(50);
    await press(en('pjShowMore'));
    expect(cardsShown()).toHaveLength(60); // exactly the shared ones
    expect(RNTL.screen.queryByRole('button', { name: en('pjShowMore') })).toBeNull();
    expect(bodyText()).not.toMatch(/PRIVATE/);
  });

  test('exactly 50 shared entries: no Show more button', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, Array.from({ length: 50 }, (_, i) => shared(`s${i}`, dayN(i), `E${i}`)));
    await openChild('Billy');
    expect(cardsShown()).toHaveLength(50);
    expect(RNTL.screen.queryByRole('button', { name: en('pjShowMore') })).toBeNull();
  });
});

describe('the previews', () => {
  test('a short text is shown whole; a long one is cut at a word near 90 characters with an ellipsis; spacing is tidied', () => {
    expect(previewOf('Short and sweet.')).toBe('Short and sweet.');
    expect(previewOf('  lots   of\n\nspace  ')).toBe('lots of space');
    const long = 'word '.repeat(60).trim();
    const preview = previewOf(long);
    expect(preview.endsWith('…')).toBe(true);
    expect(preview.length).toBeLessThanOrEqual(91);
    expect(preview.slice(0, -1).endsWith('word')).toBe(true); // cut between words
    expect(previewOf('x'.repeat(200)).length).toBe(91); // no space to cut at: a hard cut
  });
});

describe('the full entry', () => {
  const FULL = 'I went to the lake with my cousins and we swam for hours. '.repeat(10).slice(0, 500);

  test('shows the whole text (up to the 500 character limit), the full date and a Back button; Back returns to the list', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, [shared('a', '2026-03-02', FULL), shared('b', '2026-03-06', 'Cookies.')]);
    await openChild('Billy');
    expect(FULL).toHaveLength(500);
    await press(en('pjOpenEntry', { date: 'Mon, Mar 2' }));
    await settle();
    expect(await RNTL.screen.findByText(FULL)).toBeTruthy(); // the entire text, not the preview
    expect(RNTL.screen.getByText('Monday, March 2, 2026')).toBeTruthy();
    expect(RNTL.screen.getByText(en('pjReadOnly', { name: 'Billy' }))).toBeTruthy();
    expect(RNTL.screen.getByRole('button', { name: `‹ ${en('pjBack')}` })).toBeTruthy();
    expect(bodyText()).toContain('RCTScrollView'); // the page scrolls
    await press(`‹ ${en('pjBack')}`);
    await settle();
    expect(RNTL.screen.queryByText(en('pjReadOnly', { name: 'Billy' }))).toBeNull(); // the entry page is closed: back on the child's overview
    expect(cardsShown()).toHaveLength(2);
  });

  test('it is read-only: no text field, and the only buttons are Back and the header; nothing can edit, delete or share', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, [shared('a', '2026-03-02', 'Hello.')]);
    await openChild('Billy');
    await press(en('pjOpenEntry', { date: 'Mon, Mar 2' }));
    await settle();
    await RNTL.screen.findByText('Hello.');
    expect(RNTL.screen.queryByPlaceholderText(/./)).toBeNull();
    expect(bodyText()).not.toContain('TextInput'); // no input of any kind
    const names = RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel ?? ''));
    expect([...names].sort()).toEqual(['Switch player. Playing as Main.', en('phNavDashboard'), en('phSettings'), `‹ ${en('pjBack')}`].sort());
  });
});

describe('revoking and deleting: the parent stops seeing the entry', () => {
  test('sharing revoked while the list is open: opening the entry checks again and shows nothing of it', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, [shared('a', '2026-03-02', 'SECRET-AFTER-REVOKE'), shared('b', '2026-03-06', 'Still shared.')]);
    await openChild('Billy');
    expect(RNTL.screen.getByText('SECRET-AFTER-REVOKE')).toBeTruthy();
    // the child makes it private again (what the child's own screen saves)
    await setJournal(app, ids.Billy, [entry('a', '2026-03-02', 'SECRET-AFTER-REVOKE', { visibility: 'private' }), shared('b', '2026-03-06', 'Still shared.')]);
    await press(en('pjOpenEntry', { date: 'Mon, Mar 2' }));
    await settle();
    expect(await RNTL.screen.findByText(en('pjGone'))).toBeTruthy();
    expect(bodyText()).not.toContain('SECRET-AFTER-REVOKE');
    await press(`‹ ${en('pjBack')}`);
    await settle();
    expect(bodyText()).not.toContain('SECRET-AFTER-REVOKE'); // and the list read again does not have it
    expect(cardsShown()).toHaveLength(1);
  });

  test('an entry that was deleted is treated the same way', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, [shared('a', '2026-03-02', 'DELETED-TEXT')]);
    await openChild('Billy');
    await setJournal(app, ids.Billy, []);
    await press(en('pjOpenEntry', { date: 'Mon, Mar 2' }));
    await settle();
    expect(await RNTL.screen.findByText(en('pjGone'))).toBeTruthy();
    expect(bodyText()).not.toContain('DELETED-TEXT');
  });

  test('an entry that is open when the child stops sharing disappears when the app comes back to the foreground', async () => {
    const { app, ids } = await boot();
    const listeners: ((state: string) => void)[] = [];
    jest.spyOn(ReactNative.AppState, 'addEventListener').mockImplementation(((_: string, fn: (state: string) => void) => {
      listeners.push(fn);
      return { remove: () => undefined };
    }) as never);
    await setJournal(app, ids.Billy, [shared('a', '2026-03-02', 'OPEN-ENTRY-TEXT')]);
    await openChild('Billy');
    await press(en('pjOpenEntry', { date: 'Mon, Mar 2' }));
    await settle();
    expect(await RNTL.screen.findByText('OPEN-ENTRY-TEXT')).toBeTruthy();
    await setJournal(app, ids.Billy, [entry('a', '2026-03-02', 'OPEN-ENTRY-TEXT', { visibility: 'private' })]);
    await RNTL.act(async () => {
      listeners.forEach((fn) => fn('active'));
    });
    await settle();
    expect(await RNTL.screen.findByText(en('pjGone'))).toBeTruthy();
    expect(bodyText()).not.toContain('OPEN-ENTRY-TEXT');
  });

  test('nothing is left behind: after the parent area locks, no journal text is on screen, and the entry is not remembered when it opens again', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, [shared('a', '2026-03-02', 'LOCKED-OUT-TEXT')]);
    await openChild('Billy');
    await press(en('pjOpenEntry', { date: 'Mon, Mar 2' }));
    await settle();
    expect(await RNTL.screen.findByText('LOCKED-OUT-TEXT')).toBeTruthy();
    await RNTL.act(async () => {
      app.gate.lockParentArea();
    });
    await settle();
    expect(bodyText()).not.toContain('LOCKED-OUT-TEXT');
    expect(await RNTL.screen.findByText(new RegExp(en('pgTitle')))).toBeTruthy();
    // the child changes it while the parent area is locked: nothing old can come back
    await setJournal(app, ids.Billy, [entry('a', '2026-03-02', 'LOCKED-OUT-TEXT', { visibility: 'private' })]);
    await RNTL.act(async () => {
      await app.gate.unlockParentArea(require('./helpers').TEST_PIN);
    });
    await settle();
    expect(bodyText()).not.toContain('LOCKED-OUT-TEXT');
  });
});

describe('protection, data preservation and translations', () => {
  test('one parent session: opening entries and going back never shows a PIN screen', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, [shared('a', '2026-03-02', 'Hello.')]);
    await openChild('Billy');
    await press(en('pjOpenEntry', { date: 'Mon, Mar 2' }));
    await settle();
    await press(`‹ ${en('pjBack')}`);
    await settle();
    expect(RNTL.screen.queryByText(en('pgSubtitle'))).toBeNull();
  });

  test('looking writes nothing and leaves every record byte for byte as it was: the journals, their sharing choices, Main\'s journal', async () => {
    const { app, ids } = await boot();
    await setJournal(app, ids.Billy, [shared('a', '2026-03-02', 'Shared.'), entry('b', '2026-03-03', 'PRIVATE-B')]);
    await setJournal(app, ids.Sarah, [entry('c', '2026-03-04', 'PRIVATE-C')]);
    await app.AsyncStorage.setItem(`${P}journal`, JSON.stringify([shared('m', '2026-03-01', 'MAIN-JOURNAL')]));
    const before = await app.dump();
    const setItem = jest.spyOn(app.AsyncStorage, 'setItem');
    const removeItem = jest.spyOn(app.AsyncStorage, 'removeItem');
    const getItem = jest.spyOn(app.AsyncStorage, 'getItem');
    for (const spy of [setItem, removeItem, getItem]) spy.mockClear();
    await openChild('Billy');
    await press(en('pjOpenEntry', { date: 'Mon, Mar 2' }));
    await settle();
    await press(`‹ ${en('pjBack')}`);
    await settle();
    const read = getItem.mock.calls.map(([key]) => String(key)); // before the dump below
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(await app.dump()).toEqual(before);
    expect([...new Set(read.filter((key) => key.endsWith(':journal')))]).toEqual([scoped(ids.Billy, 'journal')]); // only Billy's own journal record
    expect(read.filter((key) => key === `${P}journal` || key.includes(ids.Sarah) && key.endsWith(':journal'))).toEqual([]); // never Main's journal, never another child's
    expect(bodyText()).not.toContain('MAIN-JOURNAL');
  });

  test('the same section in Spanish', async () => {
    const { app, ids } = await boot('es');
    await setJournal(app, ids.Billy, [shared('a', '2026-03-02', 'Un día feliz.')]);
    await openChild('Billy', es);
    expect(RNTL.screen.getByText(es('phJournals'))).toBeTruthy();
    const spanishDate = new Date('2026-03-02T00:00:00').toLocaleDateString(i18n().getLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: es('pjOpenEntry', { date: spanishDate }) }));
    await settle();
    expect(await RNTL.screen.findByText('Un día feliz.')).toBeTruthy();
    expect(RNTL.screen.getByText(es('pjReadOnly', { name: 'Billy' }))).toBeTruthy();
    expect(RNTL.screen.getByRole('button', { name: `‹ ${es('pjBack')}` })).toBeTruthy();
  });

  test('every wording exists in both languages and is different between them', () => {
    for (const key of ['pjEmpty', 'pjUnreadable', 'pjShowMore', 'pjOpenEntry', 'pjBack', 'pjGone', 'pjReadOnly']) {
      expect(en(key, { name: 'N', date: 'D' })).not.toBe('');
      expect(es(key, { name: 'N', date: 'D' })).not.toBe('');
      expect(es(key, { name: 'N', date: 'D' })).not.toBe(en(key, { name: 'N', date: 'D' }));
    }
  });
});

describe('where the code may reach', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8').replace(/\/\/.*$/gm, '');
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.resolve(dir), { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) => {
      const rel = `${dir}/${e.name}`;
      return e.isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
    });

  test('the Shared Journals code reads only through the filtered reader and cannot write or change anything', () => {
    const code = read('src/components/child-journal-section.tsx');
    expect(code).toMatch(/from '@\/utils\/journal-sharing'/);
    expect(code).not.toMatch(/from '@\/utils\/journal'/); // never the journal store
    expect(code).not.toMatch(/AsyncStorage|setItem|removeItem|writeScoped|saveReflection|deleteReflection|setReflectionVisibility|TextInput|switchProfile/);
    expect(code).not.toMatch(/\bvisibility\b|isShared|createdAt/); // it never looks at a privacy setting or at metadata: the reader already decided
  });

  test('only that one component uses the reader', () => {
    const users = walk('src').filter((f) => /from '@\/utils\/journal-sharing'/.test(fs.readFileSync(path.resolve(f), 'utf8')));
    expect(users).toEqual(['src/components/child-journal-section.tsx']);
  });

  test('the child overview uses the section and no longer has the "coming soon" placeholder', () => {
    const home = read('src/components/parent-home.tsx');
    expect(home).toMatch(/<ChildJournalSection childId=\{child\.id\}/);
    expect(home).not.toMatch(/phSoon/);
    expect(home).not.toMatch(/from '@\/utils\/journal'/);
  });
});
