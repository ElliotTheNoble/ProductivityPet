import { Platform } from 'react-native';

// The operating system's device security check (src/utils/device-auth.ts). Only an explicit `success: true` counts; everything else, a
// missing module, a device without any screen lock and the browser included, is refused with no fallback.

type La = { level: unknown; result: unknown; throws: boolean; calls: number };
const g = globalThis as unknown as { __la: La };

jest.mock('expo-local-authentication', () => {
  const state = (globalThis as unknown as { __la: La });
  return {
    SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
    getEnrolledLevelAsync: jest.fn(async () => state.__la.level),
    authenticateAsync: jest.fn(async () => {
      state.__la.calls += 1;
      if (state.__la.throws) throw new Error('native failure');
      return state.__la.result;
    }),
  };
});

import { authenticateDevice } from '@/utils/device-auth';

beforeEach(() => {
  g.__la = { level: 1, result: { success: true }, throws: false, calls: 0 };
});

const run = () => authenticateDevice('Confirm', 'Cancel');

describe('a successful check', () => {
  test.each([1, 2, 3])('is accepted when the system says success, at security level %s', async (level) => {
    g.__la.level = level;
    expect(await run()).toEqual({ ok: true });
    expect(g.__la.calls).toBe(1);
  });

  test('only an explicit success: true counts (anything else that looks like success is refused)', async () => {
    for (const result of [{ success: 'yes' }, { success: 1 }, {}, null, undefined, 'ok', { success: false }]) {
      g.__la.result = result;
      expect(await run()).toMatchObject({ ok: false });
    }
  });
});

describe('the options sent to the system', () => {
  test('the device passcode stays allowed next to biometrics (disableDeviceFallback is false), with the prompt and cancel texts', async () => {
    const native = require('expo-local-authentication') as { authenticateAsync: jest.Mock };
    native.authenticateAsync.mockClear();
    await run();
    expect(native.authenticateAsync).toHaveBeenCalledTimes(1);
    expect(native.authenticateAsync).toHaveBeenCalledWith({ promptMessage: 'Confirm', cancelLabel: 'Cancel', disableDeviceFallback: false });
  });
});

describe('a check that does not succeed changes nothing and says why', () => {
  test.each([
    ['user_cancel', 'cancelled'],
    ['system_cancel', 'cancelled'],
    ['app_cancel', 'cancelled'],
    ['user_fallback', 'cancelled'],
    ['not_enrolled', 'not-secured'],
    ['passcode_not_set', 'not-secured'],
    ['lockout', 'lockout'],
    ['not_available', 'unavailable'],
    ['authentication_failed', 'failed'],
    ['timeout', 'failed'],
    ['unable_to_process', 'failed'],
    ['no_space', 'failed'],
    ['invalid_context', 'failed'],
    ['unknown', 'failed'],
    ['something_new', 'failed'],
    ['missing_usage_description', 'failed'],
  ])('%s -> %s', async (error, reason) => {
    g.__la.result = { success: false, error };
    expect(await run()).toEqual({ ok: false, reason });
  });

  test('a failure with no error code is a plain failure', async () => {
    g.__la.result = { success: false };
    expect(await run()).toEqual({ ok: false, reason: 'failed' });
  });
});

describe('no device security is refused up front, with no fallback', () => {
  test('a device with no screen lock or biometrics (level none) is refused and the system prompt is never shown', async () => {
    g.__la.level = 0;
    expect(await run()).toEqual({ ok: false, reason: 'not-secured' });
    expect(g.__la.calls).toBe(0);
  });

  test('an unknown security level is refused too', async () => {
    for (const level of [undefined, null, 'secret', NaN]) {
      g.__la.level = level;
      const result = await run();
      expect(result.ok).toBe(false);
    }
    expect(g.__la.calls).toBe(0);
  });
});

describe('everything else fails closed', () => {
  test('a native error is "unavailable", never a success', async () => {
    g.__la.throws = true;
    expect(await run()).toEqual({ ok: false, reason: 'unavailable' });
  });

  test('the browser is refused: the native check does not exist there and none is simulated', async () => {
    const spy = jest.replaceProperty(Platform, 'OS', 'web');
    expect(await run()).toEqual({ ok: false, reason: 'unsupported' });
    expect(g.__la.calls).toBe(0);
    spy.restore();
  });

  test('a build without the native module is "unsupported"', async () => {
    jest.resetModules();
    jest.doMock('expo-local-authentication', () => {
      throw new Error('Cannot find native module');
    });
    let result: unknown;
    await jest.isolateModulesAsync(async () => {
      const fresh = require('@/utils/device-auth') as typeof import('@/utils/device-auth');
      result = await fresh.authenticateDevice('Confirm', 'Cancel');
    });
    expect(result).toEqual({ ok: false, reason: 'unsupported' });
    jest.dontMock('expo-local-authentication');
  });
});

describe('where it may be used', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel: string): string => fs.readFileSync(path.resolve(rel), 'utf8');
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.resolve(dir), { withFileTypes: true }).flatMap((e: { name: string; isDirectory(): boolean }) => {
      const rel = `${dir}/${e.name}`;
      return e.isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(e.name) ? [rel] : [];
    });

  test('only the protected-setup screen imports it, and nothing imports the native module directly', () => {
    const files: string[] = walk('src');
    const importers = files.filter((f) => /from '@\/utils\/device-auth'/.test(read(f)));
    expect(importers).toEqual(['src/components/parent-setup-claim.tsx']);
    const native = files.filter((f) => /expo-local-authentication/.test(read(f).replace(/\/\/.*$/gm, '')));
    expect(native).toEqual(['src/utils/device-auth.ts']);
  });

  test('it never unlocks anything: the parent gate, the PIN module and the picker do not use it', () => {
    for (const f of ['src/utils/parent-gate.ts', 'src/utils/parent-pin.ts', 'src/utils/parent-session.ts', 'src/components/family-picker.tsx']) {
      expect(read(f)).not.toMatch(/device-auth|authenticateDevice|expo-local-authentication/);
    }
  });
});
