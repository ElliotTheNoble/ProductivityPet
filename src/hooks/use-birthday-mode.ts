import { useEffect, useState } from 'react';

import { getCachedTasks } from '@/utils/task-storage';
import { occursOnDate, todayISO } from '@/utils/tasks';

// Reusable across every room screen: does a read-only check for whether any
// Birthday-kind item's yearly month/day matches today (reusing occursOnDate
// — the same yearly-recurrence logic the Tasks-tab calendar already relies
// on, not a second birthday system). Reads via the shared in-memory task
// cache (see @/utils/task-storage) rather than its own AsyncStorage call —
// this hook never writes, so it can't disturb the real saved
// task/appointment/birthday data either way. `refreshKey` — pass the
// current route's pathname (or a room's slug) — re-runs the check whenever
// it changes, so navigating to a screen after adding/removing a birthday
// reflects it without needing a full app restart.
export function useBirthdayMode(refreshKey: string): boolean {
  const [hasBirthdayToday, setHasBirthdayToday] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCachedTasks()
      .then((tasks) => {
        if (cancelled) return;
        const today = todayISO();
        setHasBirthdayToday(tasks.some((task) => task.kind === 'birthday' && occursOnDate(task, today)));
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
