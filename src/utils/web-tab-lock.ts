// One browser tab at a time may own the family storage (web, family mode only; Stage 4.4a). The source of exclusive ownership is an
// exclusive Web Lock held for the whole life of the owning document: the browser itself releases it when that tab closes, crashes or
// reloads, and nothing in this file ever steals, forces or bypasses a lock held by another tab. Nothing here is stored: there is no
// heartbeat, no token and no localStorage ownership record (localStorage cannot make a check-then-write atomic across tabs, so it is
// not used as a lock). If Web Locks, a secure context, or working storage are missing, the tab is "unsupported" and nothing may run:
// failing closed.
//
// WHAT IS NOT IN THIS FILE: it is not connected to the app's screens yet (the blocked screen, the consent dialog and the startup gate
// come in a later stage), and the storage fence that refuses writes without ownership is in @/utils/storage-fence.ts.
//
// How it works
//   start()           checks the environment, then asks for the lock with `ifAvailable`. Got it: this tab is the OWNER. Not available
//                     (even after a few short retries, because the old page of a reload may still be letting go): the tab is
//                     BLOCKED. A blocked tab never reads or writes family data.
//   a blocked tab     can ask the owner to hand over (cooperative takeover, over a BroadcastChannel). The owner decides through a hook
//                     the app provides: it asks its own person if a profile is open, finishes every tracked save, and only then
//                     releases the lock and says so. If the owner is silent (frozen, busy, hung) the asking tab can do nothing but
//                     wait: three seconds of silence is not proof that the other tab is safe to replace. If no BroadcastChannel
//                     exists, asking is not possible at all and the tab can only wait for the lock to be released naturally.
//   becoming owner    a tab that was ever blocked, or that handed over, NEVER becomes owner inside the same document: its memory may
//                     hold stale family data. `claim()` reloads the page; the fresh document runs start() again and only then can
//                     own the lock. So "owned" always means a fresh document that really holds the lock.
//   lock free signal  a blocked tab learns the lock is free from a queued Web Lock request that does nothing but notice (it holds the
//                     lock for an instant without ever being the owner, never reads or writes anything, and the tab's status stays
//                     "blocked"), and from the owner's "released" message. There is no polling.

export const TAB_LOCK_NAME = 'productivitypet-family-storage-owner';
export const TAB_CHANNEL_NAME = 'productivitypet-family-tabs';

// ---------------------------------------------------------------------------------------------------------
// what the browser provides (injected, so two tabs can be simulated)

export type LockRequestOptions = { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean };
export type LockManagerLike = {
  request(name: string, options: LockRequestOptions, callback: (lock: unknown | null) => unknown): Promise<unknown>;
};
export type ChannelLike = {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
};

export type TabLockEnv = {
  secureContext: boolean;
  locks: LockManagerLike | null;
  // null = no BroadcastChannel: cooperative takeover is impossible (a second tab can only wait)
  openChannel: ((name: string) => ChannelLike) | null;
  // true only when this tab can read and write the browser's local storage (an unrelated probe key, never a family key)
  probeStorage: () => boolean;
  newId: () => string;
  reload: () => void;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  // The old page of a reload may still be releasing the lock for a moment: a few short retries before calling the tab blocked.
  startAttempts?: number;
  startRetryMs?: number;
  // How long an asking tab waits for an answer before saying the other tab did not answer (it never steals).
  unansweredMs?: number;
};

// ---------------------------------------------------------------------------------------------------------
// state

export type UnsupportedReason = 'insecure-context' | 'no-web-locks' | 'no-storage';
export type DeclineReason = 'in-use' | 'save-failed' | 'not-ready';
export type TabLockStatus =
  | 'checking' //     start() has not finished
  | 'owned' //        this document holds the lock: family storage may be used
  | 'blocked' //      another tab holds it: nothing of the family may be read, shown or written
  | 'released' //     this tab handed the lock over: like blocked, and it can never own again without a reload
  | 'lost' //         the lock was taken away from this document by something else (never by this file): like released
  | 'unsupported'; // the environment cannot guarantee a single tab

export type TabLockSnapshot = {
  readonly status: TabLockStatus;
  readonly reason: UnsupportedReason | null;
  // Cooperative takeover is possible (a BroadcastChannel exists).
  readonly canRequest: boolean;
  // The asking side: 'asking' (waiting for an answer), 'declined' (the owner said no), 'unanswered' (silence: nothing else happens).
  readonly request: 'none' | 'asking' | 'declined' | 'unanswered';
  readonly declinedBecause: DeclineReason | null;
  // A blocked tab has learned that the lock is free: claim() (a reload) can now try for it.
  readonly lockFree: boolean;
  // claim() has asked the page to reload (the fresh document will try to acquire the lock; nothing is owned yet).
  readonly claiming: boolean;
};

export type TabLockHooks = {
  // Called on the OWNER when another tab asks it to hand over. It must ask its own person when a profile is open, finish every
  // tracked save and leave the profile safely, and answer 'accept' ONLY after that really worked. Anything else keeps the lock.
  consent?: (from: string) => Promise<'accept' | DeclineReason>;
};

type Message =
  | { v: 1; type: 'request'; from: string }
  | { v: 1; type: 'decline'; from: string; to: string; reason: DeclineReason }
  | { v: 1; type: 'released'; from: string; to?: string };

const isMessage = (data: unknown): data is Message => {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return m.v === 1 && typeof m.from === 'string' && (m.type === 'request' || m.type === 'decline' || m.type === 'released');
};

const INITIAL: TabLockSnapshot = { status: 'checking', reason: null, canRequest: false, request: 'none', declinedBecause: null, lockFree: false, claiming: false };

export class TabLock {
  private readonly id: string;
  private snapshot: TabLockSnapshot = INITIAL;
  private readonly listeners = new Set<() => void>();
  private channel: ChannelLike | null = null;
  private releaseHolder: (() => void) | null = null;
  private waitingForRelease = false;
  private claimOnFree = false; // the person asked to take over: when the lock frees up, reload to claim it
  private claiming = false; // the reload was requested once: never twice
  private unansweredTimer: unknown = null;
  private handling = false;
  private handlingFrom: string | null = null;
  private stopped = false;
  private starting: Promise<void> | null = null; // start() works ONCE per document: a document that ever failed to own, or gave the lock up, never re-acquires in place

  constructor(
    private readonly env: TabLockEnv,
    private readonly hooks: TabLockHooks = {}
  ) {
    this.id = env.newId();
  }

  // ---- what the app reads

  getSnapshot = (): TabLockSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  // True ONLY while this document holds the lock. The storage fence asks this before every protected write.
  isOwner = (): boolean => this.snapshot.status === 'owned';

  getId(): string {
    return this.id;
  }

  private set(patch: Partial<TabLockSnapshot>): void {
    const next = { ...this.snapshot, ...patch };
    const same = (Object.keys(next) as (keyof TabLockSnapshot)[]).every((key) => next[key] === this.snapshot[key]);
    if (same) return;
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  // ---- starting

  // Resolves with the first settled state: owned, blocked or unsupported. Never rejects.
  start(): Promise<TabLockSnapshot> {
    // Never a second acquisition inside the same document (its memory may be stale): later calls wait for the first and return its result.
    if (!this.starting) this.starting = this.run();
    return this.starting.then(() => this.snapshot);
  }

  private async run(): Promise<void> {
    this.stopped = false;
    const { env } = this;
    if (!env.secureContext) return void this.unsupported('insecure-context');
    if (!env.locks) return void this.unsupported('no-web-locks');
    let usable = false;
    try {
      usable = env.probeStorage();
    } catch {
      usable = false;
    }
    if (!usable) return void this.unsupported('no-storage');

    this.openChannel();
    const attempts = Math.max(1, env.startAttempts ?? 4);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (this.stopped) return;
      if (await this.tryAcquire()) {
        this.set({ status: 'owned', request: 'none', declinedBecause: null, lockFree: false });
        return;
      }
      if (attempt < attempts - 1) await new Promise<void>((resolve) => env.setTimer(resolve, env.startRetryMs ?? 250));
    }
    this.enterWaiting('blocked');
  }

  private unsupported(reason: UnsupportedReason): TabLockSnapshot {
    this.set({ status: 'unsupported', reason, canRequest: false });
    return this.snapshot;
  }

  private openChannel(): void {
    const { env } = this;
    if (!env.openChannel || this.channel) return;
    try {
      const channel = env.openChannel(TAB_CHANNEL_NAME);
      channel.onmessage = (event) => this.onMessage(event.data);
      this.channel = channel;
      this.set({ canRequest: true });
    } catch {
      this.channel = null; // no channel: no cooperative takeover, only waiting
      this.set({ canRequest: false });
    }
  }

  // Asks for the lock without waiting. If it is granted the callback holds it until release (or until the document dies).
  private tryAcquire(): Promise<boolean> {
    const locks = this.env.locks;
    if (!locks) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let granted = false;
      locks
        .request(TAB_LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          granted = true;
          resolve(true);
          // held until releaseHolder() is called (a handoff) or the document goes away
          return new Promise<void>((release) => {
            this.releaseHolder = release;
          });
        })
        .then(
          () => undefined,
          () => {
            // The request itself failed or the lock was taken from this document by something else (this file never does that).
            if (!granted) resolve(false);
            else if (this.snapshot.status === 'owned') this.set({ status: 'lost' });
          }
        );
    });
  }

  // ---- waiting (blocked, released or lost): learning that the lock is free, without ever holding it

  private enterWaiting(status: 'blocked' | 'released' | 'lost'): void {
    this.set({ status, lockFree: false });
    if (this.waitingForRelease || !this.env.locks) return;
    this.waitingForRelease = true;
    // A queued request that only NOTICES the lock becoming available: its callback returns at once, so the lock is never kept, and
    // nothing is read or written meanwhile. This tab stays blocked; it does not become the owner (see claim()).
    void this.env.locks
      .request(TAB_LOCK_NAME, { mode: 'exclusive' }, () => {
        this.waitingForRelease = false;
        this.onLockFree();
        return undefined;
      })
      .catch(() => {
        this.waitingForRelease = false;
      });
  }

  private onLockFree(): void {
    if (this.stopped || this.snapshot.status === 'owned') return;
    this.set({ lockFree: true });
    // The person already asked for the takeover, and the owner has let go (or is gone): go on with it (a reload, see claim()).
    if (this.claimOnFree) this.claim();
  }

  // ---- the blocked side

  // Ask the owner to hand over. Does nothing without a BroadcastChannel. It never takes anything: it only asks.
  requestHandoff(): boolean {
    if (this.stopped || !this.channel) return false;
    const status = this.snapshot.status;
    if (status !== 'blocked' && status !== 'released' && status !== 'lost') return false;
    this.claimOnFree = true;
    this.set({ request: 'asking', declinedBecause: null });
    this.post({ v: 1, type: 'request', from: this.id });
    if (this.unansweredTimer !== null) this.env.clearTimer(this.unansweredTimer);
    this.unansweredTimer = this.env.setTimer(() => {
      this.unansweredTimer = null;
      // Silence changes nothing but what the screen says: the tab keeps waiting, and it never steals.
      if (this.snapshot.request === 'asking') this.set({ request: 'unanswered' });
    }, this.env.unansweredMs ?? 3000);
    return true;
  }

  // The person wants this tab to be the owner now that the lock is free: a REFRESH of the whole document, so no stale family data
  // survives; the new document runs start() and only then can own the lock. Returns false if it was not allowed (the lock is not
  // known to be free, or this tab already owns it).
  claim(): boolean {
    if (this.stopped) return false;
    const status = this.snapshot.status;
    if (status === 'owned' || status === 'unsupported' || status === 'checking') return false;
    if (!this.snapshot.lockFree) return false;
    if (this.claiming) return true;
    this.claiming = true;
    this.set({ claiming: true });
    this.env.reload();
    return true;
  }

  // ---- the owning side

  private onMessage(data: unknown): void {
    if (this.stopped || !isMessage(data) || data.from === this.id) return;
    if (data.type === 'request') {
      if (this.snapshot.status === 'owned') void this.answerRequest(data.from);
      return;
    }
    if (data.type === 'decline') {
      if (data.to === this.id && (this.snapshot.request === 'asking' || this.snapshot.request === 'unanswered')) {
        this.claimOnFree = false;
        if (this.unansweredTimer !== null) this.env.clearTimer(this.unansweredTimer);
        this.unansweredTimer = null;
        this.set({ request: 'declined', declinedBecause: data.reason });
      }
      return;
    }
    // 'released': the owner has let go; the queued notice (or this) tells a waiting tab that it may try.
    if (this.snapshot.status === 'blocked' || this.snapshot.status === 'released' || this.snapshot.status === 'lost') this.onLockFree();
  }

  private async answerRequest(from: string): Promise<void> {
    if (this.handling) {
      // The same tab asking again while its first question is still being answered: it already has its answer coming.
      if (from !== this.handlingFrom) this.post({ v: 1, type: 'decline', from: this.id, to: from, reason: 'in-use' });
      return;
    }
    const consent = this.hooks.consent;
    if (!consent) {
      this.post({ v: 1, type: 'decline', from: this.id, to: from, reason: 'not-ready' });
      return;
    }
    this.handling = true;
    this.handlingFrom = from;
    let answer: 'accept' | DeclineReason;
    try {
      answer = await consent(from);
    } catch {
      answer = 'save-failed';
    }
    this.handling = false;
    this.handlingFrom = null;
    if (this.stopped || this.snapshot.status !== 'owned') return;
    if (answer !== 'accept') {
      this.post({ v: 1, type: 'decline', from: this.id, to: from, reason: answer });
      return;
    }
    this.handOver(from);
  }

  // Only after the consent hook said 'accept' (every tracked save finished and the profile left): let go of the lock, say so, and
  // become a waiting tab that can never own again without a reload.
  private handOver(to: string): void {
    const release = this.releaseHolder;
    this.releaseHolder = null;
    this.set({ status: 'released', lockFree: false }); // from this instant isOwner() is false, before the lock is actually let go
    release?.();
    this.post({ v: 1, type: 'released', from: this.id, to });
    // A tab that handed the lock over does not watch for it to come free again: the other tab is about to take it, and "free" would be
    // a stale message a moment later. Reloading this page later starts a fresh document that asks for the lock like any other.
    // (requestHandoff() still works from here.)
  }

  private post(message: Message): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // a closed channel: nothing can be said
    }
  }

  // ---- ending

  // Stops listening and timers. An owning tab does NOT release the lock here: the lock lives and dies with the document.
  stop(): void {
    this.stopped = true;
    if (this.unansweredTimer !== null) this.env.clearTimer(this.unansweredTimer);
    this.unansweredTimer = null;
    try {
      this.channel?.close();
    } catch {
      // already closed
    }
    this.channel = null;
  }
}

// ---------------------------------------------------------------------------------------------------------
// the real browser, for the later stage that connects this to the app (family mode on the web only)

export function browserTabLockEnv(): TabLockEnv | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { locks?: LockManagerLike };
  const win = window as Window & { BroadcastChannel?: new (name: string) => ChannelLike };
  return {
    secureContext: window.isSecureContext === true,
    locks: nav.locks ?? null,
    openChannel: win.BroadcastChannel ? (name) => new win.BroadcastChannel!(name) : null,
    probeStorage: () => {
      const key = '__productivitypet_storage_probe__'; // not a family key, and removed again at once
      window.localStorage.setItem(key, '1');
      window.localStorage.removeItem(key);
      return true;
    },
    newId: () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    reload: () => window.location.reload(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
}
