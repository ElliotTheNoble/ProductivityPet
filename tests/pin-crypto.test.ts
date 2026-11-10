import { generateRecoveryCode, isSecretRecord, makeSecretRecord, checkSecret, normalizeRecoveryCode, validateNewPin, isSimplePin, NEW_PIN_LENGTH, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '@/utils/pin-crypto';

import { makeLegacyRecoveryCode } from './helpers';

// Most tests use a cheap scrypt setting so the suite stays fast; the real default settings are tested in pin-crypto-real.test.ts.
jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));

const nodeRandom = async (n: number) => new Uint8Array(require('crypto').randomBytes(n));
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('secret records (PIN and recovery code verifiers)', () => {
  test('the right secret verifies, a wrong one does not', async () => {
    const record = await makeSecretRecord('pin', '135792', nodeRandom);
    expect(await checkSecret('pin', '135792', record)).toBe(true);
    expect(await checkSecret('pin', '135793', record)).toBe(false);
    expect(await checkSecret('pin', '', record)).toBe(false);
    expect(await checkSecret('pin', '1357920', record)).toBe(false);
  });

  test('the record holds settings, a random 16-byte salt and a 32-byte hash, and never the secret', async () => {
    const record = await makeSecretRecord('pin', '135792', nodeRandom);
    expect(isSecretRecord(record)).toBe(true);
    expect(record.kdf).toMatchObject({ alg: 'scrypt', r: 8, p: 1, dkLen: 32 });
    expect(record.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(record)).not.toContain('135792');
  });

  test('every record gets its own random salt, so the same secret never gives the same record', async () => {
    const a = await makeSecretRecord('pin', '135792', nodeRandom);
    const b = await makeSecretRecord('pin', '135792', nodeRandom);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  test('a PIN record can never be used as a recovery-code record (separate domains)', async () => {
    const record = await makeSecretRecord('pin', '135792', nodeRandom);
    expect(await checkSecret('recovery', '135792', record)).toBe(false);
    const other = await makeSecretRecord('recovery', '135792', nodeRandom);
    expect(await checkSecret('pin', '135792', other)).toBe(false);
  });

  test('the salt comes from the injected secure source; a source that fails or returns too little makes creation fail', async () => {
    const fixed = new Uint8Array(16).fill(7);
    const record = await makeSecretRecord('pin', '135792', async () => fixed);
    expect(record.salt).toBe('07'.repeat(16));
    await expect(makeSecretRecord('pin', '135792', async () => { throw new Error('no secure random'); })).rejects.toThrow();
  });

  test('records with invalid or dangerous settings are rejected (never verified)', async () => {
    const good = await makeSecretRecord('pin', '135792', nodeRandom);
    for (const bad of [
      { ...good, kdf: { ...good.kdf, N: 1000 } }, // not a power of two
      { ...good, kdf: { ...good.kdf, N: 2 ** 20 } }, // far too large
      { ...good, kdf: { ...good.kdf, N: 2 ** 5 } }, // far too small
      { ...good, kdf: { ...good.kdf, r: 0 } },
      { ...good, kdf: { ...good.kdf, p: 99 } },
      { ...good, kdf: { ...good.kdf, alg: 'sha256' } },
      { ...good, salt: 'zz'.repeat(16) },
      { ...good, hash: good.hash.slice(2) },
      null,
      'text',
    ]) {
      expect(isSecretRecord(bad)).toBe(false);
      expect(await checkSecret('pin', '135792', bad as never)).toBe(false);
    }
  });

  test('settings are stored per record: a record keeps verifying with the settings it was made with', async () => {
    const cheap = await makeSecretRecord('pin', '135792', nodeRandom, { alg: 'scrypt', N: 2 ** 11, r: 8, p: 1, dkLen: 32 });
    expect(cheap.kdf.N).toBe(2048);
    expect(await checkSecret('pin', '135792', cheap)).toBe(true);
  });
});

describe('PIN rules', () => {
  test.each(['4829', '2580', '7316', '0000', '1111', '1234'])('%s is accepted as a new PIN', (pin) => {
    expect(validateNewPin(pin)).toEqual({ ok: true });
  });
  // A NEW PIN is exactly 4 digits: anything shorter or longer (including the 5 to 8 digit PINs that older versions allowed) is refused.
  test.each(['', '1', '123', '12345', '135792', '246801', '90817263', '123456789', 'abcd', '12 34', '123a', '12.4', '١٢٣٤'])('%j is not a valid new PIN', (pin) => {
    expect(validateNewPin(pin)).toEqual({ ok: false, reason: 'format' });
  });
  // Simple PINs are ALLOWED (the screens only show a note); none is ever refused as "weak".
  test.each(['1111', '0000', '1234', '4321', '1212', '2222', '9876'])('%s is accepted, and is recognised as a simple PIN', (pin) => {
    expect(validateNewPin(pin)).toEqual({ ok: true });
    expect(isSimplePin(pin)).toBe(true);
  });
  test.each(['4829', '2580', '7316', '1357'])('%s is not a simple PIN', (pin) => {
    expect(isSimplePin(pin)).toBe(false);
  });
  test('the simple-PIN note still recognises the longer PINs of earlier versions', () => {
    expect(isSimplePin('000000')).toBe(true);
    expect(isSimplePin('12341234')).toBe(true);
    expect(isSimplePin('135792')).toBe(false);
  });
  test('a new PIN is 4 digits; an existing PIN is checked as 4 to 8 digits', () => {
    expect(NEW_PIN_LENGTH).toBe(4);
    expect(PIN_MIN_LENGTH).toBe(4);
    expect(PIN_MAX_LENGTH).toBe(8);
  });
});

describe('recovery codes', () => {
  const NEW_FORMAT = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

  test('a new code is 10 random characters in two groups of five (XXXXX-XXXXX)', async () => {
    const code = await generateRecoveryCode(nodeRandom);
    expect(code).toMatch(NEW_FORMAT);
    expect(code.replace(/-/g, '')).toHaveLength(10);
  });

  test('codes are different every time (500 of them)', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 500; i += 1) codes.add(await generateRecoveryCode(nodeRandom));
    expect(codes.size).toBe(500);
  });

  test('every one of the 10 characters is random: they are exactly the first 50 bits of the 7 random bytes (checked with an independent decoder)', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252]);
    const code = await generateRecoveryCode(async () => bytes);
    let bits = '';
    for (const ch of code.replace(/-/g, '')) bits += ALPHABET.indexOf(ch).toString(2).padStart(5, '0');
    const expected = Array.from(bytes).map((b) => b.toString(2).padStart(8, '0')).join('').slice(0, 50);
    expect(bits).toBe(expected);
    expect(await generateRecoveryCode(async () => new Uint8Array(7))).toBe('00000-00000');
    expect(await generateRecoveryCode(async () => new Uint8Array(7).fill(255))).toBe('ZZZZZ-ZZZZZ');
  });

  test('all 32 characters of the alphabet turn up, evenly enough (no character is favoured)', async () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i += 1) {
      for (const ch of (await generateRecoveryCode(nodeRandom)).replace(/-/g, '')) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect(counts.size).toBe(32);
    // 40,000 characters over 32 symbols: about 1250 each; a very generous band
    for (const n of counts.values()) expect(n).toBeGreaterThan(1000);
    for (const n of counts.values()) expect(n).toBeLessThan(1500);
  });

  test('a generator that returns the wrong amount of randomness fails instead of producing a weak code', async () => {
    await expect(generateRecoveryCode(async () => new Uint8Array(3))).rejects.toThrow();
    await expect(generateRecoveryCode(async () => new Uint8Array(15))).rejects.toThrow();
    await expect(generateRecoveryCode(async () => { throw new Error('no secure random'); })).rejects.toThrow();
  });

  test('typing is forgiving: lower case, spaces, missing dashes, O/0 and I/L/1 mix-ups', async () => {
    const code = await generateRecoveryCode(nodeRandom);
    const canonical = normalizeRecoveryCode(code)!;
    expect(canonical).toHaveLength(10);
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace(/-/g, ' '))).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace(/-/g, ''))).toBe(canonical);
    expect(normalizeRecoveryCode(`  ${code}  `)).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace(/0/g, 'o').replace(/1/g, 'l'))).toBe(canonical);
  });

  test('any other length, a character outside the alphabet, or empty input is rejected', async () => {
    const code = (await generateRecoveryCode(nodeRandom)).replace(/-/g, '');
    for (const bad of ['', code.slice(1), code + 'A', code.slice(0, 9) + 'U', 'U'.repeat(10), '😀'.repeat(10), 'ABCDE-FGHJ', 'A'.repeat(24), 'A'.repeat(26), 12345 as never, null as never]) {
      expect(normalizeRecoveryCode(bad as string)).toBeNull();
    }
  });

  describe('earlier 25-character codes stay valid', () => {
    test('a legacy code is recognised, in any typing style, with its check character', () => {
      const legacy = makeLegacyRecoveryCode();
      expect(legacy).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/);
      const canonical = normalizeRecoveryCode(legacy)!;
      expect(canonical).toHaveLength(25);
      expect(normalizeRecoveryCode(legacy.toLowerCase().replace(/-/g, ' '))).toBe(canonical);
      expect(normalizeRecoveryCode(legacy.replace(/0/g, 'o').replace(/1/g, 'l'))).toBe(canonical);
    });

    test('any single mistyped character of a legacy code is caught by its check character (a typo is not a guess)', () => {
      const code = makeLegacyRecoveryCode().replace(/-/g, '');
      let undetected = 0;
      for (let i = 0; i < 25; i += 1) {
        for (const ch of ALPHABET) {
          if (ch === code[i]) continue;
          const mistyped = code.slice(0, i) + ch + code.slice(i + 1);
          if (normalizeRecoveryCode(mistyped) !== null) undetected += 1;
        }
      }
      expect(undetected).toBe(0);
    });

    test('a record made from a legacy code still verifies it, and a new code cannot be mistaken for it', async () => {
      const legacy = normalizeRecoveryCode(makeLegacyRecoveryCode())!;
      const record = await makeSecretRecord('recovery', legacy, nodeRandom);
      expect(await checkSecret('recovery', legacy, record)).toBe(true);
      const fresh = normalizeRecoveryCode(await generateRecoveryCode(nodeRandom))!;
      expect(await checkSecret('recovery', fresh, record)).toBe(false);
    });
  });
});
