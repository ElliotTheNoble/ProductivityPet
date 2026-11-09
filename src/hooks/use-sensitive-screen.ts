import { useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { hasNativeModule } from '@/utils/native-available';
import { subscribeToActiveProfile } from '@/utils/profiles';

// Privacy for a screen that shows or collects a PIN or a recovery code. While the screen is mounted:
//  - screenshots and screen recordings are blocked where the platform allows it (expo-screen-capture), UNLESS the caller passes
//    `blockCapture: false`. The PIN-dot screens do (they show only dots, never a digit, so a screenshot reveals nothing); the
//    recovery-code screens block by default and let the parent switch it off for that screen ("Allow screenshots on this screen"):
//      Android: one call (the FLAG_SECURE window flag) blocks screenshots and recordings AND blanks the recent-apps preview;
//      iOS: blocks screenshots (iOS 13+) and recordings (iOS 11+), but the app-switcher preview needs a separate blur
//           overlay, which is switched on here too.
//    These two platforms do NOT behave the same, so the result below says what this device can really do.
//  - `onClear` is called when the app leaves the foreground and when the active profile changes, so the screen can wipe
//    typed digits and hide any recovery code. (The Parent Gate separately locks the parent area on both.)
// The native module is loaded only here, only on a phone, and a missing module simply means "no protection available".

type ScreenCapture = typeof import('expo-screen-capture');

function load(): ScreenCapture | null {
  if (Platform.OS === 'web') return null;
  // Asked first: a build without the native module must not even try to load the package (see @/utils/native-available.ts).
  if (!hasNativeModule('ExpoScreenCapture')) return null;
  try {
    return require('expo-screen-capture') as ScreenCapture;
  } catch {
    return null;
  }
}

export type PrivacyCapabilities = {
  // Screenshots and screen recordings are blocked on this device.
  blocksCapture: boolean;
  // The recent-apps / app-switcher preview of this screen is hidden.
  hidesAppSwitcher: boolean;
  // Capture was deliberately not blocked here (`blockCapture: false`), so "can't block" is not a problem to warn about.
  unblocked: boolean;
};

// null until it is known.
export function useSensitiveScreen(onClear: () => void, key = 'parent-pin', options: { blockCapture?: boolean } = {}): PrivacyCapabilities | null {
  const blockCapture = options.blockCapture ?? true;
  const [capabilities, setCapabilities] = useState<PrivacyCapabilities | null>(null);
  const clearRef = useRef(onClear);
  clearRef.current = onClear;

  useEffect(() => {
    // Whenever blocking is (re)started the answer is unknown again until the block has been asked for, so a screen that wants to
    // wait for it (recovery-code screens) never treats a leftover answer from the previous step as protection.
    if (blockCapture) setCapabilities(null);
    let cancelled = false;
    let prevented = false;
    let blurred = false;
    const capture = blockCapture ? load() : null;

    const release = (sc: ScreenCapture) => {
      if (prevented) void sc.allowScreenCaptureAsync(key).catch(() => {});
      if (blurred) void sc.disableAppSwitcherProtectionAsync().catch(() => {});
    };

    void (async () => {
      let blocks = false;
      let switcher = false;
      if (capture) {
        let available = false;
        try {
          available = await capture.isAvailableAsync();
        } catch {
          available = false;
        }
        if (available) {
          try {
            await capture.preventScreenCaptureAsync(key);
            prevented = true;
            blocks = true;
            switcher = Platform.OS === 'android'; // FLAG_SECURE also blanks the recent-apps preview
          } catch {
            blocks = false;
          }
          if (Platform.OS === 'ios') {
            try {
              await capture.enableAppSwitcherProtectionAsync(1);
              blurred = true;
              switcher = true;
            } catch {
              // no switcher protection
            }
          }
        }
        if (cancelled) release(capture); // the screen was closed while this was starting
      }
      if (!cancelled) setCapabilities({ blocksCapture: blocks, hidesAppSwitcher: switcher, unblocked: !blockCapture });
    })();

    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') clearRef.current();
    });
    const off = subscribeToActiveProfile(() => clearRef.current());

    return () => {
      cancelled = true;
      sub?.remove();
      off();
      if (capture) release(capture);
    };
  }, [key, blockCapture]);

  return capabilities;
}
