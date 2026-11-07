import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';

import ParentPage from '@/app/parent';
import WelcomePage from '@/app/welcome';
import { FamilyModeCard } from '@/components/family-mode-card';
import { ParentGate } from '@/components/parent-gate';
import { setCurrentLanguage, translate } from '@/i18n';
import { ensureOnboardingLoaded, skipOnboarding } from '@/utils/onboarding';
import {
  lockParentArea,
  registerPinVerifier,
  startParentGateAutoLock,
  unlockParentArea,
} from '@/utils/parent-gate';
import { ensureProfilesReady, registerChildProfile, switchProfile } from '@/utils/profiles';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
// These tests are about the Parent Gate on the parent-only screens and the Pet Care card, which exist only with family mode on (without it
// /parent goes back to the app and the card is not shown: see tests/production-exposure-*.test.tsx). The gate itself does not read the flag.
jest.mock('@/utils/dev-flags', () => ({ ...jest.requireActual('@/utils/dev-flags'), FAMILY_MODE_ENABLED: true, GAMEPLAY_CHEATS_ALLOWED: false }));
// The real screens are big; only whether they are shown matters here.
jest.mock('@/components/parent-dashboard', () => {
  const { Text: T } = require('react-native');
  const R = require('react');
  return { ParentDashboard: () => R.createElement(T, null, 'DASHBOARD-CONTENT') };
});
jest.mock('@/components/welcome-screen', () => {
  const { Text: T } = require('react-native');
  const R = require('react');
  return { WelcomeScreen: () => R.createElement(T, null, 'WELCOME-CONTENT') };
});
jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
}));

const PIN = '246813';
const en = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params);
const es = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('es', key, params);

function setPin(correct = PIN) {
  registerPinVerifier({ isConfigured: async () => true, verify: async (p) => p === correct });
}
function noPin() {
  registerPinVerifier({ isConfigured: async () => false, verify: async () => false });
}

// Types the PIN on the on-screen number pad, then presses Unlock.
async function typePin(pin: string) {
  for (const digit of pin) await fireEvent.press(screen.getByRole('button', { name: digit }));
}
async function enterPin(pin: string) {
  await typePin(pin);
  await fireEvent.press(screen.getByRole('button', { name: en('pgUnlock') }));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  setCurrentLanguage('en');
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
});
afterAll(() => {
  noPin();
  setCurrentLanguage('en');
});

// This must run before any test registers a PIN checker: it checks the state every install has while family mode is off.
describe('with no PIN checker registered at all (every install while family mode is off)', () => {
  test('the content is on screen on the very first frame, with no blank flash and no waiting', async () => {
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    expect(screen.getByText('SECRET')).toBeTruthy(); // getBy, not findBy: nothing is awaited
    expect(screen.queryByText(en('pgTitle'))).toBeNull();
  });
});

describe('ParentGate', () => {
  test('no PIN: the content is shown at once (as before)', async () => {
    noPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    expect(await screen.findByText('SECRET')).toBeTruthy();
    expect(screen.queryByText(en('pgTitle'))).toBeNull();
  });

  test('PIN set: the PIN screen is shown INSTEAD of the content', async () => {
    setPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
    expect(screen.getByText(en('pgHonest'))).toBeTruthy(); // says what the PIN is and is not
    expect(screen.getByText(en('pgForgotText'))).toBeTruthy(); // says it cannot be reset by the app
  });

  test('a wrong PIN shows a message and the tries left, and the content stays hidden', async () => {
    setPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    await enterPin('000000');
    expect(await screen.findByText(new RegExp(en('pgWrong').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
    expect(screen.getByText(/2 tries left/)).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  test('the correct PIN shows the content with an "unlocked" bar; "Lock now" locks it again', async () => {
    setPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    await enterPin(PIN);
    expect(await screen.findByText('SECRET')).toBeTruthy();
    expect(screen.getByText(new RegExp(en('pgUnlockedBar')))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: en('pgLockNow') }));
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  test('three wrong PINs start a pause: a message with the time, the button is disabled, and the content stays hidden', async () => {
    setPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    for (const pin of ['000000', '000001', '000002']) {
      await enterPin(pin);
      await act(async () => {});
    }
    expect(await screen.findByText(/Too many tries/)).toBeTruthy();
    expect(screen.getByRole('button', { name: en('pgUnlock') }).props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  test('after an app restart the pause is still shown (it was saved)', async () => {
    setPin();
    for (const pin of ['000000', '000001', '000002']) await unlockParentArea(pin); // three wrong guesses in an earlier "run"
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    expect(await screen.findByText(/Too many tries/)).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  test('a PIN that is too short cannot be submitted, and nothing is counted', async () => {
    setPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    await typePin('12345');
    expect(screen.getByRole('button', { name: en('pgUnlock') }).props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: en('pgUnlock') }));
    expect(await AsyncStorage.getItem('@ProductivityPet:parentGate')).toBeNull();
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  test('"Back to Home" leaves the lock screen', async () => {
    setPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    await fireEvent.press(screen.getByRole('button', { name: en('pgBackHome') }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
  });

  test('Spanish: every visible word of the lock screen is Spanish, including the plural message', async () => {
    setPin();
    setCurrentLanguage('es');
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    expect(await screen.findByText(es('pgTitle'))).toBeTruthy();
    expect(screen.getByText(es('pgSubtitle'))).toBeTruthy();
    expect(screen.getByText(es('pgHonest'))).toBeTruthy();
    expect(screen.getByText(es('pgForgotText'))).toBeTruthy();
    for (const digit of '000000') await fireEvent.press(screen.getByRole('button', { name: digit }));
    await fireEvent.press(screen.getByRole('button', { name: es('pgUnlock') }));
    expect(await screen.findByText(/Quedan 2 intentos/)).toBeTruthy();
    expect(screen.queryByText(en('pgTitle'))).toBeNull();
  });
});

describe('family data whose PIN record is missing (a restore or a new device)', () => {
  const missing = () =>
    registerPinVerifier({ isConfigured: async () => true, verify: async () => false, issue: async () => 'verifier-missing' });

  test('the content stays hidden, there is no PIN field to type in, and the reason is explained', async () => {
    missing();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    expect(await screen.findByText(en('pgVerifierMissing'))).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
    expect(screen.queryByLabelText(en('pgPinLabel'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('pgUnlock') })).toBeNull();
    expect(screen.queryByText(/device passcode|biometric/i)).toBeNull(); // no suggestion that the device lock is a way in
  });

  test('Spanish', async () => {
    missing();
    setCurrentLanguage('es');
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    expect(await screen.findByText(es('pgVerifierMissing'))).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  test('/parent and /welcome stay locked too', async () => {
    missing();
    await render(<ParentPage />);
    expect(await screen.findByText(en('pgVerifierMissing'))).toBeTruthy();
    expect(screen.queryByText('DASHBOARD-CONTENT')).toBeNull();
  });
});

describe('opening a parent-only screen directly (/parent, /welcome)', () => {
  test('/parent: no content while locked; the PIN screen instead', async () => {
    setPin();
    await render(<ParentPage />);
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText('DASHBOARD-CONTENT')).toBeNull();
  });

  test('/welcome: no content while locked; the PIN screen instead', async () => {
    setPin();
    await render(<WelcomePage />);
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText('WELCOME-CONTENT')).toBeNull();
  });

  test('/parent with no PIN opens exactly as before', async () => {
    noPin();
    await render(<ParentPage />);
    expect(await screen.findByText('DASHBOARD-CONTENT')).toBeTruthy();
  });

  test('/welcome with no PIN opens exactly as before (a brand-new install can still do its first set-up)', async () => {
    noPin();
    await render(<WelcomePage />);
    expect(await screen.findByText('WELCOME-CONTENT')).toBeTruthy();
  });

  test('after the PIN they open, and lock again when the parent session ends', async () => {
    setPin();
    await render(<ParentPage />);
    await screen.findByText(en('pgTitle'));
    await enterPin(PIN);
    expect(await screen.findByText('DASHBOARD-CONTENT')).toBeTruthy();
    await act(async () => lockParentArea());
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText('DASHBOARD-CONTENT')).toBeNull();
  });
});

describe('switching away from a parent session', () => {
  test('the app going to the background locks an open parent area', async () => {
    setPin();
    const handlers: ((s: string) => void)[] = [];
    const handler = (s: string) => handlers.forEach((h) => h(s)); // the real AppState tells every listener
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, cb: (s: string) => void) => {
      handlers.push(cb);
      return { remove };
    }) as never);
    const stop = startParentGateAutoLock();
    await render(<ParentPage />);
    await screen.findByText(en('pgTitle'));
    await enterPin(PIN);
    expect(await screen.findByText('DASHBOARD-CONTENT')).toBeTruthy();
    await act(async () => handler('background'));
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText('DASHBOARD-CONTENT')).toBeNull();
    await act(async () => handler('active')); // coming back does not unlock
    expect(screen.queryByText('DASHBOARD-CONTENT')).toBeNull();
    stop();
    (AppState.addEventListener as jest.Mock).mockRestore();
  });

  test('changing the active profile locks an open parent area', async () => {
    setPin();
    await ensureProfilesReady();
    await registerChildProfile('kid1');
    const stop = startParentGateAutoLock();
    await render(<ParentPage />);
    await screen.findByText(en('pgTitle'));
    await enterPin(PIN);
    expect(await screen.findByText('DASHBOARD-CONTENT')).toBeTruthy();
    await act(async () => {
      expect(await switchProfile('kid1')).toMatchObject({ ok: true });
    });
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText('DASHBOARD-CONTENT')).toBeNull();
    await act(async () => {
      await switchProfile('main');
    });
    stop();
  });
});

describe('the Family card on the Pet Care page (reachable by anyone)', () => {
  beforeEach(async () => {
    await ensureOnboardingLoaded();
    await skipOnboarding(); // an existing player
  });

  test('no PIN: unchanged (Start setup is offered)', async () => {
    noPin();
    await render(<FamilyModeCard />);
    expect(await screen.findByRole('button', { name: en('startSetup') })).toBeTruthy();
  });

  test('PIN set and locked: only "Unlock parent area" is offered; Start setup and the dashboard shortcut are not', async () => {
    setPin();
    await render(<FamilyModeCard />);
    expect(await screen.findByText(en('pgCardLocked'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: en('startSetup') })).toBeNull();
    expect(screen.queryByRole('button', { name: en('openDashboard') })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en('pgUnlockButton') }));
    expect(mockRouter.push).toHaveBeenCalledWith('/parent'); // which shows the PIN screen
  });

  test('PIN set and unlocked: Start setup is offered again', async () => {
    setPin();
    await unlockParentArea(PIN);
    await render(<FamilyModeCard />);
    expect(await screen.findByRole('button', { name: en('startSetup') })).toBeTruthy();
  });
});
