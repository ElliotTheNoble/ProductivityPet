import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { ParentGate } from '@/components/parent-gate';
import { ParentSecurityScreen } from '@/components/parent-security-screen';
import { Text } from 'react-native';
import { setCurrentLanguage, translate } from '@/i18n';
import { lockParentArea } from '@/utils/parent-gate';
import { getAuthState, getRecoveryStatus, startParentAuth } from '@/utils/parent-pin';

import { resetSecure, secureTest } from './helpers';

// Cheap scrypt settings keep the suite fast (the real settings are exercised in pin-crypto-real.test.ts).
jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
// The phone's own screen-lock check (asked after five wrong PINs in a row): it passes here.
jest.mock('expo-local-authentication', () => ({
  getEnrolledLevelAsync: jest.fn(async () => 2),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
}));

const PIN = '1357';
const NEW_PIN = '8642';
const en = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params);
const es = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('es', key, params);

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const typeDigits = async (digits: string) => {
  for (const d of digits) await press(d);
};
// The recovery code on screen (after "Show code"), read from the accessibility label like a screen reader would.
const shownCode = () => {
  const node = screen.getByLabelText(/^Recovery code\. /);
  const spoken = (node.props.accessibilityLabel as string).replace('Recovery code. ', '');
  return spoken.replace(/[ ,]/g, '').replace(/(.{5})(?=.)/g, '$1-');
};
const flush = async () => act(async () => {});
const secureText = () => [...secureTest().map.values()].join('\n');

async function chooseAndConfirm(pin = PIN) {
  await press(en('psContinue'));
  await typeDigits(pin);
  await press(en('psNext'));
  await typeDigits(pin);
  await press(en('psNext'));
}

beforeEach(async () => {
  resetSecure();
  await AsyncStorage.clear();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  setCurrentLanguage('en');
  lockParentArea();
  expect(startParentAuth({ enabled: true })).toBe(true);
});
afterEach(() => {
  jest.restoreAllMocks();
  setCurrentLanguage('en');
});

// A fully set-up PIN, parent area locked.
async function setUpPin() {
  await render(<ParentSecurityScreen />);
  await screen.findByText(en('psIntroTitle'));
  await chooseAndConfirm();
  await screen.findByText(en('psCodeTitle'));
  await press(en('rcReveal'));
  const code = shownCode();
  await press(en('psCodeSaved'));
  await typeDigits(PIN);
  const field = screen.getByLabelText(en('rcFieldLabel'));
  await fireEvent.changeText(field, code);
  await press(en('psFinish'));
  await flush();
  lockParentArea();
  return code;
}

// A box that makes a NEW PIN takes exactly 4 digits: the number pad stops at the fourth, so does the physical keyboard (the hidden field), and
// so does the device keyboard (a masked field whose own limit is 4). The main button is enabled only at exactly 4.
async function expectBoxStopsAtFour(buttonLabel: string) {
  const button = () => screen.getByRole('button', { name: buttonLabel });
  await typeDigits('135');
  expect(button().props.accessibilityState).toMatchObject({ disabled: true });
  await typeDigits('79246'); // five more: only the first one counts
  expect(screen.getByText(en('pinDigitsEntered_other', { count: 4 }))).toBeTruthy();
  expect(button().props.accessibilityState).toMatchObject({ disabled: false });
  // the physical keyboard
  await fireEvent.changeText(screen.getByTestId('pin-hardware-input', { hidden: true }), '123456789');
  expect(screen.getByText(en('pinDigitsEntered_other', { count: 4 }))).toBeTruthy();
  expect(screen.getByTestId('pin-hardware-input', { hidden: true }).props.maxLength).toBe(4);
  // the device keyboard
  await press(en('pinUseKeyboard'));
  expect(screen.getByTestId('pin-keyboard-input').props.maxLength).toBe(4);
  await fireEvent.changeText(screen.getByTestId('pin-keyboard-input'), '98765432');
  expect(screen.getByTestId('pin-keyboard-input').props.value).toBe('9876');
  await fireEvent.changeText(screen.getByTestId('pin-keyboard-input'), '987');
  expect(button().props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.changeText(screen.getByTestId('pin-keyboard-input'), '9876');
  expect(button().props.accessibilityState).toMatchObject({ disabled: false });
  await press(en('pinUsePad'));
  await press(en('pinKeyClear'));
}

describe('a new Parent PIN is exactly 4 digits on every creation screen', () => {
  test('first setup: choose, type again, and the PIN typed back at the end', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await press(en('psContinue'));
    await expectBoxStopsAtFour(en('psNext'));
    await typeDigits(PIN);
    await press(en('psNext'));
    await expectBoxStopsAtFour(en('psNext'));
    await typeDigits(PIN);
    await press(en('psNext'));
    await screen.findByText(en('psCodeTitle'));
    await press(en('rcReveal'));
    const code = shownCode();
    await press(en('psCodeSaved'));
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), code);
    await expectBoxStopsAtFour(en('psFinish'));
  });

  test('changing the PIN: the new PIN and the new PIN again', async () => {
    await setUpPin();
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('pgTitle'));
    await typeDigits(PIN);
    await press(en('pgUnlock'));
    await screen.findByText(en('pmTitle'));
    await press(en('pmChange'));
    await typeDigits(PIN);
    await press(en('psNext'));
    await expectBoxStopsAtFour(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await expectBoxStopsAtFour(en('psFinish'));
  });

  test('recovery: the new PIN and the new PIN again', async () => {
    const code = await setUpPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    await press(en('prStart'));
    await screen.findByText(en('prTitle'));
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), code);
    await press(en('psNext'));
    await expectBoxStopsAtFour(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await expectBoxStopsAtFour(en('psNext'));
  });

  test('the words say 4 digits (never 4 to 8), in English and Spanish', () => {
    for (const lang of ['en', 'es'] as const) {
      const all = JSON.stringify([require(`@/i18n/parent-pin.${lang}`), require(`@/i18n/parent-gate.${lang}`), require(`@/i18n/family-picker.${lang}`)]);
      expect(all).not.toMatch(/4\s*(to|a|-|–)\s*8|4–8|4-8/);
    }
  });
});

describe('an existing PIN of 5 to 8 digits is not cut short where it is only checked', () => {
  test('the unlock screen takes up to 8 digits', async () => {
    await setUpPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    await typeDigits('123456789');
    expect(screen.getByText(en('pinDigitsEntered_other', { count: 8 }))).toBeTruthy();
    expect(screen.getByRole('button', { name: en('pgUnlock') }).props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByTestId('pin-hardware-input', { hidden: true }).props.maxLength).toBe(8);
  });
});
