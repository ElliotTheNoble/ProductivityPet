// The key-derivation settings for new PIN and recovery-code records (kept in their own file so tests can use cheaper ones).
//
// scrypt, N = 2^15, r = 8, p = 1 uses about 32 MiB and was measured at roughly 0.1 s in Node. It has NOT been measured on
// a phone: React Native's Hermes engine has no JIT and is typically several times slower for this kind of loop, so these
// numbers MUST be benchmarked on real low-end Android and iPhone devices before release (see FEATURE-088). The settings
// are stored inside every record, so a record keeps verifying with the settings it was made with if these change later.
export type KdfParams = { alg: 'scrypt'; N: number; r: number; p: number; dkLen: 32 };

export const DEFAULT_KDF: KdfParams = { alg: 'scrypt', N: 2 ** 15, r: 8, p: 1, dkLen: 32 };
