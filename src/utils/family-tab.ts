import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { installFamilyWebStorageFence } from '@/utils/storage-fence';
import { TabLock, browserTabLockEnv, type DeclineReason, type TabLockSnapshot } from '@/utils/web-tab-lock';
import type { LeaveResult } from '@/utils/family-session';
import type { UnfinishedKind } from '@/utils/unfinished-work';

// Connects the web tab lock (@/utils/web-tab-lock.ts) and the storage write fence (@/utils/storage-fence.ts) to the family-mode startup
// (Stage 4.4c). Everything here exists ONLY for family mode on the web: with the flag off, or on a phone, installFamilyTabProtection
// returns null and nothing is created, installed or changed.
//
// Order at startup (see src/app/_layout.tsx and @/components/web-tab-gate.tsx):
//   1. installFamilyTabProtection() runs when the root module is loaded, BEFORE anything can write: it creates the lock object (not
//      started yet: it owns nothing) and installs the fence on AsyncStorage, which refuses every ProductivityPet write until the lock is
//      really held.
//   2. WebTabGate starts the lock. Only when this document holds the Web Lock does it render the app, and only then do the onboarding
//      load, the profile layer, the PIN and the profile reconciliation start. A tab that does not own the lock shows a neutral screen
//      (the browser's language, no stored data) and none of that code runs.
//
// The OWNER'S side of a cooperative handoff is here: HandoffController decides when another tab may take over.

// ---------------------------------------------------------------------------------------------------------
// the owner's answer to "may another tab take over?"

export type HandoffView =
  | null
  // A profile may be in use: the person is asked, with the unfinished work that would be lost.
  | { kind: 'asking'; work: readonly UnfinishedKind[] }
  // They said yes: the existing safe leave is running (the parent area locks first, pending saves finish).
  | { kind: 'saving'; work: readonly UnfinishedKind[] }
  // The save did not work: this tab keeps control and nothing was lost.
  | { kind: 'failed'; reason: string };

export type HandoffDeps = {
  hasChosenProfile(): boolean;
  isLeaving(): boolean;
  hasPendingWork(): boolean;
  listUnfinished(): readonly UnfinishedKind[];
  leave(): Promise<LeaveResult>;
  subscribeToSession(listener: () => void): () => void;
};

export class HandoffController {
  private view: HandoffView = null;
  private readonly listeners = new Set<() => void>();
  private settle: ((answer: 'accept' | DeclineReason) => void) | null = null;
  private stopWatching: (() => void) | null = null;

  constructor(private readonly deps: HandoffDeps) {}

  getView = (): HandoffView => this.view;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setView(view: HandoffView): void {
    this.view = view;
    this.listeners.forEach((listener) => listener());
  }

  // Nobody is using a profile and nothing is being saved or released: the picker (or the start-up) can hand over without asking.
  private canHandOverNow(): boolean {
    return !this.deps.hasChosenProfile() && !this.deps.isLeaving() && !this.deps.hasPendingWork();
  }

  // The hook the lock calls on the OWNER when another tab asks. 'accept' only after the profile was really left safely.
  consent = (): Promise<'accept' | DeclineReason> => {
    if (this.settle) return new Promise((resolve) => resolve('in-use')); // one question at a time
    if (this.canHandOverNow()) return Promise.resolve('accept');
    return new Promise((resolve) => {
      this.settle = resolve;
      this.setView({ kind: 'asking', work: [...this.deps.listUnfinished()] });
      // Walking away from the question is NEVER an approval. If the person goes back to the picker (or the inactivity rule does it)
      // while the question is open, the request is DECLINED and the question closes: only an owner that was already idle on the picker
      // when the request arrived may hand over without being asked (checked above), and only the explicit button hands over otherwise.
      this.stopWatching = this.deps.subscribeToSession(() => {
        if (this.view?.kind === 'asking' && !this.deps.hasChosenProfile()) this.finish('in-use');
      });
    });
  };

  private finish(answer: 'accept' | DeclineReason): void {
    const settle = this.settle;
    this.settle = null;
    this.stopWatching?.();
    this.stopWatching = null;
    this.setView(null);
    settle?.(answer);
  }

  // "Let the other tab take over" (and "Try again" after a failed save): run the existing safe leave; yes only if it worked.
  accept = async (): Promise<void> => {
    const current = this.view;
    if (!current || !this.settle || current.kind === 'saving') return;
    const work = current.kind === 'asking' ? current.work : [...this.deps.listUnfinished()];
    this.setView({ kind: 'saving', work });
    let result: LeaveResult;
    try {
      result = await this.deps.leave();
    } catch {
      result = { ok: false, reason: 'storage' };
    }
    if (!this.settle) return;
    if (result.ok) this.finish('accept');
    else this.setView({ kind: 'failed', reason: result.reason });
  };

  // "Keep using this tab": this tab keeps control; the asking tab is told why.
  keep = (): void => {
    const current = this.view;
    if (!current || current.kind === 'saving') return;
    this.finish(current.kind === 'failed' ? 'save-failed' : 'in-use');
  };
}

// ---------------------------------------------------------------------------------------------------------
// the one lock of this document

let lock: TabLock | null = null;
let controller: HandoffController | null = null;

export function getHandoffController(): HandoffController {
  if (!controller) {
    controller = new HandoffController({
      hasChosenProfile: () => (require('@/utils/family-session') as typeof import('@/utils/family-session')).hasChosenProfile(),
      isLeaving: () => (require('@/utils/family-session') as typeof import('@/utils/family-session')).isLeavingProfile(),
      hasPendingWork: () => (require('@/utils/profiles') as typeof import('@/utils/profiles')).hasPendingProfileWork(),
      listUnfinished: () => (require('@/utils/unfinished-work') as typeof import('@/utils/unfinished-work')).listUnfinishedWork(),
      leave: () => (require('@/utils/family-session') as typeof import('@/utils/family-session')).leaveProfile(),
      subscribeToSession: (listener) => (require('@/utils/family-session') as typeof import('@/utils/family-session')).subscribeToFamilySession(listener),
    });
  }
  return controller;
}

// Creates the lock (it owns nothing yet) and installs the write fence. Safe to call more than once. Returns null (and does nothing at
// all) unless family mode is on AND this is the web.
export function installFamilyTabProtection(): TabLock | null {
  if (lock) return lock;
  if (!FAMILY_MODE_ENABLED || Platform.OS !== 'web') return null;
  const env = browserTabLockEnv();
  if (!env) return null;
  const created = new TabLock(env, { consent: () => getHandoffController().consent() });
  installFamilyWebStorageFence(created.isOwner);
  lock = created;
  return lock;
}

export function getFamilyTabLock(): TabLock | null {
  return lock;
}

// For tests.
export function resetFamilyTabForTests(): void {
  lock = null;
  controller = null;
}

// ---------------------------------------------------------------------------------------------------------
// React

export function useTabLockSnapshot(source: TabLock): TabLockSnapshot {
  return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
}

export function useHandoffView(source: HandoffController): HandoffView {
  return useSyncExternalStore(source.subscribe, source.getView, source.getView);
}
