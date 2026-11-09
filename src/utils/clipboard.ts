import { hasNativeModule } from '@/utils/native-available';

// The system clipboard (expo-clipboard), used ONLY for the recovery code: copying it after the parent agreed to the warning, and
// pasting a code into the code field. The native module is loaded here, on demand, and a build that does not contain it (an older
// development build) simply reports "unavailable"; nothing else in the app depends on it. Nothing here logs, stores or keeps a copy
// of the text it is given or returns.

type Clip = typeof import('expo-clipboard');

function load(): Clip | null {
  // Asked first: a build without the native module must not even try to load the package (see @/utils/native-available.ts).
  if (!hasNativeModule('ExpoClipboard')) return null;
  try {
    return require('expo-clipboard') as Clip;
  } catch {
    return null;
  }
}

// 'needs-update': this build of the app does not contain the clipboard module (an older development build) - installing a newer
// build fixes it. 'failed': the module is there but the clipboard did not do it (so it is never reported as done).
export type CopyResult = 'copied' | 'needs-update' | 'failed';

export async function copyText(text: string): Promise<CopyResult> {
  const clip = load();
  if (!clip) return 'needs-update';
  try {
    // Only an explicit `true` is success: a `false` (or anything else) from the clipboard means the text was not copied.
    return (await clip.setStringAsync(text)) === true ? 'copied' : 'failed';
  } catch {
    return 'failed';
  }
}

export type ReadResult = { kind: 'text'; text: string } | { kind: 'needs-update' } | { kind: 'failed' };

// The clipboard's text ('' when it is empty), or why it could not be read.
export async function readClipboard(): Promise<ReadResult> {
  const clip = load();
  if (!clip) return { kind: 'needs-update' };
  try {
    return { kind: 'text', text: await clip.getStringAsync() };
  } catch {
    return { kind: 'failed' };
  }
}
