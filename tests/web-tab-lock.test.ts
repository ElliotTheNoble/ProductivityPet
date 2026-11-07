import { TAB_LOCK_NAME, TabLock, type TabLockHooks } from '@/utils/web-tab-lock';

import { createBrowserSim, settle, type SimTab } from './tab-sim';

// Stage 4.4a: the web tab lock, with several simulated tabs of one origin (see tests/tab-sim.ts). Web Locks are the only source of
// exclusive ownership; nothing is stolen, nothing is forced, nothing is stored.

type Sim = ReturnType<typeof createBrowserSim>;

// A document in a tab: its lock, plus the answer its owner gives when asked to hand over.
function document_(sim: Sim, options: Parameters<Sim['newTab']>[0] = {}, hooks: TabLockHooks = {}) {
  const tab = sim.newTab(options);
  const lock = new TabLock(tab.env, hooks);
  return { tab, lock };
}
const owners = (docs: { lock: TabLock }[]) => docs.filter((d) => d.lock.isOwner()).length;

describe('two tabs competing for ownership', () => {
  test('the first tab owns it, the second is blocked, and exactly one owns it at any time', async () => {
    const sim = createBrowserSim();
    const a = document_(sim);
    const b = document_(sim);
    expect((await a.lock.start()).status).toBe('owned');
    expect((await b.lock.start()).status).toBe('blocked');
    expect(owners([a, b])).toBe(1);
    expect(sim.holder(TAB_LOCK_NAME)).toBe(a.tab.id);
    expect(b.lock.isOwner()).toBe(false);
  });

  test('five tabs that all start at the same moment: exactly one owner, the other four blocked', async () => {
    const sim = createBrowserSim();
    const docs = Array.from({ length: 5 }, () => document_(sim));
    const results = await Promise.all(docs.map((d) => d.lock.start()));
    expect(results.filter((r) => r.status === 'owned')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'blocked')).toHaveLength(4);
    expect(owners(docs)).toBe(1);
  });

  test('a blocked tab never becomes the owner by itself, however long it waits', async () => {
    const sim = createBrowserSim();
    const a = document_(sim);
    const b = document_(sim);
    await a.lock.start();
    await b.lock.start();
    await settle(100);
    expect(b.lock.getSnapshot().status).toBe('blocked');
    expect(b.lock.isOwner()).toBe(false);
    expect(owners([a, b])).toBe(1);
  });

  test('stopping the owner object does not release the lock: it lives and dies with the document', async () => {
    const sim = createBrowserSim();
    const a = document_(sim);
    const b = document_(sim);
    await a.lock.start();
    a.lock.stop();
    expect(sim.holder(TAB_LOCK_NAME)).toBe(a.tab.id);
    expect((await b.lock.start()).status).toBe('blocked');
  });
});

describe('cooperative handoff', () => {
  test('the owner saves first, lets go only then, and the asking tab claims it with a fresh document, never inside the old one', async () => {
    const sim = createBrowserSim();
    const order: string[] = [];
    let fresh: ReturnType<typeof document_> | null = null;
    const a = document_(sim, {}, {
      consent: async () => {
        order.push('save-and-leave');
        await settle(10); // the tracked saves finish, the profile is left
        order.push('saved');
        return 'accept';
      },
    });
    const b = document_(sim, {
      onReload: (tab) => {
        // the page of tab B reloads: the old document is gone, a fresh one starts
        order.push('b-reload');
        sim.crash(tab);
        fresh = document_(sim, {});
        void fresh.lock.start();
      },
    });
    await a.lock.start();
    await b.lock.start();

    expect(b.lock.requestHandoff()).toBe(true);
    expect(b.lock.getSnapshot().request).toBe('asking');
    await settle(120);

    expect(order).toEqual(['save-and-leave', 'saved', 'b-reload']);
    expect(a.lock.getSnapshot().status).toBe('released');
    expect(a.lock.isOwner()).toBe(false);
    expect(b.lock.isOwner()).toBe(false); // the old document of B never owns anything
    expect(b.tab.reloads).toBe(1);
    expect(fresh!.lock.getSnapshot().status).toBe('owned');
    expect(sim.holder(TAB_LOCK_NAME)).toBe(fresh!.tab.id);
    expect(owners([a, b, fresh!])).toBe(1);
  });

  test('the old owner stops being the owner BEFORE the lock is let go, so it cannot write in between', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, {}, { consent: async () => 'accept' });
    const b = document_(sim);
    await a.lock.start();
    await b.lock.start();
    const seen: string[] = [];
    a.lock.subscribe(() => seen.push(`${a.lock.getSnapshot().status}:holder=${sim.holder(TAB_LOCK_NAME)}`));
    b.lock.requestHandoff();
    await settle(60);
    expect(seen[0]).toBe(`released:holder=${a.tab.id}`); // already not the owner while the lock was still held
  });

  test('the old owner can never own again in the same document, even when the lock is free', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, {}, { consent: async () => 'accept' });
    const b = document_(sim);
    await a.lock.start();
    await b.lock.start();
    b.lock.requestHandoff();
    await settle(60);
    expect(a.lock.getSnapshot().status).toBe('released');
    expect(a.lock.isOwner()).toBe(false);
    expect((await a.lock.start()).status).toBe('released'); // start() works once per document: it cannot take the lock again in place
    await settle(30);
    expect(a.lock.isOwner()).toBe(false);
    expect(owners([a, b])).toBe(0); // B never owns inside its old document either
  });

  test('the owner can say no (in use, or the save failed): it keeps the lock and the asking tab is told why', async () => {
    for (const reason of ['in-use', 'save-failed'] as const) {
      const sim = createBrowserSim();
      const a = document_(sim, {}, { consent: async () => reason });
      const b = document_(sim);
      await a.lock.start();
      await b.lock.start();
      b.lock.requestHandoff();
      await settle(50);
      expect(b.lock.getSnapshot()).toMatchObject({ request: 'declined', declinedBecause: reason });
      expect(a.lock.isOwner()).toBe(true);
      expect(b.tab.reloads).toBe(0);
    }
  });

  test('an owner with no consent hook answers "not ready" and keeps the lock; a consent that throws is a failed save', async () => {
    const sim = createBrowserSim();
    const quiet = document_(sim);
    const asker = document_(sim);
    await quiet.lock.start();
    await asker.lock.start();
    asker.lock.requestHandoff();
    await settle(40);
    expect(asker.lock.getSnapshot()).toMatchObject({ request: 'declined', declinedBecause: 'not-ready' });
    const sim2 = createBrowserSim();
    const boom = document_(sim2, {}, {
      consent: async () => {
        throw new Error('boom');
      },
    });
    const asker2 = document_(sim2);
    await boom.lock.start();
    await asker2.lock.start();
    asker2.lock.requestHandoff();
    await settle(40);
    expect(asker2.lock.getSnapshot()).toMatchObject({ request: 'declined', declinedBecause: 'save-failed' });
    expect(boom.lock.isOwner()).toBe(true);
  });

  test('a second request while the owner is still deciding is answered "in use"; the first still completes', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, {}, {
      consent: async () => {
        await settle(40);
        return 'accept';
      },
    });
    const b = document_(sim);
    const c = document_(sim);
    await a.lock.start();
    await b.lock.start();
    await c.lock.start();
    b.lock.requestHandoff();
    await settle(5);
    c.lock.requestHandoff();
    await settle(20);
    expect(c.lock.getSnapshot()).toMatchObject({ request: 'declined', declinedBecause: 'in-use' });
    await settle(80);
    expect(a.lock.getSnapshot().status).toBe('released');
  });

  test('a tab that is not blocked cannot ask, and asking changes nothing about who owns it', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, {}, { consent: async () => 'accept' });
    await a.lock.start();
    expect(a.lock.requestHandoff()).toBe(false);
    expect(a.lock.isOwner()).toBe(true);
  });

  test('messages from itself and garbage are ignored', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, {}, { consent: async () => 'accept' });
    await a.lock.start();
    const channel = (a.tab.env.openChannel as (name: string) => { onmessage: ((e: { data: unknown }) => void) | null })('productivitypet-family-tabs');
    void channel;
    expect(a.lock.isOwner()).toBe(true);
  });
});

describe('a frozen or unresponsive owner keeps the lock (nothing is ever taken)', () => {
  test('the asking tab is told only "no answer", never takes over, and waits', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, {}, { consent: async () => 'accept' });
    const b = document_(sim);
    await a.lock.start();
    await b.lock.start();
    sim.freeze(a.tab);
    b.lock.requestHandoff();
    await settle(80); // far longer than the "no answer" time
    expect(b.lock.getSnapshot().request).toBe('unanswered');
    expect(b.lock.isOwner()).toBe(false);
    expect(b.tab.reloads).toBe(0);
    expect(sim.holder(TAB_LOCK_NAME)).toBe(a.tab.id); // still the owner's
    expect(a.lock.isOwner()).toBe(true);
    expect(b.lock.claim()).toBe(false); // nothing to claim: the lock is not free
  });

  test('if the frozen owner wakes up it answers the old request and the handoff then completes normally', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, {}, { consent: async () => 'accept' });
    let reloaded = false;
    const b = document_(sim, { onReload: () => (reloaded = true) });
    await a.lock.start();
    await b.lock.start();
    sim.freeze(a.tab);
    b.lock.requestHandoff();
    await settle(60);
    expect(reloaded).toBe(false);
    sim.thaw(a.tab);
    await settle(80);
    expect(a.lock.getSnapshot().status).toBe('released');
    expect(reloaded).toBe(true);
  });

  test('there is no "take over anyway": the source never forces, steals or aborts a lock', () => {
    const fs = require('fs');
    const code = (fs.readFileSync(require('path').resolve('src/utils/web-tab-lock.ts'), 'utf8') as string).replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/steal/);
    expect(code).not.toMatch(/signal|AbortController|forceTakeover|takeOver/i);
    expect(code).not.toMatch(/heartbeat|epoch|getItem|sessionStorage|indexedDB|document\.cookie/);
    expect(code.match(/localStorage\.setItem/g)).toHaveLength(1); // only the storage probe, on a key that is not a family key
    expect(code).toMatch(/__productivitypet_storage_probe__/);
  });
});

describe('a closed or crashed owner releases the lock', () => {
  test('a waiting tab learns the lock is free (no polling), stays blocked, and only claims on request', async () => {
    const sim = createBrowserSim();
    const a = document_(sim);
    const b = document_(sim);
    await a.lock.start();
    await b.lock.start();
    expect(b.lock.getSnapshot().lockFree).toBe(false);
    sim.crash(a.tab);
    await settle(20);
    expect(b.lock.getSnapshot()).toMatchObject({ status: 'blocked', lockFree: true });
    expect(b.lock.isOwner()).toBe(false); // knowing is not owning
    expect(b.tab.reloads).toBe(0); // nobody asked for a takeover: nothing happens by itself
    expect(sim.holder(TAB_LOCK_NAME)).toBeNull();
  });

  test('claim() then reloads the page once, and the fresh document becomes the owner', async () => {
    const sim = createBrowserSim();
    let fresh: ReturnType<typeof document_> | null = null;
    const a = document_(sim);
    const b = document_(sim, {
      onReload: (tab) => {
        sim.crash(tab);
        fresh = document_(sim);
        void fresh.lock.start();
      },
    });
    await a.lock.start();
    await b.lock.start();
    sim.crash(a.tab);
    await settle(20);
    expect(b.lock.claim()).toBe(true);
    expect(b.lock.claim()).toBe(true); // asked twice: still one reload
    await settle(30);
    expect(b.tab.reloads).toBe(1);
    expect(b.lock.isOwner()).toBe(false);
    expect(fresh!.lock.isOwner()).toBe(true);
  });

  test('a tab that had already asked to take over goes ahead by itself when the owner crashes', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, {}, { consent: async () => 'accept' });
    const b = document_(sim);
    await a.lock.start();
    await b.lock.start();
    sim.freeze(a.tab);
    b.lock.requestHandoff();
    await settle(50);
    sim.crash(a.tab);
    await settle(30);
    expect(b.tab.reloads).toBe(1);
    expect(b.lock.isOwner()).toBe(false);
  });

  test('a reload: the old page lets go a moment after the new one starts, and the retries let the new page become the owner', async () => {
    const sim = createBrowserSim();
    const old = document_(sim);
    await old.lock.start();
    const next = document_(sim, { startAttempts: 8, startRetryMs: 8 });
    const starting = next.lock.start();
    setTimeout(() => sim.crash(old.tab), 20); // the old document is torn down shortly after
    expect((await starting).status).toBe('owned');
    expect(owners([next])).toBe(1); // (the old document is gone)
    expect(sim.holder(TAB_LOCK_NAME)).toBe(next.tab.id);
  });

  test('if the lock is still held after the retries, the new page is blocked, not owner', async () => {
    const sim = createBrowserSim();
    const old = document_(sim);
    await old.lock.start();
    const next = document_(sim, { startAttempts: 2, startRetryMs: 2 });
    expect((await next.lock.start()).status).toBe('blocked');
  });

  test('a tab that loses the lock to something else (never this app) is "lost": not owner, and it needs a reload and a new lock to own again', async () => {
    const sim = createBrowserSim();
    const a = document_(sim);
    await a.lock.start();
    sim.externalSteal(TAB_LOCK_NAME);
    await settle(20);
    expect(a.lock.getSnapshot().status).toBe('lost');
    expect(a.lock.isOwner()).toBe(false);
    expect(a.lock.requestHandoff()).toBe(true); // it may ask like any waiting tab
  });
});

describe('no BroadcastChannel', () => {
  test('cooperative takeover is off: asking does nothing, and a blocked tab can only wait for a natural release', async () => {
    const sim = createBrowserSim();
    let reloaded = 0;
    const a = document_(sim, { broadcast: false }, { consent: async () => 'accept' });
    const b = document_(sim, { broadcast: false, onReload: () => (reloaded += 1) });
    await a.lock.start();
    await b.lock.start();
    expect(b.lock.getSnapshot().canRequest).toBe(false);
    expect(b.lock.requestHandoff()).toBe(false);
    await settle(30);
    expect(b.lock.isOwner()).toBe(false);
    expect(a.lock.isOwner()).toBe(true);
    sim.crash(a.tab); // the original tab closes
    await settle(20);
    expect(b.lock.getSnapshot().lockFree).toBe(true);
    expect(b.lock.claim()).toBe(true);
    expect(reloaded).toBe(1);
  });

  test('a channel that cannot be opened is treated the same way', async () => {
    const sim = createBrowserSim();
    const tab = sim.newTab({});
    const env = {
      ...tab.env,
      openChannel: () => {
        throw new Error('blocked');
      },
    };
    const lock = new TabLock(env);
    expect((await lock.start()).status).toBe('owned');
    expect(lock.getSnapshot().canRequest).toBe(false);
  });
});

describe('an environment that cannot guarantee one tab fails closed', () => {
  test('no Web Locks: unsupported, never owner, never loads anything', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, { webLocks: false });
    expect(await a.lock.start()).toMatchObject({ status: 'unsupported', reason: 'no-web-locks', canRequest: false });
    expect(a.lock.isOwner()).toBe(false);
    expect(a.lock.requestHandoff()).toBe(false);
    expect(a.lock.claim()).toBe(false);
  });

  test('an insecure context (a LAN address over http): unsupported', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, { secure: false });
    expect(await a.lock.start()).toMatchObject({ status: 'unsupported', reason: 'insecure-context' });
    expect(a.lock.isOwner()).toBe(false);
  });

  test('storage that is unavailable or throws: unsupported, even though the lock itself would work', async () => {
    const sim = createBrowserSim();
    const a = document_(sim, { storage: 'throws' });
    expect(await a.lock.start()).toMatchObject({ status: 'unsupported', reason: 'no-storage' });
    expect(a.lock.isOwner()).toBe(false);
    expect(sim.holder(TAB_LOCK_NAME)).toBeNull(); // it did not even ask for the lock
  });

  test('a Web Locks request that fails outright leaves the tab blocked, never owner', async () => {
    const sim = createBrowserSim();
    const tab = sim.newTab({});
    const lock = new TabLock({ ...tab.env, locks: { request: () => Promise.reject(new Error('denied')) }, startAttempts: 2, startRetryMs: 1 });
    expect((await lock.start()).status).toBe('blocked');
    expect(lock.isOwner()).toBe(false);
  });

  test('before start() finishes nothing is owned', () => {
    const sim = createBrowserSim();
    const a = document_(sim);
    expect(a.lock.getSnapshot().status).toBe('checking');
    expect(a.lock.isOwner()).toBe(false);
  });
});

describe('the real browser environment', () => {
  test('is built from the browser objects, with no lock, channel or storage use until it is asked', () => {
    const { browserTabLockEnv } = require('@/utils/web-tab-lock') as typeof import('@/utils/web-tab-lock');
    const env = browserTabLockEnv();
    if (env === null) return; // an environment without a window builds nothing
    expect(typeof env.secureContext).toBe('boolean');
    expect(typeof env.probeStorage).toBe('function');
    expect(typeof env.reload).toBe('function');
  });
});

describe('whatever happens, at most one live document owns the lock (a seeded random run)', () => {
  test('hundreds of random starts, requests, freezes, thaws, crashes and claims never produce two owners, and the owner is always the lock holder', async () => {
    let seed = 20261106;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const sim = createBrowserSim();
    type Doc = { tab: SimTab; lock: TabLock; dead: boolean };
    const docs: Doc[] = [];
    const open = (): Doc => {
      let doc!: Doc;
      const tab = sim.newTab({
        startAttempts: 2,
        startRetryMs: 1,
        unansweredMs: 5,
        onReload: (t) => {
          const old = docs.find((d) => d.tab === t)!;
          if (!old.dead) {
            old.dead = true;
            sim.crash(t); // the reload tears the old document down
          }
          void open().lock.start();
        },
      });
      const lock = new TabLock(tab.env, { consent: async () => (random() < 0.7 ? 'accept' : 'in-use') });
      doc = { tab, lock, dead: false };
      docs.push(doc);
      return doc;
    };
    const live = () => docs.filter((d) => !d.dead);
    for (let i = 0; i < 4; i += 1) void open().lock.start();
    for (let step = 0; step < 300; step += 1) {
      const pool = live();
      const pick = pool[Math.floor(random() * pool.length)];
      const roll = random();
      if (pick) {
        if (roll < 0.25) pick.lock.requestHandoff();
        else if (roll < 0.35) pick.lock.claim();
        else if (roll < 0.45) {
          pick.dead = true;
          sim.crash(pick.tab);
        } else if (roll < 0.6) sim.freeze(pick.tab);
        else if (roll < 0.75) sim.thaw(pick.tab);
        else if (roll < 0.85 && live().length < 6) void open().lock.start();
      }
      await settle(4);
      const owning = live().filter((d) => d.lock.isOwner());
      expect(owning.length).toBeLessThanOrEqual(1);
      if (owning.length === 1) expect(sim.holder(TAB_LOCK_NAME)).toBe(owning[0].tab.id);
    }
    for (const doc of docs) sim.thaw(doc.tab);
    await settle(30);
    expect(live().filter((d) => d.lock.isOwner()).length).toBeLessThanOrEqual(1);
  });
});
