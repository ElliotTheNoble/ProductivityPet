import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { normalizeTask, occursOnDate, todayISO } from '@/utils/tasks';

// Same key Home/Tasks read and write — this hook only ever reads it, never
// writes, so it can't disturb the real saved task/appointment/birthday data.
const TASKS_STORAGE_KEY = '@ProductivityPet:tasks';

// Reusable across every room screen: does a read-only AsyncStorage check for
// whether any Birthday-kind item's yearly month/day matches today (reusing
// occursOnDate — the same yearly-recurrence logic the Tasks-tab calendar
// already relies on, not a second birthday system). `refreshKey` — pass the
// current route's pathname (or a room's slug) — re-runs the check whenever
// it changes, so navigating to a screen after adding/removing a birthday
// reflects it without needing a full app restart.
export function useBirthdayMode(refreshKey: string): boolean {
  const [hasBirthdayToday, setHasBirthdayToday] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(TASKS_STORAGE_KEY)
      .then((stored) => {
        if (cancelled) return;
        if (!stored) {
          setHasBirthdayToday(false);
          return;
        }
        try {
          const parsed = JSON.parse(stored) as unknown[];
          const today = todayISO();
          const tasks = parsed.map((raw) => normalizeTask(raw, today));
          setHasBirthdayToday(tasks.some((task) => task.kind === 'birthday' && occursOnDate(task, today)));
        } catch {
          setHasBirthdayToday(false);
        }
      })
      .catch(() => {
        if (!cancelled) setHasBirthdayToday(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return hasBirthdayToday;
}
