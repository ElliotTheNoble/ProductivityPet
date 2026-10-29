import AsyncStorage from '@react-native-async-storage/async-storage';

import { addDaysISO, dateToISO, todayISO } from '@/utils/tasks';

// Token EARNINGS history — an append-only record of every Paw Token earning
// event from now on, kept separately from the balance (PetProfile.pawTokens,
// which is untouched here). Spending in the Shop or on growth lowers the
// balance but is never recorded here, so "lifetime earned" can never go down
// because of spending.
//
// Only sources that really exist are recorded: finishing a task or an
// appointment (@/utils/paw-tokens.ts), a Kitty Catch round, and a Memory
// Match game. Earnings from before this history started were never logged
// anywhere, so they are NOT back-filled or guessed; `startedAt` records when
// tracking began so the pages can say exactly what the totals cover.
//
// Task/appointment earnings are paid at most once per occurrence (that module
// keeps its own permanent awarded-keys record) and are never reversed when a
// task is un-checked, so there is nothing to subtract on undo. Each event has
// a stable id, and recording the same id twice is a no-op, so a rerender or
// restart can't create duplicates.

const TOKEN_HISTORY_STORAGE_KEY = '@ProductivityPet:tokenEarnings';

export type TokenSource = 'task' | 'appointment' | 'kitty-catch' | 'memory-match';

export const TOKEN_SOURCE_LABELS: Record<TokenSource, string> = {
  task: 'Completed a task',
  appointment: 'Completed an appointment',
  'kitty-catch': 'Kitty Catch',
  'memory-match': 'Memory Match',
};

export type TokenEvent = {
  id: string;
  at: string; // ISO timestamp
  dateISO: string; // local 'YYYY-MM-DD' of `at`
  amount: number;
  source: TokenSource;
  // The task/appointment id for task earnings, or which reward a game paid.
  refId?: string;
};

type StoredTokenHistory = { startedAt: string; events: TokenEvent[] };

let cached: StoredTokenHistory | null = null;
let inFlight: Promise<StoredTokenHistory> | null = null;
const listeners = new Set<(history: StoredTokenHistory) => void>();

function isEvent(value: unknown): value is TokenEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<TokenEvent>;
  return (
    typeof e.id === 'string' &&
    typeof e.at === 'string' &&
    typeof e.dateISO === 'string' &&
    typeof e.amount === 'number' &&
    typeof e.source === 'string' &&
    e.source in TOKEN_SOURCE_LABELS
  );
}

function persist(history: StoredTokenHistory): void {
  cached = history;
  AsyncStorage.setItem(TOKEN_HISTORY_STORAGE_KEY, JSON.stringify(history)).catch(() => {});
  listeners.forEach((listener) => listener(history));
}

// Loads (and, the very first time, creates) the history. The creation moment
// becomes `startedAt` — the honest start of what the totals cover.
export async function getTokenHistory(): Promise<StoredTokenHistory> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const stored = await AsyncStorage.getItem(TOKEN_HISTORY_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<StoredTokenHistory>;
        cached = {
          startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString(),
          events: Array.isArray(parsed.events) ? parsed.events.filter(isEvent) : [],
        };
      } else {
        cached = { startedAt: new Date().toISOString(), events: [] };
        AsyncStorage.setItem(TOKEN_HISTORY_STORAGE_KEY, JSON.stringify(cached)).catch(() => {});
      }
    } catch {
      cached = { startedAt: new Date().toISOString(), events: [] };
    } finally {
      inFlight = null;
    }
    return cached ?? { startedAt: new Date().toISOString(), events: [] };
  })();
  return inFlight;
}

// Serializes recording so two earnings landing together can't read the same
// snapshot and drop one.
let pending: Promise<void> = Promise.resolve();

export function recordTokenEarning(input: {
  id?: string;
  amount: number;
  source: TokenSource;
  refId?: string;
  at?: Date;
}): Promise<void> {
  pending = pending.then(async () => {
    if (!(input.amount > 0)) return;
    const history = await getTokenHistory();
    const at = input.at ?? new Date();
    const id = input.id ?? `${at.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    if (history.events.some((event) => event.id === id)) return;
    persist({
      ...history,
      events: [
        ...history.events,
        { id, at: at.toISOString(), dateISO: dateToISO(at), amount: input.amount, source: input.source, refId: input.refId },
      ],
    });
  });
  return pending;
}

export function subscribeToTokenHistory(listener: (history: StoredTokenHistory) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ----- pure helpers -----

export function sumTokens(events: TokenEvent[]): number {
  return events.reduce((sum, event) => sum + event.amount, 0);
}

export function tokensInYear(events: TokenEvent[], year: number): TokenEvent[] {
  return events.filter((event) => event.dateISO.startsWith(`${year}-`));
}

// Daily token totals for the last `days` days ending today (oldest first).
// Same bucket shape as the task charts so CompletedBarChart can draw it.
export function getTokenDailyBuckets(events: TokenEvent[], days: number) {
  const today = todayISO();
  const buckets = [] as { dateISO: string; weekdayLabel: string; count: number }[];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const dateISO = addDaysISO(today, -offset);
    const date = new Date(`${dateISO}T00:00:00`);
    buckets.push({
      dateISO,
      weekdayLabel:
        days <= 7
          ? date.toLocaleDateString(undefined, { weekday: 'short' })
          : date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }),
      count: 0,
    });
  }
  for (const event of events) {
    const bucket = buckets.find((b) => b.dateISO === event.dateISO);
    if (bucket) bucket.count += event.amount;
  }
  return buckets;
}

export function getTokenMonthBuckets(events: TokenEvent[], year: number, monthLabels: string[]) {
  return monthLabels.map((label, i) => ({
    dateISO: `${year}-${String(i + 1).padStart(2, '0')}`,
    weekdayLabel: label,
    count: sumTokens(events.filter((e) => e.dateISO.startsWith(`${year}-${String(i + 1).padStart(2, '0')}-`))),
  }));
}
