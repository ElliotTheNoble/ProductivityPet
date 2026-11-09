import { DAY, T0, flush, freezeClock, loadApp, setClock, unfreezeClock, type App } from './helpers';

const GATE_KEY = '@ProductivityPet:parentGate';
const PIN = '246813';
const SEC = 1000;
const MIN = 60 * SEC;

beforeEach(() => freezeClock(T0));
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
    for (const bad of ['', '1', '123', '123456789', 'abcdef', '12 345', '12.456', ' 246813']) {
      expect(await app.gate.unlockParentArea(bad)).toEqual({ ok: false, reason: 'invalid-format' });
    }
    expect(verifier.verify).not.toHaveBeenCalled();
    expect(await failures(app)).toBe(0);
  });
});

describe('wrong guesses and the pause', () => {
  test('three tries, then a 30 second pause; nothing is checked during the pause', async () => {
    const { app, verifier } = await boot();
    expect(await app.gate.unlockParentArea('000000')).toEqual({ ok: false, reason: 'wrong', triesLeft: 2, cooldownMs: 0 });
    expect(await app.gate.unlockParentArea('000001')).toEqual({ ok: false, reason: 'wrong', triesLeft: 1, cooldownMs: 0 });
    expect(await app.gate.unlockParentArea('000002')).toEqual({ ok: false, reason: 'wrong', triesLeft: 0, cooldownMs: 30 * SEC });
    expect(verifier.verify).toHaveBeenCalledTimes(3);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'cooldown', remainingMs: 30 * SEC });

    const during = await app.gate.unlockParentArea(PIN); // even the CORRECT pin is refused during the pause
    expect(during).toEqual({ ok: false, reason: 'cooldown', remainingMs: 30 * SEC });
    expect(verifier.verify).toHaveBeenCalledTimes(3);

    setClock(T0 + 31 * SEC);
    expect(await app.gate.getParentAccess()).toEqual({ state: 'locked' });
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });

  test('the pauses grow: 30 s, 5 min, 15 min, 1 hour', async () => {
    const { app } = await boot();
    const expected: Record<number, number> = { 3: 30 * SEC, 4: 30 * SEC, 5: 5 * MIN, 6: 5 * MIN, 7: 15 * MIN, 8: 15 * MIN, 9: 60 * MIN, 10: 60 * MIN };
    let clock = T0;
    for (let n = 1; n <= 10; n += 1) {
      const r = await app.gate.unlockParentArea('999999');
      expect(r).toMatchObject({ ok: false, reason: 'wrong' });
      if (expected[n]) {
        expect((r as { cooldownMs: number }).cooldownMs).toBe(expected[n]);
        clock += expected[n] + SEC;
        setClock(clock);
      }
    }
    expect(app.gate.cooldownForFailures(2)).toBe(0);
    expect(app.gate.cooldownForFailures(50)).toBe(60 * MIN);
  });

  test('a correct PIN starts the count again', async () => {
    const { app } = await boot();
    await app.gate.unlockParentArea('000000');
    await app.gate.unlockParentArea('000001');
    expect(await failures(app)).toBe(2);
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
    expect(await failures(app)).toBe(0);
    app.gate.lockParentArea();
    expect(await app.gate.unlockParentArea('000000')).toMatchObject({ reason: 'wrong', triesLeft: 2 });
  });

  test('two taps at once are counted one after the other (no lost count)', async () => {
    const { app, verifier } = await boot();
    const [a, b] = await Promise.all([app.gate.unlockParentArea('111111'), app.gate.unlockParentArea('222222')]);
    expect(a).toMatchObject({ reason: 'wrong', triesLeft: 2 });
    expect(b).toMatchObject({ reason: 'wrong', triesLeft: 1 });
    expect(verifier.verify).toHaveBeenCalledTimes(2);
    expect(await failures(app)).toBe(2);
  });
});

describe('the pause survives restarts and tampering with the clock', () => {
  test('closing and reopening the app does not reset the count or the pause', async () => {
    const first = await boot();
    for (const pin of ['000000', '000001', '000002']) await first.app.gate.unlockParentArea(pin);
    const second = await boot({ storage: await first.app.dump() });
    expect(await second.app.gate.getParentAccess()).toMatchObject({ state: 'cooldown' });
    expect(await second.app.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(second.verifier.verify).not.toHaveBeenCalled();
    // after the pause, the count is still 3: the next wrong guess is the 4th (30 s again), the 5th is 5 minutes
    setClock(T0 + 40 * SEC);
    expect(await second.app.gate.unlockParentArea('000003')).toMatchObject({ reason: 'wrong', cooldownMs: 30 * SEC });
    const third = await boot({ storage: await second.app.dump() });
    setClock(T0 + 80 * SEC);
    expect(await third.app.gate.unlockParentArea('000004')).toMatchObject({ reason: 'wrong', cooldownMs: 5 * MIN });
  });

  test('closing the app in the middle of a check still counts that guess (counted before it is checked)', async () => {
    const { app, verifier } = await boot();
    verifier.verify.mockImplementation(() => new Promise<boolean>(() => {})); // the app is "killed" while checking
    void app.gate.unlockParentArea('000000');
    await flush();
    expect(await failures(app)).toBe(1);
    const restarted = await boot({ storage: await app.dump() });
    expect(await restarted.app.gate.unlockParentArea('000001')).toMatchObject({ reason: 'wrong', triesLeft: 1 }); // 2nd, not 1st
  });

  test('a clock moved BACKWARDS does not shorten the pause', async () => {
    const { app } = await boot();
    for (const pin of ['000000', '000001', '000002']) await app.gate.unlockParentArea(pin);
    setClock(T0 - 3 * DAY);
    const access = await app.gate.getParentAccess();
    expect(access.state).toBe('cooldown');
    expect(await app.gate.unlockParentArea(PIN)).toMatchObject({ ok: false, reason: 'cooldown' });
  });

  test('KNOWN LIMIT: a clock moved FORWARDS ends a pause early (no trusted time source on the device)', async () => {
    const { app } = await boot();
    for (const pin of ['000000', '000001', '000002']) await app.gate.unlockParentArea(pin);
    setClock(T0 + 2 * MIN);
    expect((await app.gate.getParentAccess()).state).toBe('locked');
  });
});

describe('failing closed', () => {
  test('if the count cannot be saved, the PIN is not checked at all', async () => {
    const { app, verifier } = await boot();
    const real = app.AsyncStorage.setItem;
    app.AsyncStorage.setItem = jest.fn(async () => {
      throw new Error('disk full');
    });
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'unavailable' });
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
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'unavailable' });
    expect((await app.gate.getParentAccess()).state).toBe('locked');
    app.AsyncStorage.getItem = real;
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  test('a damaged count is never a free reset: it starts a pause', async () => {
    const storage = new Map([[GATE_KEY, '{ not json']]);
    const { app } = await boot({ storage });
    expect((await app.gate.getParentAccess()).state).toBe('cooldown');
    expect(JSON.parse((await app.AsyncStorage.getItem(GATE_KEY))!).failures).toBe(3); // repaired, not left damaged
    setClock(T0 + 31 * SEC);
    expect((await app.gate.getParentAccess()).state).toBe('locked'); // and the pause really ends
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: true });
  });

  test('a PIN check that fails by error is "unavailable" and the guess stays counted', async () => {
    const { app, verifier } = await boot();
    verifier.verify.mockRejectedValueOnce(new Error('keystore error'));
    expect(await app.gate.unlockParentArea(PIN)).toEqual({ ok: false, reason: 'unavailable' });
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

describe('helpers', () => {
  test('formatRemaining', async () => {
    const { app } = await boot({ pin: false });
    expect(app.gate.formatRemaining(30 * SEC)).toBe('0:30');
    expect(app.gate.formatRemaining(29_001)).toBe('0:30');
    expect(app.gate.formatRemaining(5 * MIN)).toBe('5:00');
    expect(app.gate.formatRemaining(60 * MIN)).toBe('1:00:00');
    expect(app.gate.formatRemaining(-5)).toBe('0:00');
  });
});
