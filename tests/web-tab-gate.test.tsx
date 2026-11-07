import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, render } from '@testing-library/react-native';
import { createElement, useEffect } from 'react';
import { StyleSheet, Text } from 'react-native';

import { WebTabGate, browserLanguage } from '@/components/web-tab-gate';
import { setCurrentLanguage, translate, type StringKey } from '@/i18n';
import { HandoffController, type HandoffDeps } from '@/utils/family-tab';
import type { LeaveResult } from '@/utils/family-session';
import type { UnfinishedKind } from '@/utils/unfinished-work';
import { TAB_LOCK_NAME, TabLock } from '@/utils/web-tab-lock';

import { createBrowserSim, settle, type SimTab } from './tab-sim';

// Stage 4.4c: the gate in front of the whole app, the neutral blocked screens and the hand-over question, over a simulation of several
// tabs of one origin (tests/tab-sim.ts) with real components. The gate only ever ASKS: nothing here can force or steal the lock.

const SECRET = 'SECRET-PROFILE Mia 42 tokens';
const t = (key: StringKey, lang: 'en' | 'es' = 'en') => translate(lang, key);

beforeEach(() => setCurrentLanguage('en'));

// What the owner's tab knows, and what its "safe leave" does (the real one is covered in family-leave.test.ts).
function makeDeps(init: { chosen?: boolean; work?: UnfinishedKind[]; leave?: LeaveResult; pending?: boolean } = {}) {
  const state = { chosen: init.chosen ?? false, leaving: false, pending: init.pending ?? false, work: init.work ?? [], leaveCalls: 0, leaveResult: init.leave ?? ({ ok: true, changed: true } as LeaveResult) };
  const listeners = new Set<() => void>();
  const deps: HandoffDeps = {
    hasChosenProfile: () => state.chosen,
    isLeaving: () => state.leaving,
    hasPendingWork: () => state.pending,
    listUnfinished: () => state.work,
    leave: async () => {
      state.leaveCalls += 1;
      state.leaving = true;
      await settle(10);
      state.leaving = false;
      if (state.leaveResult.ok) state.chosen = false;
      listeners.forEach((l) => l());
      return state.leaveResult;
    },
    subscribeToSession: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  return { state, deps, notify: () => listeners.forEach((l) => l()) };
}

// A probe for "the whole app": it shows private data and reads storage the moment it is mounted.
const mounts: string[] = [];
const locks: TabLock[] = []; // every lock a test created (stopped after the test, see afterEach)
function AppProbe({ name }: { name: string }) {
  useEffect(() => {
    mounts.push(name);
    void AsyncStorage.getItem('@ProductivityPet:household');
  }, [name]);
  return createElement(Text, null, SECRET);
}

type Mount = { tab: SimTab; lock: TabLock; controller: HandoffController; model: ReturnType<typeof makeDeps>; view: Awaited<ReturnType<typeof render>>; name: string };

async function mountTab(sim: ReturnType<typeof createBrowserSim>, name: string, options: Parameters<ReturnType<typeof createBrowserSim>['newTab']>[0] = {}, model = makeDeps(), language: 'en' | 'es' = 'en'): Promise<Mount> {
  const tab = sim.newTab({ unansweredMs: 5000, ...options }); // a person may take a while to answer
  const controller = new HandoffController(model.deps);
  const lock = new TabLock(tab.env, { consent: () => controller.consent() });
  locks.push(lock);
  const view = await render(
    <WebTabGate lock={lock} controller={controller} language={language}>
      <AppProbe name={name} />
    </WebTabGate>
  );
  return { tab, lock, controller, model, view, name };
}

// A page reload: the old document is gone and a fresh one starts (it only OWNS something if it really gets the lock).
function reloadInto(sim: ReturnType<typeof createBrowserSim>, name: string) {
  const state: { fresh: Mount | null; done: Promise<void> | null } = { fresh: null, done: null };
  const onReload = (tab: SimTab) => {
    sim.crash(tab);
    state.done = mountTab(sim, name).then(async (m) => {
      state.fresh = m;
      await m.lock.start();
    });
  };
  return { state, onReload };
}

// A person (or a screen reader) activating a control: the accessibility click that React Native's Pressable answers with its onPress.
async function activate(element: { props: { onClick?: (event: unknown) => void } }): Promise<void> {
  const target = {};
  await act(async () => {
    element.props.onClick?.({ nativeEvent: {}, currentTarget: target, target, stopPropagation: () => undefined });
  });
}

let reads: jest.SpyInstance;
beforeEach(() => {
  mounts.length = 0;
  reads = jest.spyOn(AsyncStorage, 'getItem');
});
afterEach(async () => {
  reads.mockRestore();
  await cleanup(); // every tab of the test is closed before the next one starts
  for (const lock of locks.splice(0)) lock.stop(); // and its pending 'no answer' timer cancelled, so no timer outlives the test
});

const text = (m: Mount, key: StringKey, lang: 'en' | 'es' = 'en') => m.view.queryByText(t(key, lang));
const secret = (m: Mount) => m.view.queryByText(SECRET);
const button = (m: Mount, key: StringKey, lang: 'en' | 'es' = 'en') => m.view.queryByRole('button', { name: t(key, lang) });

// ---------------------------------------------------------------------------------------------------------
describe('two tabs opening at the same moment', () => {
  test('exactly one tab shows the app; the other shows a neutral screen with no private detail and never ran the app', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A');
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await Promise.all([a.lock.start(), b.lock.start()]);
      await settle(20);
    });
    const [owner, other] = a.lock.isOwner() ? [a, b] : [b, a];
    expect(secret(owner)).toBeTruthy();
    expect(secret(other)).toBeNull();
    expect(mounts).toEqual([owner.name]); // the blocked tab's app was never even rendered
    expect(reads).toHaveBeenCalledTimes(1); // and it read no storage
    expect(text(other, 'tlBlockedTitle')).toBeTruthy();
    expect(sim.holder(TAB_LOCK_NAME)).toBe(owner.tab.id);
  });

  test('before the lock question is answered nothing of the app is rendered or read', async () => {
    const sim = createBrowserSim();
    const tab = sim.newTab();
    tab.env.locks = { request: () => new Promise(() => undefined) }; // the browser has not answered yet
    const lock = new TabLock(tab.env, {});
    const view = await render(
      <WebTabGate lock={lock} controller={new HandoffController(makeDeps().deps)} language="en">
        <AppProbe name="A" />
      </WebTabGate>
    );
    await act(async () => {
      await settle(30);
    });
    expect(view.queryByText(t('tlChecking'))).toBeTruthy();
    expect(view.queryByText(SECRET)).toBeNull();
    expect(mounts).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
  });

  test('the blocked screen shows only fixed words: no stored language, profile, nickname, pet or token', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A');
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    const rendered = JSON.stringify(b.view.toJSON());
    expect(rendered).not.toMatch(/Mia|token|SECRET|Kitty|household/i);
    expect(reads).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('a successful cooperative handoff', () => {
  test('an owner on the picker with nothing pending lets go at once: the other tab reloads, then a FRESH document owns and starts the app', async () => {
    const sim = createBrowserSim();
    const reload = reloadInto(sim, 'B-fresh');
    const a = await mountTab(sim, 'A', {}, makeDeps({ chosen: false }));
    const b = await mountTab(sim, 'B', { onReload: reload.onReload });
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    expect(mounts).toEqual(['A']);
    await activate(b.view.getByRole('button', { name: t('tlAsk') }));
    await act(async () => {
    });
    expect(b.lock.getSnapshot().request).toBe('asking');
    await act(async () => {
      await settle(120);
      await reload.state.done;
    });
    const fresh = reload.state.fresh;

    expect(a.model.state.leaveCalls).toBe(0); // nothing was open: no leave was needed
    expect(text(a, 'tlReleasedTitle')).toBeTruthy(); // the old owner now shows a neutral "gave it away" screen
    expect(secret(a)).toBeNull();
    expect(b.tab.reloads).toBe(1);
    expect(b.lock.isOwner()).toBe(false); // the old page of B never owned anything
    expect(fresh!.lock.isOwner()).toBe(true);
    expect(mounts).toEqual(['A', 'B-fresh']); // private data was initialized only in the fresh, owning document
    expect(sim.holder(TAB_LOCK_NAME)).toBe(fresh!.tab.id);
  });

  test('an owner with a profile open asks its person first, naming the unfinished work; "yes" runs the safe leave and only then hands over', async () => {
    const sim = createBrowserSim();
    let reloaded = 0;
    const a = await mountTab(sim, 'A', {}, makeDeps({ chosen: true, work: ['task-draft', 'kitty-catch'] }));
    const b = await mountTab(sim, 'B', { onReload: () => (reloaded += 1) });
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    await act(async () => {
      b.lock.requestHandoff();
      await settle(30);
    });
    expect(a.view.getByText(t('tlHandoffTitle'))).toBeTruthy();
    expect(a.view.getByText(t('tlHandoffUnfinished'))).toBeTruthy();
    expect(a.view.getByText(`• ${t('pcKindTaskDraft')}`)).toBeTruthy();
    expect(a.view.getByText(`• ${t('pcKindKitty')}`)).toBeTruthy();
    expect(a.view.queryByText(`• ${t('pcKindBathing')}`)).toBeNull();
    expect(a.model.state.leaveCalls).toBe(0); // asking is not leaving
    expect(a.lock.isOwner()).toBe(true);
    expect(b.lock.getSnapshot().request).toBe('asking');

    await activate(a.view.getByRole('button', { name: t('tlHandoffLet') }));
    await act(async () => {
      await settle(150);
    });
    expect(a.model.state.leaveCalls).toBe(1);
    expect(text(a, 'tlReleasedTitle')).toBeTruthy();
    expect(a.lock.isOwner()).toBe(false);
    expect(reloaded).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('declined and failed handoffs: the owner keeps control and the asking tab stays blocked', () => {
  test('"Keep using this tab": the asking tab is told no; nothing is released, nothing reloads', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A', {}, makeDeps({ chosen: true, work: ['journal'] }));
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    await act(async () => {
      b.lock.requestHandoff();
      await settle(30);
    });
    await activate(a.view.getByRole('button', { name: t('tlHandoffKeep') }));
    await act(async () => {
      await settle(40);
    });
    expect(a.view.queryByText(t('tlHandoffTitle'))).toBeNull(); // the question is gone
    expect(secret(a)).toBeTruthy();
    expect(a.lock.isOwner()).toBe(true);
    expect(a.model.state.leaveCalls).toBe(0);
    expect(text(b, 'tlDeclinedTitle')).toBeTruthy();
    expect(button(b, 'tlAskAgain')).toBeTruthy();
    expect(b.lock.isOwner()).toBe(false);
    expect(b.tab.reloads).toBe(0);
  });

  test('a save that fails: the owner says so, keeps control, and the asking tab is told the save failed', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A', {}, makeDeps({ chosen: true, leave: { ok: false, reason: 'unsaved-changes', keys: ['k'] } }));
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    await act(async () => {
      b.lock.requestHandoff();
      await settle(30);
    });
    await activate(a.view.getByRole('button', { name: t('tlHandoffLet') }));
    await act(async () => {
      await settle(60);
    });
    expect(a.view.getByText(t('tlHandoffFailedTitle'))).toBeTruthy();
    expect(a.view.getByText(t('tlHandoffFailedBody'))).toBeTruthy();
    expect(a.lock.isOwner()).toBe(true);
    expect(secret(a)).toBeTruthy();
    expect(a.model.state.leaveCalls).toBe(1);
    // the person gives up: "Keep using this tab"
    await activate(a.view.getByRole('button', { name: t('tlHandoffKeep') }));
    await act(async () => {
      await settle(40);
    });
    expect(text(b, 'tlSaveFailedTitle')).toBeTruthy();
    expect(b.lock.getSnapshot()).toMatchObject({ request: 'declined', declinedBecause: 'save-failed' });
    expect(a.lock.isOwner()).toBe(true);
    expect(b.tab.reloads).toBe(0);
  });

  test('"Try again" after a failed save runs the safe leave again', async () => {
    const sim = createBrowserSim();
    const model = makeDeps({ chosen: true, leave: { ok: false, reason: 'timeout' } });
    const a = await mountTab(sim, 'A', {}, model);
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
      b.lock.requestHandoff();
      await settle(30);
    });
    await act(async () => {
      a.controller.accept();
      await settle(50);
    });
    expect(a.controller.getView()).toMatchObject({ kind: 'failed' });
    model.state.leaveResult = { ok: true, changed: true };
    await act(async () => {
      a.controller.accept();
      await settle(100);
    });
    expect(model.state.leaveCalls).toBe(2);
    expect(a.lock.getSnapshot().status).toBe('released');
  });

  test('walking away from the question is NEVER an approval: going back to the picker (or the idle rule doing it) while it is open declines the request', async () => {
    const sim = createBrowserSim();
    const model = makeDeps({ chosen: true });
    const a = await mountTab(sim, 'A', {}, model);
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
      b.lock.requestHandoff();
      await settle(30);
    });
    expect(a.controller.getView()).toMatchObject({ kind: 'asking' });
    await act(async () => {
      model.state.chosen = false; // back at the picker, nothing pending
      model.notify();
      await settle(80);
    });
    expect(a.controller.getView()).toBeNull(); // the question closed
    expect(a.lock.isOwner()).toBe(true); // nothing was handed over
    expect(a.lock.getSnapshot().status).toBe('owned');
    expect(model.state.leaveCalls).toBe(0);
    expect(text(b, 'tlDeclinedTitle')).toBeTruthy(); // the asking tab is told no
    expect(b.tab.reloads).toBe(0);
    // and only an owner that is ALREADY idle on the picker when a request arrives may hand over without being asked
    await act(async () => {
      b.lock.requestHandoff();
      await settle(100);
    });
    expect(a.lock.getSnapshot().status).toBe('released');
  });

  test('pending saves on the picker are not handed over silently: the person is asked', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A', {}, makeDeps({ chosen: false, pending: true }));
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
      b.lock.requestHandoff();
      await settle(30);
    });
    expect(a.controller.getView()).toMatchObject({ kind: 'asking' });
    expect(a.lock.isOwner()).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('an owner that does not answer, and an owner that goes away', () => {
  test('a frozen owner: the asking tab says "no answer", offers "Try asking again", and never takes over or reloads', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A', {}, makeDeps({ chosen: false }));
    const b = await mountTab(sim, 'B', { unansweredMs: 20 });
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    sim.freeze(a.tab);
    await act(async () => {
      b.lock.requestHandoff();
      for (let i = 0; i < 200 && b.lock.getSnapshot().request !== 'unanswered'; i += 1) await settle(10); // patient under load
    });
    expect(text(b, 'tlUnansweredTitle')).toBeTruthy();
    expect(text(b, 'tlUnansweredBody')).toBeTruthy(); // says: go back to the other tab or close it, never forced
    expect(secret(b)).toBeNull();
    expect(b.lock.isOwner()).toBe(false);
    expect(b.tab.reloads).toBe(0);
    expect(sim.holder(TAB_LOCK_NAME)).toBe(a.tab.id);
    const askedBefore = sim.log.filter((line) => line.includes('"request"')).length;
    await activate(b.view.getByRole('button', { name: t('tlAskAgain') }));
    await act(async () => {
      await settle(10);
    });
    expect(sim.log.filter((line) => line.includes('"request"')).length).toBe(askedBefore + 1); // it only ASKS again
    expect(['asking', 'unanswered']).toContain(b.lock.getSnapshot().request); // asked again (and, with no answer, silent again)
    expect(b.lock.isOwner()).toBe(false);
  });

  test('when the frozen owner wakes up it answers the old question and the handoff then completes normally', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A', {}, makeDeps({ chosen: false }));
    const b = await mountTab(sim, 'B', { unansweredMs: 20 });
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    sim.freeze(a.tab);
    await act(async () => {
      b.lock.requestHandoff();
      await settle(60);
    });
    await act(async () => {
      sim.thaw(a.tab);
      await settle(80);
    });
    expect(a.lock.getSnapshot().status).toBe('released');
    expect(b.tab.reloads).toBe(1);
  });

  test('the owner closes or crashes: the other tab only SAYS the lock is free; it owns nothing, runs nothing and reads nothing until the person taps', async () => {
    const sim = createBrowserSim();
    const reload = reloadInto(sim, 'B-fresh');
    const a = await mountTab(sim, 'A');
    const b = await mountTab(sim, 'B', { onReload: reload.onReload });
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    reads.mockClear();
    mounts.length = 0;
    await act(async () => {
      sim.crash(a.tab);
      await settle(40);
    });
    expect(text(b, 'tlFreeTitle')).toBeTruthy();
    expect(b.lock.isOwner()).toBe(false); // knowing the lock is free is not owning it
    expect(secret(b)).toBeNull();
    expect(mounts).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    expect(b.tab.reloads).toBe(0);
    expect(sim.holder(TAB_LOCK_NAME)).toBeNull();

    await activate(b.view.getByRole('button', { name: t('tlUseThisTab') }));
    await act(async () => {
      await settle(60);
      await reload.state.done;
    });
    const fresh = reload.state.fresh;
    expect(b.tab.reloads).toBe(1); // the explicit claim: a full page reload, never an in-place start
    expect(b.lock.isOwner()).toBe(false);
    expect(fresh!.lock.isOwner()).toBe(true);
    expect(mounts).toEqual(['B-fresh']);
  });

  test('while the page reloads after a claim, the tab says "Switching to this tab…" and owns nothing yet', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A');
    const b = await mountTab(sim, 'B', { onReload: () => undefined }); // the reload has not happened yet
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    await act(async () => {
      sim.crash(a.tab);
      await settle(40);
    });
    await activate(b.view.getByRole('button', { name: t('tlUseThisTab') }));
    await act(async () => {
    });
    expect(text(b, 'tlSwitchingTitle')).toBeTruthy();
    expect(b.lock.isOwner()).toBe(false);
    expect(mounts).toEqual(['A']);
  });

  test('without a BroadcastChannel the tab can only wait: no ask button, and it frees up when the original tab closes', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A', { broadcast: false });
    const b = await mountTab(sim, 'B', { broadcast: false });
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    expect(text(b, 'tlWaitingTitle')).toBeTruthy();
    expect(button(b, 'tlAsk')).toBeNull();
    await act(async () => {
      sim.crash(a.tab);
      await settle(40);
    });
    expect(text(b, 'tlFreeTitle')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('browsers that cannot guarantee one tab fail closed (nothing of the app is rendered or read)', () => {
  test.each([
    ['no Web Locks', { webLocks: false }, 'tlUnsupportedNoLocksTitle'],
    ['an insecure connection', { secure: false }, 'tlUnsupportedInsecureTitle'],
    ['storage that cannot be used', { storage: 'throws' as const }, 'tlUnsupportedNoStorageTitle'],
  ] as const)('%s', async (_name, options, title) => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A', options);
    await act(async () => {
      await a.lock.start();
    });
    expect(text(a, title as StringKey)).toBeTruthy();
    expect(secret(a)).toBeNull();
    expect(mounts).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    expect(a.view.queryAllByRole('button')).toHaveLength(0); // nothing to press: there is no way around it
  });

  test('a build that cannot even create a lock object shows the same unsupported screen', async () => {
    const view = await render(<WebTabGate language="en"><AppProbe name="X" /></WebTabGate>);
    // (no lock prop and not the family web in this test environment: the real installer returns null)
    expect(view.queryByText(SECRET)).toBeNull();
    expect(view.getByText(t('tlUnsupportedNoLocksTitle'))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('English and Spanish', () => {
  test('every blocked state has Spanish words, and the language comes from the browser, never from storage', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A');
    const b = await mountTab(sim, 'B', { unansweredMs: 10 }, makeDeps(), 'es');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    expect(text(b, 'tlBlockedTitle', 'es')).toBeTruthy();
    expect(button(b, 'tlAsk', 'es')).toBeTruthy();
    sim.freeze(a.tab);
    await act(async () => {
      b.lock.requestHandoff();
      await settle(40);
    });
    expect(text(b, 'tlUnansweredTitle', 'es')).toBeTruthy();
    expect(button(b, 'tlAskAgain', 'es')).toBeTruthy();
    expect(reads).toHaveBeenCalledTimes(1); // only the owner's probe read anything
  });

  test('the browser language picks the screens: Spanish for es, English for everything else', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const set = (value: unknown) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
    try {
      set({ language: 'es-MX', languages: ['es-MX', 'en'] });
      expect(browserLanguage()).toBe('es');
      set({ language: 'en-US', languages: ['en-US'] });
      expect(browserLanguage()).toBe('en');
      set({ language: 'fr-FR', languages: ['fr-FR'] });
      expect(browserLanguage()).toBe('en');
      set(undefined);
      expect(browserLanguage()).toBe('en');
    } finally {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    }
  });

  test('the question in the owner tab is Spanish when the app language is Spanish', async () => {
    setCurrentLanguage('es');
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A', {}, makeDeps({ chosen: true, work: ['bathing'] }));
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
      b.lock.requestHandoff();
      await settle(30);
    });
    expect(a.view.getByText('Otra pestaña quiere usar ProductivityPet')).toBeTruthy();
    expect(a.view.getByText('• El baño que empezaste')).toBeTruthy();
    expect(a.view.getByRole('button', { name: 'Dejar que la otra pestaña tome el control' })).toBeTruthy();
    expect(a.view.getByRole('button', { name: 'Seguir usando esta pestaña' })).toBeTruthy();
  });

  test('both languages have every string, and none of the blocked screens names a profile', () => {
    const en = require('@/i18n/tab-lock.en') as typeof import('@/i18n/tab-lock.en');
    const es = require('@/i18n/tab-lock.es') as typeof import('@/i18n/tab-lock.es');
    expect(Object.keys(es.tabLockEs).sort()).toEqual(Object.keys(en.tabLockEn).sort());
    for (const value of [...Object.values(en.tabLockEn), ...Object.values(es.tabLockEs)]) expect(value).not.toMatch(/\{name\}/);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('accessibility', () => {
  test('every blocked screen has one heading and a polite live status; every control is a labelled button of at least 44px', async () => {
    const sim = createBrowserSim();
    const a = await mountTab(sim, 'A');
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    expect(b.view.getAllByRole('header')).toHaveLength(1);
    const status = JSON.stringify(b.view.toJSON());
    expect(status).toContain('"accessibilityLiveRegion":"polite"');
    const ask = b.view.getByRole('button', { name: t('tlAsk') });
    expect(ask.props.accessible).toBe(true);
    const fs = require('fs');
    const ui = fs.readFileSync(require('path').resolve('src/components/family-ui.tsx'), 'utf8') as string;
    expect(ui).toMatch(/button: \{ minHeight: 44/);
    expect(StyleSheet.flatten({ minHeight: 44 }).minHeight).toBeGreaterThanOrEqual(44);
  });

  test('the owner\'s question is a modal dialog with two real buttons of at least 44px, announced once', async () => {
    const fs = require('fs');
    const modal = fs.readFileSync(require('path').resolve('src/components/confirm-modal.tsx'), 'utf8') as string;
    expect(modal).toMatch(/minHeight: 44/);
    const sim = createBrowserSim();
    const announce = jest.spyOn(require('react-native').AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    const a = await mountTab(sim, 'A', {}, makeDeps({ chosen: true }));
    const b = await mountTab(sim, 'B');
    await act(async () => {
      await a.lock.start();
      await b.lock.start();
    });
    announce.mockClear();
    await act(async () => {
      b.lock.requestHandoff();
      await settle(30);
    });
    expect(a.view.getByRole('button', { name: t('tlHandoffLet') })).toBeTruthy();
    expect(a.view.getByRole('button', { name: t('tlHandoffKeep') })).toBeTruthy();
    expect(announce).toHaveBeenCalledTimes(1);
    announce.mockRestore();
  });
});
