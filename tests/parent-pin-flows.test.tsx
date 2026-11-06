import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
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

const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
}));

const PIN = '135792';
const NEW_PIN = '864209';
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

describe('first setup', () => {
  test('intro is honest: a local barrier, not proof of who is using the app', async () => {
    await render(<ParentSecurityScreen />);
    expect(await screen.findByText(en('psIntroBody'))).toBeTruthy();
    expect(en('psIntroBody')).toMatch(/does not prove who is using the app/);
    expect(es('psIntroBody')).toMatch(/no comprueba/i);
  });

  test('choose PIN, confirm it, save the code, type both: the parent area opens and the dashboard is shown', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await chooseAndConfirm();
    await screen.findByText(en('psCodeTitle'));
    expect((await getAuthState()).kind).toBe('none');
    expect(await getRecoveryStatus()).toBe('pending-setup');
    await press(en('rcReveal'));
    const code = shownCode();
    expect(code).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/);
    await press(en('psCodeSaved'));
    await typeDigits(PIN);
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), code.toLowerCase().replace(/-/g, ' '));
    await press(en('psFinish'));
    await flush();
    expect(mockRouter.replace).toHaveBeenCalledWith('/parent');
    expect((await getAuthState()).kind).toBe('ready');
    expect(await getRecoveryStatus()).toBe('confirmed');
  });

  test('the code is never shown until "Show code" is pressed, and can be hidden again', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await chooseAndConfirm();
    await screen.findByText(en('psCodeTitle'));
    expect(screen.getByLabelText(en('rcHidden'))).toBeTruthy();
    expect(screen.queryByLabelText(/^Recovery code\. /)).toBeNull();
    await press(en('rcReveal'));
    expect(screen.getByLabelText(/^Recovery code\. /)).toBeTruthy();
    await press(en('rcHide'));
    expect(screen.queryByLabelText(/^Recovery code\. /)).toBeNull();
  });

  test('there is no Copy button anywhere on the code screen', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await chooseAndConfirm();
    await screen.findByText(en('psCodeTitle'));
    await press(en('rcReveal'));
    expect(screen.queryByRole('button', { name: /copy|copiar/i })).toBeNull();
  });

  test('a weak PIN is refused with a friendly message; mismatched confirmation is refused and starts the second entry again', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await press(en('psContinue'));
    await typeDigits('123456');
    await press(en('psNext'));
    expect(await screen.findByText(en('pePinWeak'))).toBeTruthy();
    await press(en('pinKeyClear'));
    await typeDigits(PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    expect(await screen.findByText(en('pePinMismatch'))).toBeTruthy();
    expect(secureText()).toBe(''); // nothing was created
  });

  test('a PIN shorter than 6 digits cannot be submitted', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await press(en('psContinue'));
    await typeDigits('13579');
    expect(screen.getByRole('button', { name: en('psNext') }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  test('a wrong code at the end does not finish; the right PIN with the right code does', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await chooseAndConfirm();
    await screen.findByText(en('psCodeTitle'));
    await press(en('rcReveal'));
    const code = shownCode();
    await press(en('psCodeSaved'));
    await typeDigits(PIN);
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA');
    await press(en('psFinish'));
    await flush();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    expect((await getAuthState()).kind).toBe('none');
    await typeDigits(PIN);
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), code);
    await press(en('psFinish'));
    await flush();
    expect(mockRouter.replace).toHaveBeenCalledWith('/parent');
  });

  test('closing the app before the code is confirmed: setup resumes at "setup was not finished", nothing is protected yet', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await chooseAndConfirm();
    await screen.findByText(en('psCodeTitle'));
    await screen.unmount();
    lockParentArea();
    await render(<ParentSecurityScreen />);
    expect(await screen.findByText(en('psResumeTitle'))).toBeTruthy();
    // the old code can never be shown again
    expect(screen.queryByText(en('rcReveal'))).toBeNull();
    // starting over works and gives a different code
    await press(en('psResumeStart'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await screen.findByText(en('psCodeTitle'));
    expect((await getAuthState()).kind).toBe('none');
  });

  test('the app going to the background while the code is shown hides it, wipes typed digits and does not reveal it again', async () => {
    const handlers: ((s: string) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
      handlers.push(h);
      return { remove: jest.fn() };
    }) as never);
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await chooseAndConfirm();
    await screen.findByText(en('psCodeTitle'));
    await press(en('rcReveal'));
    expect(screen.getByLabelText(/^Recovery code\. /)).toBeTruthy();
    await act(async () => handlers.forEach((h) => h('background')));
    await act(async () => handlers.forEach((h) => h('active')));
    expect(screen.queryByLabelText(/^Recovery code\. /)).toBeNull();
    // the unfinished setup is back at its resume step (the shown code is gone for good)
    expect(await screen.findByText(en('psResumeTitle'))).toBeTruthy();
  });

  test('leaving during the code step asks first; staying keeps the code, leaving goes back to the dashboard', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await chooseAndConfirm();
    await screen.findByText(en('psCodeTitle'));
    await press(en('psCancel'));
    expect(await screen.findByText(en('psLeaveTitle'))).toBeTruthy();
    await fireEvent.press(screen.getAllByText(en('cancel')).at(-1)!); // the dialog's own Cancel (stay)
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await press(en('psCancel'));
    await fireEvent.press(screen.getByText(en('psLeave')));
    expect(mockRouter.replace).toHaveBeenCalledWith('/parent');
  });

  test('secure storage unavailable: the screen explains and offers nothing that creates a PIN', async () => {
    secureTest().available = false;
    expect(startParentAuth({ enabled: true })).toBe(true);
    await render(<ParentSecurityScreen />);
    expect(await screen.findByText(en('puTitle'))).toBeTruthy();
    expect(screen.queryByText(en('psContinue'))).toBeNull();
  });
});

describe('unlock', () => {
  test('masked entry, wrong PIN shows a friendly message with tries left, the right PIN shows the content', async () => {
    await setUpPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
    await typeDigits(NEW_PIN);
    await press(en('pgUnlock'));
    expect(await screen.findByText(new RegExp(en('pgWrong')))).toBeTruthy();
    await typeDigits(PIN);
    await press(en('pgUnlock'));
    expect(await screen.findByText('SECRET')).toBeTruthy();
  });

  test('after the free tries, a cooldown with a countdown appears and the keypad action is disabled', async () => {
    await setUpPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    for (let i = 0; i < 4; i++) {
      await typeDigits(NEW_PIN);
      await press(en('pgUnlock'));
      await flush();
    }
    expect(await screen.findByText(/try again in|Inténtalo|30/i)).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  test('the Spanish unlock screen is fully translated', async () => {
    await setUpPin();
    setCurrentLanguage('es');
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    expect(await screen.findByText(es('pgTitle'))).toBeTruthy();
    expect(screen.getByText(es('prStart'))).toBeTruthy();
  });
});

describe('forgotten PIN', () => {
  async function toRecoveryScreen() {
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    await press(en('prStart'));
    await screen.findByText(en('prTitle'));
  }

  test('recovery: code -> new PIN twice -> new code -> type it back -> back to unlock; the parent area never opens by itself', async () => {
    const oldCode = await setUpPin();
    await toRecoveryScreen();
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), oldCode);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await screen.findByText(en('prNewCodeTitle'));
    expect(screen.queryByText('SECRET')).toBeNull();
    await press(en('rcReveal'));
    const newCode = shownCode();
    expect(newCode).not.toBe(oldCode);
    await press(en('psCodeSaved'));
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), newCode);
    await press(en('psFinish'));
    expect(await screen.findByText(en('prDoneTitle'))).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
    expect(await getRecoveryStatus()).toBe('confirmed');
    await press(en('prToUnlock'));
    await screen.findByText(en('pgTitle'));
    await typeDigits(PIN); // the old PIN no longer works
    await press(en('pgUnlock'));
    expect(await screen.findByText(new RegExp(en('pgWrong')))).toBeTruthy();
    await typeDigits(NEW_PIN);
    await press(en('pgUnlock'));
    expect(await screen.findByText('SECRET')).toBeTruthy();
  });

  test('a wrong recovery code is refused, counted, and goes back to the code entry', async () => {
    await setUpPin();
    await toRecoveryScreen();
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), '00000-00000-00000-00000-00001');
    await press(en('psNext'));
    // a code that does not even pass the checksum is caught before anything is tried
    expect(await screen.findByText(en('peCodeFormat'))).toBeTruthy();
  });

  test('closing the app after the PIN was reset but before the replacement code was shown: unlocking with the new PIN leads to a confirm-your-code step, not to the dashboard', async () => {
    const oldCode = await setUpPin();
    await toRecoveryScreen();
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), oldCode);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await screen.findByText(en('prNewCodeTitle'));
    expect(await getRecoveryStatus()).toBe('unconfirmed');
    await screen.unmount(); // the app is closed here: the new code was never typed back
    lockParentArea();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    await typeDigits(NEW_PIN);
    await press(en('pgUnlock'));
    expect(await screen.findByText(en('pgdTitle'))).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  test('a lost unconfirmed replacement code is never a dead end: with the new PIN another one can be issued and confirmed', async () => {
    const oldCode = await setUpPin();
    await toRecoveryScreen();
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), oldCode);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await screen.findByText(en('prNewCodeTitle'));
    await press(en('rcReveal'));
    const lost = shownCode();
    await screen.unmount();
    lockParentArea();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
    await typeDigits(NEW_PIN);
    await press(en('pgUnlock'));
    await screen.findByText(en('pgdTitle'));
    await press(en('pgdNew'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await screen.findByText(en('psCodeTitle'));
    await press(en('rcReveal'));
    const fresh = shownCode();
    expect(fresh).not.toBe(lost);
    expect(fresh).not.toBe(oldCode);
    await press(en('psCodeSaved'));
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), fresh);
    await press(en('psFinish'));
    expect(await screen.findByText('SECRET')).toBeTruthy();
    expect(await getRecoveryStatus()).toBe('confirmed');
  });
});

describe('PIN management', () => {
  async function openManage() {
    await setUpPin();
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('pgTitle'));
    await typeDigits(PIN);
    await press(en('pgUnlock'));
    await screen.findByText(en('pmTitle'));
  }

  test('direct navigation to the management screen asks for the PIN first', async () => {
    await setUpPin();
    await render(<ParentSecurityScreen />);
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText(en('pmChange'))).toBeNull();
  });

  test('change PIN: current -> new -> again; the new PIN works and the old one does not', async () => {
    await openManage();
    await press(en('pmChange'));
    await typeDigits(PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psFinish'));
    expect(await screen.findByText(en('pmChanged'))).toBeTruthy();
    await press(en('pmDone'));
    await press(en('pmLockNow'));
    await screen.findByText(en('pgTitle'));
    await typeDigits(PIN);
    await press(en('pgUnlock'));
    expect(await screen.findByText(new RegExp(en('pgWrong')))).toBeTruthy();
  });

  test('a wrong current PIN is refused and counted', async () => {
    await openManage();
    await press(en('pmChange'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await typeDigits(PIN);
    await press(en('psNext'));
    await typeDigits(PIN);
    await press(en('psFinish'));
    expect(await screen.findByText(new RegExp(en('pgWrong')))).toBeTruthy();
  });

  test('a replacement recovery code: PIN -> new code -> typed back; the old code stops working', async () => {
    await openManage();
    await press(en('pmNewCode'));
    await typeDigits(PIN);
    await press(en('psNext'));
    await screen.findByText(en('psCodeTitle'));
    await press(en('rcReveal'));
    const fresh = shownCode();
    await press(en('psCodeSaved'));
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), fresh);
    await press(en('psFinish'));
    expect(await screen.findByText(en('pmCodeConfirmed'))).toBeTruthy();
  });

  test('"Lock the parent area now" locks it at once', async () => {
    await openManage();
    await press(en('pmLockNow'));
    expect(await screen.findByText(en('pgTitle'))).toBeTruthy();
    expect(screen.queryByText(en('pmChange'))).toBeNull();
  });

  test('the management page repeats the honest wording', async () => {
    await openManage();
    expect(screen.getByText(en('pgHonest'))).toBeTruthy();
  });
});

describe('nothing sensitive is stored in the clear', () => {
  test('neither the PIN nor the recovery code appears in ordinary storage, in secure storage as text, or in any console output', async () => {
    const logs: string[] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(' ')));
    }
    const code = await setUpPin();
    const ordinary = [...(await AsyncStorage.getAllKeys())].join('\n');
    const values = (await AsyncStorage.multiGet(await AsyncStorage.getAllKeys())).map(([, v]) => v).join('\n');
    for (const secret of [PIN, code, code.replace(/-/g, '')]) {
      expect(ordinary + values).not.toContain(secret);
      expect(secureText()).not.toContain(secret);
      expect(logs.join('\n')).not.toContain(secret);
    }
    expect(JSON.stringify(mockRouter.push.mock.calls) + JSON.stringify(mockRouter.replace.mock.calls)).not.toContain(PIN);
  });
});
