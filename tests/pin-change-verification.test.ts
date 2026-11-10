import { makeLegacyRecoveryCode, loadApp, resetSecure, secureTest } from './helpers';

// The stronger success check of a Parent PIN change, the step codes of its failures, and the development trace. A development build with family mode
// on (switched on here); the hashing functions are wrapped so each test can make one step go wrong.

jest.mock('@/utils/dev-flags', () => ({ ...jest.requireActual('@/utils/dev-flags'), FAMILY_MODE_ENABLED: true }));
jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));
jest.mock('@/utils/pin-crypto', () => {
  const real = jest.requireActual('@/utils/pin-crypto');
  return { ...real, makeSecretRecord: jest.fn(real.makeSecretRecord), checkSecret: jest.fn(real.checkSecret) };
});

const PIN = '1357';
const NEW_PIN = '8642';
const RECORD = 'pp.parentAuth.v1';
const ATTEMPTS = 'pp.parentAuth.attempts.v1';
const record = () => JSON.parse(secureTest().map.get(RECORD)!);

async function boot() {
  resetSecure();
  const app = await loadApp();
  expect(app.pin.startParentAuth({ enabled: true })).toBe(true);
  const crypto = require('@/utils/pin-crypto') as typeof import('@/utils/pin-crypto') & {
    makeSecretRecord: jest.Mock;
    checkSecret: jest.Mock;
  };
  const begun = await app.pin.beginPinSetup(PIN);
  if (!begun.ok) throw new Error('begin ' + begun.reason);
  expect(await app.pin.confirmPinSetup(PIN, begun.recoveryCode)).toEqual({ ok: true });
  app.gate.lockParentArea();
  return { app, crypto, code: begun.recoveryCode };
}

let logs: jest.SpyInstance;
beforeEach(() => {
  logs = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => logs.mockRestore());
const printed = () => logs.mock.calls.map((call) => call.map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
const traceLines = () => printed().filter((line) => line.startsWith('[pin-trace]'));

describe('a change is shown as done only when the saved record accepts the new PIN (and, in a development build, refuses the old one)', () => {
  test('a good change checks, in order: the current PIN, the new hash, the write, the read-back, the new PIN on the saved record, the old PIN on it', async () => {
    const { app, crypto } = await boot();
    crypto.checkSecret.mockClear();
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: true });
    const events = traceLines().map((line) => line.split(' ')[1]);
    expect(events).toEqual([
      'change:start',
      'change:current-pin-checked',
      'change:new-pin-hashed',
      'change:record-written',
      'change:read-back',
      'change:new-pin-verified',
      'change:old-pin-checked',
      'change:finished',
    ]);
    // three checks: the current PIN, then the new PIN on the saved record, then the old PIN on it
    expect(crypto.checkSecret.mock.calls.map((call) => call[1])).toEqual([PIN, NEW_PIN, PIN]);
    expect(traceLines().join('\n')).toContain('"oldStillAccepted":false');
    expect(traceLines().join('\n')).toContain('"accepted":true');
  });

  test('if the saved record would still accept the OLD PIN, the change is not shown as done', async () => {
    const { app, crypto } = await boot();
    const real = jest.requireActual('@/utils/pin-crypto') as typeof import('@/utils/pin-crypto');
    crypto.checkSecret.mockImplementation(async (domain: never, secret: string, rec: never) => (secret === PIN ? true : real.checkSecret(domain, secret, rec)));
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: false, reason: 'not-verified', detail: 'old-pin-still-works' });
  });

  test('if the saved record does not accept the NEW PIN, the change is not shown as done', async () => {
    const { app, crypto } = await boot();
    const real = jest.requireActual('@/utils/pin-crypto') as typeof import('@/utils/pin-crypto');
    crypto.checkSecret.mockImplementation(async (domain: never, secret: string, rec: never) => (secret === NEW_PIN ? false : real.checkSecret(domain, secret, rec)));
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: false, reason: 'not-verified', detail: 'new-pin-does-not-match' });
  });

  test('a change to the very same PIN is allowed and does not trip the old-PIN check', async () => {
    const { app } = await boot();
    expect(await app.pin.changePin(PIN, PIN)).toEqual({ ok: true });
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });

  test('hashing the new PIN failing is "unavailable" with its step code, and nothing is written', async () => {
    const { app, crypto } = await boot();
    const before = secureTest().map.get(RECORD);
    crypto.makeSecretRecord.mockRejectedValueOnce(new Error('no memory'));
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: false, reason: 'unavailable', detail: 'hash-new' });
    expect(secureTest().map.get(RECORD)).toBe(before);
  });

  test('the step code says which part failed: the guess counter, the record write', async () => {
    const { app } = await boot();
    secureTest().failKeys.add(ATTEMPTS);
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: false, reason: 'unavailable', detail: 'attempts-write' });
    secureTest().failKeys.delete(ATTEMPTS);
    secureTest().failKeys.add(RECORD);
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: false, reason: 'unavailable', detail: 'record-write' });
    secureTest().failKeys.delete(RECORD);
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: true });
  });

  test('a wrong current PIN is a plain "wrong" with the tries left, never a verification failure', async () => {
    const { app } = await boot();
    expect(await app.pin.changePin('0000', NEW_PIN)).toEqual({ ok: false, reason: 'wrong', triesLeft: 4 });
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });
});

describe('the development trace', () => {
  test('it prints only fixed event names, numbers, true/false and fixed words: never a PIN, a recovery code, a hash, a salt or an install id', async () => {
    const { app, code } = await boot();
    const before = record();
    await app.pin.changePin('0000', NEW_PIN); // a wrong current PIN
    await app.pin.changePin(PIN, NEW_PIN); // a good change
    secureTest().failKeys.add(RECORD);
    await app.pin.changePin(NEW_PIN, '2580'); // a failed write
    secureTest().failKeys.delete(RECORD);
    const after = record();
    const text = printed().join('\n');
    expect(traceLines().length).toBeGreaterThan(10);
    const secrets = [PIN, NEW_PIN, '2580', code, code.replace(/-/g, ''), before.pin.hash, before.pin.salt, before.recovery.hash, before.recovery.salt, before.installId, after.pin.hash, after.pin.salt];
    for (const secret of secrets) expect(text).not.toContain(secret);
    // every line is "[pin-trace] <event> <json of numbers / booleans / fixed words>"
    for (const line of traceLines()) {
      const [, event, ...rest] = line.split(' ');
      expect(event).toMatch(/^[a-z]+:[a-z-]+$/);
      const data = JSON.parse(rest.join(' '));
      for (const value of Object.values(data)) expect(['number', 'boolean', 'string']).toContain(typeof value);
      for (const value of Object.values(data)) if (typeof value === 'string') expect(value).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  test('a failed secure-storage call is traced by its error CODE only, never its message', async () => {
    const { app } = await boot();
    // the secure store stand-in fails with a message that carries a "secret"
    const secure = secureTest();
    const realSet = secure.map.set.bind(secure.map);
    secure.failKeys.add(RECORD);
    await app.pin.changePin(PIN, NEW_PIN);
    secure.failKeys.delete(RECORD);
    secure.map.set = realSet as typeof secure.map.set;
    const failed = traceLines().filter((line) => line.includes('secure:write-failed'));
    expect(failed.length).toBeGreaterThan(0);
    for (const line of failed) expect(line).not.toMatch(/secure store write failed/); // the message of the thrown error is not printed
  });
});

describe('PINs and recovery codes made by earlier versions keep working', () => {
  async function bootWith(legacyPin: string | null, legacyCode: string | null) {
    const { app } = await boot();
    const crypto = jest.requireActual('@/utils/pin-crypto') as typeof import('@/utils/pin-crypto');
    const stored = record();
    if (legacyPin) stored.pin = await crypto.makeSecretRecord('pin', legacyPin);
    if (legacyCode) stored.recovery = await crypto.makeSecretRecord('recovery', crypto.normalizeRecoveryCode(legacyCode)!);
    secureTest().map.set(RECORD, JSON.stringify(stored));
    return app;
  }

  test.each(['13579', '135792', '1357924', '13579246'])('the earlier PIN %s still unlocks, and is replaced by a 4-digit one only when its owner changes it', async (legacy) => {
    const app = await bootWith(legacy, null);
    expect(await app.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await app.gate.unlockParentArea(legacy)).toEqual({ ok: true });
    app.gate.lockParentArea();
    expect(await app.pin.regenerateRecoveryCode(legacy)).toMatchObject({ ok: true }); // the other PIN-protected steps accept it too
    expect(await app.pin.changePin(legacy, NEW_PIN)).toEqual({ ok: true });
    expect(await app.gate.unlockParentArea(legacy)).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await app.gate.unlockParentArea(NEW_PIN)).toEqual({ ok: true });
  });

  test('a new PIN is exactly 4 digits: setup, change and recovery all refuse 5 to 8 digits without counting a guess', async () => {
    const { app, code } = await boot();
    for (const longer of ['13579', '135792', '13579246']) {
      expect(await app.pin.changePin(PIN, longer)).toEqual({ ok: false, reason: 'format' });
      expect(await app.pin.recoverWithCode(code, longer)).toEqual({ ok: false, reason: 'format' });
    }
    expect(JSON.parse(secureTest().map.get(ATTEMPTS)!).failures).toBe(0);
    const fresh = await loadApp();
    resetSecure();
    expect(fresh.pin.startParentAuth({ enabled: true })).toBe(true);
    expect(await fresh.pin.beginPinSetup('135792')).toEqual({ ok: false, reason: 'format' });
    expect(await fresh.pin.beginPinSetup('1357')).toMatchObject({ ok: true });
  });

  test('an earlier 25-character recovery code still recovers, and the new code is 10 characters; a PIN change leaves the old code exactly as it was', async () => {
    const legacyCode = makeLegacyRecoveryCode();
    const app = await bootWith(null, legacyCode);
    const before = record();
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: true });
    const after = record();
    expect(after.recovery).toEqual(before.recovery); // not regenerated, not converted
    expect(after.recoveryGeneration).toBe(before.recoveryGeneration);
    app.gate.lockParentArea();
    const recovered = await app.pin.recoverWithCode(legacyCode.toLowerCase().replace(/-/g, ' '), '2580');
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.recoveryCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/); // only now, on request, a new-style code
    expect(await app.pin.recoverWithCode(legacyCode, '1357')).toMatchObject({ ok: false, reason: 'wrong' }); // the old code is used up
  });

  test('an earlier recovery code confirms in any typing style when it is the unconfirmed one', async () => {
    const legacyCode = makeLegacyRecoveryCode();
    const app = await bootWith(null, legacyCode);
    const stored = record();
    stored.recoveryConfirmed = false;
    secureTest().map.set(RECORD, JSON.stringify(stored));
    expect(await app.pin.getRecoveryStatus()).toBe('unconfirmed');
    expect(await app.pin.confirmRecoveryCode(legacyCode.toLowerCase())).toEqual({ ok: true });
    expect(await app.pin.getRecoveryStatus()).toBe('confirmed');
  });
});
