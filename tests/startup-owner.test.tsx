import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, render } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';

import { WebTabGate } from '@/components/web-tab-gate';
import { HandoffController } from '@/utils/family-tab';
import { TabLock } from '@/utils/web-tab-lock';

import { createBrowserSim, settle } from './tab-sim';

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
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

// Stage 4.4c: with the REAL startup modules, a tab that does not own the family storage starts nothing and touches no storage; the
// owning tab starts everything.

const METHODS = ['getItem', 'setItem', 'multiGet', 'multiSet', 'getAllKeys', 'removeItem', 'mergeItem', 'multiRemove', 'clear'] as const;
afterEach(async () => {
  await cleanup();
});

describe('a blocked tab starts nothing; the owning tab starts everything', () => {
  // Stands in for RootLayoutContent: the same startup calls, in effects.
  function Startup() {
    useEffect(() => {
      void require('@/utils/onboarding').ensureOnboardingLoaded();
      void require('@/utils/profiles').ensureProfilesReady();
      void require('@/utils/family-profiles').reconcileFamilyProfiles().catch(() => undefined);
    }, []);
    return <Text>APP</Text>;
  }

  test('the blocked tab: zero storage calls of any kind; the owner: the startup runs and reads storage', async () => {
    const calls: string[] = [];
    const spies = METHODS.map((method) => jest.spyOn(AsyncStorage, method));
    const sim = createBrowserSim();
    const make = async (name: string) => {
      const tab = sim.newTab({ unansweredMs: 5000 });
      const model = { chosen: false };
      const controller = new HandoffController({
        hasChosenProfile: () => model.chosen,
        isLeaving: () => false,
        hasPendingWork: () => false,
        listUnfinished: () => [],
        leave: async () => ({ ok: true, changed: true }),
        subscribeToSession: () => () => undefined,
      });
      const lock = new TabLock(tab.env, { consent: () => controller.consent() });
      const view = await render(
        <WebTabGate lock={lock} controller={controller} language="en">
          <Startup />
        </WebTabGate>
      );
      return { name, lock, view };
    };
    const owner = await make('owner');
    await act(async () => {
      await settle(30);
    });
    expect(owner.lock.isOwner()).toBe(true);
    for (const spy of spies) calls.push(...spy.mock.calls.map((c) => `${spy.getMockName()}`));
    const ownerCalls = spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    expect(ownerCalls).toBeGreaterThan(0); // the owning tab's startup really did read storage

    spies.forEach((spy) => spy.mockClear());
    const blocked = await make('blocked');
    await act(async () => {
      await settle(60);
    });
    expect(blocked.lock.getSnapshot().status).toBe('blocked');
    expect(blocked.view.queryByText('APP')).toBeNull();
    expect(spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(0); // nothing: not a read, not a write, not a key listing
    spies.forEach((spy) => spy.mockRestore());
  });
});
