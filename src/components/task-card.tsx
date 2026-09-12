import { Pressable, StyleSheet, View } from 'react-native';

import { TaskIcon } from '@/components/task-icon';
import { TaskMenu, type TaskMenuItem } from '@/components/task-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DisplayTask } from '@/utils/tasks';

type TaskCardProps = {
  tasks: DisplayTask[];
  dateLabel: string;
  onToggleTask: (id: string) => void;
  onToggleImportant: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onStopRepeating: (id: string) => void;
  onRemoveToday: (id: string) => void;
  isCelebrating: boolean;
};

// Adding new tasks now only happens from the Tasks tab (which has date and
// repeat controls); this card is read/manage-only for today's occurrences.
export function TaskCard({
  tasks,
  dateLabel,
  onToggleTask,
  onToggleImportant,
  onDeleteTask,
  onStopRepeating,
  onRemoveToday,
  isCelebrating,
}: TaskCardProps) {
  const theme = useTheme();

  const completedCount = tasks.filter((task) => task.completed).length;
  const completionPercent =
    tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <ThemedText style={styles.cardTitle}>Today&apos;s Tasks</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {dateLabel}
          </ThemedText>
        </View>
      </View>

      <View style={styles.progressSection}>
        <ThemedText type="smallBold" themeColor={isCelebrating ? 'accent' : 'textSecondary'}>
          {isCelebrating ? 'All tasks complete! Amazing job! 🎉' : `${completionPercent}% complete`}
        </ThemedText>
        <View style={[styles.progressTrack, { backgroundColor: theme.backgroundSelected }]}>
          <View style={{ flex: completionPercent, backgroundColor: theme.mint }} />
          <View style={{ flex: 100 - completionPercent }} />
        </View>
      </View>

      <View style={styles.list}>
        {tasks.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No tasks for today. Add one from the Tasks tab.
          </ThemedText>
        ) : (
          tasks.map((task, index) => (
            <Pressable
              key={task.id}
              onPress={() => onToggleTask(task.id)}
              style={({ pressed }) => pressed && styles.pressed}>
              <View
                style={[
                  styles.taskRow,
                  index !== tasks.length - 1 && {
                    borderBottomWidth: 1,
                    borderBottomColor: theme.backgroundSelected,
                  },
                ]}>
                <View
                  style={[
                    styles.checkbox,
                    { borderColor: theme.backgroundSelected },
                    task.completed && { backgroundColor: theme.mint, borderColor: theme.mint },
                  ]}>
                  {task.completed ? <ThemedText style={styles.checkmark}>✓</ThemedText> : null}
                </View>

                <TaskIcon category={task.category} />

                <View style={styles.taskTextGroup}>
                  <ThemedText
                    style={task.completed && styles.completedText}
                    themeColor={task.completed ? 'textSecondary' : 'text'}>
                    {task.text}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {task.category}
                  </ThemedText>
                </View>

                {task.important ? <ThemedText style={styles.importantStar}>⭐</ThemedText> : null}

                <TaskMenu
                  items={buildTaskMenuItems(
                    task,
                    onToggleImportant,
                    onDeleteTask,
                    onStopRepeating,
                    onRemoveToday
                  )}
                />
              </View>
            </Pressable>
          ))
        )}
      </View>
    </ThemedView>
  );
}

// Mirrors the Tasks-tab day list's menu: a repeating task gets both
// history-safe controls (Stop Repeating From Here, Remove Just This Day)
// instead of a single destructive delete — removing "today" only excludes
// today's date (via excludeDateFromTask) and never touches completedDates,
// so past completions and pet progress are unaffected either way.
function buildTaskMenuItems(
  task: DisplayTask,
  onToggleImportant: (id: string) => void,
  onDeleteTask: (id: string) => void,
  onStopRepeating: (id: string) => void,
  onRemoveToday: (id: string) => void
): TaskMenuItem[] {
  const importantItem: TaskMenuItem = {
    key: 'important',
    label: task.important ? '⭐ Remove Important' : '⭐ Mark as Important',
    onPress: () => onToggleImportant(task.id),
  };

  if (task.isRepeating) {
    return [
      importantItem,
      {
        key: 'stop-repeating',
        label: '⏹ Stop Repeating From Here',
        onPress: () => onStopRepeating(task.id),
        destructive: true,
      },
      {
        key: 'remove-today',
        label: '🗑️ Remove Just This Day',
        onPress: () => onRemoveToday(task.id),
        destructive: true,
      },
    ];
  }

  return [
    importantItem,
    {
      key: 'delete',
      label: '🗑️ Delete Task',
      onPress: () => onDeleteTask(task.id),
      destructive: true,
    },
  ];
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  cardHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.7,
  },
  progressSection: {
    gap: Spacing.one,
  },
  progressTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  list: {
    gap: 0,
  },
  emptyText: {
    paddingVertical: Spacing.two,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  taskTextGroup: {
    flex: 1,
    gap: 2,
  },
  completedText: {
    textDecorationLine: 'line-through',
  },
  importantStar: {
    fontSize: 15,
  },
});
