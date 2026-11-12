import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, configurePin, freezeClock, loadApp, unfreezeClock, type App } from './helpers';

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

// The room's top controls (Back to Rooms upper left, the task panel upper right, in portrait and landscape), the pet picker / adopt button
// on Home only, Home's "go and check" guide, and the task cards' own interactions (hover, press, keyboard / screen reader, details).
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockState = { path: '/', params: {} as Record<string, string> };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  usePathname: () => mockState.path,
  useLocalSearchParams: () => mockState.params,
  Link: 'Link',
}));

const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => {
  freezeClock(T0);
  mockRouter.push.mockClear();
  mockState.path = '/';
  mockState.params = {};
});
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const H = () => require('@/utils/household') as typeof import('@/utils/household');
const views = () => require('@/components/assigned-task-views') as typeof import('@/components/assigned-task-views');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 25; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const size = (width: number, height: number) => jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width, height, scale: 1, fontScale: 1 });
const flat = (el: { props: { style?: unknown } }) => ReactNative.StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');

async function boot(language: 'en' | 'es' = 'en') {
  jest.doMock('react', () => ReactTop);
  jest.doMock('react-native', () => ReactNative);
  process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
  const app: App = await loadApp();
  await app.profiles.ensureProfilesReady();
  await configurePin(app, { unlocked: true });
  const added = await H().addChild('Billy');
  if (!added.ok || !added.id) throw new Error('child not added');
  await (require('@/utils/family-profiles') as typeof import('@/utils/family-profiles')).reconcileFamilyProfiles();
  i18n().setCurrentLanguage(language);
  return { app, billy: added.id };
}
const assign = async (childId: string, text: string, room?: string) => {
  const result = await H().addTask(childId, text, 'parent', room as never);
  if (!result.ok || !result.id) throw new Error('not assigned');
  return result.id;
};
const status = (childId: string, taskId: string) => H().peekHousehold()!.children.find((c) => c.id === childId)!.tasks.find((t) => t.id === taskId)!.status;
const words = (): string => {
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
const Panel = (props: Record<string, unknown>) => {
  const { RoomTaskPanel } = require('@/components/room-task-panel') as typeof import('@/components/room-task-panel');
  return <RoomTaskPanel roomName="gym" tasks={[]} onToggleTask={() => undefined} onAddTask={() => undefined} {...(props as object)} />;
};

describe('room controls: portrait at the top, landscape at the bottom', () => {
  test('Back to Rooms: top-left in portrait, the original bottom-left in landscape; inside the safe-area view so system bars are cleared', () => {
    const source = read('src/components/room-detail-screen.tsx');
    expect(source.match(/backButtonPortrait: \{[^}]*\}/)![0]).toMatch(/top: Spacing\.two/);
    expect(source.match(/backButtonPortrait: \{[^}]*\}/)![0]).not.toMatch(/bottom/);
    expect(source.match(/backButtonPortraitPhone: \{[^}]*\}/)![0]).not.toMatch(/bottom/);
    expect(source.match(/backButtonLandscape: \{[^}]*\}/)![0]).toMatch(/left: Spacing\.four,\s*bottom: Spacing\.four/); // the original corner
    expect(source.match(/backButtonLandscape: \{[^}]*\}/)![0]).not.toMatch(/top/);
    expect(source.match(/backButtonLandscapePhone: \{[^}]*\}/)![0]).toMatch(/bottom: Spacing\.two/);
    expect(source).toMatch(/const isLandscape = width > height/);
    expect(source).toMatch(/<SafeAreaView style=\{styles\.safeArea\}/);
    expect(source).toMatch(/availableHeight=\{areaHeight\}/);
  });

  test('portrait: the closed panel is a pill at the upper right, no bottom offset (unchanged)', async () => {
    await boot();
    size(390, 800);
    await RNTL.render(<Panel assignedCount={2} availableHeight={680} />);
    const pill = RNTL.screen.getByTestId('room-panel-pill');
    const style = flat(pill);
    expect(style.top).toBeLessThanOrEqual(8);
    expect(style.right).toBeGreaterThan(0);
    expect(style.left).toBeUndefined();
    expect(style.bottom).toBeUndefined();
    expect(String(pill.props.accessibilityLabel)).toMatch(/ 2$/);
    expect(String(pill.props.accessibilityLabel)).not.toContain('+');
    expect(pill.props.accessibilityRole).toBe('button');
  });

  test.each([
    ['landscape phone', 844, 390],
    ['small landscape phone', 640, 360],
  ])('landscape: the closed panel is a pill at the original lower right, no top offset (%s)', async (_name, width, height) => {
    await boot();
    size(width, height);
    await RNTL.render(<Panel assignedCount={2} availableHeight={height - 120} />);
    const style = flat(RNTL.screen.getByTestId('room-panel-pill'));
    expect(style.bottom).toBeGreaterThan(0);
    expect(style.right).toBeGreaterThan(0);
    expect(style.left).toBeUndefined();
    expect(style.top).toBeUndefined();
  });

  test('landscape phone: the open panel is a column at the lower right, inside the safe area (above the navigation bar), scrolling, clear of Back to Rooms at the lower left', async () => {
    await boot();
    size(844, 390);
    await RNTL.render(<Panel availableHeight={270} />);
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('room-panel-pill'));
    const style = flat(RNTL.screen.getByTestId('room-panel'));
    expect(style.bottom).toBeGreaterThan(0);
    expect(style.right).toBeGreaterThan(0);
    expect(style.top).toBeUndefined();
    expect(style.left).toBeUndefined();
    expect(style.width as number).toBeLessThanOrEqual(844 - 200); // leaves the lower left to Back to Rooms
    expect(style.maxHeight as number).toBeLessThanOrEqual(270); // never past the safe area: its bottom edge is the safe area's bottom
    expect(flat(RNTL.screen.getByTestId('room-panel-scroll')).maxHeight as number).toBeLessThan(270); // the list scrolls inside it
  });

  test('portrait phone: the open panel sits right under the top row, full width minus gutters, never over the Back button, scrolling inside the safe area', async () => {
    await boot();
    size(360, 740);
    await RNTL.render(<Panel availableHeight={600} />);
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('room-panel-pill'));
    const style = flat(RNTL.screen.getByTestId('room-panel'));
    const { ROOM_BACK_ROW_HEIGHT, ROOM_TOP_GAP } = require('@/components/room-task-panel') as typeof import('@/components/room-task-panel');
    expect(style.top as number).toBeGreaterThanOrEqual(ROOM_TOP_GAP + ROOM_BACK_ROW_HEIGHT); // below the Back button's row
    expect(style.left).toBeGreaterThan(0);
    expect(style.right).toBeGreaterThan(0);
    expect(style.bottom).toBeUndefined();
    expect((style.top as number) + (style.maxHeight as number)).toBeLessThanOrEqual(600); // inside the safe area (clear of the navigation bar)
    expect(RNTL.screen.getByTestId('room-panel-scroll').props.showsVerticalScrollIndicator).toBe(false);
  });

  test('desktop: still docked at the upper right, always open', async () => {
    await boot();
    size(1200, 800);
    await RNTL.render(<Panel availableHeight={700} />);
    const style = flat(RNTL.screen.getByTestId('room-panel')) as Record<string, unknown>;
    expect(RNTL.screen.queryByTestId('room-panel-pill')).toBeNull();
    expect(style.top as number).toBeLessThanOrEqual(8);
    expect(style.right).toBeGreaterThan(0);
  });

  test('every assigned task, status and button is inside the scrolling area, so none can be out of reach', async () => {
    const { app, billy } = await boot();
    for (let i = 1; i <= 8; i += 1) await assign(billy, `Task number ${i}`, 'gym');
    await app.profiles.switchProfile(billy);
    size(360, 600);
    const { AssignedRoomTasks } = views();
    await RNTL.render(<Panel availableHeight={420} assignedSection={<AssignedRoomTasks room="gym" />} />);
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('room-panel-pill'));
    await settle();
    const scroll = RNTL.screen.getByTestId('room-panel-scroll');
    expect(RNTL.within(scroll).getAllByRole('button', { name: /^I did it: Task number/ })).toHaveLength(8);
    expect(RNTL.within(scroll).getAllByText(en('atToDo'))).toHaveLength(8);
    expect(flat(scroll).maxHeight as number).toBeLessThan(420);
  });

  test('opened from Home\'s guide (a focus value): a collapsed panel opens by itself and shows the assigned tasks', async () => {
    const { app, billy } = await boot();
    await assign(billy, 'Do ten jumping jacks', 'gym');
    await app.profiles.switchProfile(billy);
    size(360, 740);
    const { AssignedRoomTasks } = views();
    await RNTL.render(<Panel focusToken="123" availableHeight={600} assignedSection={<AssignedRoomTasks room="gym" highlight />} />);
    await settle();
    expect(RNTL.screen.queryByTestId('room-panel-pill')).toBeNull();
    expect(RNTL.screen.getByTestId('room-panel')).toBeTruthy();
    expect(words()).toContain('Do ten jumping jacks');
    expect(flat(RNTL.screen.getByTestId('assigned-section')).backgroundColor).toBeTruthy(); // lit up
  });

  test('without a focus value the panel stays closed, and the highlight goes away by itself', async () => {
    const { app, billy } = await boot();
    await assign(billy, 'Do ten jumping jacks', 'gym');
    await app.profiles.switchProfile(billy);
    size(360, 740);
    await RNTL.render(<Panel availableHeight={600} />);
    expect(RNTL.screen.getByTestId('room-panel-pill')).toBeTruthy();
    await RNTL.cleanup();
    const { AssignedRoomTasks, useFocusPulse, FOCUS_HIGHLIGHT_MS } = views();
    function Probe({ token }: { token?: string }) {
      const on = useFocusPulse(token);
      return <AssignedRoomTasks room="gym" highlight={on} />;
    }
    await RNTL.render(<Probe token="1" />);
    await settle();
    expect(flat(RNTL.screen.getByTestId('assigned-section')).backgroundColor).toBeTruthy();
    await RNTL.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, FOCUS_HIGHLIGHT_MS + 200));
    });
    expect(flat(RNTL.screen.getByTestId('assigned-section')).backgroundColor).toBeUndefined();
  });
});

describe('the Room Tasks counter: one number, the tasks that still need the child', () => {
  const pillText = () => String(RNTL.screen.getByTestId('room-panel-pill').props.accessibilityLabel);
  const squashed = () => words().replace(/ \| /g, '');
  const A = () => require('@/utils/assigned-tasks') as typeof import('@/utils/assigned-tasks');
  type Personal = { id: string; text: string; completed: boolean };
  // Renders the panel the way the room screen feeds it: the count passed in is the room's To do + Try again tasks only.
  function Screenish({ room, personal = [] }: { room: string; personal?: Personal[] }) {
    const a = A();
    const { AssignedRoomTasks } = views();
    const here = a.viewsForRoom(a.useAssignedTasks(), room as never);
    return (
      <Panel
        roomName={room}
        tasks={personal.map((p) => ({ ...p, category: 'Personal', important: false }))}
        assignedCount={here.filter(a.isOutstanding).length}
        assignedSection={<AssignedRoomTasks room={room as never} />}
        availableHeight={600}
      />
    );
  }
  async function open(room: string, setup: (billy: string) => Promise<void>, width = 390, height = 800, personal: Personal[] = []) {
    const { app, billy } = await boot();
    await setup(billy);
    await app.profiles.switchProfile(billy);
    size(width, height);
    await RNTL.render(<Screenish room={room} personal={personal} />);
    await settle();
    return { app, billy };
  }
  const count = (text: string) => text.match(/(\d+)$/)?.[1];

  test.each(['study-room', 'gym', 'bedroom', 'bathroom', 'kitchen'])('%s: the examples (3 to do = 3; 2 to do + 1 waiting = 2; 3 waiting = 0; 1 try again + 1 waiting = 1; none = 0)', async (room) => {
    const cases: [string, (billy: string) => Promise<void>, string][] = [
      ['3 to do', async (b) => { for (const n of ['a', 'b', 'c']) await assign(b, n, room); }, '3'],
      ['2 to do + 1 waiting', async (b) => { await assign(b, 'a', room); await assign(b, 'b', room); await H().markTaskDone(b, await assign(b, 'c', room)); }, '2'],
      ['3 waiting', async (b) => { for (const n of ['a', 'b', 'c']) await H().markTaskDone(b, await assign(b, n, room)); }, '0'],
      ['1 try again + 1 waiting', async (b) => { const x = await assign(b, 'a', room); await H().markTaskDone(b, x); await H().sendTaskBack(b, x); await H().markTaskDone(b, await assign(b, 'b', room)); }, '1'],
      ['none', async () => undefined, '0'],
    ];
    for (const [label, setup, expected] of cases) {
      await open(room, setup);
      expect([label, count(pillText())]).toEqual([label, expected]);
      expect([label, squashed().includes('(')]).toEqual([label, false]); // no parentheses...
      expect(squashed()).not.toMatch(/\/|\+\d/); // ...fractions or "+N"
      await RNTL.cleanup();
    }
  });

  test('a waiting task is not counted but stays in the open panel with its status and Undo', async () => {
    await open('gym', async (billy) => {
      await assign(billy, 'Still to do', 'gym');
      await H().markTaskDone(billy, await assign(billy, 'Handed in', 'gym'));
    });
    expect(count(pillText())).toBe('1');
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('room-panel-pill'));
    await settle();
    expect(words()).toContain('Handed in');
    expect(words()).toContain(en('atWaiting'));
    expect(RNTL.screen.getByRole('button', { name: en('atUndoFor', { task: 'Handed in' }) })).toBeTruthy();
    expect(words()).toMatch(/Gym Tasks \| 1/); // the open heading shows the same single number
  });

  test('live: submitting subtracts at once, Undo adds back, the parent sending it back adds it, approval keeps it out; only this room counts', async () => {
    const { app, billy } = await open('gym', async (b) => {
      await assign(b, 'Elsewhere', 'kitchen'); // another room: never counted here
    });
    const id = await assign(billy, 'Counted task', 'gym');
    await settle();
    expect(count(pillText())).toBe('1');
    await RNTL.act(async () => { await A().submitAssignedTask(id); });
    await settle();
    expect(count(pillText())).toBe('0'); // submitted: subtracted immediately
    await RNTL.act(async () => { await A().undoAssignedTask(id); });
    await settle();
    expect(count(pillText())).toBe('1'); // Undo: added back
    await RNTL.act(async () => { await A().submitAssignedTask(id); });
    await RNTL.act(async () => {
      await app.gate.unlockParentArea(require('./helpers').TEST_PIN);
      await H().sendTaskBack(billy, id);
    });
    await settle();
    expect(count(pillText())).toBe('1'); // sent back as Try again: counted again, automatically
    await RNTL.act(async () => { await A().submitAssignedTask(id); });
    await RNTL.act(async () => { await H().approveTask(billy, id); });
    await settle();
    expect(count(pillText())).toBe('0'); // approved: stays out
  });

  test('personal tasks: only the ones not done yet count, added to the assigned To do / Try again ones; completed ones do not', async () => {
    await open(
      'gym',
      async (billy) => {
        await assign(billy, 'Assigned to do', 'gym');
        await H().markTaskDone(billy, await assign(billy, 'Assigned waiting', 'gym'));
      },
      390,
      800,
      [
        { id: 'p1', text: 'Mine open', completed: false },
        { id: 'p2', text: 'Mine open too', completed: false },
        { id: 'p3', text: 'Mine done', completed: true },
      ]
    );
    expect(count(pillText())).toBe('3'); // 2 personal open + 1 assigned to do (waiting and done ones excluded)
  });

  test('landscape: the same single number on the pill, and in the open heading', async () => {
    await open(
      'bedroom',
      async (billy) => {
        await assign(billy, 'One', 'bedroom');
        await assign(billy, 'Two', 'bedroom');
        await H().markTaskDone(billy, await assign(billy, 'Three', 'bedroom'));
      },
      844,
      390
    );
    expect(count(pillText())).toBe('2');
    await RNTL.fireEvent.press(RNTL.screen.getByTestId('room-panel-pill'));
    await settle();
    expect(words()).toMatch(/Bedroom Tasks \| 2/);
  });

  test('source: the screen passes only To do / Try again tasks, and no fraction or "+N" is built any more', () => {
    expect(read('src/components/room-detail-screen.tsx')).toMatch(/assignedCount=\{assignedHere\.filter\(isOutstanding\)\.length\}/);
    const panel = read('src/components/room-task-panel.tsx');
    expect(panel).toMatch(/const needAttention = totalCount - completedCount \+ assignedCount/);
    expect(panel).not.toMatch(/\}\/\{|\+\$\{assignedCount\}/);
  });
});

describe('the pet picker and the adopt button are on Home only', () => {
  async function bar(path: string, language: 'en' | 'es' = 'en') {
    const { app } = await boot(language);
    mockState.path = path;
    size(390, 800);
    const { PetFamilyBar } = require('@/components/pet-family-bar') as typeof import('@/components/pet-family-bar');
    await RNTL.render(<PetFamilyBar />);
    await settle();
    return app;
  }
  const adopt = (language: 'en' | 'es' = 'en') => (language === 'en' ? en : es)('adoptEggLabel');

  test('Home shows the picker and "Adopt an egg"', async () => {
    await bar('/');
    expect(RNTL.screen.queryAllByRole('button', { name: adopt() })).toHaveLength(1);
    expect(RNTL.screen.queryAllByRole('button', { name: /^Kitty/ }).length).toBeGreaterThan(0);
  });

  test.each(['/tasks', '/rooms', '/rooms/gym', '/rooms/study-room', '/rooms/bedroom', '/rooms/bathroom', '/rooms/kitchen', '/shop', '/stats', '/stats/tasks'])(
    '%s shows neither',
    async (path) => {
      await bar(path);
      expect(RNTL.screen.queryAllByRole('button', { name: adopt() })).toHaveLength(0);
      expect(RNTL.screen.queryAllByRole('button')).toHaveLength(0);
    }
  );

  test('off Home, with no warning to show, the bar renders nothing at all (no empty strip under the Rooms header); Home still renders it', async () => {
    await bar('/rooms');
    expect(RNTL.screen.toJSON()).toBeNull();
    await RNTL.cleanup();
    mockState.path = '/';
    const { PetFamilyBar } = require('@/components/pet-family-bar') as typeof import('@/components/pet-family-bar');
    await RNTL.render(<PetFamilyBar />);
    await settle();
    expect(RNTL.screen.toJSON()).not.toBeNull();
  });

  test('Spanish: same (button on Home only)', async () => {
    await bar('/', 'es');
    expect(RNTL.screen.queryAllByRole('button', { name: adopt('es') })).toHaveLength(1);
    await RNTL.cleanup();
    mockState.path = '/rooms/gym';
    const { PetFamilyBar } = require('@/components/pet-family-bar') as typeof import('@/components/pet-family-bar');
    await RNTL.render(<PetFamilyBar />);
    await settle();
    expect(RNTL.screen.queryAllByRole('button', { name: adopt('es') })).toHaveLength(0);
  });

  test('hiding is only on screen: nothing about pets or adopting is removed from the code or the saved data', async () => {
    const app = await bar('/');
    const before = [...(await app.dump()).entries()];
    mockState.path = '/rooms/gym';
    await RNTL.cleanup();
    const { PetFamilyBar } = require('@/components/pet-family-bar') as typeof import('@/components/pet-family-bar');
    await RNTL.render(<PetFamilyBar />);
    await settle();
    expect([...(await app.dump()).entries()].filter(([key]) => /pet/i.test(key))).toEqual(before.filter(([key]) => /pet/i.test(key)));
    const source = read('src/components/pet-family-bar.tsx');
    expect(source).toMatch(/adoptNewEgg/);
    expect(source).toMatch(/selectPet/);
    // the health and memorial banners are not part of what is hidden
    expect(source).toMatch(/accessibilityRole="alert"/);
  });
});

describe('Home: the parent\'s tasks as compact rows in "Today\'s Tasks"', () => {
  const rowName = (task: string, state: string, from: string) => en('atHomeRowLabel', { task, state, from });

  test('one row per task (title, "From my parent" with the room, status), none duplicated, waiting ones kept; no action buttons', async () => {
    const { app, billy } = await boot();
    await assign(billy, 'Gym task one', 'gym');
    await assign(billy, 'Gym task two', 'gym');
    const kitchen = await assign(billy, 'Wash the dishes', 'kitchen');
    const back = await assign(billy, 'Make the bed', 'bedroom');
    await assign(billy, 'Water the plants');
    await H().markTaskDone(billy, kitchen);
    await H().markTaskDone(billy, back);
    await H().sendTaskBack(billy, back);
    await app.profiles.switchProfile(billy);
    const { AssignedHomeRows } = views();
    await RNTL.render(<AssignedHomeRows />);
    await settle();
    const text = words();
    for (const title of ['Gym task one', 'Gym task two', 'Wash the dishes', 'Make the bed', 'Water the plants']) expect(text.split(title).length - 1).toBe(1);
    expect(text).toContain(en('atFromParentRoom', { room: 'Gym' }));
    expect(text).toContain(en('atFromParentRoom', { room: 'Kitchen' }));
    expect(text).toContain(en('atFromParent'));
    expect(text).toContain(en('atToDo'));
    expect(text).toContain(en('atSentBack'));
    expect(text).toContain(en('atWaiting'));
    expect(text).not.toContain(en('atDone')); // no "I did it!" or Undo here: those are in the room and the Tasks tab
    expect(text).not.toContain(en('atUndo'));
    const labels = RNTL.screen.queryAllByRole('button').map((b) => String(b.props.accessibilityLabel));
    expect(labels).toHaveLength(5);
    expect(labels).toContain(rowName('Wash the dishes', en('atWaiting'), en('atFromParentRoom', { room: 'Kitchen' })));
    expect(labels).toContain(rowName('Make the bed', en('atSentBack'), en('atFromParentRoom', { room: 'Bedroom' })));
  });

  test('tapping a room task goes straight to its room with a fresh focus (two taps, two values); an Anywhere task goes to the Tasks tab', async () => {
    const { app, billy } = await boot();
    await assign(billy, 'Gym task', 'gym');
    await assign(billy, 'Water the plants');
    await app.profiles.switchProfile(billy);
    const { AssignedHomeRows } = views();
    await RNTL.render(<AssignedHomeRows />);
    await settle();
    const gym = RNTL.screen.getByRole('button', { name: rowName('Gym task', en('atToDo'), en('atFromParentRoom', { room: 'Gym' })) });
    await RNTL.fireEvent.press(gym);
    jest.setSystemTime(T0 + 5);
    await RNTL.fireEvent.press(gym);
    const calls = mockRouter.push.mock.calls.map((c) => c[0]);
    expect(calls).toHaveLength(2);
    for (const call of calls) expect(call).toMatchObject({ pathname: '/rooms/[room]', params: { room: 'gym' } });
    expect(calls[0].params.focus).not.toBe(calls[1].params.focus);
    mockRouter.push.mockClear();
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: rowName('Water the plants', en('atToDo'), en('atFromParent')) }));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/tasks', params: { focus: expect.any(String) } });
  });

  test('the Tasks tab lights up "Today\'s Tasks" when opened from Home (a focus value), and not otherwise', async () => {
    const { app, billy } = await boot();
    await assign(billy, 'Water the plants');
    await app.profiles.switchProfile(billy);
    const { AssignedAllTasks } = views();
    mockState.params = { focus: '99' };
    await RNTL.render(<AssignedAllTasks />);
    await settle();
    expect(words()).toContain(en('atTitle'));
    expect(flat(RNTL.screen.getByTestId('assigned-section')).backgroundColor).toBeTruthy();
    await RNTL.cleanup();
    mockState.params = {};
    await RNTL.render(<AssignedAllTasks />);
    await settle();
    expect(flat(RNTL.screen.getByTestId('assigned-section')).backgroundColor).toBeUndefined();
  });

  test('Spanish rows', async () => {
    const { app, billy } = await boot('es');
    await assign(billy, 'Algo', 'bedroom');
    await assign(billy, 'Otra cosa');
    await app.profiles.switchProfile(billy);
    const { AssignedHomeRows } = views();
    await RNTL.render(<AssignedHomeRows />);
    await settle();
    expect(words()).toContain(es('atFromParentRoom', { room: 'Dormitorio' }));
    expect(words()).toContain(es('atFromParent'));
    expect(words()).toContain(es('atToDo'));
  });

  test('the Tasks screen and the room route hand the focus on (source check)', () => {
    expect(read('src/app/tasks.tsx')).toMatch(/<AssignedAllTasks scrollRef=\{scrollRef\} embedded \/>/);
    expect(read('src/app/rooms/[room].tsx')).toMatch(/focusToken=/);
  });
});

describe('task cards: hover, press, keyboard and screen readers', () => {
  async function renderCards() {
    const { app, billy } = await boot();
    const id = await assign(billy, 'A fairly long task title that should show in full once the card is opened for details', 'gym');
    await app.profiles.switchProfile(billy);
    const { AssignedAllTasks } = views();
    await RNTL.render(<AssignedAllTasks />);
    await settle();
    return { billy, id };
  }

  test('tapping the card opens and closes its details and never hands in or undoes the task', async () => {
    const { billy, id } = await renderCards();
    const card = RNTL.screen.getByTestId(`assigned-card-${id}`);
    expect(card.props.accessibilityState.expanded).toBe(false);
    await RNTL.fireEvent.press(card);
    expect(RNTL.screen.getByTestId(`assigned-card-${id}`).props.accessibilityState.expanded).toBe(true);
    expect(status(billy, id)).toBe('assigned');
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`assigned-card-${id}`));
    expect(RNTL.screen.getByTestId(`assigned-card-${id}`).props.accessibilityState.expanded).toBe(false);
    expect(status(billy, id)).toBe('assigned');
    // and the other way round: the button submits without opening the card
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: /^I did it: / }));
    await settle();
    expect(status(billy, id)).toBe('pending');
    expect(RNTL.screen.getByTestId(`assigned-card-${id}`).props.accessibilityState.expanded).toBe(false);
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`assigned-card-${id}`));
    expect(status(billy, id)).toBe('pending'); // tapping the words does not undo it either
    await RNTL.fireEvent.press(RNTL.screen.getByRole('button', { name: /^Undo: / }));
    await settle();
    expect(status(billy, id)).toBe('assigned');
  });

  test('the button stays in the same place whether or not the details are open', async () => {
    const { id } = await renderCards();
    const before = RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel));
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`assigned-card-${id}`));
    const after = RNTL.screen.getAllByRole('button').map((b) => String(b.props.accessibilityLabel));
    expect(after.filter((l) => l.startsWith('I did it'))).toEqual(before.filter((l) => l.startsWith('I did it')));
    expect(after.indexOf(after.find((l) => l.startsWith('I did it'))!)).toBe(before.indexOf(before.find((l) => l.startsWith('I did it'))!));
  });

  test('screen readers: the card is a button with a spoken name (task and status), an expanded state and a hint; the action button has its own name', async () => {
    const { id } = await renderCards();
    const card = RNTL.screen.getByTestId(`assigned-card-${id}`);
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe(en('atCardLabel', { task: 'A fairly long task title that should show in full once the card is opened for details', state: en('atToDo') }));
    expect(card.props.accessibilityHint).toBe(en('atCardHintOpen'));
    expect(card.props.accessible).not.toBe(false);
    await RNTL.fireEvent.press(card);
    expect(RNTL.screen.getByTestId(`assigned-card-${id}`).props.accessibilityHint).toBe(en('atCardHintClose'));
    // the card and the action are SIDE BY SIDE controls (not one inside the other), so both can be reached by touch exploration and the keyboard
    expect(RNTL.within(RNTL.screen.getByTestId(`assigned-card-${id}`)).queryAllByRole('button')).toEqual([]);
    expect(RNTL.screen.getAllByRole('button')).toHaveLength(2);
  });

  test('keyboard: both controls are focusable and answer the same activation (press) as a tap', async () => {
    const { id } = await renderCards();
    for (const control of [RNTL.screen.getByTestId(`assigned-card-${id}`), RNTL.screen.getByRole('button', { name: /^I did it: / })]) {
      expect(control.props.focusable).not.toBe(false);
      expect(control.props.accessibilityRole).toBe('button');
    }
  });

  test('hover and press: a soft tint on the card under the mouse, a deeper one while pressed (touch)', async () => {
    const { id } = await renderCards();
    const card = RNTL.screen.getByTestId(`assigned-card-${id}`);
    const source = read('src/components/assigned-task-views.tsx');
    expect(source).toMatch(/hovered === true && styles\.rowHover/);
    expect(source).toMatch(/state\.pressed && styles\.rowPressed/);
    expect(flat(card).backgroundColor).toBeUndefined(); // at rest: no tint
  });

  test('the open card shows the room as well as the status; Spanish labels exist for every new string', async () => {
    const { id } = await renderCards();
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`assigned-card-${id}`));
    expect(words()).toContain(en('atParentRoomLine', { room: 'Gym' }));
    for (const key of ['atFromParentRoom', 'atFromParent', 'atCardHintOpen', 'atCardHintClose'] as const) {
      expect(en(key, { room: 'x', task: 'x', state: 'x' })).not.toBe(es(key, { room: 'x', task: 'x', state: 'x' }));
    }
  });
});

describe('what stays as it was', () => {
  test('statuses, undo, approval and the tab number are unchanged by the new layout', async () => {
    const { app, billy } = await boot();
    const a = await assign(billy, 'First', 'gym');
    const b = await assign(billy, 'Second', 'bedroom');
    await app.profiles.switchProfile(billy);
    const A = require('@/utils/assigned-tasks') as typeof import('@/utils/assigned-tasks');
    const total = () => A.outstandingTotal(A.assignedTasksFor(H().peekHousehold(), billy));
    expect(total()).toBe(2);
    expect(await A.submitAssignedTask(a)).toBe('sent');
    expect(total()).toBe(1); // waiting does not count
    expect(await A.undoAssignedTask(a)).toBe('undone');
    expect(total()).toBe(2);
    expect(await A.submitAssignedTask(b)).toBe('sent');
    await app.gate.unlockParentArea(require('./helpers').TEST_PIN);
    await H().approveTask(billy, b);
    expect(total()).toBe(1);
    expect(await A.undoAssignedTask(b)).not.toBe('undone');
    expect(status(billy, b)).toBe('approved');
  });
});
