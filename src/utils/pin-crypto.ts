import { scryptAsync } from '@noble/hashes/scrypt';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

import { DEFAULT_KDF, type KdfParams } from '@/utils/kdf-params';
import { recordDeriveTime } from '@/utils/pin-timing';
import { secureRandomBytes, type RandomBytes } from '@/utils/secure-random';

// PIN and recovery-code verification primitives. Nothing here stores anything.
//
// A secret (PIN or recovery code) is never stored. What is stored is a SecretRecord: the key-derivation settings, a random
// 16-byte salt from the operating system, and the 32-byte scrypt output. scrypt comes from @noble/hashes (an audited,
// widely used library); no hash or key-derivation function is written here. PIN and recovery code use different
// "domains", so a record made for one can never be used to check the other.
//
// Honest limit: a 4-8 digit PIN has few possibilities (a 4-digit one only 10,000), so ANY stored verifier that someone can read can
// be guessed offline, whatever the settings. The protection comes from keeping the record in native secure storage (where an app
// user cannot read it) plus the attempt limits in parent-gate.ts (3 free tries, then 30 seconds, 5, 15 and finally 60 minutes per
// try); scrypt only makes each offline guess slower.

export type SecretDomain = 'pin' | 'recovery';

export type SecretRecord = { kdf: KdfParams; salt: string; hash: string };

const SALT_BYTES = 16;
const MAX_N = 2 ** 17;
const MIN_N = 2 ** 10;

function validKdf(k: unknown): k is KdfParams {
  if (!k || typeof k !== 'object') return false;
  const p = k as Record<string, unknown>;
  const N = p.N;
  return (
    p.alg === 'scrypt' &&
    typeof N === 'number' && Number.isInteger(N) && N >= MIN_N && N <= MAX_N && (N & (N - 1)) === 0 &&
    typeof p.r === 'number' && Number.isInteger(p.r) && p.r >= 1 && p.r <= 16 &&
    typeof p.p === 'number' && Number.isInteger(p.p) && p.p >= 1 && p.p <= 4 &&
    p.dkLen === 32
  );
}

const HEX = /^[0-9a-f]+$/;
export function isSecretRecord(value: unknown): value is SecretRecord {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return (
    validKdf(r.kdf) &&
    typeof r.salt === 'string' && r.salt.length === SALT_BYTES * 2 && HEX.test(r.salt) &&
    typeof r.hash === 'string' && r.hash.length === 64 && HEX.test(r.hash)
  );
}

async function derive(domain: SecretDomain, secret: string, salt: Uint8Array, kdf: KdfParams): Promise<Uint8Array> {
  // The domain is part of the secret, so the two kinds of record can never be swapped.
  const input = utf8ToBytes(`productivitypet:${domain}:v1:${secret}`);
  const started = Date.now();
  const key = await scryptAsync(input, salt, { N: kdf.N, r: kdf.r, p: kdf.p, dkLen: kdf.dkLen, asyncTick: 10 });
  recordDeriveTime(Date.now() - started, kdf.N); // development-only timing of this step (never the secret), see pin-timing.ts
  return key;
}

// Takes the same time however many leading bytes match.
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function makeSecretRecord(
  domain: SecretDomain,
  secret: string,
  random: RandomBytes = secureRandomBytes,
  kdf: KdfParams = DEFAULT_KDF
): Promise<SecretRecord> {
  const salt = await random(SALT_BYTES);
  const hash = await derive(domain, secret, salt, kdf);
  return { kdf, salt: bytesToHex(salt), hash: bytesToHex(hash) };
}

// false for a wrong secret AND for a record that is not valid.
export async function checkSecret(domain: SecretDomain, secret: string, record: SecretRecord): Promise<boolean> {
  if (!isSecretRecord(record)) return false;
  const hash = await derive(domain, secret, hexToBytes(record.salt), record.kdf);
  return equalBytes(hash, hexToBytes(record.hash));
}

// ---------------------------------------------------------------------------------------------------------
// PIN rules

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

// 'weak' is no longer returned (simple PINs are allowed, see isSimplePin); the member stays so existing callers still type-check.
export type PinPolicyResult = { ok: true } | { ok: false; reason: 'format' | 'weak' };

// A new PIN is 4 to 8 digits. Repeats (1111) and runs (1234) are ALLOWED: the screens show a non-blocking note instead.
export function validateNewPin(pin: string): PinPolicyResult {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) return { ok: false, reason: 'format' };
  return { ok: true };
}

// True for a PIN that is easy to guess: all the same digit, a straight run up or down, or a short block repeated (121212, 123123).
// Only used to show a note; it never rejects a PIN.
export function isSimplePin(pin: string): boolean {
  if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) return false;
  const d = Array.from(pin, Number);
  if (d.every((x) => x === d[0])) return true;
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return true;
  for (let block = 1; block <= 4; block += 1) {
    if (pin.length % block === 0 && pin.length / block >= 2 && pin === pin.slice(0, block).repeat(pin.length / block)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------
// recovery code: 120 random bits as 24 characters (Crockford base32: no I, L, O or U) plus one check character, shown in
// five groups of five. The check character (Luhn mod 32) catches a mistyped character without counting as a wrong guess.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_BYTES = 15;
const DATA_CHARS = 24;

function checkChar(data: string): string {
  let factor = 2;
  let sum = 0;
  for (let i = data.length - 1; i >= 0; i -= 1) {
    const cp = ALPHABET.indexOf(data[i]);
    let addend = factor * cp;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }
  return ALPHABET[(32 - (sum % 32)) % 32];
}

function toBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  return out;
}

// A new recovery code in its display form: "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX". Shown to the parent once and never stored.
export async function generateRecoveryCode(random: RandomBytes = secureRandomBytes): Promise<string> {
  const bytes = await random(RECOVERY_CODE_BYTES);
  if (bytes.length !== RECOVERY_CODE_BYTES) throw new Error('secure random bytes unavailable');
  const data = toBase32(bytes); // 15 bytes = 120 bits = exactly 24 characters
  const full = data + checkChar(data);
  return full.match(/.{5}/g)!.join('-');
}

// The canonical form of a typed code (upper case, no spaces or dashes, O->0 and I/L->1), or null when it cannot be a valid
// code (wrong length, a character outside the alphabet, or a wrong check character).
export function normalizeRecoveryCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const cleaned = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (cleaned.length !== DATA_CHARS + 1) return null;
  for (const ch of cleaned) if (ALPHABET.indexOf(ch) < 0) return null;
  return checkChar(cleaned.slice(0, DATA_CHARS)) === cleaned[DATA_CHARS] ? cleaned : null;
}
