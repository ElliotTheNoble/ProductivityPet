import { DAY, T0, flush, freezeClock, loadApp, setClock, unfreezeClock, type App } from './helpers';

const GATE_KEY = '@ProductivityPet:parentGate';
const PIN = '2468';
const SEC = 1000;
const MIN = 60 * SEC;

// The phone's own screen-lock check (expo-local-authentication), controlled by the tests: what the system answers, and how many times it was asked.
const mockAuth: { level: number; result: unknown; throws: boolean; calls: number } = { level: 2, result: { success: true }, throws: false, calls: 0 };
jest.mock('expo-local-authentication', () => ({
  getEnrolledLevelAsync: jest.fn(async () => mockAuth.level),
  authenticateAsync: jest.fn(async () => {
    mockAuth.calls += 1;
    if (mockAuth.throws) throw new Error('system error');
    return mockAuth.result;
  }),
}));

beforeEach(() => {
  freezeClock(T0);
  mockAuth.level = 2;
  mockAuth.result = { success: true };
  mockAuth.throws = false;
  mockAuth.calls = 0;
});
afterEach(() => unfreezeClock());

// A stand-in for the real PIN storage (which does not exist yet): it only answers "is a PIN set" and "is this the PIN".
function fakeVerifier(correct = PIN) {
  return { isConfigured: jest.fn(async () => true), verify: jest.fn(async (pin: string) => pin === correct) };
}

async function boot(opts: { pin?: boolean; storage?: Map<string, string> } = {}) {
  const app = await loadApp(undefined, opts.storage);
  const verifier = fakeVerifier();
  if (opts.pin !== false) app.gate.registerPinVerifier(verifier);
  return { app, verifier };
}
const failures = async (app: App) => {
  const raw = await app.AsyncStorage.getItem(GATE_KEY);
  return raw ? JSON.parse(raw).failures : 0;
};

describe('with no PIN (every install today)', () => {
  test('the parent area is open exactly as before, and nothing is stored', async () => {
    const { app } = await boot({ pin: false });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unprotected' });
    expect(await app.gate.isParentAccessAllowed()).toBe(true);
    expect(await app.gate.unlockParentArea('123456')).toEqual({ ok: true });
    expect(await app.AsyncStorage.getItem(GATE_KEY)).toBeNull();
  });

  test('restarting the family set-up works as before', async () => {
    const { app } = await boot({ pin: false });
    await app.onboarding.ensureOnboardingLoaded();
    await app.onboarding.skipOnboarding();
    await app.onboarding.restartOnboarding();
    expect((await app.onboarding.ensureOnboardingLoaded()).status).toBe('pending');
  });
});

describe('with a PIN set', () => {
  test('starts locked, and a restart always starts locked', async () => {
    const { app } = await boot();
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked' });
    expect(await app.gate.isParentAccessAllowed()).toBe(false);
    await app.gate.unlockParentArea(PIN);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'unlocked' });
    const { app: restarted } = await boot({ storage: await app.dump() });
    expect(await restarted.gate.getParentAccess()).toEqual({ state: 'locked' }); // the open session was memory only
  });

  test('the correct PIN opens it; the PIN is never written to storage', async () => {
    const { app, verifier } = await boot();
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
    expect(verifier.verify).toHaveBeenCalledWith(PIN);
    expect(await app.gate.isParentAccessAllowed()).toBe(true);
    await flush();
    for (const value of (await app.dump()).values()) expect(value).not.toContain(PIN);
  });

  test('a PIN that is not 4-8 digits is refused without counting or checking', async () => {
    const { app, verifier } = await boot();
    for (const bad of ['', '1', '123', '123456789', 'abcdef', '12 345', '12.456', ' 2468']) {
      expect(await app.gate.unlockParentArea(bad)).toEqual({ ok: false, reason: 'invalid-format' });
    }
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(await failures(app)).toBe(0);
  });
});

describe('wrong guesses: no waiting, and the phone\'s screen lock after five in a row', () => {
  test('wrong PINs are answered at once, with the tries left; there is never a pause', async () => {
    const { app, verifier } = await boot();
    for (const [i, pin] of ['0001', '0002', '0003', '0004', '0005'].entries()) {
      expect(await app.gate.unlockParentArea(pin)).toEqual({ ok: false, reason: 'wrong', triesLeft: 4 - i });
    }
    expect(verifier.verify).toHaveBeenCalledTimes(5);
    expect(await failures(app)).toBe(5);
    // nothing in the access state or the answers mentions a wait
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked', deviceCheck: true });
    expect(JSON.parse((await app.AsyncStorage.getItem(GATE_KEY))!).lockedUntil).toBe(0);
    expect((app.gate as Record<string, unknown>).cooldownForFailures).toBeUndefined(); // the waiting periods are gone
    expect((app.gate as Record<string, unknown>).formatRemaining).toBeUndefined();
  });

  test('before the fifth wrong PIN the area is plainly locked (no screen-lock check owed yet)', async () => {
    const { app } = await boot();
    for (const pin of ['0001', '0002', '0003', '0004']) await app.gate.unlockParentArea(pin);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked' });
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true }); // the right PIN still works
  });

  test('after five wrong PINs the next try, even the right PIN, needs the screen-lock check: nothing is checked or counted', async () => {
    const { app, verifier } = await boot();
    for (const pin of ['0001', '0002', '0003', '0004', '0005']) await app.gate.unlockParentArea(pin);
    verifier.verify.mockClear();
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'device-check' });
    expect(await app.gate.unlockParentArea('0006')).toEqual({ ok: false, reason: 'device-check' });
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(await failures(app)).toBe(5);
  });

  test('passing the phone\'s screen-lock check gives five more tries; the count starts again', async () => {
    const { app } = await boot();
    for (const pin of ['0001', '0002', '0003', '0004', '0005']) await app.gate.unlockParentArea(pin);
    mockAuth.result = { success: true };
    expect(await app.gate.passDeviceCheck('Confirm', 'Cancel')).toBe('passed');
    expect(mockAuth.calls).toBe(1);
    expect(await failures(app)).toBe(0);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked' });
    expect(await app.gate.unlockParentArea('0006')).toEqual({ ok: false, reason: 'wrong', triesLeft: 4 });
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });

  test.each([
    ['cancelled', { success: false, error: 'user_cancel' }, 'cancelled'],
    ['not passed', { success: false, error: 'authentication_failed' }, 'failed'],
    ['locked out by the phone', { success: false, error: 'lockout' }, 'failed'],
    ['not available', { success: false, error: 'not_available' }, 'unavailable'],
    ['an unknown answer', { success: false }, 'failed'],
    ['something that is not a success', { success: 'yes' }, 'failed'],
  ])('a screen-lock check that is %s changes nothing: the tries stay held back', async (_name, answer, expected) => {
    const { app, verifier } = await boot();
    for (const pin of ['0001', '0002', '0003', '0004', '0005']) await app.gate.unlockParentArea(pin);
    mockAuth.result = answer as never;
    expect(await app.gate.passDeviceCheck('Confirm', 'Cancel')).toBe(expected);
    expect(await failures(app)).toBe(5);
    verifier.verify.mockClear();
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'device-check' });
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  test('a screen-lock check that throws is "unavailable" and changes nothing', async () => {
    const { app } = await boot();
    for (const pin of ['0001', '0002', '0003', '0004', '0005']) await app.gate.unlockParentArea(pin);
    mockAuth.throws = true;
    expect(await app.gate.passDeviceCheck('Confirm', 'Cancel')).toBe('unavailable');
    expect(await failures(app)).toBe(5);
  });

  test('a phone with no screen lock: the PIN tries stay stopped (no waiting, no free tries), also after a restart, and the check can be tried again later', async () => {
    const { app, verifier } = await boot();
    for (const pin of ['0001', '0002', '0003', '0004', '0005']) await app.gate.unlockParentArea(pin);
    mockAuth.level = 0;
    expect(await app.gate.passDeviceCheck('Confirm', 'Cancel')).toBe('no-device-lock');
    expect(mockAuth.calls).toBe(0); // the system was never asked to authenticate
    expect(await failures(app)).toBe(5); // the count is not set back
    verifier.verify.mockClear();
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'device-check' }); // even the right PIN
    expect(verifier.verify).not.toHaveBeenCalled();
    const restarted = await boot({ storage: await app.dump() });
    expect(await failures(restarted.app)).toBe(5); // a restart does not give the tries back
    expect(await restarted.app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'device-check' });
    // setting a screen lock on the phone later gives the way back
    mockAuth.level = 2;
    expect(await restarted.app.gate.passDeviceCheck('Confirm', 'Cancel')).toBe('passed');
    expect(await restarted.app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });

  test('if the count cannot be set back after a passed check, the tries stay held back', async () => {
    const { app } = await boot();
    for (const pin of ['0001', '0002', '0003', '0004', '0005']) await app.gate.unlockParentArea(pin);
    const real = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async () => {
      throw new Error('disk full');
    });
    mockAuth.result = { success: true };
    expect(await app.gate.passDeviceCheck('Confirm', 'Cancel')).toBe('unavailable');
    app.AsyncStorage.setItem = real;
    expect(await failures(app)).toBe(5);
  });

  test('closing and reopening the app does not skip the check: the count is kept', async () => {
    const first = await boot();
    for (const pin of ['0001', '0002', '0003', '0004', '0005']) await first.app.gate.unlockParentArea(pin);
    const second = await boot({ storage: await first.app.dump() });
    expect(await second.app.gate.getParentAccess()).toEqual({ state: 'locked', deviceCheck: true });
    expect(await second.app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'device-check' });
    expect(second.verifier.verify).not.toHaveBeenCalled();
    // and a half-way count survives too
    const third = await boot();
    for (const pin of ['0001', '0002']) await third.app.gate.unlockParentArea(pin);
    const fourth = await boot({ storage: await third.app.dump() });
    expect(await fourth.app.gate.unlockParentArea('0003')).toMatchObject({ reason: 'wrong', triesLeft: 2 });
  });

  test('the clock makes no difference (there is no waiting to shorten or skip)', async () => {
    const { app } = await boot();
    for (const pin of ['0001', '0002', '0003', '0004', '0005']) await app.gate.unlockParentArea(pin);
    for (const moved of [T0 - 3 * DAY, T0 + 2 * DAY]) {
      setClock(moved);
      expect(await app.gate.getParentAccess()).toEqual({ state: 'locked', deviceCheck: true });
      expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'device-check' });
    }
  });

  test('a correct PIN starts the count again', async () => {
    const { app } = await boot();
    await app.gate.unlockParentArea('0001');
    await app.gate.unlockParentArea('0002');
    expect(await failures(app)).toBe(2);
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
    expect(await failures(app)).toBe(0);
    app.gate.lockParentArea();
    expect(await app.gate.unlockParentArea('0001')).toMatchObject({ reason: 'wrong', triesLeft: 4 });
  });

  test('two taps at once are counted one after the other (no lost count)', async () => {
    const { app, verifier } = await boot();
    const [a, b] = await Promise.all([app.gate.unlockParentArea('1111'), app.gate.unlockParentArea('2222')]);
    expect(a).toMatchObject({ reason: 'wrong', triesLeft: 4 });
    expect(b).toMatchObject({ reason: 'wrong', triesLeft: 3 });
    expect(verifier.verify).toHaveBeenCalledTimes(2);
    expect(await failures(app)).toBe(2);
  });

  test('closing the app in the middle of a check still counts that guess (counted before it is checked)', async () => {
    const { app, verifier } = await boot();
    verifier.verify.mockImplementation(() => new Promise<boolean>(() => {})); // the app is "killed" while checking
    void app.gate.unlockParentArea('0001');
    await flush();
    expect(await failures(app)).toBe(1);
    const restarted = await boot({ storage: await app.dump() });
    expect(await restarted.app.gate.unlockParentArea('0002')).toMatchObject({ reason: 'wrong', triesLeft: 3 }); // 2nd, not 1st
  });

  test('recovery-code tries are never counted and never held back', async () => {
    const { app } = await boot();
    for (const pin of ['0001', '0002', '0003', '0004', '0005']) await app.gate.unlockParentArea(pin);
    const wrong = await app.gate.limitedAttempt(async () => false, undefined, 'code');
    expect(wrong).toEqual({ kind: 'wrong', triesLeft: 0 });
    expect(await failures(app)).toBe(5); // not counted
    const right = await app.gate.limitedAttempt(async () => true, undefined, 'code');
    expect(right).toEqual({ kind: 'ok' });
    expect(await failures(app)).toBe(0); // a right code (the way out for a parent who forgot the PIN) clears the count
  });

  test('the waiting periods of earlier versions are gone: a saved pause is ignored, so nobody stays locked after the update', async () => {
    const old = JSON.stringify({ version: 1, failures: 3, lockedUntil: T0 + 60 * MIN, lastSeen: T0 });
    const { app, verifier } = await boot({ storage: new Map([[GATE_KEY, old]]) });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked' }); // not "cooldown"
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
    expect(verifier.verify).toHaveBeenCalledTimes(1);
    // and the three wrong tries it had counted still count: two more, not five
    const again = await boot({ storage: new Map([[GATE_KEY, old]]) });
    expect(await again.app.gate.unlockParentArea('0001')).toMatchObject({ reason: 'wrong', triesLeft: 1 });
    expect(JSON.parse((await again.app.AsyncStorage.getItem(GATE_KEY))!).lockedUntil).toBe(0);
  });

  test('PINs of 5 to 8 digits made by earlier versions are still checked', async () => {
    for (const legacy of ['13579', '135792', '1357924', '13579246']) {
      const app = await loadApp();
      app.gate.registerPinVerifier(fakeVerifier(legacy));
      expect(await app.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'wrong' });
      expect(await app.gate.unlockParentArea(legacy)).toEqual({ ok: true });
    }
  });
});

describe('failing closed', () => {
  test('if the count cannot be saved, the PIN is not checked at all', async () => {
    const { app, verifier } = await boot();
    const real = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async () => {
      throw new Error('disk full');
    });
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'unavailable', detail: 'attempts-write' });
    app.AsyncStorage.setItem = real;
    expect(verifier.verify).not.toHaveBeenCalled();
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });

  test('if the count cannot be read, the PIN is not checked and the area stays locked', async () => {
    const { app, verifier } = await boot();
    const real = app.AsyncStorage.getItem;
    app.AsyncStorage.getItem = jest.fn(async () => {
      throw new Error('read error');
    });
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'unavailable', detail: 'attempts-read' });
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    app.AsyncStorage.getItem = real;
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  test('a damaged count is never a free reset: it counts as five wrong tries, so the screen-lock check is needed', async () => {
    const storage = new Map([[GATE_KEY, '{ not json']]);
    const { app } = await boot({ storage });
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked', deviceCheck: true });
    expect(JSON.parse((await app.AsyncStorage.getItem(GATE_KEY))!)).toMatchObject({ failures: 5, lockedUntil: 0 }); // repaired, not left damaged
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'device-check' });
    mockAuth.result = { success: true };
    expect(await app.gate.passDeviceCheck('Confirm', 'Cancel')).toBe('passed');
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });

  test('a PIN check that fails by error is "unavailable" and the guess stays counted', async () => {
    const { app, verifier } = await boot();
    verifier.verify.mockRejectedValueOnce(new Error('keystore error'));
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'unavailable', detail: 'check-failed' });
    expect(await failures(app)).toBe(1);
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });

  test('if it cannot be told whether a PIN exists, the area is treated as protected', async () => {
    const app = await loadApp();
    app.gate.registerPinVerifier({ isConfigured: async () => { throw new Error('unknown'); }, verify: async () => false });
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });
});

describe('the open session locks again', () => {
  async function open() {
    const ctx = await boot();
    await ctx.app.gate.unlockParentArea(PIN);
    return ctx.app;
  }

  test('after 5 minutes without use; any use keeps it open, up to 30 minutes in total', async () => {
    const app = await open();
    setClock(T0 + 4 * MIN);
    expect((await app.gate.getParentAccess()).state).toBe('unlocked');
    app.gate.touchParentSession();
    setClock(T0 + 8 * MIN);
    expect((await app.gate.getParentAccess()).state).toBe('unlocked'); // 4 min since the last use
    for (let m = 12; m < 30; m += 4) {
      setClock(T0 + m * MIN);
      app.gate.touchParentSession();
    }
    setClock(T0 + 31 * MIN);
    expect((await app.gate.getParentAccess()).state).toBe('locked'); // the total limit, even with constant use
    const quiet = await open();
    setClock(T0 + 6 * MIN);
    expect((await quiet.gate.getParentAccess()).state).toBe('locked');
  });

  test('a clock moved backwards locks it', async () => {
    const app = await open();
    setClock(T0 - 1 * MIN);
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });

  test('"Lock now" and registering a new PIN checker lock it, and listeners hear about it', async () => {
    const app = await open();
    const heard = jest.fn();
    app.gate.subscribeToParentAccess(heard);
    app.gate.lockParentArea();
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    expect(heard).toHaveBeenCalledTimes(1);
    await app.gate.unlockParentArea(PIN);
    app.gate.registerPinVerifier(fakeVerifier());
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });

  test('the app going to the background or inactive locks it; coming back to the foreground does not unlock', async () => {
    const app = await open();
    const { AppState } = app.reactNative;
    let handler: ((s: string) => void) | undefined;
    const remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, cb: (s: string) => void) => {
      handler = cb;
      return { remove };
    }) as never);
    const stop = app.gate.startParentGateAutoLock();
    handler!('active');
    expect((await app.gate.getParentAccess()).state).toBe('unlocked');
    handler!('inactive');
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    await app.gate.unlockParentArea(PIN);
    handler!('background');
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    handler!('active');
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    stop();
    expect(remove).toHaveBeenCalled();
  });

  test('switching to another profile locks it', async () => {
    const app = await open();
    await app.profiles.ensureProfilesReady();
    await app.profiles.registerChildProfile('kid1');
    app.gate.startParentGateAutoLock();
    expect((await app.gate.getParentAccess()).state).toBe('unlocked');
    expect(await app.profiles.switchProfile('kid1')).toMatchObject({ ok: true });
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    await app.gate.unlockParentArea(PIN);
    await app.profiles.switchProfile('main');
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });
});

describe('actions outside the parent screens', () => {
  async function onboardingBoot(pin: boolean) {
    const ctx = await boot({ pin });
    await ctx.app.onboarding.ensureOnboardingLoaded();
    await ctx.app.onboarding.skipOnboarding(); // an existing player who skipped set-up
    return ctx.app;
  }

  test('restarting the family set-up does nothing while the parent area is locked', async () => {
    const app = await onboardingBoot(true);
    await app.onboarding.restartOnboarding();
    expect((await app.onboarding.ensureOnboardingLoaded()).status).toBe('skipped'); // unchanged
  });

  test('it works once the parent area is open', async () => {
    const app = await onboardingBoot(true);
    await app.gate.unlockParentArea(PIN);
    await app.onboarding.restartOnboarding();
    expect((await app.onboarding.ensureOnboardingLoaded()).status).toBe('pending');
  });
});
