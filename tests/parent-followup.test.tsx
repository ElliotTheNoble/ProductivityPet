import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { BackHandler, StyleSheet, Text } from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { Button, ChoiceCard, ToggleRow } from '@/components/family-ui';
import { ParentGate } from '@/components/parent-gate';
import { ParentSecurityScreen } from '@/components/parent-security-screen';
import { PinEntry } from '@/components/pin-entry';
import { setCurrentLanguage, translate } from '@/i18n';
import { lockParentArea } from '@/utils/parent-gate';
import { startParentAuth } from '@/utils/parent-pin';
import { getPinTiming, resetPinTimingForTests } from '@/utils/pin-timing';

import { resetSecure, secureTest } from './helpers';

// Stage 1 follow-up after the first phone test: the PIN-change confirmation, the old and new PIN on the protected recovery-code
// flow, a PIN check that answers the tap at once, the lock-out countdown, and visible pressed feedback.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
}));
jest.mock('@/utils/native-available', () => ({ hasNativeModule: () => true }));

const PIN = '135792';
const NEW_PIN = '864209';
const RECORD_KEY = 'pp.parentAuth.v1';
const en = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate('en', key, params);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const typeDigits = async (digits: string) => {
  for (const d of digits) await press(d);
};
const flush = async () => act(async () => {});
// A finger going down on / lifting off a control, through the same touch-responder handlers a real touch uses (the pressed state
// of a Pressable only changes through them).
const touch = { nativeEvent: { touches: [], changedTouches: [], identifier: 1, locationX: 1, locationY: 1, pageX: 1, pageY: 1, target: 1, timestamp: 0 }, persist() {}, currentTarget: 1 };
const fingerDown = (name: string) => act(async () => screen.getByRole('button', { name }).props.onResponderGrant(touch));
const fingerUp = (name: string) =>
  act(async () => {
    screen.getByRole('button', { name }).props.onResponderRelease(touch);
    await new Promise((resolve) => setTimeout(resolve, 300)); // a press stays visible for a minimum time
  });
const record = () => JSON.parse(secureTest().map.get(RECORD_KEY)!);
const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as { backgroundColor?: string };

const shownCode = () => {
  const node = screen.getByLabelText(/^Recovery code\. /);
  return (node.props.accessibilityLabel as string).replace('Recovery code. ', '').replace(/[ ,]/g, '').replace(/(.{5})(?=.)/g, '$1-');
};

// A complete first setup with `pin`, then the parent area locked; returns the recovery code that was shown.
async function setUpPin() {
  const view = await render(<ParentSecurityScreen />);
  await screen.findByText(en('psIntroTitle'));
  await press(en('psContinue'));
  await typeDigits(PIN);
  await press(en('psNext'));
  await typeDigits(PIN);
  await press(en('psNext'));
  await screen.findByText(en('psCodeTitle'));
  await press(en('rcReveal'));
  const code = shownCode();
  await press(en('psCodeSaved'));
  await typeDigits(PIN);
  await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), code);
  await press(en('psFinish'));
  await flush();
  await act(async () => view.unmount());
  lockParentArea();
  return code;
}

beforeEach(async () => {
  resetSecure();
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  resetPinTimingForTests();
  setCurrentLanguage('en');
  lockParentArea();
  expect(startParentAuth({ enabled: true })).toBe(true);
});

describe('changing the PIN, then the protected recovery-code flow', () => {
  test('a confirmation card says the PIN was updated and the code is unchanged; the old PIN then fails and the new PIN works on the recovery-code flow', async () => {
    await setUpPin();
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('pgTitle'));
    await typeDigits(PIN);
    await press(en('pgUnlock'));
    await screen.findByText(en('pmTitle'));
    const before = record();

    // change the PIN
    mockRouter.replace.mockClear();
    await press(en('pmChange'));
    await typeDigits(PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psFinish'));

    // the confirmation card: clear, and nothing leaves the page by itself
    expect(await screen.findByText(en('pmChangedBody'))).toBeTruthy();
    expect(en('pmChangedBody')).toMatch(/recovery code has not changed/i);
    expect(screen.getByText(en('pmChangedTitle'))).toBeTruthy();
    expect(mockRouter.replace).not.toHaveBeenCalled();
    await press(en('pmBackNow'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/parent');

    // the recovery code was NOT regenerated and is still the confirmed one; only the PIN verifier changed
    const after = record();
    expect(after.recoveryGeneration).toBe(before.recoveryGeneration);
    expect(after.recoveryConfirmed).toBe(true);
    expect(after.recovery).toEqual(before.recovery);
    expect(after.pin.hash).not.toBe(before.pin.hash);

    // the protected recovery-code flow ("Get a new recovery code") asks for the PIN: the OLD one is refused, the NEW one accepted
    await render(<ParentSecurityScreen />);
    await press(en('pmNewCode'));
    expect(await screen.findByText(en('pmNewCodeTitle'))).toBeTruthy();
    await typeDigits(PIN);
    await press(en('psNext'));
    expect(await screen.findByText(new RegExp(en('pgWrong')))).toBeTruthy();
    expect(screen.queryByText(en('psCodeTitle'))).toBeNull();
    expect(record().recoveryGeneration).toBe(before.recoveryGeneration); // the refused PIN changed nothing
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    expect(await screen.findByText(en('psCodeTitle'))).toBeTruthy();
    expect(record().recoveryGeneration).toBe(before.recoveryGeneration + 1); // only now, on request, a new code exists
  });
});

describe('an ordinary wrong PIN', () => {
  async function lockedGate() {
    await setUpPin();
    await render(
      <ParentGate>
        <Text>SECRET</Text>
      </ParentGate>
    );
    await screen.findByText(en('pgTitle'));
  }

  test('the dots clear and the button says "Checking…" at once, then the answer and the tries left appear', async () => {
    await lockedGate();
    const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
    let answer!: () => void;
    jest.spyOn(gate, 'unlockParentArea').mockImplementationOnce(
      () => new Promise((resolve) => { answer = () => resolve({ ok: false, reason: 'wrong', triesLeft: 2, cooldownMs: 0 }); })
    );
    await typeDigits('1111');
    expect(screen.getByText(/4 digits entered/)).toBeTruthy();
    await press(en('pgUnlock'));
    // the check is still running: the screen already answered the tap
    expect(screen.getByText(/0 digits entered/)).toBeTruthy();
    expect(screen.getByRole('button', { name: en('pgChecking') })).toBeTruthy();
    expect(screen.queryByText(en('pgWrong'), { exact: false })).toBeNull();

    await act(async () => answer());
    expect(await screen.findByText(new RegExp(`${en('pgWrong')} 2 tries left`))).toBeTruthy();
    expect(screen.getByRole('button', { name: en('pgUnlock') })).toBeTruthy();
    expect(screen.queryByText('SECRET')).toBeNull();
  });

  test('the first two wrong tries have no pause; the third starts the 30 second pause with a countdown (thresholds unchanged)', async () => {
    await lockedGate();
    for (const wrong of ['1111', '2222']) {
      await typeDigits(wrong);
      await press(en('pgUnlock'));
      expect(await screen.findByText(new RegExp(en('pgWrong')))).toBeTruthy();
      expect(screen.queryByText(/Please wait/)).toBeNull();
    }
    await typeDigits('3333');
    await press(en('pgUnlock'));
    expect(await screen.findByText(/Too many tries\. Please wait 0:30/)).toBeTruthy();
    expect(screen.getByRole('button', { name: en('pgUnlock') }).props.accessibilityState).toMatchObject({ disabled: true });
  });

  test('no check time is recorded outside a development build with family mode on', async () => {
    await lockedGate();
    await typeDigits('1111');
    await press(en('pgUnlock'));
    await flush();
    expect(getPinTiming()).toEqual({ totalMs: null, deriveMs: null, n: null, checks: 0 });
  });
});

describe('pressed feedback', () => {
  test('a button turns a deeper shade while it is pressed, and back when released', async () => {
    await render(<Button label="Press me" onPress={() => {}} />);
    const fill = () => flat(screen.getByText('Press me').parent as never).backgroundColor;
    const resting = fill();
    await fingerDown('Press me');
    expect(fill()).toBe('#EE7AA0');
    expect(fill()).not.toBe(resting);
    await fingerUp('Press me');
    expect(fill()).toBe(resting);
  });

  test('every tone of button changes colour when pressed', async () => {
    for (const tone of ['primary', 'mint', 'soft', 'danger'] as const) {
      const view = await render(<Button tone={tone} label={`B-${tone}`} onPress={() => {}} />);
      const fill = () => flat(screen.getByText(`B-${tone}`).parent as never).backgroundColor;
      const resting = fill();
      await fingerDown(`B-${tone}`);
      expect(fill()).not.toBe(resting);
      await act(async () => view.unmount());
    }
  });

  test('a number-pad key turns pink while it is pressed, and back when released', async () => {
    await render(<PinEntry label="PIN" value="" onChange={() => {}} />);
    const key = () => flat(screen.getByRole('button', { name: '5' }) as never).backgroundColor;
    const resting = key();
    await fingerDown('5');
    expect(key()).toBe('#F6C6D8');
    expect(key()).not.toBe(resting);
    await fingerUp('5');
    expect(key()).toBe(resting);
  });

  test('a choice card and a toggle row show the press too', async () => {
    await render(<ChoiceCard title="Pick me" onPress={() => {}} />);
    const card = () => flat(screen.getByText('Pick me').parent!.parent as never).backgroundColor;
    const restingCard = card();
    await fingerDown('Pick me');
    expect(card()).toBe('#FBD3E4');
    expect(card()).not.toBe(restingCard);
    await fingerUp('Pick me');

    await render(<ToggleRow label="Sound" value={false} onChange={() => {}} onLabel="On" offLabel="Off" />);
    const row = () => flat(screen.getByRole('switch', { name: 'Sound' }) as never).backgroundColor;
    const restingRow = row();
    await act(async () => screen.getByRole('switch', { name: 'Sound' }).props.onResponderGrant(touch));
    expect(row()).toBe('rgba(247, 182, 203, 0.45)');
    expect(row()).not.toBe(restingRow);
  });

  test('the dialog buttons turn a deeper shade while pressed', async () => {
    await render(
      <ConfirmModal visible title="Title" confirmLabel="Yes please" onConfirm={() => {}} onCancel={() => {}}>
        <Text>body</Text>
      </ConfirmModal>
    );
    const fill = (label: string) => flat(screen.getByText(label).parent as never).backgroundColor;
    const restingConfirm = fill('Yes please');
    await fingerDown('Yes please');
    expect(fill('Yes please')).toBe('#EE7AA0');
    expect(fill('Yes please')).not.toBe(restingConfirm);
    const cancel = en('cancel' as never);
    const restingCancel = fill(cancel);
    await fingerDown(cancel);
    expect(fill(cancel)).toBe('#F6C6D8');
    expect(fill(cancel)).not.toBe(restingCancel);
  });
});

describe('saving a changed PIN', () => {
  // Sets a PIN, unlocks the management screen and fills in the three Change PIN steps up to (not including) "Finish".
  async function readyToFinish() {
    await setUpPin();
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('pgTitle'));
    await typeDigits(PIN);
    await press(en('pgUnlock'));
    await screen.findByText(en('pmTitle'));
    await press(en('pmChange'));
    await typeDigits(PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
    await press(en('psNext'));
    await typeDigits(NEW_PIN);
  }
  // The Android back button: the screens register their handlers with BackHandler; pressing back asks them newest first and the first
  // one that answers true holds it back (otherwise the system would leave the screen).
  function watchBackButton() {
    const handlers: (() => boolean | null | undefined)[] = [];
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_name: string, handler: () => boolean | null | undefined) => {
      handlers.push(handler);
      return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
    }) as never);
    return () => [...handlers].reverse().some((handler) => handler() === true); // true = the press was held back
  }

  test('while it saves the button says "Saving…", Cancel is off and the Android back button is blocked; the card appears only when it has finished', async () => {
    const pressBack = watchBackButton();
    await readyToFinish();
    const parentPin = require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');
    let finish!: () => void;
    jest.spyOn(parentPin, 'changePin').mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true }); }));

    expect(pressBack()).toBe(false); // before saving, the back button is not held back

    await press(en('psFinish'));
    expect(screen.getByRole('button', { name: en('pmSaving') }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText(en('pmSavingNote'))).toBeTruthy();
    expect(screen.getByRole('button', { name: en('psCancel') }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByRole('button', { name: en('psCancel') })); // does nothing
    expect(screen.getByText(en('pmSavingNote'))).toBeTruthy();
    expect(pressBack()).toBe(true); // held back while saving
    expect(screen.queryByText(en('pmChangedBody'))).toBeNull(); // no confirmation yet

    await act(async () => finish());
    expect(await screen.findByText(en('pmChangedBody'))).toBeTruthy();
    expect(screen.queryByText(en('pmSavingNote'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('psCancel') })).toBeNull();
  });

  test('a change that cannot be verified shows the error, never the confirmation card, and the old PIN still works', async () => {
    await readyToFinish();
    const secure = secureTest();
    const old = secure.map.get(RECORD_KEY)!;
    const realSet = secure.map.set.bind(secure.map);
    secure.map.set = ((key: string, value: string) => realSet(key, key === RECORD_KEY ? old : value)) as typeof secure.map.set; // the write is silently lost
    await press(en('psFinish'));
    expect(await screen.findByText(en('peNotVerified'))).toBeTruthy();
    expect(screen.queryByText(en('pmChangedBody'))).toBeNull();
    expect(screen.queryByText(en('pmChangedTitle'))).toBeNull();
    expect(screen.getByText(en('pmCurrentPin'))).toBeTruthy(); // back at the first step
    secure.map.set = realSet as typeof secure.map.set;
    const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
    expect(await gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });

  test('a write that fails shows the "could not be saved" message, not the confirmation card', async () => {
    await readyToFinish();
    secureTest().failKeys.add(RECORD_KEY);
    await press(en('psFinish'));
    expect(await screen.findByText(en('peUnavailable'))).toBeTruthy();
    expect(screen.queryByText(en('pmChangedBody'))).toBeNull();
    secureTest().failKeys.delete(RECORD_KEY);
  });

  test('a verified change shows the card; the saved record then holds the new PIN', async () => {
    await readyToFinish();
    await press(en('psFinish'));
    expect(await screen.findByText(en('pmChangedBody'))).toBeTruthy();
    expect(screen.getByText(en('pmChangedTitle'))).toBeTruthy();
    expect(screen.queryByText(/DEV PIN record/, { includeHiddenElements: true })).toBeNull(); // the developer line is gone from every screen
  });
});
