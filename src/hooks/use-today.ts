import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { todayISO } from '@/utils/tasks';

// The device's local calendar date ('YYYY-MM-DD'), kept current: it changes by itself at local midnight, and again whenever the app comes back to
// the foreground (a phone that slept past midnight). Screens that list "today" use it, so the list follows the day without being reopened.
export function useTodayISO(): string {
  const [today, setToday] = useState(() => todayISO());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1).getTime();
      timer = setTimeout(() => {
        setToday(todayISO());
        arm();
      }, Math.max(1000, nextMidnight - now.getTime()));
    };
    arm();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') setToday(todayISO());
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  return today;
}
