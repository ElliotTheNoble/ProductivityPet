import { fireEvent, render, screen } from '@testing-library/react-native';
import { Platform, Text } from 'react-native';

import { RecoveryCodeDisplay, RecoveryCodeField } from '@/components/recovery-code';
import { useSensitiveScreen } from '@/hooks/use-sensitive-screen';
import { translate } from '@/i18n';

const fs = require('fs');
const path = require('path');

// An older development build has no ExpoClipboard / ExpoScreenCapture native module. Loading the JavaScript package of a missing
// native module throws while it loads, and Metro hands such an error to the global fatal-error reporter instead of to a surrounding
// try/catch ("Uncaught Error: Cannot find native module 'ExpoClipboard'" on the Samsung). So the packages must not be loaded at all
// when their native side is missing: the app asks first (src/utils/native-available.ts). Jest cannot reproduce Metro's loader, so
// these tests assert the cause instead: the package is never required when the module is missing, and every caller then reports
// "unavailable" without throwing.

const mockNative = { ExpoClipboard: false, ExpoScreenCapture: false };
jest.mock('@/utils/native-available', () => ({ hasNativeModule: (name: string) => mockNative[name as keyof typeof mockNative] === true }));

const mockLoads = { clipboard: 0, capture: 0 };
jest.mock('expo-clipboard', () => {
  mockLoads.clipboard += 1;
  throw new Error("Cannot find native module 'ExpoClipboard'");
});
jest.mock('expo-screen-capture', () => {
  mockLoads.capture += 1;
  throw new Error("Cannot find native module 'ExpoScreenCapture'");
});

beforeEach(() => {
  mockNative.ExpoClipboard = false;
  mockNative.ExpoScreenCapture = false;
  mockLoads.clipboard = 0;
  mockLoads.capture = 0;
});

describe('clipboard without its native module', () => {
  test('Copy and Paste say a newer build is needed, and the package is never loaded', async () => {
    const clip = require('@/utils/clipboard') as typeof import('@/utils/clipboard');
    await expect(clip.copyText('ABCDE')).resolves.toBe('needs-update');
    await expect(clip.readClipboard()).resolves.toEqual({ kind: 'needs-update' });
    expect(mockLoads.clipboard).toBe(0);
  });

  test('if the check wrongly says yes but the package still fails to load, it is "unavailable", not a crash', async () => {
    mockNative.ExpoClipboard = true;
    const clip = require('@/utils/clipboard') as typeof import('@/utils/clipboard');
    await expect(clip.copyText('ABCDE')).resolves.toBe('needs-update');
    await expect(clip.readClipboard()).resolves.toEqual({ kind: 'needs-update' });
    expect(mockLoads.clipboard).toBeGreaterThan(0);
  });
});

describe('what the person sees without the clipboard module', () => {
  const en = (key: Parameters<typeof translate>[1]) => translate('en', key);

  test('Paste says a newer development build is needed (and that the keyboard still works), not that something failed', async () => {
    await render(<RecoveryCodeField value="" onChange={() => {}} />);
    await fireEvent.press(screen.getByRole('button', { name: en('rcPaste') }));
    expect(await screen.findByText(en('rcPasteNeedsUpdate'))).toBeTruthy();
    expect(en('rcPasteNeedsUpdate')).toMatch(/newer version of this app \(a new development build\)/);
    expect(en('rcPasteNeedsUpdate')).toMatch(/paste with your keyboard/);
    expect(screen.queryByText(en('rcPasteFailed'))).toBeNull();
    expect(mockLoads.clipboard).toBe(0);
  });

  test('Copy says the same, in Spanish too', async () => {
    await render(<RecoveryCodeDisplay code="ABCDE-FGHIJ-KLMNP-QRSTV-WXYZ0" revealed onReveal={() => {}} onHide={() => {}} />);
    await fireEvent.press(screen.getByRole('button', { name: en('rcCopy') }));
    await fireEvent.press(screen.getByRole('button', { name: en('rcCopyConfirm') }));
    expect(await screen.findByText(en('rcCopyNeedsUpdate'))).toBeTruthy();
    expect(translate('es', 'rcCopyNeedsUpdate')).toMatch(/versión más nueva/);
    expect(translate('es', 'rcPasteNeedsUpdate')).toMatch(/versión más nueva/);
  });
});

describe('screen protection without its native module', () => {
  function Probe({ onResult }: { onResult: (caps: unknown) => void }) {
    onResult(useSensitiveScreen(() => {}, 'parent-pin', { blockCapture: true }));
    return <Text>probe</Text>;
  }

  test('the screen still works (nothing is blocked, and it says so) and the package is never loaded', async () => {
    let caps: unknown = 'unset';
    await render(<Probe onResult={(value) => (caps = value)} />);
    await screen.findByText('probe');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(caps).toMatchObject({ blocksCapture: false, hidesAppSwitcher: false });
    expect(mockLoads.capture).toBe(0);
  });
});

describe('the availability check itself', () => {
  const real = () => jest.requireActual('@/utils/native-available') as typeof import('@/utils/native-available');

  test('a native module that is not in this build is reported as missing, without throwing', () => {
    expect(real().hasNativeModule('ThisModuleDoesNotExist')).toBe(false);
  });

  test('on the web every package is allowed (the web has no native modules)', () => {
    const previous = Platform.OS;
    Platform.OS = 'web';
    try {
      expect(real().hasNativeModule('ThisModuleDoesNotExist')).toBe(true);
    } finally {
      Platform.OS = previous;
    }
  });
});

describe('static check', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8').replace(/\/\/.*$/gm, '');

  test.each([
    ['src/utils/clipboard.ts', 'ExpoClipboard', "require('expo-clipboard')"],
    ['src/hooks/use-sensitive-screen.ts', 'ExpoScreenCapture', "require('expo-screen-capture')"],
  ])('%s asks for the native module (%s) before it loads the package', (file, moduleName, requireCall) => {
    const src = read(file);
    const asked = src.indexOf(`hasNativeModule('${moduleName}')`);
    const loaded = src.indexOf(requireCall);
    expect(asked).toBeGreaterThan(-1);
    expect(loaded).toBeGreaterThan(asked);
  });
});
