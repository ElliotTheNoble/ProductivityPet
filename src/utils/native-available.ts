import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// Is this native module part of the app that is running? Asked BEFORE its JavaScript package is loaded.
//
// Why: loading a package whose native module is missing (an older development build) throws while the package loads, and Metro's
// module loader does not pass such an error on to the caller: outside another module's start-up it hands it to the global fatal
// error reporter ("Uncaught Error: Cannot find native module ..." on the screen) and returns nothing, so a `try/catch` around
// `require(...)` never sees it. `requireOptionalNativeModule` answers with null instead of throwing, so the package is only
// loaded when its native side is really there.
//
// The web has no native modules (the packages bring their own web code), so it is always "available" there.
export function hasNativeModule(name: string): boolean {
  if (Platform.OS === 'web') return true;
  try {
    return requireOptionalNativeModule(name) != null;
  } catch {
    return false;
  }
}
