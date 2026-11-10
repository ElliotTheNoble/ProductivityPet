import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard } from 'react-native';

import { ParentSecurityScreen } from '@/components/parent-security-screen';
import { RecoveryCodeDisplay } from '@/components/recovery-code';
import { useKeyboardAvoidance } from '@/hooks/use-keyboard-avoidance';
import { setCurrentLanguage, translate } from '@/i18n';
import { lockParentArea } from '@/utils/parent-gate';
import { startParentAuth } from '@/utils/parent-pin';

import { resetSecure } from './helpers';

// Parent PIN usability (4-digit PINs, screenshots on PIN screens, a screenshot switch and Copy / Paste for the recovery code, the
// keyboard not covering the code field). The checks of the PIN and lock-out rules themselves are in parent-pin.test.ts and
// parent-gate.test.ts.

jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
const mockRouter = { push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-notifications', () => ({
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  dismissAllNotificationsAsync: jest.fn(async () => undefined),
}));
const mockCapture = {
  isAvailableAsync: jest.fn(async () => true),
  preventScreenCaptureAsync: jest.fn(async () => undefined),
  allowScreenCaptureAsync: jest.fn(async () => undefined),
  enableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
  disableAppSwitcherProtectionAsync: jest.fn(async () => undefined),
};
// The native modules are "in the build" here (the check for a missing one is tested in native-missing.test.ts).
jest.mock('@/utils/native-available', () => ({ hasNativeModule: () => true }));
jest.mock('expo-screen-capture', () => mockCapture);
const mockClipboard = { setStringAsync: jest.fn(async () => true), getStringAsync: jest.fn(async () => '') };
jest.mock('expo-clipboard', () => mockClipboard);

const en = (key: Parameters<typeof translate>[1]) => translate('en', key);
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const typeDigits = async (digits: string) => {
  for (const d of digits) await press(d);
};
const flush = async () => act(async () => {});
const shownCode = () => {
  const node = screen.getByLabelText(/^Recovery code\. /);
  return (node.props.accessibilityLabel as string).replace('Recovery code. ', '').replace(/[ ,]/g, '').replace(/(.{5})(?=.)/g, '$1-');
};
async function toCodeScreen(pin = '4829') {
  const view = await render(<ParentSecurityScreen />);
  await screen.findByText(en('psIntroTitle'));
  await press(en('psContinue'));
  await typeDigits(pin);
  await press(en('psNext'));
  await typeDigits(pin);
  await press(en('psNext'));
  await screen.findByText(en('psCodeTitle'));
  return view;
}

beforeEach(async () => {
  resetSecure();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockClipboard.getStringAsync.mockImplementation(async () => '');
  setCurrentLanguage('en');
  lockParentArea();
  expect(startParentAuth({ enabled: true })).toBe(true);
});

describe('4-digit PINs', () => {
  test('a 4-digit PIN with repeated digits sets up and unlocks, and five wrong PINs call for the phone\'s screen lock', async () => {
    await toCodeScreen('1111');
    await press(en('rcReveal'));
    const code = shownCode();
    await press(en('psCodeSaved'));
    await typeDigits('1111');
    await fireEvent.changeText(screen.getByLabelText(en('rcFieldLabel')), code);
    await press(en('psFinish'));
    await flush();
    expect(mockRouter.replace).toHaveBeenCalledWith('/parent');
    lockParentArea();
    const gate = require('@/utils/parent-gate') as typeof import('@/utils/parent-gate');
    for (const [i, wrong] of ['1112', '1113', '1114', '1115', '1116'].entries()) {
      expect(await gate.unlockParentArea(wrong)).toEqual({ ok: false, reason: 'wrong', triesLeft: 4 - i }); // answered at once, no waiting
    }
    expect(await gate.unlockParentArea('1111')).toEqual({ ok: false, reason: 'device-check' }); // after five, the phone's screen lock is owed first
  });
});

describe('screenshots', () => {
  test('PIN-dot screens never ask for screenshot blocking', async () => {
    await render(<ParentSecurityScreen />);
    await screen.findByText(en('psIntroTitle'));
    await press(en('psContinue'));
    await typeDigits('4829');
    await press(en('psNext'));
    await typeDigits('4829');
    await flush();
    expect(mockCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(en('psShotAllow'))).toBeNull(); // no switch on a PIN screen
  });

  test('the recovery code screen blocks screenshots by default and the switch allows them for that screen only', async () => {
    await toCodeScreen();
    await flush();
    expect(mockCapture.preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByText(en('psCodeNoShot'))).toBeTruthy();
    const sw = screen.getByLabelText(en('psShotAllow'));
    expect(sw.props.value).toBe(false);

    await fireEvent(sw, 'valueChange', true);
    await flush();
    expect(mockCapture.allowScreenCaptureAsync).toHaveBeenCalled();
    expect(screen.getByText(en('psShotOn'))).toBeTruthy();
    expect(screen.queryByText(en('psCodeCaptureOff'))).toBeNull();

    await fireEvent(screen.getByLabelText(en('psShotAllow')), 'valueChange', false);
    await flush();
    expect(mockCapture.preventScreenCaptureAsync).toHaveBeenCalledTimes(2);
  });

  test('the switch is off again on the next step', async () => {
    await toCodeScreen();
    await flush();
    await fireEvent(screen.getByLabelText(en('psShotAllow')), 'valueChange', true);
    await flush();
    await press(en('psCodeSaved')); // next step ("type both"): a recovery step again
    await flush();
    expect(screen.getByLabelText(en('psShotAllow')).props.value).toBe(false);
    expect(mockCapture.preventScreenCaptureAsync.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('copying and pasting the recovery code', () => {
  test('Copy asks first, copies only after the parent agrees, and never by itself', async () => {
    await toCodeScreen();
    await press(en('rcReveal'));
    const code = shownCode();
    expect(mockClipboard.setStringAsync).not.toHaveBeenCalled(); // showing it copies nothing
    await press(en('rcCopy'));
    expect(screen.getByText(en('rcCopyTitle'))).toBeTruthy();
    expect(screen.getByText(en('rcCopyBody'))).toBeTruthy();
    expect(mockClipboard.setStringAsync).not.toHaveBeenCalled(); // the warning is up, nothing copied yet
    await fireEvent.press(screen.getAllByRole('button', { name: en('psCancel') })[0]); // the copy dialog's own Cancel (it comes before the page's)
    expect(mockClipboard.setStringAsync).not.toHaveBeenCalled();

    await press(en('rcCopy'));
    await press(en('rcCopyConfirm'));
    await flush();
    expect(mockClipboard.setStringAsync).toHaveBeenCalledTimes(1);
    expect(mockClipboard.setStringAsync).toHaveBeenCalledWith(code);
    expect(await screen.findByText(en('rcCopied'))).toBeTruthy();

    await press(en('rcHide'));
    // hiding the code takes the note and the Copy button away
    expect(screen.queryByText(en('rcCopied'))).toBeNull();
    expect(screen.queryByRole('button', { name: en('rcCopy') })).toBeNull();
  });

  test('Paste fills the field with the formatted code; an empty clipboard says so', async () => {
    await toCodeScreen();
    await press(en('rcReveal'));
    const code = shownCode();
    await press(en('psCodeSaved'));
    await typeDigits('4829');
    await press(en('rcPaste'));
    await flush();
    expect(screen.getByText(en('rcPasteEmpty'))).toBeTruthy();
    expect(screen.getByLabelText(en('rcFieldLabel')).props.value).toBe('');

    mockClipboard.getStringAsync.mockImplementation(async () => `  ${code.toLowerCase().replace(/-/g, ' ')}  `);
    await press(en('rcPaste'));
    await flush();
    expect(screen.getByLabelText(en('rcFieldLabel')).props.value).toBe(code);
    expect(screen.queryByText(en('rcPasteEmpty'))).toBeNull();
  });

  test('a clipboard that fails is reported as failed (not as "needs a newer build") instead of throwing', async () => {
    const clip = require('@/utils/clipboard') as typeof import('@/utils/clipboard');
    mockClipboard.setStringAsync.mockRejectedValueOnce(new Error('native failure'));
    await expect(clip.copyText('x')).resolves.toBe('failed');
    mockClipboard.getStringAsync.mockRejectedValueOnce(new Error('native failure'));
    await expect(clip.readClipboard()).resolves.toEqual({ kind: 'failed' });
    mockClipboard.getStringAsync.mockResolvedValueOnce('hello');
    await expect(clip.readClipboard()).resolves.toEqual({ kind: 'text', text: 'hello' });
  });
});

describe('keeping the field above the keyboard', () => {
  async function setup(frame: { y: number; height: number } | null) {
    const handlers: Record<string, (event: unknown) => void> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, cb: (event: unknown) => void) => {
      handlers[name] = cb;
      return { remove: jest.fn() };
    }) as never);
    const seen: ReturnType<typeof useKeyboardAvoidance>[] = [];
    const hook = {
      result: {
        get current() {
          return seen[seen.length - 1];
        },
      },
    };
    function Probe() {
      seen.push(useKeyboardAvoidance());
      return null;
    }
    await render(<Probe />);
    if (frame) {
      (hook.result.current.frameRef as { current: unknown }).current = {
        measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(0, frame.y, 400, frame.height),
      };
    }
    return { hook, handlers };
  }

  test('adds the overlap as bottom space when the keyboard covers the page, and removes it when the keyboard closes', async () => {
    const { hook, handlers } = await setup({ y: 0, height: 800 });
    await act(async () => handlers.keyboardDidShow({ endCoordinates: { screenY: 500, height: 300 } }));
    expect(hook.result.current.bottomInset).toBe(300);
    await act(async () => handlers.keyboardDidHide({}));
    expect(hook.result.current.bottomInset).toBe(0);
  });

  test('adds nothing when the window was already made shorter by the system', async () => {
    const { hook, handlers } = await setup({ y: 0, height: 480 });
    await act(async () => handlers.keyboardDidShow({ endCoordinates: { screenY: 500, height: 300 } }));
    expect(hook.result.current.bottomInset).toBe(0);
  });

  test('ignores a keyboard event it cannot place', async () => {
    const { hook, handlers } = await setup({ y: 0, height: 800 });
    await act(async () => handlers.keyboardDidShow({}));
    expect(hook.result.current.bottomInset).toBe(0);
  });
});

describe('leaving a recovery screen', () => {
  test('screenshot protection is released when the screen closes', async () => {
    const view = await toCodeScreen();
    await flush();
    expect(mockCapture.preventScreenCaptureAsync).toHaveBeenCalled();
    await act(async () => view.unmount());
    expect(mockCapture.allowScreenCaptureAsync).toHaveBeenCalled();
  });
});

describe('wording', () => {
  test('the PIN length messages say 4 to 8 digits in both languages, and nothing still says 6 to 8', () => {
    expect(translate('en', 'pgFormat')).toBe('Enter your Parent PIN.');
    expect(translate('es', 'pgFormat')).toBe('Escribe tu PIN de padres.');
    // the boxes that MAKE a PIN say exactly 4 digits (earlier 5 to 8 digit PINs are still accepted where a PIN is only checked)
    for (const lang of ['en', 'es'] as const) {
      for (const key of ['pePinFormat', 'psCreateBody'] as const) {
        expect(translate(lang, key)).toContain('4');
        expect(translate(lang, key)).not.toMatch(/[5-8]/);
      }
    }
    expect(translate('en', 'pePinFormat')).toBe('A PIN needs exactly 4 digits.');
    expect(translate('es', 'pePinFormat')).toBe('Un PIN necesita exactamente 4 dígitos.');
  });
});

describe('a copy that did not happen is never reported as success', () => {
  test('a false result from the clipboard is "unavailable" at every level', async () => {
    const clip = require('@/utils/clipboard') as typeof import('@/utils/clipboard');
    mockClipboard.setStringAsync.mockResolvedValueOnce(false as never);
    await expect(clip.copyText('x')).resolves.toBe('failed');
    mockClipboard.setStringAsync.mockResolvedValueOnce(undefined as never);
    await expect(clip.copyText('x')).resolves.toBe('failed');
    await expect(clip.copyText('x')).resolves.toBe('copied');
  });

  test('the screen shows "not available", not "copied", when the clipboard says no', async () => {
    await toCodeScreen();
    await press(en('rcReveal'));
    mockClipboard.setStringAsync.mockResolvedValueOnce(false as never);
    await press(en('rcCopy'));
    await press(en('rcCopyConfirm'));
    expect(await screen.findByText(en('rcCopyFailed'))).toBeTruthy();
    expect(screen.queryByText(en('rcCopied'))).toBeNull();
    expect(screen.queryByText(en('rcCopyNeedsUpdate'))).toBeNull();
  });
});

describe('hiding the code takes the Copy question and note away for good', () => {
  const display = (revealed: boolean) => <RecoveryCodeDisplay code="ABCDE-FGHIJ-KLMNP-QRSTV-WXYZ0" revealed={revealed} onReveal={() => {}} onHide={() => {}} />;

  test('a note from before does not come back when the code is shown again', async () => {
    const view = await render(display(true));
    await press(en('rcCopy'));
    await press(en('rcCopyConfirm'));
    expect(await screen.findByText(en('rcCopied'))).toBeTruthy();
    await view.rerender(display(false));
    await view.rerender(display(true));
    expect(screen.queryByText(en('rcCopied'))).toBeNull();
  });

  test('a pending Copy question is closed by hiding and does not reappear', async () => {
    const view = await render(display(true));
    await press(en('rcCopy'));
    expect(screen.getByText(en('rcCopyTitle'))).toBeTruthy();
    await view.rerender(display(false));
    expect(screen.queryByText(en('rcCopyTitle'))).toBeNull();
    await view.rerender(display(true));
    expect(screen.queryByText(en('rcCopyTitle'))).toBeNull();
  });

  test('a copy that finishes after the code was hidden leaves no note behind', async () => {
    let finish!: (ok: boolean) => void;
    mockClipboard.setStringAsync.mockImplementationOnce(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const view = await render(display(true));
    await press(en('rcCopy'));
    await press(en('rcCopyConfirm'));
    await view.rerender(display(false));
    await act(async () => finish(true));
    await view.rerender(display(true));
    expect(screen.queryByText(en('rcCopied'))).toBeNull();
    expect(screen.queryByText(en('rcCopyFailed'))).toBeNull();
  });
});

describe('nothing sensitive appears before the screen protection is in place', () => {
  test('"Show code" stays off until the block has been asked for', async () => {
    let settle!: (available: boolean) => void;
    mockCapture.isAvailableAsync.mockImplementationOnce(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    await toCodeScreen();
    expect(screen.getByRole('button', { name: en('rcReveal') }).props.accessibilityState).toMatchObject({ disabled: true });
    expect(mockCapture.preventScreenCaptureAsync).not.toHaveBeenCalled();
    await act(async () => settle(true));
    await flush();
    expect(mockCapture.preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: en('rcReveal') }).props.accessibilityState).toMatchObject({ disabled: false });
  });

  test('moving on from a step where screenshots were allowed protects the next step before its field or Paste work', async () => {
    await toCodeScreen();
    await flush();
    await fireEvent(screen.getByLabelText(en('psShotAllow')), 'valueChange', true);
    await flush();
    expect(mockCapture.allowScreenCaptureAsync).toHaveBeenCalled();
    mockCapture.preventScreenCaptureAsync.mockClear();

    let settle!: (available: boolean) => void;
    mockCapture.isAvailableAsync.mockImplementationOnce(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    await press(en('psCodeSaved')); // the next recovery step: the leftover choice must not carry over, from the very first render
    expect(screen.getByLabelText(en('psShotAllow')).props.value).toBe(false);
    expect(screen.getByLabelText(en('rcFieldLabel')).props.editable).toBe(false);
    expect(screen.getByRole('button', { name: en('rcPaste') }).props.accessibilityState).toMatchObject({ disabled: true });

    await act(async () => settle(true));
    await flush();
    expect(mockCapture.preventScreenCaptureAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(en('rcFieldLabel')).props.editable).toBe(true);
    expect(screen.getByRole('button', { name: en('rcPaste') }).props.accessibilityState).toMatchObject({ disabled: false });
  });

  test('when the parent allows screenshots the page is usable at once (no wait for a block that is not wanted)', async () => {
    await toCodeScreen();
    await flush();
    await fireEvent(screen.getByLabelText(en('psShotAllow')), 'valueChange', true);
    expect(screen.getByRole('button', { name: en('rcReveal') }).props.accessibilityState).toMatchObject({ disabled: false });
  });
});
