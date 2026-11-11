// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
const path = require('path');

import { loadApp } from './helpers';

// Stage 0 of the family profile picker: what a child must never be able to reach, and what must reset when the profile changes.
// These are static and structural checks, so a NEW route, a NEW stored record or a NEW cheat switch fails here until someone
// decides what it is.

const ROOT = path.resolve('.');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function files(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...files(rel));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out.sort();
}

describe('route protection: every route is classified', () => {
  // Opened with the Parent PIN (when one exists) and NEVER rendered otherwise: the screen is simply not mounted, so opening its
  // address directly cannot skip the PIN screen.
  const PARENT_ONLY = ['src/app/parent.tsx', 'src/app/welcome.tsx'];
  // Shows nothing at all unless family mode is on, and then wraps its screen in the same gate.
  const FAMILY_ONLY_PARENT_ROUTES = ['src/app/dashboard.tsx', 'src/app/parent-security.tsx'];
  // A child may open these in their own profile: they show and change only the active profile's own data.
  const CHILD_SAFE = [
    'src/app/index.tsx',
    'src/app/mini-games.tsx',
    'src/app/pet-alerts.tsx',
    'src/app/rooms.tsx',
    'src/app/rooms/[room].tsx',
    'src/app/shop.tsx',
    'src/app/stats.tsx',
    'src/app/stats/[category].tsx',
    'src/app/stats/lifetime/[stat].tsx',
    'src/app/stats/lifetime/pets.tsx',
    'src/app/stats/lifetime/pets/[petId].tsx',
    'src/app/stats/lifetime/streak.tsx',
    'src/app/stats/lifetime/tokens.tsx',
    'src/app/stats/mood.tsx',
    'src/app/stats/review.tsx',
    'src/app/tasks.tsx',
  ];
  const routes = files('src/app').filter((f) => !f.endsWith('/_layout.tsx'));

  test('a new route fails this test until it is classified as child-safe or parent-only', () => {
    const known = [...PARENT_ONLY, ...FAMILY_ONLY_PARENT_ROUTES, ...CHILD_SAFE].sort();
    expect(routes).toEqual(known);
  });

  test.each(PARENT_ONLY)('%s renders its content only inside the Parent Gate', (file) => {
    const text = read(file);
    expect(text).toMatch(/<ParentGate>/);
    expect(text).toMatch(/<\/ParentGate>/);
  });

  test('the family-only routes go back to the app without family mode, and their screens are inside the gate', () => {
    expect(read('src/app/parent-security.tsx')).toMatch(/if \(!FAMILY_MODE_ENABLED\) return <Redirect href="\/" \/>;/);
    expect(read('src/components/parent-security-screen.tsx')).toMatch(/<ParentGate>/);
    // the dashboard route too: without family mode there is no household to manage, so it never reaches the gate or the dashboard
    expect(read('src/app/parent.tsx')).toMatch(/if \(!FAMILY_MODE_ENABLED\) return <Redirect href="\/" \/>;/);
    expect(read('src/app/parent.tsx')).not.toMatch(/^import .*(parent-dashboard|parent-gate)/m);
    // the Parent Dashboard (Main in family mode): the same, and it belongs to Main only
    const dashboard = read('src/app/dashboard.tsx');
    expect(dashboard).toMatch(/if \(!FAMILY_MODE_ENABLED \|\| profileId !== MAIN_PROFILE_ID\) return <Redirect href="\/" \/>;/);
    expect(dashboard).toMatch(/<ParentGate>\s*<ParentHome \/>\s*<\/ParentGate>/);
    expect(dashboard).not.toMatch(/^import .*(parent-home|parent-gate)/m);
  });

  test('child-safe routes never import the parent-only modules (household, parent PIN, parent dashboard)', () => {
    const forbidden = /@\/utils\/household|@\/utils\/parent-pin|@\/components\/parent-dashboard|@\/components\/parent-pin-flows|@\/components\/welcome-screen/;
    for (const file of CHILD_SAFE) expect(read(file)).not.toMatch(forbidden);
  });

  test('the app shell reconciles children with their profiles only behind the family-mode flag, and never imports it at the top', () => {
    const text = read('src/app/_layout.tsx');
    expect(text).toMatch(/if \(FAMILY_MODE_ENABLED\) void \(require\('@\/utils\/family-profiles'\)/);
    expect(text).not.toMatch(/^import .*family-profiles/m);
  });

  test('every parent-only household action asks for a verified parent session when it runs; the child-side one does not', () => {
    const text = read('src/utils/household.ts');
    const body = (name: string) => {
      const start = text.indexOf(`export async function ${name}(`);
      const end = text.indexOf('export ', start + 10);
      return text.slice(start, end < 0 ? undefined : end);
    };
    for (const name of ['saveParentProfile', 'addChild', 'renameChild', 'setChildArchived', 'selectChild', 'updateChildSettings', 'addTask', 'approveTask', 'sendTaskBack', 'deleteTask']) {
      expect([name, /'(parent|children)'/.test(body(name))]).toEqual([name, true]);
    }
    expect(/'(parent|children)'/.test(body('markTaskDone'))).toBe(false);
  });

  test('the Parent PIN is created only behind the setup claim, and the gate fails closed for a household with children and no PIN', () => {
    expect(read('src/utils/parent-pin.ts')).toMatch(/if \(!\(await setupClaimSatisfied\(\)\)\) return \{ ok: false, reason: 'claim-required' \};/);
    const gate = read('src/components/parent-gate.tsx');
    expect(gate).toMatch(/<UnprotectedGate>/);
    expect(gate).toMatch(/hasAnyChildRecord\(household, getHouseholdIntegrity\(\)\)/);
    expect(read('src/components/parent-security-screen.tsx')).toMatch(/<ParentSetupClaim \/>/);
  });

  test('restarting the family set-up (reachable from Pet Care and Alerts) is refused while the parent area is locked', () => {
    expect(read('src/utils/onboarding.ts')).toMatch(/if \(!\(await isParentAccessAllowed\(\)\)\) return;/);
    expect(read('src/utils/onboarding.ts')).toMatch(/if \(!\(await checkParentAction\('parent'\)\)\.ok\) return;/);
  });
});

describe('profile reset audit: everything that holds a profile\'s data clears itself on a profile change', () => {
  // Records that belong to the DEVICE or the household, not to one profile (never reset on a switch).
  const DEVICE_LEVEL = [
    'src/utils/household.ts',
    'src/utils/onboarding.ts',
    'src/utils/parent-auth-backend.ts',
    'src/utils/parent-auth-preview.ts',
    'src/utils/parent-gate.ts',
    'src/utils/parent-pin.ts',
    'src/utils/parent-secrets.ts',
    'src/utils/dev-stage-preview.ts', // a developer preview (switched off in family mode)
    'src/utils/profiles.ts',
    'src/utils/family-profiles.ts', // reads another profile's record, read-only, and holds no cache
    'src/utils/family-care-input.ts', // reads other profiles' pets and alert setting, read-only (getItem only), and holds no cache
    'src/utils/family-management.ts', // lists storage keys to report leftovers, read-only, and holds no cache
    'src/utils/child-overview.ts', // reads each ACTIVE child's pet record for the Parent Dashboard, read-only (getItem only), and holds no cache
    'src/utils/journal-sharing.ts', // reads a CHILD's shared journal entries for a parent, read-only (getItem only), filters before returning, holds no cache
    'src/utils/native-notifications.ts', // the lazily loaded expo-notifications package itself (or the error from loading it): nothing of any profile
  ];
  // Screens that keep a key in a ref (resolved through scopedKey) rather than in a store.
  const SCREENS_USING_SCOPED_KEYS = ['src/app/index.tsx', 'src/components/pet-family-bar.tsx'];

  const sources = [...files('src/utils'), ...files('src/hooks'), ...files('src/components'), ...files('src/app')];
  const usesStorage = sources.filter((f) => /AsyncStorage/.test(read(f)) && /from '@react-native-async-storage\/async-storage'/.test(read(f)));

  test('every file that reads or writes AsyncStorage is a profile store, a device-level record or a scoped-key screen', () => {
    for (const file of usesStorage) {
      const text = read(file);
      const isStore = /registerProfileStore\(/.test(text);
      const ok = isStore || DEVICE_LEVEL.includes(file) || SCREENS_USING_SCOPED_KEYS.includes(file);
      if (!ok) throw new Error(`${file} uses AsyncStorage but is not registered as a profile store or listed as device-level`);
    }
  });

  test('profile stores build their keys with scopedKey (never a fixed @ProductivityPet: key of their own)', () => {
    for (const file of usesStorage.filter((f) => /registerProfileStore\(/.test(read(f)) && f !== 'src/utils/profiles.ts')) {
      expect(read(file)).toMatch(/scopedKey\(|scopedKeyFor\(/);
    }
  });

  test('device-level files do not read profile data through the active profile', () => {
    for (const file of DEVICE_LEVEL.filter((f) => f !== 'src/utils/profiles.ts' && f !== 'src/utils/family-profiles.ts' && f !== 'src/utils/family-management.ts')) {
      expect(read(file)).not.toMatch(/\bscopedKey\(/);
    }
  });

  test('every store that was registered at the last audit is still registered (a removed hook fails here)', async () => {
    const app = await loadApp();
    // Loading these modules is what registers them.
    require('@/utils/task-storage');
    require('@/utils/shop-inventory');
    require('@/utils/mood-log');
    require('@/utils/journal');
    require('@/utils/pawadise-postcards');
    require('@/utils/pawadise-mail');
    require('@/utils/kitty-catch-rewards');
    require('@/utils/memory-match-rewards');
    require('@/utils/pet-alerts');
    require('@/utils/pet-equipment');
    require('@/utils/pet-growth');
    expect(app.profiles.registeredProfileStoreNames().sort()).toEqual(
      [
        'journal',
        'kitty-catch',
        'memory-match',
        'mood-log',
        'notifications',
        'paw-tokens',
        'pawadise-mail',
        'pawadise-postcards',
        'pet-alerts',
        'pet-equipment',
        'pet-family',
        'pet-growth',
        'shop-inventory',
        'tasks',
        'token-history',
      ].sort()
    );
  });

  test('everything that schedules phone notifications waits for the clean-up of the profile that was left, and a screen that loads tasks re-syncs reminders after a swap', () => {
    expect(read('src/utils/notifications.ts')).toMatch(/await whenProfileCleanupDone\(\)/);
    expect(read('src/utils/notifications.ts')).toMatch(/lastSyncedEpoch !== epoch/);
    expect(read('src/utils/pet-alerts.ts')).toMatch(/await whenProfileCleanupDone\(\)/);
    for (const screen of ['src/app/index.tsx', 'src/app/tasks.tsx']) expect(read(screen)).toMatch(/reminderResyncNeeded\(\)/);
    // only a swap or release that really happened starts a clean-up (so only then is the epoch counted)
    const profiles = read('src/utils/profiles.ts');
    expect(profiles.match(/runCleanups\(swapped\.cleanups\)/g)).toHaveLength(2);
    // (and by the start-up clean-up of stale private notifications, which family-notifications.ts registers with trackCleanup)
    expect(profiles.match(/notificationEpoch \+= 1/g)).toHaveLength(2);
    expect(profiles.match(/trackCleanup\(/g)).toHaveLength(1);
    const callers = files('src').filter((file) => /trackCleanup\(/.test(read(file)) && file !== 'src/utils/profiles.ts');
    expect(callers).toEqual(['src/utils/family-notifications.ts']);
    expect(read('src/utils/family-care.ts')).toMatch(/await whenProfileCleanupDone\(\)/);
  });

  test('every module-level cache in the data layer is either registered or deliberately device-level', () => {
    const cacheLine = /^let (state|cache|loaded|[a-zA-Z]*Cache|[a-zA-Z]*Promise)\b/m;
    for (const file of [...files('src/utils'), ...files('src/hooks')]) {
      const text = read(file);
      if (!cacheLine.test(text)) continue;
      if (/registerProfileStore\(/.test(text) || DEVICE_LEVEL.includes(file)) continue;
      throw new Error(`${file} keeps a module-level cache but does not reset on a profile change`);
    }
  });
});

describe('gameplay cheats are unavailable whenever family mode is on', () => {
  const FLAGS = [
    'DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP',
    'DEV_BYPASS_GROWTH_TASK_REQUIREMENT',
    'DEV_ENABLE_TEST_PAW_TOKEN_GRANT',
    'DEV_ENABLE_STAGE_PREVIEW',
    'DEV_ENABLE_DIRTY_TEST_CONTROLS',
    'DEV_ENABLE_HATCH_INTRO_PREVIEW',
    'DEV_ENABLE_LIFECYCLE_TEST_CONTROLS',
  ] as const;

  const original = process.env.EXPO_PUBLIC_FAMILY_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
    else process.env.EXPO_PUBLIC_FAMILY_MODE = original;
  });

  function flagsWith(env: string | undefined, dev = true) {
    const g = globalThis as unknown as { __DEV__: boolean };
    const before = g.__DEV__;
    g.__DEV__ = dev;
    if (env === undefined) delete process.env.EXPO_PUBLIC_FAMILY_MODE;
    else process.env.EXPO_PUBLIC_FAMILY_MODE = env;
    let out: Record<string, boolean> = {};
    try {
      jest.isolateModules(() => {
        out = require('@/utils/dev-flags') as Record<string, boolean>;
      });
    } finally {
      g.__DEV__ = before;
    }
    return out;
  }

  test('family mode on (development build + the variable): every cheat switch is off', () => {
    const flags = flagsWith('1');
    expect(flags.FAMILY_MODE_ENABLED).toBe(true);
    expect(flags.GAMEPLAY_CHEATS_ALLOWED).toBe(false);
    for (const name of FLAGS) expect([name, flags[name]]).toEqual([name, false]);
  });

  test('family mode off (every real user and release build): the switches keep the values they always had', () => {
    for (const flags of [flagsWith(undefined), flagsWith('1', false)]) {
      expect(flags.FAMILY_MODE_ENABLED).toBe(false);
      expect(flags.GAMEPLAY_CHEATS_ALLOWED).toBe(true);
      for (const name of FLAGS) expect([name, flags[name]]).toEqual([name, true]);
    }
  });

  test('with family mode on, the developer helpers that change a pet do nothing, and growth still needs the tasks', async () => {
    process.env.EXPO_PUBLIC_FAMILY_MODE = '1';
    const app = await loadApp();
    const before = JSON.stringify(await app.family.ensureFamilyLoaded());
    app.family.devSetSelectedNeed('hunger', 0);
    app.family.devShiftSicknessBack(24);
    app.family.devAddGrowthToSelectedPet(10);
    app.family.devSetSelectedPetActualStage(3);
    expect(app.family.devSetSelectedHealthState('deceased')).toMatchObject({ ok: false });
    expect(JSON.stringify(app.family.peekFamily())).toBe(before);
    const growth = require('@/utils/pet-growth') as typeof import('@/utils/pet-growth');
    const stages = [0, 1, 2, 3].map((stage) => growth.getGrowthEligibility(stage, 0));
    expect(stages.some((s) => s.canGrow)).toBe(false);
    expect(stages.some((s) => !s.canGrow && s.reason === 'not-eligible-yet')).toBe(true);
  });

  test('with family mode off the developer helpers still work as before', async () => {
    delete process.env.EXPO_PUBLIC_FAMILY_MODE;
    const app = await loadApp();
    await app.family.ensureFamilyLoaded();
    app.family.devSetSelectedNeed('hunger', 0);
    expect(app.family.peekFamily()!.pets[0].profile.hunger).toBe(0);
  });

  test('the cheat switches are tied to the family-mode switch in the source (not separate literals)', () => {
    const text = read('src/utils/dev-flags.ts');
    for (const name of FLAGS) expect(text).toMatch(new RegExp(`export const ${name}: boolean = GAMEPLAY_CHEATS_ALLOWED;`));
    expect(text).toMatch(/GAMEPLAY_CHEATS_ALLOWED: boolean = !FAMILY_MODE_ENABLED;/);
  });
});
