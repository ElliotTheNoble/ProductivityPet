import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, AppState } from 'react-native';

import { ProfileCard } from '@/components/family-picker';
import { PinEntry } from '@/components/pin-entry';
import { ChangePinFlow, PIN_UPDATED_RETURN_MS } from '@/components/parent-pin-flows';
import { setCurrentLanguage, translate } from '@/i18n';
import { lockParentArea } from '@/utils/parent-gate';
import { startParentAuth } from '@/utils/parent-pin';

import { resetSecure } from './helpers';

// The Change PIN screen on its own: changePin itself is replaced, so these tests are about the SCREEN's handling of time and interruptions
// (the real saving, its read-back and the old / new PIN are covered in parent-pin.test.ts and parent-followup.test.tsx). Also the
// pressed / hover feedback added to profile cards and the number-pad text links.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
}));
jest.mock('@/utils/native-available', () => ({ hasNativeModule: () => true }));

const PIN = '135792';
const NEW_PIN = '864209';
const en = (key: Parameters<typeof translate>[1]) => translate('en', key);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const typeDigits = async (digits: string) => {
  for (const d of digits) await press(d);
};
// A finger going down on / lifting off a control, through the touch-responder handlers a real touch uses.
const touch = { nativeEvent: { touches: [], changedTouches: [], identifier: 1, locationX: 1, locationY: 1, pageX: 1, pageY: 1, target: 1, timestamp: 0 }, persist() {}, currentTarget: 1 };
const fingerDown = (name: string) => act(async () => screen.getByRole('button', { name }).props.onResponderGrant(touch));
const fingerUp = (name: string) =>
  act(async () => {
    screen.getByRole('button', { name }).props.onResponderRelease(touch);
    await new Promise((resolve) => setTimeout(resolve, 300)); // a press stays visible for a minimum time
  });

beforeEach(async () => {
  resetSecure();
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  setCurrentLanguage('en');
  lockParentArea();
  expect(startParentAuth({ enabled: true })).toBe(true);
});
afterEach(() => {
  jest.useRealTimers();
});

const parentPin = () => require('@/utils/parent-pin') as typeof import('@/utils/parent-pin');

async function enterChange() {
  const onDone = jest.fn();
  const onCancel = jest.fn();
  const view = await render(<ChangePinFlow onDone={onDone} onCancel={onCancel} />);
  await typeDigits(PIN);
  await press(en('psNext'));
  await typeDigits(NEW_PIN);
  await press(en('psNext'));
  await typeDigits(NEW_PIN);
  return { view, onDone, onCancel };
}

// Holds changePin until `finish(result)` is called.
function holdSave() {
  let finish!: (result: Awaited<ReturnType<typeof import('@/utils/parent-pin').changePin>>) => void;
  const spy = jest.spyOn(parentPin(), 'changePin').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  return { spy, finish: (result: Parameters<typeof finish>[0]) => act(async () => finish(result)) };
}

function watchAppState() {
  const handlers: ((state: string) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_name: string, handler: (state: string) => void) => {
    handlers.push(handler);
    return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
  }) as never);
  return (state: string) => act(async () => handlers.slice().forEach((handler) => handler(state)));
}

const fakeTimers = () => jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });

describe('the Change PIN screen: return to the dashboard, interruptions, one save at a time', () => {
  test('"PIN updated successfully" shows with a way back now, and the dashboard follows by itself after about 4 seconds, once', async () => {
    jest.spyOn(parentPin(), 'changePin').mockResolvedValue({ ok: true });
    fakeTimers();
    const { onDone } = await enterChange();
    await press(en('psFinish'));
    expect(await screen.findByText(en('pmChangedTitle'))).toBeTruthy();
    expect(en('pmChangedTitle')).toBe('PIN updated successfully');
    expect(screen.getByText(en('pmChangedBody'))).toBeTruthy();
    expect(en('pmChangedBody')).toMatch(/recovery code has not changed/i);
    expect(screen.getByText(en('pmReturning'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to Dashboard now' })).toBeTruthy();
    expect(PIN_UPDATED_RETURN_MS).toBe(4000);

    await act(async () => jest.advanceTimersByTime(PIN_UPDATED_RETURN_MS - 1));
    expect(onDone).not.toHaveBeenCalled(); // not early
    await act(async () => jest.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(20_000));
    expect(onDone).toHaveBeenCalledTimes(1); // once
  });

  test('the "Back to Dashboard now" button goes at once, and the timer then does not go a second time', async () => {
    jest.spyOn(parentPin(), 'changePin').mockResolvedValue({ ok: true });
    fakeTimers();
    const { onDone } = await enterChange();
    await press(en('psFinish'));
    await screen.findByText(en('pmChangedTitle'));
    await press(en('pmBackNow'));
    expect(onDone).toHaveBeenCalledTimes(1);
    await act(async () => jest.advanceTimersByTime(PIN_UPDATED_RETURN_MS + 1000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('leaving the screen during the 4 seconds cancels the automatic return', async () => {
    jest.spyOn(parentPin(), 'changePin').mockResolvedValue({ ok: true });
    fakeTimers();
    const { view, onDone } = await enterChange();
    await press(en('psFinish'));
    await screen.findByText(en('pmChangedTitle'));
    await act(async () => view.unmount());
    await act(async () => jest.advanceTimersByTime(PIN_UPDATED_RETURN_MS * 2));
    expect(onDone).not.toHaveBeenCalled();
  });

  test('a change that is not verified shows no success and no automatic return', async () => {
    jest.spyOn(parentPin(), 'changePin').mockResolvedValue({ ok: false, reason: 'not-verified' });
    fakeTimers();
    const { onDone } = await enterChange();
    await press(en('psFinish'));
    expect(await screen.findByText(en('peNotVerified'))).toBeTruthy();
    expect(screen.queryByText(en('pmChangedTitle'))).toBeNull();
    await act(async () => jest.advanceTimersByTime(PIN_UPDATED_RETURN_MS * 2));
    expect(onDone).not.toHaveBeenCalled();
  });

  test('the app leaving the foreground during a save wipes the digits but keeps showing "Saving…", and the result still arrives', async () => {
    const appState = watchAppState();
    const { finish } = holdSave();
    const { onDone } = await enterChange();
    await press(en('psFinish'));
    expect(screen.getByRole('button', { name: en('pmSaving') })).toBeTruthy();
    await appState('background');
    await appState('active');
    expect(screen.getByRole('button', { name: en('pmSaving') })).toBeTruthy(); // still saving, not sent back to the first step
    expect(screen.queryByText(en('pmCurrentPin'))).toBeNull();
    expect(screen.getByText(/0 digits entered/)).toBeTruthy(); // the typed digits are gone
    await finish({ ok: true });
    expect(await screen.findByText(en('pmChangedTitle'))).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled(); // (the 4 seconds have only just started)
  });

  test('the app leaving the foreground after the success keeps the confirmation (it does not send you back to step one)', async () => {
    const appState = watchAppState();
    jest.spyOn(parentPin(), 'changePin').mockResolvedValue({ ok: true });
    await enterChange();
    await press(en('psFinish'));
    await screen.findByText(en('pmChangedTitle'));
    await appState('background');
    await appState('active');
    expect(screen.getByText(en('pmChangedTitle'))).toBeTruthy();
    expect(screen.queryByText(en('pmCurrentPin'))).toBeNull();
  });

  test('the app leaving the foreground when nothing is under way still goes back to step one with the digits wiped', async () => {
    const appState = watchAppState();
    await enterChange();
    await appState('background');
    expect(screen.getByText(en('pmCurrentPin'))).toBeTruthy();
  });

  test('a second "Finish" while the first save runs does not start another save', async () => {
    const { spy, finish } = holdSave();
    await enterChange();
    // two presses in the very same moment, before the screen has had a chance to turn the button off
    const finishButton = screen.getByRole('button', { name: en('psFinish') });
    await act(async () => {
      finishButton.props.onClick({ nativeEvent: {} });
      finishButton.props.onClick({ nativeEvent: {} });
    });
    expect(spy).toHaveBeenCalledTimes(1);
    await finish({ ok: true });
    await screen.findByText(en('pmChangedTitle'));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('a save that throws unexpectedly leaves the screen usable (Saving… ends) and never shows a success', async () => {
    jest.spyOn(parentPin(), 'changePin').mockRejectedValue(new Error('boom'));
    await enterChange();
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await press(en('psFinish')).catch(() => undefined);
    errors.mockRestore();
    expect(screen.queryByText(en('pmChangedTitle'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('pmSaving') })).toBeNull();
  });
});

describe('more pressed and hover feedback', () => {
  test('a profile card tints pink while it is pressed, and goes back when released', async () => {
    await render(<ProfileCard basis="48%" emoji="🐱" fill="#FFF" name="Kit" label="Kit card" onPress={() => {}} />);
    expect(JSON.stringify(screen.toJSON())).not.toContain('#FBD3E4');
    await fingerDown('Kit card');
    expect(JSON.stringify(screen.toJSON())).toContain('#FBD3E4');
    await fingerUp('Kit card');
    expect(JSON.stringify(screen.toJSON())).not.toContain('#FBD3E4');
  });

  test('a disabled profile card shows no pressed tint', async () => {
    await render(<ProfileCard basis="48%" emoji="🐱" fill="#FFF" name="Kit" label="Kit card" disabled onPress={() => {}} />);
    await fingerDown('Kit card');
    expect(JSON.stringify(screen.toJSON())).not.toContain('#FBD3E4');
  });

  test('the two number-pad text links show a pink pill while pressed', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false); // the number pad is the default
    await render(<PinEntry label="PIN" value="" onChange={() => {}} />);
    await act(async () => {});
    const pill = 'rgba(246, 198, 216, 0.75)';
    const first = en('pinUseKeyboard'); // leads from the pad to the device keyboard
    const second = en('pinUsePad'); // and back
    expect(JSON.stringify(screen.toJSON())).not.toContain(pill);
    await fingerDown(first);
    expect(JSON.stringify(screen.toJSON())).toContain(pill);
    await fingerUp(first); // lifting the finger is a tap: the mode switches, so now the other link is shown
    expect(JSON.stringify(screen.toJSON())).not.toContain(pill);
    await fingerDown(second);
    expect(JSON.stringify(screen.toJSON())).toContain(pill);
  });

  test('hover (web only, so checked in the source): cards, links, keys and buttons all define a hover look', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8');
    expect(read('src/components/family-picker.tsx')).toContain('styles.cardHover');
    expect(read('src/components/pin-entry.tsx')).toContain('styles.linkHover');
    expect(read('src/components/pin-entry.tsx')).toContain("hovered === true ? '#F6C6D8'");
    expect(read('src/components/family-ui.tsx')).toContain('isHovered(state) || isPressed(state)');
  });
});
