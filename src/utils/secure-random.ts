// Cryptographically secure random bytes from the operating system (through expo-crypto). There is deliberately NO
// fallback to Math.random or anything else: if secure randomness is not available, creating a PIN or recovery code fails.
// expo-crypto is loaded only when it is needed, so nothing changes while family mode is off.
export async function secureRandomBytes(count: number): Promise<Uint8Array> {
  const Crypto = require('expo-crypto') as typeof import('expo-crypto');
  const bytes = await Crypto.getRandomBytesAsync(count);
  if (!(bytes instanceof Uint8Array) || bytes.length !== count) throw new Error('secure random bytes unavailable');
  return bytes;
}

export type RandomBytes = (count: number) => Promise<Uint8Array>;
