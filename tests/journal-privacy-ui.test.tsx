import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { translate } from '@/i18n';
import { todayISO } from '@/utils/tasks';

import { flush } from './helpers';

// The Private / Shared choice on the daily reflection: only a child profile in family mode has it.
// (The profile the screen is shown for is stood in by the mocks below; the journal storage itself is the real one.)
const mockProfile: { id: string; kind: 'main' | 'child' } = { id: 'kid1', kind: 'child' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => '/stats/mood',
  Link: 'Link',
}));
jest.mock('@/hooks/use-active-profile', () => ({ useActiveProfileId: () => mockProfile.id }));
jest.mock('@/utils/dev-flags', () => ({ ...jest.requireActual('@/utils/dev-flags'), FAMILY_MODE_ENABLED: true }));
jest.mock('@/utils/profiles', () => {
  const actual = jest.requireActual('@/utils/profiles');
  return {
    ...actual,
    getProfilesStatus: () => ({ ...actual.getProfilesStatus(), profiles: [{ id: mockProfile.id, kind: mockProfile.kind, storage: 'scoped', createdAt: '' }] }),
  };
});

type Storage = typeof import('@react-native-async-storage/async-storage').default;
let AsyncStorage: Storage;
let language: 'en' | 'es' = 'en';
const JOURNAL = '@ProductivityPet:journal';
const en = (key: Parameters<typeof translate>[1]) => translate('en', key);
const es = (key: Parameters<typeof translate>[1]) => translate('es', key);
const today = () => todayISO();
const stored = async () => JSON.parse((await AsyncStorage.getItem(JOURNAL)) ?? '[]');
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));
const toggle = (lang: 'en' | 'es' = 'en') => screen.getByRole('switch', { name: (lang === 'en' ? en : es)('mjShareLabel') });
const editor = () => screen.getByPlaceholderText(en('mjReflectionPlaceholder'));
const settle = () =>
  act(async () => {
    await flush();
  });

// Every test starts from a fresh copy of the app's modules (the journal keeps a cache), with React and the renderer kept as the one copy.
async function openScreen(entries: object[] = []) {
  jest.resetModules();
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  const storageModule = require('@react-native-async-storage/async-storage');
  AsyncStorage = storageModule.default ?? storageModule;
  await AsyncStorage.clear();
  if (entries.length) await AsyncStorage.setItem(JOURNAL, JSON.stringify(entries));
  (require('@/i18n') as typeof import('@/i18n')).setCurrentLanguage(language);
  const { MoodJourneyScreen } = require('@/components/mood-journey-screen') as typeof import('@/components/mood-journey-screen');
  await render(<MoodJourneyScreen />);
  await settle();
}
const mine = (extra: object = {}) => ({ id: 'e1', dateISO: today(), text: 'my day', createdAt: '2026-03-10T10:00:00.000Z', updatedAt: '2026-03-10T10:00:00.000Z', ...extra });

beforeEach(() => {
  mockProfile.id = 'kid1';
  mockProfile.kind = 'child';
  language = 'en';
});

describe('who gets the choice', () => {
  test('a child profile in family mode', async () => {
    await openScreen();
    expect(toggle()).toBeTruthy();
    expect(screen.getByText(en('mjPrivateExplain'))).toBeTruthy(); // a new entry starts private
  });

  test.each([
    [
      'Main',
      () => {
        mockProfile.id = 'main';
        mockProfile.kind = 'main';
      },
    ],
  ])('not %s', async (_name, setup) => {
    setup();
    await openScreen([mine({ visibility: 'shared' })]);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByText(en('mjShared'))).toBeNull();
    expect(screen.queryByText(en('mjPrivate'))).toBeNull();
  });
});

test('with family mode off (every real user today) the screen has no sharing choice at all', () => {
  const code = require('fs').readFileSync(require('path').resolve('src/components/mood-journey-screen.tsx'), 'utf8');
  expect(code).toMatch(/const canShare = FAMILY_MODE_ENABLED &&/);
});

describe('sharing', () => {
  test('picking Shared explains that a parent can read it, and nothing is shared until Save', async () => {
    await openScreen();
    await fireEvent.changeText(editor(), 'for my parent');
    await fireEvent.press(toggle());
    expect(screen.getByText(en('mjShareNeedsSave'))).toBeTruthy();
    expect(await stored()).toEqual([]); // not even saved yet
    await press(en('mjSave'));
    await settle();
    expect((await stored())[0]).toMatchObject({ text: 'for my parent', visibility: 'shared' });
    expect(screen.getByText(en('mjSharedExplain'))).toBeTruthy();
  });

  test('picking Shared on a saved private entry still shares nothing until Save', async () => {
    await openScreen([mine()]);
    await fireEvent.press(toggle());
    expect((await stored())[0].visibility).toBeUndefined(); // untouched
    await press(en('mjUpdate'));
    await settle();
    expect((await stored())[0].visibility).toBe('shared');
  });

  test('without touching the choice, saving a new entry keeps it private', async () => {
    await openScreen();
    await fireEvent.changeText(editor(), 'just me');
    await press(en('mjSave'));
    await settle();
    expect((await stored())[0].visibility).toBe('private');
  });
});

describe('making a shared entry private again', () => {
  test('it is saved at once, confirmed on screen, and the child does not need to save the text', async () => {
    await openScreen([mine({ visibility: 'shared' })]);
    expect(screen.getByText(en('mjSharedExplain'))).toBeTruthy();
    await fireEvent.press(toggle());
    await settle();
    expect((await stored())[0]).toMatchObject({ text: 'my day', visibility: 'private' });
    expect(screen.getByText(en('mjNowPrivate'))).toBeTruthy();
    expect(screen.getByText(en('mjPrivateExplain'))).toBeTruthy();
  });

  test('unsaved text in the editor is kept: not saved, not discarded', async () => {
    await openScreen([mine({ visibility: 'shared' })]);
    await fireEvent.changeText(editor(), 'my day, and a half-written new thought');
    await fireEvent.press(toggle());
    await settle();
    const [record] = await stored();
    expect(record.visibility).toBe('private');
    expect(record.text).toBe('my day'); // the stored words did not change
    expect(editor().props.value).toBe('my day, and a half-written new thought'); // and the draft is still there
  });

  test('when it cannot be saved it still says shared, and says so', async () => {
    await openScreen([mine({ visibility: 'shared' })]);
    const original = AsyncStorage.setItem;
    (AsyncStorage as unknown as { setItem: unknown }).setItem = jest.fn(async () => {
      throw new Error('disk full');
    });
    await fireEvent.press(toggle());
    await settle();
    (AsyncStorage as unknown as { setItem: unknown }).setItem = original;
    expect(screen.getByText(en('mjPrivacyFailed'))).toBeTruthy();
    expect(screen.getByText(en('mjSharedExplain'))).toBeTruthy(); // still shown as shared, like what is stored
    expect((await stored())[0].visibility).toBe('shared');
  });
});

describe('the history list and Spanish', () => {
  test('each entry is marked Private or Shared', async () => {
    await openScreen([mine({ visibility: 'shared' }), mine({ id: 'e0', dateISO: '2026-01-01', text: 'older' })]);
    expect(screen.getAllByText(en('mjShared')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(en('mjPrivate')).length).toBeGreaterThan(0);
  });

  test('the same choice in Spanish', async () => {
    language = 'es';
    await openScreen();
    expect(toggle('es')).toBeTruthy();
    expect(screen.getByText(es('mjPrivateExplain'))).toBeTruthy();
    await fireEvent.press(toggle('es'));
    expect(screen.getByText(es('mjShareNeedsSave'))).toBeTruthy();
  });
});
