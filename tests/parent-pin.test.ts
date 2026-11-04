import { checkSecret, generateRecoveryCode, normalizeRecoveryCode } from '@/utils/pin-crypto';

import { T0, fixture, freezeClock, loadApp, resetSecure, secureTest, setClock, unfreezeClock, type App } from './helpers';

// Cheap scrypt settings keep the suite fast (the real settings are exercised in pin-crypto-real.test.ts).
jest.mock('@/utils/kdf-params', () => ({ DEFAULT_KDF: { alg: 'scrypt', N: 1024, r: 8, p: 1, dkLen: 32 } }));

const fs = require('fs');
const path = require('path');
const ROOT: string = path.resolve('.'); // jest runs from the project root

const P = '@ProductivityPet:';
const MARKER = `${P}parentAuth`;
const GATE_ATTEMPTS = `${P}parentGate`;
const FAMILY = `${P}petFamily`;
const RECORD = 'pp.parentAuth.v1';
const ATTEMPTS = 'pp.parentAuth.attempts.v1';
const PIN = '135792';
const NEW_PIN = '864209';
const OTHER_PIN = '472916';
const SEC = 1000;

beforeEach(() => {
  resetSecure();
  freezeClock(T0);
});
afterEach(() => unfreezeClock());

// A fresh "process" on top of the current ordinary storage (`storage`, when given) and the persistent secure storage.
async function boot(opts: { storage?: Map<string, string>; seed?: Record<string, unknown>; start?: boolean } = {}): Promise<App> {
  const app = await loadApp(opts.seed, opts.storage);
  if (opts.start !== false) expect(app.pin.startParentAuth({ enabled: true })).toBe(true);
  return app;
}

const secureText = () => [...secureTest().map.values()].join('\n');
async function everything(app: App) {
  return [...(await app.dump()).values(), ...secureTest().map.values()].join('\n');
}
const record = () => JSON.parse(secureTest().map.get(RECORD)!);
const compact = (code: string) => code.replace(/-/g, '');
const CODE_FORMAT = /^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/;

// Both steps of setup (what the future setup screens do): show the code, then the parent types back the PIN and the code.
async function activate(app: App, pin = PIN): Promise<string> {
  const begun = await app.pin.beginPinSetup(pin);
  if (!begun.ok) throw new Error('begin failed: ' + begun.reason);
  const done = await app.pin.confirmPinSetup(pin, begun.recoveryCode);
  if (!done.ok) throw new Error('confirm failed: ' + done.reason);
  return begun.recoveryCode;
}

async function configured(opts: { seed?: Record<string, unknown> } = {}) {
  const app = await boot(opts);
  const code = await activate(app);
  return { app, code };
}

const failMarkerWrites = (app: App) => {
  const real = app.AsyncStorage.setItem;
  app.AsyncStorage.setItem = jest.fn(async (key: string, value: string) => {
    if (key === MARKER) throw new Error('disk full');
    return real(key, value);
  });
  return () => {
    app.AsyncStorage.setItem = real;
  };
};

// ---------------------------------------------------------------------------------------------------------
describe('setting up a PIN: step 1 (pending) and step 2 (confirmed)', () => {
  test('step 1 creates only a PENDING record: nothing is protected, there is no marker, the parent area is untouched', async () => {
    const app = await boot();
    const begun = await app.pin.beginPinSetup(PIN);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.recoveryCode).toMatch(CODE_FORMAT);
    expect(record().phase).toBe('pending');
    expect(record().recoveryConfirmed).toBe(false);
    expect(await app.pin.getAuthState()).toMatchObject({ kind: 'none', pending: expect.anything() });
    expect(await app.pin.getRecoveryStatus()).toBe('pending-setup');
    expect((await app.dump()).has(MARKER)).toBe(false);
    expect(secureTest().map.has(ATTEMPTS)).toBe(false);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unprotected' }); // exactly as before: open
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true }); // nothing to unlock
  });

  test('step 2 needs BOTH the PIN and the recovery code; only then is protection switched on', async () => {
    const app = await boot();
    const begun = await app.pin.beginPinSetup(PIN);
    if (!begun.ok) throw new Error('begin');
    const wrongCode = await generateRecoveryCode();
    expect(await app.pin.confirmPinSetup(OTHER_PIN, begun.recoveryCode)).toEqual({ ok: false, reason: 'wrong' }); // mistyped PIN
    expect(await app.pin.confirmPinSetup(PIN, wrongCode)).toEqual({ ok: false, reason: 'wrong' }); // a different code
    expect(await app.pin.confirmPinSetup(PIN, compact(begun.recoveryCode).slice(0, 24) + (compact(begun.recoveryCode)[24] === '0' ? '1' : '0'))).toEqual({ ok: false, reason: 'invalid-code' });
    expect(await app.pin.confirmPinSetup('12', begun.recoveryCode)).toEqual({ ok: false, reason: 'format' });
    expect((await app.dump()).has(MARKER)).toBe(false);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unprotected' }); // still not protecting anything
    expect(await app.pin.confirmPinSetup(PIN, begun.recoveryCode)).toEqual({ ok: true });
    expect(record().phase).toBe('active');
    expect(record().recoveryConfirmed).toBe(true);
    expect(await app.pin.getAuthState()).toMatchObject({ kind: 'ready' });
    expect(await app.pin.getRecoveryStatus()).toBe('confirmed');
    expect(JSON.parse((await app.dump()).get(MARKER)!)).toEqual({ v: 1, installId: record().installId, configuredAt: expect.any(String) });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked' });
  });

  test('confirming is not a guess (nothing is protected yet, so there is nothing to gain)', async () => {
    const app = await boot();
    const begun = await app.pin.beginPinSetup(PIN);
    if (!begun.ok) throw new Error('begin');
    for (let i = 0; i < 6; i += 1) await app.pin.confirmPinSetup(OTHER_PIN, begun.recoveryCode);
    expect(secureTest().map.has(ATTEMPTS)).toBe(false);
    expect((await app.pin.confirmPinSetup(PIN, begun.recoveryCode)).ok).toBe(true);
  });

  test('neither the PIN nor the recovery code is stored anywhere, in any form (after step 1 and after step 2)', async () => {
    const app = await boot();
    const begun = await app.pin.beginPinSetup(PIN);
    if (!begun.ok) throw new Error('begin');
    const code = begun.recoveryCode;
    for (const stage of ['pending', 'active']) {
      const all = await everything(app);
      for (const secret of [PIN, code, compact(code), code.toLowerCase(), compact(code).toLowerCase()]) expect([stage, all.includes(secret)]).toEqual([stage, false]);
      if (stage === 'pending') await app.pin.confirmPinSetup(PIN, code);
    }
    const rec = record();
    expect(Object.keys(rec).sort()).toEqual(['createdAt', 'installId', 'phase', 'pin', 'recovery', 'recoveryConfirmed', 'recoveryGeneration', 'updatedAt', 'v']);
    expect(rec.pin.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.recovery.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.pin.salt).not.toBe(rec.recovery.salt);
  });

  test('the secret record is NOT kept in ordinary storage (only the marker is)', async () => {
    const { app } = await configured();
    const ordinary = await app.dump();
    expect(ordinary.has(RECORD)).toBe(false);
    expect([...ordinary.keys()].filter((k) => k.includes('parentAuth'))).toEqual([MARKER]);
    expect(ordinary.get(MARKER)).not.toContain('hash');
  });

  test('every write to secure storage asks for "when unlocked, this device only"', async () => {
    await configured();
    const sets = secureTest().sets;
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) expect(s.options).toEqual({ keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' });
  });

  test('a PIN that is too short, too long, not digits or too easy is refused and nothing is stored', async () => {
    const app = await boot();
    for (const [pin, reason] of [['12345', 'format'], ['123456789', 'format'], ['abcdef', 'format'], ['123456', 'weak'], ['111111', 'weak']] as const) {
      expect(await app.pin.beginPinSetup(pin)).toEqual({ ok: false, reason });
    }
    expect(secureTest().map.size).toBe(0);
    expect((await app.dump()).has(MARKER)).toBe(false);
  });

  test('setup is refused while a PIN exists (the PIN is never silently replaced), and a stray confirm does nothing', async () => {
    const { app, code } = await configured();
    const before = secureTest().map.get(RECORD);
    expect(await app.pin.beginPinSetup(NEW_PIN)).toEqual({ ok: false, reason: 'already-configured' });
    expect(await app.pin.confirmPinSetup(PIN, code)).toEqual({ ok: false, reason: 'already-configured' });
    expect(secureTest().map.get(RECORD)).toBe(before);
  });

  test('confirming with nothing pending does nothing', async () => {
    const app = await boot();
    expect(await app.pin.confirmPinSetup(PIN, await generateRecoveryCode())).toEqual({ ok: false, reason: 'not-pending' });
    expect(secureTest().map.size).toBe(0);
  });

  test('two taps at once begin one setup; a begin and a confirm at once do not race', async () => {
    const app = await boot();
    const results = await Promise.all([app.pin.beginPinSetup(PIN), app.pin.beginPinSetup(PIN)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(secureTest().sets.filter((s) => s.key === RECORD)).toHaveLength(1);
    const first = results.find((r) => r.ok);
    if (!first || !first.ok) throw new Error('no first');
    const [a, b] = await Promise.all([app.pin.confirmPinSetup(PIN, first.recoveryCode), app.pin.confirmPinSetup(PIN, first.recoveryCode)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await app.pin.getAuthState()).toMatchObject({ kind: 'ready' });
  });

  test('without secure storage (the web, or a build without the module) a PIN cannot be created', async () => {
    secureTest().available = false;
    const app = await boot();
    expect(await app.pin.getAuthState()).toEqual({ kind: 'unsupported' });
    expect(await app.pin.beginPinSetup(PIN)).toEqual({ ok: false, reason: 'unsupported' });
    expect((await app.dump()).has(MARKER)).toBe(false);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unprotected' });
  });

  test('without secure randomness a PIN cannot be created (there is no weaker fallback)', async () => {
    const app = await boot();
    const Crypto = require('expo-crypto');
    Crypto.getRandomBytesAsync = async () => {
      throw new Error('no secure random');
    };
    expect(await app.pin.beginPinSetup(PIN)).toEqual({ ok: false, reason: 'unavailable' });
    expect(secureTest().map.size).toBe(0);
    expect((await app.dump()).has(MARKER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('interrupted setup: an incomplete PIN is never switched on, nobody is locked out, nothing is deleted', () => {
  const familySeed = () => ({ [FAMILY]: (fixture('family-v1-mixed') as Record<string, unknown>)[FAMILY] });

  test('the app closes after step 1, before the parent has saved or confirmed the code: nothing is protected', async () => {
    const app = await boot({ seed: familySeed() });
    await app.family.ensureFamilyLoaded();
    const begun = await app.pin.beginPinSetup(PIN);
    if (!begun.ok) throw new Error('begin');
    const before = await app.dump();
    const restarted = await boot({ storage: before }); // "the app closed"
    expect(await restarted.pin.getAuthState()).toMatchObject({ kind: 'none', pending: expect.anything() });
    expect(await restarted.pin.getRecoveryStatus()).toBe('pending-setup');
    expect(await restarted.gate.getParentAccess()).toEqual({ state: 'unprotected' }); // exactly as before: nobody is locked out
    expect(await restarted.gate.isParentAccessAllowed()).toBe(true);
    const after = await restarted.dump();
    for (const [key, value] of before) expect([key, after.get(key)]).toEqual([key, value]); // family data and everything else untouched
  });

  test('the parent who still has the code can finish after a restart; one who lost it simply starts again', async () => {
    const first = await boot();
    const begun = await first.pin.beginPinSetup(PIN);
    if (!begun.ok) throw new Error('begin');
    const kept = await boot({ storage: await first.dump() });
    expect(await kept.pin.confirmPinSetup(PIN, begun.recoveryCode)).toEqual({ ok: true });

    resetSecure();
    const lost = await boot();
    const old = await lost.pin.beginPinSetup(PIN);
    if (!old.ok) throw new Error('begin');
    const again = await lost.pin.beginPinSetup(NEW_PIN); // the code was lost: start over (the pending record is replaced)
    if (!again.ok) throw new Error('begin again');
    expect(await lost.pin.confirmPinSetup(PIN, old.recoveryCode)).toEqual({ ok: false, reason: 'wrong' }); // the old attempt is gone
    expect(await lost.pin.confirmPinSetup(NEW_PIN, again.recoveryCode)).toEqual({ ok: true });
  });

  test('the app closes while the code is being generated or before anything is saved: nothing exists', async () => {
    const app = await boot();
    secureTest().failSet = true;
    expect(await app.pin.beginPinSetup(PIN)).toEqual({ ok: false, reason: 'unavailable' });
    secureTest().failSet = false;
    expect(secureTest().map.size).toBe(0);
    expect(await app.pin.getAuthState()).toMatchObject({ kind: 'none', pending: null });
    expect(await app.pin.getRecoveryStatus()).toBe('none');
    expect((await app.pin.beginPinSetup(PIN)).ok).toBe(true); // a retry works
  });

  test('the app closes between the secure write and the marker write: the stray record is ignored and a retry replaces it', async () => {
    const app = await boot({ seed: familySeed() });
    await app.family.ensureFamilyLoaded();
    const begun = await app.pin.beginPinSetup(PIN);
    if (!begun.ok) throw new Error('begin');
    const before = await app.dump();
    const restore = failMarkerWrites(app);
    expect(await app.pin.confirmPinSetup(PIN, begun.recoveryCode)).toEqual({ ok: false, reason: 'unavailable' });
    restore();
    expect(record().phase).toBe('active'); // the secure record was saved...
    expect((await app.dump()).has(MARKER)).toBe(false); // ...but nothing refers to it
    expect(await app.pin.getAuthState()).toMatchObject({ kind: 'none', pending: null });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unprotected' }); // never half-enabled, nobody locked out
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
    const after = await app.dump();
    for (const [key, value] of before) expect([key, after.get(key)]).toEqual([key, value]);
    const retry = await app.pin.beginPinSetup(NEW_PIN); // start again from the beginning
    if (!retry.ok) throw new Error('retry');
    expect(await app.pin.confirmPinSetup(NEW_PIN, retry.recoveryCode)).toEqual({ ok: true });
    expect(await app.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'wrong' }); // the abandoned PIN never worked
    expect(await app.gate.unlockParentArea(NEW_PIN)).toEqual({ ok: true });
  });

  test('the secure record cannot be written at step 2: still not protected, retry works', async () => {
    const app = await boot();
    const begun = await app.pin.beginPinSetup(PIN);
    if (!begun.ok) throw new Error('begin');
    secureTest().failKeys.add(RECORD);
    expect(await app.pin.confirmPinSetup(PIN, begun.recoveryCode)).toEqual({ ok: false, reason: 'unavailable' });
    secureTest().failKeys.delete(RECORD);
    expect((await app.dump()).has(MARKER)).toBe(false);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unprotected' });
    expect(await app.pin.confirmPinSetup(PIN, begun.recoveryCode)).toEqual({ ok: true });
  });

  test('an existing family can never be unlocked by an interrupted or repeated setup', async () => {
    const { app, code } = await configured({ seed: familySeed() });
    // ready: every setup step is refused and the area stays locked
    for (let i = 0; i < 2; i += 1) {
      expect(await app.pin.beginPinSetup(NEW_PIN)).toEqual({ ok: false, reason: 'already-configured' });
      expect(await app.pin.confirmPinSetup(PIN, code)).toEqual({ ok: false, reason: 'already-configured' });
      expect(await app.gate.getParentAccess()).toEqual({ state: 'locked' });
    }
    // verifier-missing (the data came without its secret): every setup step is refused and the area stays locked
    const dump = await app.dump();
    resetSecure();
    const restored = await boot({ storage: dump });
    expect(await restored.pin.beginPinSetup(NEW_PIN)).toEqual({ ok: false, reason: 'verifier-missing' });
    expect(await restored.pin.confirmPinSetup(PIN, code)).toEqual({ ok: false, reason: 'verifier-missing' });
    expect(await restored.gate.getParentAccess()).toEqual({ state: 'locked', reason: 'verifier-missing' });
    expect(secureTest().map.size).toBe(0);
    // a secure record that is only 'pending' while the marker says a PIN protects the data is damage, not "no PIN"
    const second = await configured();
    const tampered = record();
    secureTest().map.set(RECORD, JSON.stringify({ ...tampered, phase: 'pending' }));
    expect(await second.app.pin.getAuthState()).toEqual({ kind: 'verifier-missing', why: 'damaged' });
    expect(await second.app.gate.isParentAccessAllowed()).toBe(false);
  });

  test('a pending record never checks anything: the PIN of an unfinished setup is not accepted anywhere', async () => {
    const app = await boot();
    await app.pin.beginPinSetup(PIN);
    const verifier = app.pin.createPinVerifier();
    expect(await verifier.isConfigured()).toBe(false);
    expect(await verifier.verify(PIN)).toBe(false);
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: false, reason: 'not-configured' });
    expect(await app.pin.recoverWithCode(await generateRecoveryCode(), NEW_PIN)).toEqual({ ok: false, reason: 'not-configured' });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('checking the PIN through the Parent Gate', () => {
  test('locked until the right PIN; wrong guesses are counted in SECURE storage, not ordinary storage', async () => {
    const { app } = await configured();
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked' });
    expect(await app.gate.unlockParentArea(OTHER_PIN)).toMatchObject({ ok: false, reason: 'wrong', triesLeft: 2 });
    expect(JSON.parse(secureTest().map.get(ATTEMPTS)!).failures).toBe(1);
    expect((await app.dump()).has(GATE_ATTEMPTS)).toBe(false);
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
    expect(JSON.parse(secureTest().map.get(ATTEMPTS)!).failures).toBe(0);
  });

  test('three wrong PINs start a pause, and a restart does not clear it', async () => {
    const { app } = await configured();
    for (const pin of ['000001', '000002', '000003']) await app.gate.unlockParentArea(pin);
    expect((await app.gate.getParentAccess()).state).toBe('cooldown');
    const restarted = await boot({ storage: await app.dump() });
    expect((await restarted.gate.getParentAccess()).state).toBe('cooldown');
    expect(await restarted.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'cooldown' });
    setClock(T0 + 40 * SEC);
    expect(await restarted.gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });

  test('a restart always starts locked, and the PIN still works after it', async () => {
    const { app } = await configured();
    await app.gate.unlockParentArea(PIN);
    const restarted = await boot({ storage: await app.dump() });
    expect(await restarted.gate.getParentAccess()).toEqual({ state: 'locked' });
    expect(await restarted.gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });

  test('the guess counter in secure storage cannot be read (fails closed): nothing is checked', async () => {
    const { app } = await configured();
    secureTest().failGet = true;
    expect(await app.gate.unlockParentArea(PIN)).toMatchObject({ ok: false });
    expect((await app.gate.getParentAccess()).state).not.toBe('unlocked');
  });

  test('a damaged guess counter in secure storage starts a pause instead of resetting the limits', async () => {
    const { app } = await configured();
    secureTest().map.set(ATTEMPTS, '{ not json');
    expect((await app.gate.getParentAccess()).state).toBe('cooldown');
    expect(JSON.parse(secureTest().map.get(ATTEMPTS)!).failures).toBe(3); // repaired, so the pause ends on time
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('recovery code', () => {
  test('a correct code sets a new PIN, invalidates the OLD code, and returns a NEW one', async () => {
    const { app, code } = await configured();
    const result = await app.pin.recoverWithCode(code, NEW_PIN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.recoveryCode).toMatch(CODE_FORMAT);
    expect(result.recoveryCode).not.toBe(code);
    expect(record().recoveryGeneration).toBe(2);
    // the old PIN no longer works, the new one does
    expect(await app.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await app.gate.unlockParentArea(NEW_PIN)).toEqual({ ok: true });
    // the OLD code no longer works (and the guess is counted), the NEW one does
    expect(await app.pin.recoverWithCode(code, OTHER_PIN)).toMatchObject({ ok: false, reason: 'wrong' });
    const again = await app.pin.recoverWithCode(result.recoveryCode, OTHER_PIN);
    expect(again.ok).toBe(true);
    expect(record().recoveryGeneration).toBe(3);
    expect(await app.gate.unlockParentArea(OTHER_PIN)).toEqual({ ok: true });
  });

  test('it never touches family data, the marker or the profile registry', async () => {
    const { app, code } = await configured({ seed: { [FAMILY]: (fixture('family-v1-mixed') as Record<string, unknown>)[FAMILY] } });
    await app.family.ensureFamilyLoaded();
    await app.profiles.ensureProfilesReady();
    await app.profiles.registerChildProfile('kid1');
    const before = await app.dump();
    const result = await app.pin.recoverWithCode(code, NEW_PIN);
    expect(result.ok).toBe(true);
    const after = await app.dump();
    for (const [key, value] of before) expect([key, after.get(key)]).toEqual([key, value]); // every ordinary key is byte-identical
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  });

  test('the code can be typed in lower case, with spaces or without dashes', async () => {
    const { app, code } = await configured();
    const result = await app.pin.recoverWithCode(`  ${compact(code).toLowerCase()}  `, NEW_PIN);
    expect(result.ok).toBe(true);
  });

  test('a mistyped code (bad check character), a wrong length, or a weak new PIN are refused WITHOUT counting a guess', async () => {
    const { app, code } = await configured();
    const mistyped = compact(code).slice(0, 24) + (compact(code)[24] === '0' ? '1' : '0');
    expect(await app.pin.recoverWithCode(mistyped, NEW_PIN)).toEqual({ ok: false, reason: 'invalid-code' });
    expect(await app.pin.recoverWithCode('ABC', NEW_PIN)).toEqual({ ok: false, reason: 'invalid-code' });
    expect(await app.pin.recoverWithCode(code, '123456')).toEqual({ ok: false, reason: 'weak' });
    expect(await app.pin.recoverWithCode(code, '12')).toEqual({ ok: false, reason: 'format' });
    expect(JSON.parse(secureTest().map.get(ATTEMPTS)!).failures).toBe(0);
  });

  test('a well-formed but wrong code is a counted guess; three start a pause; the pause survives a restart', async () => {
    const { app, code } = await configured();
    const wrong = await generateRecoveryCode();
    expect(await app.pin.recoverWithCode(wrong, NEW_PIN)).toMatchObject({ ok: false, reason: 'wrong', triesLeft: 2 });
    await app.pin.recoverWithCode(wrong, NEW_PIN);
    expect(await app.pin.recoverWithCode(wrong, NEW_PIN)).toMatchObject({ ok: false, reason: 'wrong', cooldownMs: 30 * SEC });
    const restarted = await boot({ storage: await app.dump() });
    expect(await restarted.pin.recoverWithCode(code, NEW_PIN)).toMatchObject({ ok: false, reason: 'cooldown' }); // even the right code waits
    setClock(T0 + 40 * SEC);
    expect((await restarted.pin.recoverWithCode(code, NEW_PIN)).ok).toBe(true);
  });

  test('PIN guesses and recovery-code guesses share ONE counter', async () => {
    const { app, code } = await configured();
    const wrong = await generateRecoveryCode();
    await app.gate.unlockParentArea('000001');
    await app.gate.unlockParentArea('000002');
    await app.pin.recoverWithCode(wrong, NEW_PIN); // the third guess overall
    expect((await app.gate.getParentAccess()).state).toBe('cooldown');
    expect(await app.pin.recoverWithCode(code, NEW_PIN)).toMatchObject({ ok: false, reason: 'cooldown' });
  });

  test('if the new record cannot be saved, NOTHING changes: the old PIN and the old code still work', async () => {
    const { app, code } = await configured();
    secureTest().failKeys.add(RECORD);
    expect(await app.pin.recoverWithCode(code, NEW_PIN)).toEqual({ ok: false, reason: 'unavailable' });
    secureTest().failKeys.delete(RECORD);
    expect(record().recoveryGeneration).toBe(1);
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true }); // the old PIN
    const retry = await app.pin.recoverWithCode(code, NEW_PIN); // and the old code
    expect(retry.ok).toBe(true);
  });

  test('two recoveries with the same valid code at once: exactly one succeeds (the code is invalid after the first)', async () => {
    const { app, code } = await configured();
    const [a, b] = await Promise.all([app.pin.recoverWithCode(code, NEW_PIN), app.pin.recoverWithCode(code, OTHER_PIN)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await app.gate.unlockParentArea(NEW_PIN)).toEqual({ ok: true });
  });

  test('a new recovery code can be made with the PIN; it invalidates the old one', async () => {
    const { app, code } = await configured();
    const wrongPin = await app.pin.regenerateRecoveryCode(OTHER_PIN);
    expect(wrongPin).toMatchObject({ ok: false, reason: 'wrong' });
    const fresh = await app.pin.regenerateRecoveryCode(PIN);
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    expect(fresh.recoveryCode).not.toBe(code);
    expect(await app.pin.recoverWithCode(code, NEW_PIN)).toMatchObject({ ok: false, reason: 'wrong' });
    expect((await app.pin.recoverWithCode(fresh.recoveryCode, NEW_PIN)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('changing the PIN', () => {
  test('needs the current PIN; afterwards only the new PIN works and the recovery code is still valid', async () => {
    const { app, code } = await configured();
    expect(await app.pin.changePin(OTHER_PIN, NEW_PIN)).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: true });
    expect(await app.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'wrong' });
    expect(await app.gate.unlockParentArea(NEW_PIN)).toEqual({ ok: true });
    expect(record().recoveryGeneration).toBe(1);
    expect((await app.pin.recoverWithCode(code, OTHER_PIN)).ok).toBe(true);
  });

  test('refuses a weak new PIN without counting a guess; an interrupted write leaves the old PIN working', async () => {
    const { app } = await configured();
    expect(await app.pin.changePin(PIN, '111111')).toEqual({ ok: false, reason: 'weak' });
    expect(JSON.parse(secureTest().map.get(ATTEMPTS)!).failures).toBe(0);
    secureTest().failKeys.add(RECORD);
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: false, reason: 'unavailable' });
    secureTest().failKeys.delete(RECORD);
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
    expect(await app.gate.unlockParentArea(NEW_PIN)).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('family data without its PIN record (a restore, a new device, damage)', () => {
  // The same family data, but this "device" has no secure record.
  async function restoredDevice() {
    const first = await configured({ seed: { [FAMILY]: (fixture('family-v1-mixed') as Record<string, unknown>)[FAMILY] } });
    await first.app.family.ensureFamilyLoaded();
    const dump = await first.app.dump();
    resetSecure();
    const app = await boot({ storage: dump });
    return { app, dump, code: first.code };
  }

  test('parent access stays LOCKED and says why; nothing is deleted or reset', async () => {
    const { app, dump } = await restoredDevice();
    expect(await app.pin.getAuthState()).toEqual({ kind: 'verifier-missing', why: 'missing' });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked', reason: 'verifier-missing' });
    expect(await app.gate.isParentAccessAllowed()).toBe(false);
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'verifier-missing' });
    expect(secureTest().map.size).toBe(0); // nothing was created, not even a guess counter
    const after = await app.dump();
    for (const [key, value] of dump) expect([key, after.get(key)]).toEqual([key, value]); // all family data and the marker unchanged
  });

  test('no new PIN is created silently, and neither a recovery code nor the device passcode is a way in', async () => {
    const { app, code } = await restoredDevice();
    expect(await app.pin.beginPinSetup(NEW_PIN)).toEqual({ ok: false, reason: 'verifier-missing' });
    expect(await app.pin.recoverWithCode(code, NEW_PIN)).toEqual({ ok: false, reason: 'verifier-missing' }); // the code's verifier was in the lost record too
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: false, reason: 'verifier-missing' });
    expect(await app.pin.regenerateRecoveryCode(PIN)).toEqual({ ok: false, reason: 'verifier-missing' });
    expect(secureTest().map.size).toBe(0);
    expect(secureTest().sets).toHaveLength(0);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked', reason: 'verifier-missing' });
  });

  test('the children’s data stays usable (profiles still switch and load) while parent access is locked', async () => {
    const { app } = await restoredDevice();
    await app.profiles.ensureProfilesReady();
    expect(await app.profiles.registerChildProfile('kid1')).toMatchObject({ ok: true });
    expect(await app.profiles.switchProfile('kid1')).toMatchObject({ ok: true });
    expect((await app.family.ensureFamilyLoaded()).pets).toHaveLength(1);
    expect(await app.profiles.switchProfile('main')).toMatchObject({ ok: true });
    expect((await app.family.ensureFamilyLoaded()).pets).toHaveLength(5);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked', reason: 'verifier-missing' });
  });

  test('a damaged secure record is treated the same way and is never overwritten', async () => {
    const { app } = await configured();
    secureTest().map.set(RECORD, '{ "damaged": true');
    expect(await app.pin.getAuthState()).toEqual({ kind: 'verifier-missing', why: 'damaged' });
    expect(await app.pin.beginPinSetup(NEW_PIN)).toEqual({ ok: false, reason: 'verifier-missing' });
    expect(secureTest().map.get(RECORD)).toBe('{ "damaged": true');
  });

  test('a record that belongs to a different install is not trusted', async () => {
    const { app } = await configured();
    secureTest().map.set(RECORD, JSON.stringify({ ...record(), installId: 'a'.repeat(32) }));
    expect(await app.pin.getAuthState()).toEqual({ kind: 'verifier-missing', why: 'other-install' });
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'verifier-missing' });
  });

  test('secure storage unreadable (or the native module missing) while the data says a PIN exists: LOCKED, never open', async () => {
    const { app } = await configured();
    secureTest().failGet = true;
    expect(await app.pin.getAuthState()).toEqual({ kind: 'verifier-missing', why: 'unreadable' });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked', reason: 'verifier-missing' });
    secureTest().failGet = false;
    expect(await app.pin.getAuthState()).toMatchObject({ kind: 'ready' }); // rechecked every time: recovers when readable again
    secureTest().available = false;
    expect(await app.pin.getAuthState()).toEqual({ kind: 'verifier-missing', why: 'unreadable' });
    expect(await app.gate.isParentAccessAllowed()).toBe(false);
  });

  test('an unreadable or damaged marker: unreadable = locked; damaged with a good secure record = repaired', async () => {
    const { app } = await configured();
    const realGet = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async (key: string) => {
      if (key === MARKER) throw new Error('read error');
      return realGet(key);
    });
    expect(await app.pin.getAuthState()).toEqual({ kind: 'verifier-missing', why: 'unreadable' });
    app.AsyncStorage.getItem = realGet;
    await app.AsyncStorage.setItem(MARKER, '{ nope');
    expect(await app.pin.getAuthState()).toMatchObject({ kind: 'ready' });
    expect(JSON.parse((await app.AsyncStorage.getItem(MARKER))!)).toMatchObject({ v: 1, installId: record().installId });
  });

  test('a stale secure record from an earlier install (data gone, marker gone) is ignored and can be replaced', async () => {
    const first = await configured();
    const dump = await first.app.dump();
    dump.delete(MARKER); // a reinstall: ordinary storage is empty, the old Keychain item survived
    const app = await boot({ storage: dump });
    expect(await app.pin.getAuthState()).toMatchObject({ kind: 'none' });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unprotected' });
    const code = await activate(app, NEW_PIN);
    expect(code).toMatch(CODE_FORMAT);
    expect(await app.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'wrong' }); // the stale PIN is gone
    expect(await app.gate.unlockParentArea(NEW_PIN)).toEqual({ ok: true });
  });

  test('reading secure storage fails and the data claims no PIN: no PIN (never an invented lock-out)', async () => {
    const app = await boot();
    secureTest().failGet = true;
    expect(await app.pin.getAuthState()).toMatchObject({ kind: 'none' });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('interrupted recovery: a new recovery code that was never acknowledged is detected and replaced', () => {
  const familySeed = () => ({ [FAMILY]: (fixture('family-v1-mixed') as Record<string, unknown>)[FAMILY] });

  test('recovery succeeds but the app closes before the new code is acknowledged -> "unconfirmed", the new PIN works, and the way forward is clear', async () => {
    const { app, code } = await configured({ seed: familySeed() });
    await app.family.ensureFamilyLoaded();
    const recovered = await app.pin.recoverWithCode(code, NEW_PIN);
    if (!recovered.ok) throw new Error('recovery');
    expect(await app.pin.getRecoveryStatus()).toBe('unconfirmed');
    const before = await app.dump();

    const restarted = await boot({ storage: before }); // the app closed; the new code was never seen or saved
    expect(await restarted.pin.getRecoveryStatus()).toBe('unconfirmed'); // the UI must act on this as soon as the area opens
    expect(await restarted.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'wrong' }); // the old PIN is gone
    expect(await restarted.gate.unlockParentArea(NEW_PIN)).toEqual({ ok: true }); // the PIN the parent just chose works
    expect(await restarted.pin.getRecoveryStatus()).toBe('unconfirmed'); // opening the area does not hide the problem
    // The UI contract: create a new code with the PIN, show it, and confirm it.
    const fresh = await restarted.pin.regenerateRecoveryCode(NEW_PIN);
    if (!fresh.ok) throw new Error('regenerate');
    expect(await restarted.pin.getRecoveryStatus()).toBe('unconfirmed'); // a new code is unconfirmed until typed back
    expect(await restarted.pin.confirmRecoveryCode(recovered.recoveryCode)).toMatchObject({ ok: false, reason: 'wrong' }); // the unseen code is dead
    expect(await restarted.pin.confirmRecoveryCode(code)).toMatchObject({ ok: false, reason: 'wrong' }); // so is the original
    expect(await restarted.pin.confirmRecoveryCode(fresh.recoveryCode)).toEqual({ ok: true });
    expect(await restarted.pin.getRecoveryStatus()).toBe('confirmed');
    expect(await restarted.gate.getParentAccess()).toMatchObject({ state: 'unlocked' });
    // family data untouched throughout
    const after = await restarted.dump();
    for (const [key, value] of before) if (key !== MARKER) expect([key, after.get(key)]).toEqual([key, value]);
  });

  test('confirming the recovery code: a typo is not a guess, a wrong code is, an already-confirmed code needs nothing', async () => {
    const { app, code } = await configured();
    const recovered = await app.pin.recoverWithCode(code, NEW_PIN);
    if (!recovered.ok) throw new Error('recovery');
    const c = compact(recovered.recoveryCode);
    expect(await app.pin.confirmRecoveryCode(c.slice(0, 24) + (c[24] === '0' ? '1' : '0'))).toEqual({ ok: false, reason: 'invalid-code' });
    expect(JSON.parse(secureTest().map.get(ATTEMPTS)!).failures).toBe(0);
    expect(await app.pin.confirmRecoveryCode(await generateRecoveryCode())).toMatchObject({ ok: false, reason: 'wrong', triesLeft: 2 });
    secureTest().failKeys.add(RECORD);
    expect(await app.pin.confirmRecoveryCode(recovered.recoveryCode)).toEqual({ ok: false, reason: 'unavailable' });
    secureTest().failKeys.delete(RECORD);
    expect(await app.pin.getRecoveryStatus()).toBe('unconfirmed'); // a failed save changes nothing
    expect(await app.pin.confirmRecoveryCode(recovered.recoveryCode.toLowerCase())).toEqual({ ok: true });
    expect(await app.pin.getRecoveryStatus()).toBe('confirmed');
    const failuresBefore = JSON.parse(secureTest().map.get(ATTEMPTS)!).failures;
    expect(await app.pin.confirmRecoveryCode(await generateRecoveryCode())).toEqual({ ok: true }); // nothing to confirm: no check, no guess
    expect(JSON.parse(secureTest().map.get(ATTEMPTS)!).failures).toBe(failuresBefore);
  });

  test('confirming shares the lockout counter and survives a restart', async () => {
    const { app, code } = await configured();
    const recovered = await app.pin.recoverWithCode(code, NEW_PIN);
    if (!recovered.ok) throw new Error('recovery');
    for (let i = 0; i < 3; i += 1) await app.pin.confirmRecoveryCode(await generateRecoveryCode());
    const restarted = await boot({ storage: await app.dump() });
    expect(await restarted.pin.confirmRecoveryCode(recovered.recoveryCode)).toMatchObject({ ok: false, reason: 'cooldown' });
    expect((await restarted.gate.getParentAccess()).state).toBe('cooldown');
  });

  test('a regenerated code is unconfirmed too, and a PIN change leaves the confirmed state alone', async () => {
    const { app } = await configured();
    expect(await app.pin.getRecoveryStatus()).toBe('confirmed');
    expect(await app.pin.changePin(PIN, NEW_PIN)).toEqual({ ok: true });
    expect(await app.pin.getRecoveryStatus()).toBe('confirmed');
    const fresh = await app.pin.regenerateRecoveryCode(NEW_PIN);
    expect(fresh.ok).toBe(true);
    expect(await app.pin.getRecoveryStatus()).toBe('unconfirmed');
  });

  test('a recovery and a new-code request at the same moment are applied one after the other', async () => {
    const { app, code } = await configured();
    const [recovered, regenerated] = await Promise.all([app.pin.recoverWithCode(code, NEW_PIN), app.pin.regenerateRecoveryCode(PIN)]);
    if (!recovered.ok) throw new Error('recovery');
    expect(regenerated).toMatchObject({ ok: false, reason: 'wrong' }); // the PIN had already been replaced by the time it ran
    expect(await app.pin.confirmRecoveryCode(recovered.recoveryCode)).toEqual({ ok: true });
    expect(await app.gate.unlockParentArea(NEW_PIN)).toEqual({ ok: true });
  });

  test('secure storage unavailable during recovery: nothing is changed and nothing opens', async () => {
    const { app, code } = await configured();
    secureTest().failGet = true;
    expect(await app.pin.recoverWithCode(code, NEW_PIN)).toEqual({ ok: false, reason: 'verifier-missing' });
    expect(await app.pin.confirmRecoveryCode(code)).toEqual({ ok: false, reason: 'verifier-missing' });
    expect(await app.gate.isParentAccessAllowed()).toBe(false);
    secureTest().failGet = false;
    expect(await app.pin.getRecoveryStatus()).toBe('confirmed');
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true }); // the old PIN still works
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('security properties', () => {
  test('the PIN verifier and the recovery verifier use independent random salts and separate domains', async () => {
    const first = await configured();
    const a = record();
    expect(a.pin.salt).not.toBe(a.recovery.salt);
    expect(a.pin.hash).not.toBe(a.recovery.hash);
    expect(a.pin.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(a.recovery.salt).toMatch(/^[0-9a-f]{32}$/);
    // the same PIN set up again gets different salts and hashes
    resetSecure();
    const second = await configured();
    const b = record();
    expect(b.pin.salt).not.toBe(a.pin.salt);
    expect(b.pin.hash).not.toBe(a.pin.hash);
    expect(b.installId).not.toBe(a.installId);
    // a PIN record never verifies a recovery code, and a recovery record never verifies a PIN
    expect(await checkSecret('recovery', PIN, a.pin)).toBe(false);
    expect(await checkSecret('pin', normalizeRecoveryCode(first.code)!, a.recovery)).toBe(false);
    expect(await checkSecret('recovery', normalizeRecoveryCode(first.code)!, a.recovery)).toBe(true);
    expect(await checkSecret('pin', PIN, a.pin)).toBe(true);
    expect(second.code).not.toBe(first.code);
  });

  test('PIN guesses, PIN changes, recovery-code guesses and confirmations all share ONE persistent counter', async () => {
    const { app, code } = await configured();
    await app.gate.unlockParentArea('000001'); // 1: the gate
    await app.pin.changePin('000002', NEW_PIN); // 2: a PIN change
    await app.pin.recoverWithCode(await generateRecoveryCode(), NEW_PIN); // 3: a recovery attempt
    expect(JSON.parse(secureTest().map.get(ATTEMPTS)!).failures).toBe(3);
    expect((await app.gate.getParentAccess()).state).toBe('cooldown');
    expect(await app.pin.regenerateRecoveryCode(PIN)).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(await app.pin.recoverWithCode(code, NEW_PIN)).toMatchObject({ ok: false, reason: 'cooldown' });
    const restarted = await boot({ storage: await app.dump() }); // the counter is persistent
    expect(await restarted.pin.recoverWithCode(code, NEW_PIN)).toMatchObject({ ok: false, reason: 'cooldown' });
    expect((await app.dump()).has(GATE_ATTEMPTS)).toBe(false); // and it never lives in ordinary storage
  });

  test('no PIN, recovery code or verifier is ever written to a log', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    const app = await boot();
    const begun = await app.pin.beginPinSetup(PIN);
    if (!begun.ok) throw new Error('begin');
    await app.pin.confirmPinSetup(PIN, begun.recoveryCode);
    await app.gate.unlockParentArea('000001');
    await app.gate.unlockParentArea(PIN);
    await app.pin.changePin(PIN, NEW_PIN);
    const recovered = await app.pin.recoverWithCode(begun.recoveryCode, OTHER_PIN);
    if (!recovered.ok) throw new Error('recovery');
    await app.pin.regenerateRecoveryCode(OTHER_PIN);
    await app.pin.confirmRecoveryCode(recovered.recoveryCode);
    secureTest().failKeys.add(RECORD);
    await app.pin.changePin(OTHER_PIN, NEW_PIN); // an error path
    secureTest().failKeys.delete(RECORD);
    const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))).join('\n');
    const secrets = [PIN, NEW_PIN, OTHER_PIN, begun.recoveryCode, compact(begun.recoveryCode), recovered.recoveryCode, record().pin.hash, record().recovery.hash, record().pin.salt];
    for (const secret of secrets) expect(logged).not.toContain(secret);
    spies.forEach((s) => s.mockRestore());
  });

  test('the authentication code contains no logging at all', () => {
    for (const f of ['parent-pin.ts', 'parent-secrets.ts', 'pin-crypto.ts', 'secure-random.ts', 'parent-gate.ts', 'kdf-params.ts']) {
      const text = fs.readFileSync(path.join(ROOT, 'src', 'utils', f), 'utf8');
      expect([f, /console\./.test(text)]).toEqual([f, false]);
    }
  });

  test('the scrypt settings are unchanged (changing them needs measured evidence from real phones)', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src', 'utils', 'kdf-params.ts'), 'utf8');
    expect(text).toContain("{ alg: 'scrypt', N: 2 ** 15, r: 8, p: 1, dkLen: 32 }");
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('nothing is ever deleted', () => {
  test('no delete or clear of secure or ordinary storage through setup, recovery, change, restore and failures', async () => {
    const app = await boot();
    const spies = { removeItem: jest.fn(), multiRemove: jest.fn(), clear: jest.fn(), mergeItem: jest.fn() };
    Object.assign(app.AsyncStorage, spies);
    const setupCode = await activate(app, PIN);
    const setup = { ok: true as const, recoveryCode: setupCode };
    await app.pin.changePin(PIN, NEW_PIN);
    await app.pin.recoverWithCode(setup.recoveryCode, OTHER_PIN);
    secureTest().failSet = true;
    await app.pin.changePin(NEW_PIN, PIN);
    secureTest().failSet = false;
    secureTest().map.delete(RECORD); // the record is lost
    await app.pin.beginPinSetup(PIN);
    await app.pin.recoverWithCode(setup.recoveryCode, NEW_PIN);
    expect(secureTest().deletes).toBe(0);
    for (const [name, spy] of Object.entries(spies)) expect([name, spy.mock.calls.length]).toEqual([name, 0]);
  });

  test('the code offers no way to reset, delete or wipe anything', () => {
    const files = ['parent-pin.ts', 'parent-secrets.ts', 'pin-crypto.ts', 'parent-gate.ts'];
    for (const f of files) {
      const text = fs.readFileSync(path.join(ROOT, 'src', 'utils', f), 'utf8');
      const exported = [...text.matchAll(/export (?:async )?(?:function|const) ([A-Za-z0-9_]+)/g)].map((m) => m[1]);
      expect(exported.filter((n) => /reset|delete|remove|clear|wipe|erase/i.test(n))).toEqual([]);
      expect(text).not.toMatch(/deleteItemAsync|removeItem|multiRemove|\.clear\(/);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('family mode is off by default: the app behaves exactly as before', () => {
  test('the flag is off, nothing is registered, the parent area is open, and no native module is even loaded', async () => {
    const { FAMILY_MODE_ENABLED } = require('@/utils/dev-flags');
    expect(FAMILY_MODE_ENABLED).toBe(false);
    const app = await loadApp();
    expect(app.pin.startParentAuth()).toBe(false);
    expect(app.gate.hasPinVerifier()).toBe(false);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unprotected' });
    expect(await app.gate.isParentAccessAllowed()).toBe(true);
    expect(await app.gate.unlockParentArea('123456')).toEqual({ ok: true });
    expect(secureTest().loaded).toBe(0); // expo-secure-store was never required
    expect((await app.dump()).has(MARKER)).toBe(false);
    expect(secureTest().map.size).toBe(0);
  });

  test('the web is never supported, even with the flag on', async () => {
    const app = await loadApp();
    expect(app.pin.startParentAuth({ enabled: true, platformOS: 'web' })).toBe(false);
    expect(app.gate.hasPinVerifier()).toBe(false);
    expect(secureTest().loaded).toBe(0);
  });

  test('the app shell only loads the PIN module behind the flag', () => {
    const text = fs.readFileSync(path.join(ROOT, 'src', 'app', '_layout.tsx'), 'utf8');
    expect(text).toMatch(/if \(FAMILY_MODE_ENABLED\) \(require\('@\/utils\/parent-pin'\)/);
    expect(text).not.toMatch(/^import .*parent-pin/m); // never imported at the top, so it is not even evaluated while the flag is off
  });

  test('with the flag on, the PIN checker is registered with the gate (locked until the PIN)', async () => {
    const { app } = await configured();
    expect(app.gate.hasPinVerifier()).toBe(true);
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });
});
