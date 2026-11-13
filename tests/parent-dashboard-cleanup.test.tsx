import * as ReactNative from 'react-native';
import * as ReactTop from 'react';
import * as RNTL from '@testing-library/react-native';

import { T0, TEST_PIN, configurePin, freezeClock, loadApp, unfreezeClock, type App } from './helpers';

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

// The Parent Dashboard's cleanup round: complete child cards (their own Rename / Archive / Resume inside), a lean rewards card, "<Name>'s Tasks",
// no preview controls, no explanation under the approval setting, and Pet Safety with a short info note instead of an orange paragraph.
const originalFamilyMode = process.env.EXPO_PUBLIC_FAMILY_MODE;
beforeEach(() => {
  freezeClock(T0);
});
afterEach(() => {
  unfreezeClock();
  if (originalFamilyMode === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
  else process.env.EXPO_PUBLIC_FAMILY_MODE = originalFamilyMode;
  jest.restoreAllMocks();
});

const H = () => require('@/utils/household') as typeof import('@/utils/household');
const A = () => require('@/utils/assigned-tasks') as typeof import('@/utils/assigned-tasks');
const R = () => require('@/utils/household-rewards') as typeof import('@/utils/household-rewards');
const i18n = () => require('@/i18n') as typeof import('@/i18n');
const en = (key: string, params?: Record<string, string | number>) => i18n().translate('en', key as never, params as never);
const es = (key: string, params?: Record<string, string | number>) => i18n().translate('es', key as never, params as never);
const settle = () =>
  RNTL.act(async () => {
    for (let i = 0; i < 30; i += 1) await new Promise<void>((resolve) => setImmediate(() => resolve()));
  });
const read = (rel: string): string => require('fs').readFileSync(require('path').resolve(rel), 'utf8');
const code = (rel: string): string => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
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
const press = async (name: string | RegExp) => {
  await RNTL.fireEvent.press(RNTL.screen.getAllByRole('button', { name })[0]);
  await settle();
};
const enter = async (app: App, id: string) => expect(await app.profiles.switchProfile(id)).toMatchObject({ ok: true });
const child = (id: string) => H().peekHousehold()!.children.find((c) => c.id === id)!;
const task = (childId: string, id: string) => child(childId).tasks.find((t) => t.id === id)!;

async function boot(language: 'en' | 'es' = 'en') {
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
  i18n().setCurrentLanguage(language);
  await enter(app, 'main');
  await H().selectChild(ids.Billy);
  return { app, ids };
}
async function dashboard(language: 'en' | 'es' = 'en') {
  const ctx = await boot(language);
  const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
  await RNTL.render(<ParentDashboard />);
  await settle();
  return ctx;
}
const box = (id: string) => RNTL.within(RNTL.screen.getByTestId(`child-card-box-${id}`));

describe('child profile cards', () => {
  test('each child has one complete card with their own Rename and Archive inside it; the actions belong to the card they are in', async () => {
    const { ids } = await dashboard();
    for (const name of ['Billy', 'Sarah']) {
      const inside = box(ids[name]);
      expect(inside.getByText(name)).toBeTruthy();
      expect(inside.getByRole('button', { name: en('fmRenameLabel', { name }) })).toBeTruthy();
      expect(inside.getByRole('button', { name: en('fmArchiveLabel', { name }) })).toBeTruthy();
      expect(inside.getByTestId(`child-card-${ids[name]}`)).toBeTruthy(); // the card's own selection control
    }
    // and none of one child's buttons is inside the other child's card
    expect(box(ids.Billy).queryByRole('button', { name: en('fmRenameLabel', { name: 'Sarah' }) })).toBeNull();
    expect(box(ids.Sarah).queryByRole('button', { name: en('fmArchiveLabel', { name: 'Billy' }) })).toBeNull();
  });

  test('the cards are stacked as columns (nothing sits beside or outside a card), and "Add a child" comes after every card', async () => {
    const { ids } = await dashboard();
    const text = words();
    const billy = text.indexOf('Billy');
    const sarah = text.indexOf('Sarah');
    const add = text.indexOf(`＋ ${en('addChild')}`);
    expect(billy).toBeLessThan(sarah);
    expect(sarah).toBeLessThan(add); // Add a child is below both cards
    const source = code('src/components/family-management-card.tsx');
    expect(source).toMatch(/childCard: \{[^}]*alignSelf: 'stretch'/);
    expect(source).toMatch(/cardActions: \{ flexDirection: 'row', flexWrap: 'wrap'/); // the buttons wrap inside the card instead of spilling out
    expect(source).toMatch(/cardBody: \{ gap: Spacing\.two, minWidth: 0 \}/);
    expect(source).not.toMatch(/childRow\b/);
    expect(ids.Billy).toBeTruthy();
  });

  test('tapping anywhere on a card selects that child (check + highlight on the selected one); no Selected / Select button', async () => {
    const { ids } = await dashboard();
    expect(RNTL.screen.queryByRole('button', { name: /^Select(ed)?$/ })).toBeNull();
    expect(RNTL.screen.getByTestId(`child-selected-${ids.Billy}`, { hidden: true })).toBeTruthy();
    expect(RNTL.screen.queryByTestId(`child-selected-${ids.Sarah}`, { hidden: true })).toBeNull();
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`child-card-${ids.Sarah}`));
    await settle();
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Sarah);
    expect(RNTL.screen.getByTestId(`child-selected-${ids.Sarah}`, { hidden: true })).toBeTruthy();
    expect(RNTL.screen.queryByTestId(`child-selected-${ids.Billy}`, { hidden: true })).toBeNull();
    expect(RNTL.screen.getByTestId(`child-card-${ids.Sarah}`).props.accessibilityState).toMatchObject({ selected: true, checked: true });
  });

  test('Rename applies only to the child whose card it is in, whoever is selected; a wrong target is impossible', async () => {
    const { ids } = await dashboard();
    await RNTL.fireEvent.press(box(ids.Sarah).getByRole('button', { name: en('fmRenameLabel', { name: 'Sarah' }) }));
    await settle();
    await RNTL.fireEvent.changeText(RNTL.screen.getByLabelText(en('fmNewName')), 'Sally');
    await press(en('saveChild'));
    expect(child(ids.Sarah).nickname).toBe('Sally');
    expect(child(ids.Billy).nickname).toBe('Billy');
    expect(H().peekHousehold()!.selectedChildId).toBe(ids.Billy); // renaming did not change the selection
    expect(box(ids.Sarah).getByText('Sally')).toBeTruthy();
  });

  test('Archive asks first (with the protections); cancel changes nothing; confirming archives only that child, and Resume inside their card brings them back', async () => {
    const { ids } = await dashboard();
    await RNTL.fireEvent.press(box(ids.Sarah).getByRole('button', { name: en('fmArchiveLabel', { name: 'Sarah' }) }));
    await settle();
    expect(RNTL.screen.getByText(en('fmArchiveTitle', { name: 'Sarah' }))).toBeTruthy();
    expect(RNTL.screen.getByText(en('fmArchiveSaved', { name: 'Sarah' }))).toBeTruthy(); // nothing is deleted
    expect(RNTL.screen.getByText(en('fmArchiveAging'))).toBeTruthy(); // pets keep aging
    await press(en('cancel') === 'Cancel' ? 'Cancel' : en('cancel'));
    expect(H().isChildArchived(child(ids.Sarah))).toBe(false);
    await RNTL.fireEvent.press(box(ids.Sarah).getByRole('button', { name: en('fmArchiveLabel', { name: 'Sarah' }) }));
    await settle();
    await press(en('fmArchiveConfirm', { name: 'Sarah' }));
    expect(H().isChildArchived(child(ids.Sarah))).toBe(true);
    expect(H().isChildArchived(child(ids.Billy))).toBe(false);
    // the archived child shows under "Archived children", in a card of their own, with Resume inside it
    await press(en('fmArchivedShow', { count: 1 }));
    const archivedCard = box(ids.Sarah);
    expect(archivedCard.getByRole('button', { name: en('fmRestoreLabel', { name: 'Sarah' }) })).toBeTruthy();
    expect(en('fmRestore')).toBe('Resume');
    expect(archivedCard.queryByRole('button', { name: en('fmArchiveLabel', { name: 'Sarah' }) })).toBeNull();
    await RNTL.fireEvent.press(archivedCard.getByRole('button', { name: en('fmRestoreLabel', { name: 'Sarah' }) }));
    await settle();
    expect(H().isChildArchived(child(ids.Sarah))).toBe(false);
    expect(child(ids.Billy).nickname).toBe('Billy'); // nobody else was touched
  });

  test('parent-only: with the parent area locked, Rename and Archive change nothing', async () => {
    const { app, ids } = await dashboard();
    app.gate.lockParentArea();
    await RNTL.fireEvent.press(box(ids.Sarah).getByRole('button', { name: en('fmArchiveLabel', { name: 'Sarah' }) }));
    await settle();
    const confirm = RNTL.screen.queryAllByRole('button', { name: en('fmArchiveConfirm', { name: 'Sarah' }) });
    if (confirm.length > 0) {
      await RNTL.fireEvent.press(confirm[0]);
      await settle();
    }
    expect(H().isChildArchived(child(ids.Sarah))).toBe(false);
    expect(child(ids.Sarah).nickname).toBe('Sarah');
  });

  test('selecting never switches who is playing', async () => {
    const { app, ids } = await dashboard();
    const before = app.profiles.getActiveProfileId();
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`child-card-${ids.Sarah}`));
    await settle();
    expect(app.profiles.getActiveProfileId()).toBe(before);
  });
});

describe('Paw Token Rewards card', () => {
  test('only the heading, the two amounts, the minus / plus controls, Save and Set as Default: no paragraph, no "Now" line', async () => {
    await dashboard();
    const text = words();
    expect(text).toContain(en('rwTitle'));
    expect(text).toContain(en('rwRegular'));
    expect(text).toContain(en('rwImportant'));
    expect(text).not.toMatch(/Choose the amounts|tap Save|new tasks start/i);
    expect(text).not.toMatch(/Now: Regular/);
    expect(RNTL.screen.getAllByRole('button', { name: en('rwMoreFor', { kind: en('rwRegular') }) }).length).toBeGreaterThan(0);
    expect(RNTL.screen.getAllByRole('button', { name: en('rwFewerFor', { kind: en('rwImportant') }) }).length).toBeGreaterThan(0);
    expect(RNTL.screen.getAllByRole('button', { name: en('rwSave') })).toHaveLength(1);
    expect(RNTL.screen.getAllByRole('button', { name: en('rwSetDefault') })).toHaveLength(1);
    expect(JSON.stringify(require('@/i18n/rewards.en'))).not.toContain('rwHelp');
  });

  test('behaviour unchanged: Save keeps the amounts, Set as Default restores 5 and 10, existing tasks keep their rewards', async () => {
    const { ids } = await dashboard();
    const before = await H().addTask(ids.Billy, 'Existing', 'parent', undefined, { reward: 40 });
    await RNTL.fireEvent.press(RNTL.screen.getAllByRole('button', { name: en('rwMoreFor', { kind: en('rwRegular') }) })[0]);
    await press(en('rwSave'));
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 6, important: 10 });
    await press(en('rwSetDefault'));
    expect(H().getRewardSettings(H().peekHousehold())).toEqual({ regular: 5, important: 10 });
    expect(task(ids.Billy, (before as { id?: string }).id as string).reward).toBe(40);
  });
});

describe('"<Name>\'s Tasks" and no preview controls', () => {
  test('the heading shows the selected child\'s name and follows the selection; each child only sees their own tasks', async () => {
    const { ids } = await dashboard();
    await H().addTask(ids.Billy, 'Billy chore', 'parent');
    await H().addTask(ids.Sarah, 'Sarah chore', 'parent');
    await settle();
    expect(words()).toContain("Billy's Tasks");
    expect(words()).not.toContain('Household Tasks');
    expect(words()).toContain('Billy chore');
    expect(words()).not.toContain('Sarah chore');
    await RNTL.fireEvent.press(RNTL.screen.getByTestId(`child-card-${ids.Sarah}`));
    await settle();
    expect(words()).toContain("Sarah's Tasks");
    expect(words()).not.toContain("Billy's Tasks");
    expect(words()).toContain('Sarah chore');
    expect(words()).not.toContain('Billy chore');
  });

  test('Spanish heading', async () => {
    await dashboard('es');
    expect(words()).toContain('Tareas de Billy');
  });

  test('no preview button, text or "add as child" control anywhere on the dashboard', async () => {
    const { ids } = await dashboard();
    await H().updateChildSettings(ids.Billy, { canCreateTasks: true }); // the setting that used to add a preview-add button
    await H().addTask(ids.Billy, 'Some chore', 'parent');
    await settle();
    expect(words()).not.toMatch(/Preview/i);
    expect(RNTL.screen.queryAllByRole('button', { name: /Preview/i })).toEqual([]);
    expect(words()).not.toMatch(/pretends to be the child|for testing/i);
    for (const lang of ['en', 'es'] as const) {
      const all = JSON.stringify(require(`@/i18n/${lang}`));
      expect(all).not.toContain('previewAsChild');
      expect(all).not.toContain('previewNote');
    }
    const source = code('src/components/parent-dashboard.tsx');
    expect(source).not.toMatch(/markTaskDone|previewAsChild|submitTask\('child'\)/);
  });

  test('the real flow: assigned = To do for the child (not waiting) -> I did it! -> waiting for your approval with Approve / Try again -> approved pays the child', async () => {
    const { app, ids } = await dashboard();
    const added = await H().addTask(ids.Billy, 'Flow task', 'parent', undefined, { reward: 6 });
    const id = (added as { id?: string }).id as string;
    await settle();
    // just assigned: To do, with no Approve / Try again for it (nothing is waiting)
    expect(task(ids.Billy, id).status).toBe('assigned');
    expect(RNTL.screen.queryAllByRole('button', { name: `${en('approve')}: Flow task` })).toEqual([]);
    expect(words()).not.toContain(en('waitingForApproval'));
    expect(words()).toContain(en('hhToDo'));
    // the child hands it in
    await RNTL.cleanup();
    await enter(app, ids.Billy);
    expect(await A().submitAssignedTask(id)).toBe('sent');
    expect(task(ids.Billy, id).status).toBe('pending');
    expect(await R().collectHouseholdRewards()).toBe(0); // nothing paid yet
    // the parent sees it waiting
    await enter(app, 'main');
    await H().selectChild(ids.Billy);
    const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
    await RNTL.render(<ParentDashboard />);
    await settle();
    expect(words()).toContain(en('hhWaiting'));
    expect(words()).toContain(en('waitingForApproval'));
    expect(en('waitingForApproval')).toBe('Waiting for your approval');
    expect(RNTL.screen.getAllByRole('button', { name: `${en('approve')}: Flow task` })).toHaveLength(1);
    expect(RNTL.screen.getAllByRole('button', { name: `${en('sendBack')}: Flow task` })).toHaveLength(1);
    // Try again: back to To do, nothing paid
    await press(`${en('sendBack')}: Flow task`);
    expect(task(ids.Billy, id).status).toBe('assigned');
    // again, then approve: the existing payout pays the child
    await RNTL.cleanup();
    await enter(app, ids.Billy);
    await A().submitAssignedTask(id);
    await app.family.ensureFamilyLoaded();
    const start = app.family.getWalletBalance();
    await enter(app, 'main');
    await app.gate.unlockParentArea(TEST_PIN);
    await H().selectChild(ids.Billy);
    await RNTL.render(<ParentDashboard />);
    await settle();
    await press(`${en('approve')}: Flow task`);
    expect(task(ids.Billy, id).status).toBe('approved');
    await enter(app, ids.Billy);
    expect(await R().collectHouseholdRewards()).toBe(6);
    expect(app.family.getWalletBalance()).toBe(start + 6);
  });
});

describe('Child settings and Pet Safety', () => {
  test('the approval setting keeps its On / Off control and loses its explanation sentence', async () => {
    const { ids } = await dashboard();
    expect(words()).toContain(en('requireApproval'));
    expect(words()).not.toMatch(/waits for you instead of counting right away/);
    expect(JSON.stringify(require('@/i18n/en'))).not.toContain('requireApprovalHelp');
    expect(child(ids.Billy).settings.requireApproval).toBe(true);
    expect(words()).toContain(en('on'));
  });

  test('Gentle and Classic stay; "(Recommended)" and the big orange paragraph are gone', async () => {
    const { ids } = await dashboard();
    expect(words()).toContain(en('gentleMode'));
    expect(words()).toContain(en('classicMode'));
    expect(words()).not.toMatch(/Recommended/i);
    expect(words()).not.toMatch(/NOT enforced yet|Pets are not separated per child yet/);
    expect(JSON.stringify(require('@/i18n/es'))).not.toMatch(/Recomendado/);
    await press(new RegExp(en('classicMode')));
    expect(child(ids.Billy).settings.petSafety).toBe('classic');
    await press(new RegExp(en('gentleMode')));
    expect(child(ids.Billy).settings.petSafety).toBe('gentle');
  });

  test('Pet Safety is enforced now, so the "not enforced yet" info button and note are gone', async () => {
    await dashboard();
    expect(RNTL.screen.queryByTestId('pet-safety-info')).toBeNull();
    expect(RNTL.screen.queryByTestId('pet-safety-info-text')).toBeNull();
    expect(words()).not.toMatch(/not enforced|not separated per child/i);
    expect(RNTL.screen.queryByRole('button', { name: /About Pet Safety/i })).toBeNull();
    for (const lang of ['en', 'es'] as const) {
      const all = JSON.stringify(require(`@/i18n/${lang}`));
      expect(all).not.toContain('psInfo');
      expect(all).not.toContain('petSafetyNotEnforced');
    }
  });
});

describe('unchanged protections', () => {
  test('the dashboard still never touches a wallet (source check)', () => {
    const source = code('src/components/parent-dashboard.tsx');
    expect(source).not.toMatch(/paw-tokens|household-rewards|pet-family|addToWallet/);
    expect(code('src/components/family-management-card.tsx')).not.toMatch(/paw-tokens|pet-family|addToWallet/);
  });
});
