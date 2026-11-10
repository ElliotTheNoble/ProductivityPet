import AsyncStorage from '@react-native-async-storage/async-storage';

import { ensureHouseholdLoaded, getHouseholdIntegrity, isChildArchived } from '@/utils/household';
import { JOURNAL_KEY_NAME, isShared } from '@/utils/journal';
import { checkParentAction } from '@/utils/parent-session';
import { ensureProfilesReady, getProfilesStatus, scopedKeyFor } from '@/utils/profiles';

// What a parent may read of a child's journal: ONLY the entries the child has explicitly shared. This is the one module that reads
// another profile's journal, and the privacy filter runs in here, before anything is returned, so no parent-facing screen can ever
// receive a private entry (the result type has no field that could carry one). Rules:
//  - a verified parent session has to be open right now (the same check every parent-only action makes);
//  - only a real, registered CHILD profile can be read. Main (and a future Adult Profile) is the parent's own space: never readable
//    here, whatever its entries say. An unknown or duplicated id is refused;
//  - an ARCHIVED child is not readable while archived (the status is 'not-a-child', nothing is read); their journal is kept exactly as it
//    is, and if the child is restored their shared entries can be read again. Private entries are never returned, archived or not;
//  - an entry is shared only if its `visibility` is exactly 'shared' (a missing or any other value is private);
//  - it reads one stored record and writes nothing: no cache, no profile switch, no store is loaded, nothing is changed;
//  - a record that cannot be read or understood is reported as such, never guessed at.
// Notifications, previews and dashboard cards must get journal text only from here.

export type SharedReflection = { id: string; dateISO: string; text: string; updatedAt: string };

export type SharedJournalResult =
  | { status: 'ok'; entries: SharedReflection[] }
  | { status: 'not-allowed' } // no verified parent session is open
  | { status: 'not-a-child' } // Main, an unknown id, a duplicated id or an unregistered child: nothing is read
  | { status: 'unreadable' };

export async function readSharedJournal(childId: string): Promise<SharedJournalResult> {
  const check = await checkParentAction('children');
  if (!check.ok) return { status: 'not-allowed' };
  try {
    await ensureProfilesReady();
    const status = getProfilesStatus();
    const registered = status.state === 'ready' && status.profiles.some((p) => p.id === childId && p.kind === 'child' && p.storage === 'scoped');
    if (!registered) return { status: 'not-a-child' };
    const household = await ensureHouseholdLoaded();
    const info = getHouseholdIntegrity();
    if (info.loadFailed) return { status: 'unreadable' };
    const record = household.children.find((c) => c.id === childId);
    if (info.duplicateChildIds.includes(childId) || !record || isChildArchived(record)) return { status: 'not-a-child' };

    const raw = await AsyncStorage.getItem(scopedKeyFor(childId, JOURNAL_KEY_NAME));
    if (raw === null) return { status: 'ok', entries: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { status: 'unreadable' };
    const entries: SharedReflection[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      if (!isShared(r)) continue; // private (or anything unclear): dropped here, before it can be returned
      if (typeof r.id !== 'string' || typeof r.dateISO !== 'string' || typeof r.text !== 'string' || typeof r.updatedAt !== 'string') continue;
      entries.push({ id: r.id, dateISO: r.dateISO, text: r.text, updatedAt: r.updatedAt });
    }
    entries.sort((a, b) => (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : 0));
    return { status: 'ok', entries };
  } catch {
    return { status: 'unreadable' };
  }
}
