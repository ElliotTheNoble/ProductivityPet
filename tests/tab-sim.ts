import type { ChannelLike, LockManagerLike, LockRequestOptions, TabLockEnv } from '@/utils/web-tab-lock';

// A small simulation of several browser tabs of ONE origin, for testing the web tab lock. It models exactly what the lock relies on:
//  - Web Locks: an exclusive lock per name, granted first come first served, released when the callback's promise settles, with
//    `ifAvailable`. A tab that CRASHES or closes loses its lock and its queued requests at once (the browser does that). A FROZEN tab
//    keeps its lock and neither runs code nor receives messages until it thaws. `steal` does not exist here on purpose: nothing in
//    the app may use it.
//  - BroadcastChannel: a message goes to every other open channel of the same name, in a later turn; a frozen tab gets its messages
//    when it thaws; a crashed tab gets none.
//  - A shared local storage (a plain Map), so tests can see which tab's writes landed.

type Entry = { tab: string; callback: (lock: unknown | null) => unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void };

export type SimTab = {
  id: string;
  env: TabLockEnv;
  reloads: number;
  frozen: boolean;
  crashed: boolean;
};

export function createBrowserSim() {
  const holders = new Map<string, { tab: string; done: () => void; abort: () => void }>();
  const queues = new Map<string, Entry[]>();
  const channels: { tab: string; name: string; channel: ChannelLike; closed: boolean }[] = [];
  const frozenInbox = new Map<string, unknown[]>();
  const tabs = new Map<string, SimTab>();
  const storage = new Map<string, string>();
  const log: string[] = [];
  let counter = 0;

  const tabIs = (id: string) => tabs.get(id)!;

  function drain(name: string): void {
    if (holders.has(name)) return;
    const queue = queues.get(name) ?? [];
    const next = queue.shift();
    if (!next) return;
    grant(name, next);
  }

  function grant(name: string, entry: Entry): void {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      if (holders.get(name)?.tab === entry.tab) holders.delete(name);
      drain(name);
    };
    const abort = () => {
      // the lock was taken away: the holder's request() promise rejects (AbortError), as in a real browser
      if (finished) return;
      finished = true;
      if (holders.get(name)?.tab === entry.tab) holders.delete(name);
      entry.reject(Object.assign(new Error('The lock request was aborted'), { name: 'AbortError' }));
      drain(name);
    };
    holders.set(name, { tab: entry.tab, done, abort });
    let result: unknown;
    try {
      result = entry.callback({ name });
    } catch (error) {
      done();
      entry.reject(error);
      return;
    }
    Promise.resolve(result).then(
      (value) => {
        done();
        entry.resolve(value);
      },
      (error) => {
        done();
        entry.reject(error);
      }
    );
  }

  function manager(tab: string): LockManagerLike {
    return {
      request(name: string, options: LockRequestOptions, callback: (lock: unknown | null) => unknown): Promise<unknown> {
        return new Promise((resolve, reject) => {
          if (tabIs(tab).crashed) return; // a dead tab never hears back
          const entry: Entry = { tab, callback, resolve, reject };
          if (options.ifAvailable) {
            if (holders.has(name)) {
              Promise.resolve()
                .then(() => callback(null))
                .then(resolve, reject);
              return;
            }
            grant(name, entry);
            return;
          }
          const queue = queues.get(name) ?? [];
          queue.push(entry);
          queues.set(name, queue);
          drain(name);
        });
      },
    };
  }

  function deliver(to: string, name: string, data: unknown): void {
    const target = tabIs(to);
    if (target.crashed) return;
    if (target.frozen) {
      frozenInbox.set(to, [...(frozenInbox.get(to) ?? []), { name, data }]);
      return;
    }
    for (const c of channels) {
      if (c.tab === to && c.name === name && !c.closed) Promise.resolve().then(() => !tabIs(to).crashed && c.channel.onmessage?.({ data }));
    }
  }

  function openChannel(tab: string) {
    return (name: string): ChannelLike => {
      const channel: ChannelLike = {
        onmessage: null,
        postMessage(message: unknown) {
          log.push(`${tab} -> ${JSON.stringify(message)}`);
          for (const other of tabs.keys()) if (other !== tab) deliver(other, name, message);
        },
        close() {
          const record = channels.find((c) => c.channel === channel);
          if (record) record.closed = true;
        },
      };
      channels.push({ tab, name, channel, closed: false });
      return channel;
    };
  }

  type TabOptions = { secure?: boolean; webLocks?: boolean; broadcast?: boolean; storage?: 'ok' | 'throws'; startAttempts?: number; startRetryMs?: number; unansweredMs?: number; onReload?: (tab: SimTab) => void };

  function newTab(options: TabOptions = {}): SimTab {
    const id = `tab-${(counter += 1)}`;
    const tab: SimTab = {
      id,
      reloads: 0,
      frozen: false,
      crashed: false,
      env: {
        secureContext: options.secure ?? true,
        locks: options.webLocks === false ? null : manager(id),
        openChannel: options.broadcast === false ? null : openChannel(id),
        probeStorage: () => {
          if (options.storage === 'throws') throw new Error('storage unavailable');
          return true;
        },
        newId: () => `doc-${id}`,
        reload: () => {
          tab.reloads += 1;
          options.onReload?.(tab);
        },
        setTimer: (run, ms) => setTimeout(run, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        startAttempts: options.startAttempts ?? 3,
        startRetryMs: options.startRetryMs ?? 5,
        unansweredMs: options.unansweredMs ?? 30,
      },
    };
    tabs.set(id, tab);
    return tab;
  }

  return {
    storage,
    log,
    newTab,
    holder: (name: string) => holders.get(name)?.tab ?? null,
    // the tab closes or crashes: its lock and queued requests go, its channels close
    crash(tab: SimTab): void {
      tab.crashed = true;
      for (const [name, held] of holders) if (held.tab === tab.id) held.done(), holders.delete(name);
      for (const [name, queue] of queues) queues.set(name, queue.filter((entry) => entry.tab !== tab.id));
      for (const c of channels) if (c.tab === tab.id) c.closed = true;
      for (const name of holders.keys()) drain(name);
      for (const name of queues.keys()) drain(name);
    },
    // the tab stops running (browser freezing): it keeps its lock, hears nothing until thaw()
    freeze(tab: SimTab): void {
      tab.frozen = true;
    },
    thaw(tab: SimTab): void {
      tab.frozen = false;
      const inbox = frozenInbox.get(tab.id) ?? [];
      frozenInbox.delete(tab.id);
      for (const item of inbox as { name: string; data: unknown }[]) deliver(tab.id, item.name, item.data);
    },
    // something that is NOT this app (devtools, another script) takes the lock away from its holder
    externalSteal(name: string): void {
      holders.get(name)?.abort();
    },
  };
}

export const settle = async (ms = 30) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};
