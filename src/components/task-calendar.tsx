import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dateToISO, occursOnDate, todayISO, type Task } from '@/utils/tasks';

type TaskCalendarProps = {
  tasks: Task[];
  selectedDate: string;
  onSelectDate: (dateISO: string) => void;
};

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

type DayCell = { date: Date; iso: string } | null;

// Builds a Sun-start month grid (always a multiple of 7 cells, padded with
// nulls before day 1 and after the last day) — plain Date math, no calendar
// library needed for a single month view.
function getMonthGrid(year: number, month: number): DayCell[][] {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: DayCell[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    cells.push({ date, iso: dateToISO(date) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export function TaskCalendar({ tasks, selectedDate, onSelectDate }: TaskCalendarProps) {
  const theme = useTheme();
  const initialSelected = new Date(`${selectedDate}T00:00:00`);
  const [viewYear, setViewYear] = useState(initialSelected.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialSelected.getMonth());

  const today = todayISO();
  const weeks = getMonthGrid(viewYear, viewMonth);

  function goToPreviousMonth() {
    if (viewMonth === 0) {
      setViewYear((year) => year - 1);
      setViewMonth(11);
    } else {
      setViewMonth((month) => month - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewYear((year) => year + 1);
      setViewMonth(0);
    } else {
      setViewMonth((month) => month + 1);
    }
  }

  function goToToday() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    onSelectDate(todayISO());
  }

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.headerRow}>
        <Pressable onPress={goToPreviousMonth} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" style={styles.navArrow}>
            ←
          </ThemedText>
        </Pressable>

        <Pressable onPress={goToToday} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold">
            {MONTH_LABELS[viewMonth]} {viewYear}
          </ThemedText>
        </Pressable>

        <Pressable onPress={goToNextMonth} hitSlop={8} style={({ pressed }) => pressed && styles.pressed}>
          <ThemedText type="smallBold" style={styles.navArrow}>
            →
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((label, index) => (
          <View key={index} style={styles.dayCell}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.weekdayLabel}>
              {label}
            </ThemedText>
          </View>
        ))}
      </View>

      {weeks.map((week, weekIndex) => (
        <View key={weekIndex} style={styles.weekRow}>
          {week.map((cell, cellIndex) => {
            if (!cell) return <View key={cellIndex} style={styles.dayCell} />;

            const isSelected = cell.iso === selectedDate;
            const isToday = cell.iso === today;
            const hasItems = tasks.some((task) => occursOnDate(task, cell.iso));

            return (
              <View key={cellIndex} style={styles.dayCell}>
                <Pressable
                  onPress={() => onSelectDate(cell.iso)}
                  style={({ pressed }) => pressed && styles.pressed}>
                  <View
                    style={[
                      styles.dayCircle,
                      isToday && { borderWidth: 2, borderColor: theme.accent },
                      isSelected && { backgroundColor: theme.purple },
                    ]}>
                    <ThemedText
                      type="small"
                      style={isSelected ? styles.selectedDayText : undefined}>
                      {cell.date.getDate()}
                    </ThemedText>
                  </View>
                  <View
                    style={[
                      styles.dot,
                      { backgroundColor: hasItems ? theme.mint : 'transparent' },
                    ]}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>
      ))}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.one,
  },
  navArrow: {
    fontSize: 18,
    paddingHorizontal: Spacing.two,
  },
  pressed: {
    opacity: 0.7,
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  weekdayLabel: {
    fontWeight: '700',
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedDayText: {
    color: '#FFFFFF',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 2,
  },
});
