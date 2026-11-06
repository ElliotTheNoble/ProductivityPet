import { Platform } from 'react-native';

// The operating system's own security check (screen lock, fingerprint or face), through expo-local-authentication. It is used for ONE
// thing: letting a household that already has children but no Parent PIN reach the existing PIN setup (see
// @/utils/family-claim.ts and @/components/parent-setup-claim.tsx). It NEVER opens the parent area, never enters Main and never
// resets, replaces or bypasses a Parent PIN: nothing else imports this file (a test checks it).
//
// What a success means: the operating system confirmed that someone who can unlock THIS DEVICE is present. It does not say who that
// person is, and a child who knows the device passcode passes it too. Only a verified guardian account (a later milestone) can do more.
//
// Fails closed: only an explicit `success: true` from the system counts. A device with no screen lock or biometrics at all is
// refused up front ("not-secured"), with no fallback. The browser is refused too (there is no native check there and none is simulated).
export type DeviceAuthFailure = 'unsupported' | 'not-secured' | 'cancelled' | 'failed' | 'lockout' | 'unavailable';
export type DeviceAuthResult = { ok: true } | { ok: false; reason: DeviceAuthFailure };

type Native = typeof import('expo-local-authentication');

function load(): Native | null {
  try {
    return require('expo-local-authentication') as Native;
  } catch {
    return null;
  }
}

const CANCELLED = new Set(['user_cancel', 'system_cancel', 'app_cancel', 'user_fallback']);
const NOT_SECURED = new Set(['not_enrolled', 'passcode_not_set']);

export async function authenticateDevice(promptMessage: string, cancelLabel: string): Promise<DeviceAuthResult> {
  if (Platform.OS === 'web') return { ok: false, reason: 'unsupported' };
  const native = load();
  if (!native) return { ok: false, reason: 'unsupported' };
  try {
    // Some device security has to exist at all (a screen lock, or biometrics). Anything else, including an unknown answer, is refused.
    const level = await native.getEnrolledLevelAsync();
    if (typeof level !== 'number' || !Number.isFinite(level)) return { ok: false, reason: 'unavailable' };
    if (level < 1) return { ok: false, reason: 'not-secured' };
    const result = await native.authenticateAsync({ promptMessage, cancelLabel, disableDeviceFallback: false });
    if (result && result.success === true) return { ok: true };
    const error = result && result.success === false ? String(result.error) : 'unknown';
    if (CANCELLED.has(error)) return { ok: false, reason: 'cancelled' };
    if (NOT_SECURED.has(error)) return { ok: false, reason: 'not-secured' };
    if (error === 'lockout') return { ok: false, reason: 'lockout' };
    if (error === 'not_available') return { ok: false, reason: 'unavailable' };
    return { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
