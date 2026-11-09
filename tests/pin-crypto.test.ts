import { generateRecoveryCode, isSecretRecord, makeSecretRecord, checkSecret, normalizeRecoveryCode, validateNewPin, isSimplePin, PIN_MIN_LENGTH, PIN_MAX_LENGTH } from '@/utils/pin-crypto';

// Most tests use a cheap scrypt setting so the suite stays fast; the real default settings are tested in pin-crypto-real.test.ts.
jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));

const nodeRandom = async (n: number) => new Uint8Array(require('crypto').randomBytes(n));
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_FORMAT = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/;

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
  test.each(['135792', '246801', '90817263', '472916', '4829', '73514'])('%s is accepted', (pin) => {
    expect(validateNewPin(pin)).toEqual({ ok: true });
  });
  test.each(['', '1', '123', '123456789', 'abcdef', '12 3456', '12345a', '1234.5', '١٢٣٤'])('%j has the wrong format', (pin) => {
    expect(validateNewPin(pin)).toEqual({ ok: false, reason: 'format' });
  });
  // Simple PINs are ALLOWED (the screens only show a note); none is ever refused as "weak".
  const SIMPLE = ['1111', '0000', '1234', '4321', '000000', '999999', '11111111', '123456', '234567', '654321', '98765432', '121212', '123123', '12341234', '565656', '1212'];
  test.each(SIMPLE)('%s is accepted, and is recognised as a simple PIN', (pin) => {
    expect(validateNewPin(pin)).toEqual({ ok: true });
    expect(isSimplePin(pin)).toBe(true);
  });
  test.each(['135792', '4829', '2580', '90817263', '472916'])('%s is not a simple PIN', (pin) => {
    expect(isSimplePin(pin)).toBe(false);
  });
  test('the length limits are 4 to 8', () => {
    expect(PIN_MIN_LENGTH).toBe(4);
    expect(PIN_MAX_LENGTH).toBe(8);
  });
});

describe('recovery codes', () => {
  test('a code is 120 random bits: 24 characters plus a check character, in five groups of five', async () => {
    const code = await generateRecoveryCode(nodeRandom);
    expect(code).toMatch(CODE_FORMAT);
    expect(code.replace(/-/g, '')).toHaveLength(25);
  });

  test('codes are different every time (200 of them)', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i += 1) codes.add(await generateRecoveryCode(nodeRandom));
    expect(codes.size).toBe(200);
  });

  test('the 24 data characters are exactly the 15 random bytes (checked with an independent decoder)', async () => {
    const bytes = new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253, 254, 255, 16, 32, 64, 128, 99]);
    const code = await generateRecoveryCode(async () => bytes);
    const data = code.replace(/-/g, '').slice(0, 24);
    let bits = '';
    for (const ch of data) bits += ALPHABET.indexOf(ch).toString(2).padStart(5, '0');
    const decoded = Array.from({ length: 15 }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2));
    expect(decoded).toEqual(Array.from(bytes));
    expect(await generateRecoveryCode(async () => new Uint8Array(15))).toBe('00000-00000-00000-00000-00000');
  });

  test('a generator that returns the wrong amount of randomness fails instead of producing a weak code', async () => {
    await expect(generateRecoveryCode(async () => new Uint8Array(3))).rejects.toThrow();
    await expect(generateRecoveryCode(async () => { throw new Error('no secure random'); })).rejects.toThrow();
  });

  test('typing is forgiving: lower case, spaces, missing dashes, O/0 and I/L/1 mix-ups', async () => {
    const code = await generateRecoveryCode(nodeRandom);
    const canonical = normalizeRecoveryCode(code)!;
    expect(canonical).toHaveLength(25);
    expect(normalizeRecoveryCode(code.toLowerCase())).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace(/-/g, ' '))).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace(/-/g, ''))).toBe(canonical);
    expect(normalizeRecoveryCode(`  ${code}  `)).toBe(canonical);
    expect(normalizeRecoveryCode(code.replace(/0/g, 'o').replace(/1/g, 'l'))).toBe(canonical);
  });

  test('wrong length, a character outside the alphabet, or empty input is rejected', async () => {
    const code = (await generateRecoveryCode(nodeRandom)).replace(/-/g, '');
    for (const bad of ['', code.slice(1), code + 'A', code.slice(0, 24) + 'U', 'U'.repeat(25), '😀'.repeat(25), 12345 as never, null as never]) {
      expect(normalizeRecoveryCode(bad as string)).toBeNull();
    }
  });

  test('any single mistyped character is caught by the check character (so a typo is not counted as a guess)', async () => {
    const code = (await generateRecoveryCode(nodeRandom)).replace(/-/g, '');
    let undetected = 0;
    for (let i = 0; i < 25; i += 1) {
      for (const ch of ALPHABET) {
        if (ch === code[i]) continue;
        // the typed O/I/L aliases map to characters that are already in the alphabet, so only canonical substitutions are tried
        const mistyped = code.slice(0, i) + ch + code.slice(i + 1);
        if (normalizeRecoveryCode(mistyped) !== null) undetected += 1;
      }
    }
    expect(undetected).toBe(0);
  });
});
