import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { TaskIcon } from '@/components/task-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TaskCategory } from '@/utils/categorize-task';

export type Task = {
  id: string;
  text: string;
  completed: boolean;
  category: TaskCategory;
  important: boolean;
};

type TaskCardProps = {
  tasks: Task[];
  onAddTask: (text: string) => void;
  onToggleTask: (id: string) => void;
  onToggleImportant: (id: string) => void;
  onDeleteTask: (id: string) => void;
  isCelebrating: boolean;
};

// Menu box width, used to position it so its right edge lines up under the
// three-dot icon that was tapped (pageX/pageY come from the tap event).
const MENU_WIDTH = 190;

type OpenMenu = {
  taskId: string;
  x: number;
  y: number;
};

export function TaskCard({
  tasks,
  onAddTask,
  onToggleTask,
  onToggleImportant,
  onDeleteTask,
  isCelebrating,
}: TaskCardProps) {
  const theme = useTheme();
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [openMenu, setOpenMenu] = useState<OpenMenu | null>(null);

  function handleSubmit() {
    const text = draft.trim();
    if (!text) return;
    onAddTask(text);
    setDraft('');
  }

  function closeMenu() {
    setOpenMenu(null);
  }

  const menuTask = openMenu ? tasks.find((task) => task.id === openMenu.taskId) : undefined;

  const completedCount = tasks.filter((task) => task.completed).length;
  const completionPercent =
    tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardHeader}>
        <ThemedText style={styles.cardTitle}>Today&apos;s Tasks</ThemedText>
        <Pressable
          onPress={() => setIsAdding((prev) => !prev)}
          style={({ pressed }) => pressed && styles.pressed}>
          <ThemedView type="accent" style={styles.addTaskButton}>
            <ThemedText type="smallBold" style={styles.addTaskButtonText}>
              + Add Task
            </ThemedText>
          </ThemedView>
        </Pressable>
      </View>

      {isAdding ? (
        <View style={styles.composeRow}>
          <TextInput
            autoFocus
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: theme.backgroundSelected,
                backgroundColor: theme.background,
              },
            ]}
            placeholder="What do you need to do?"
            placeholderTextColor={theme.textSecondary}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={handleSubmit}
            returnKeyType="done"
          />
          <Pressable onPress={handleSubmit} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="accent" style={styles.composeAddButton}>
              <ThemedText type="smallBold" style={styles.addTaskButtonText}>
                Add
              </ThemedText>
            </ThemedView>
          </Pressable>
        </View>
      ) : null}

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
            No tasks yet. Tap + Add Task to get started.
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

                <Pressable
                  hitSlop={8}
                  onPress={(event) => {
                    event.stopPropagation();
                    const { pageX, pageY } = event.nativeEvent;
                    setOpenMenu((prev) =>
                      prev?.taskId === task.id ? null : { taskId: task.id, x: pageX, y: pageY }
                    );
                  }}>
                  <ThemedText themeColor="textSecondary" style={styles.menuDots}>
                    ⋮
                  </ThemedText>
                </Pressable>
              </View>
            </Pressable>
          ))
        )}
      </View>

      <Modal visible={openMenu !== null} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} />
        {openMenu && menuTask ? (
          <ThemedView
            type="background"
            style={[
              styles.menuBox,
              {
                top: openMenu.y + Spacing.one,
                left: Math.max(Spacing.two, openMenu.x - MENU_WIDTH),
                borderColor: theme.backgroundSelected,
              },
            ]}>
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
              onPress={() => {
                onToggleImportant(menuTask.id);
                closeMenu();
              }}>
              <ThemedText type="smallBold">
                {menuTask.important ? '⭐ Remove Important' : '⭐ Mark as Important'}
              </ThemedText>
            </Pressable>
            <View style={[styles.menuDivider, { backgroundColor: theme.backgroundSelected }]} />
            <Pressable
              style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
              onPress={() => {
                onDeleteTask(menuTask.id);
                closeMenu();
              }}>
              <ThemedText type="smallBold" style={{ color: theme.accent }}>
                🗑️ Delete Task
              </ThemedText>
            </Pressable>
          </ThemedView>
        ) : null}
      </Modal>
    </ThemedView>
  );
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
  addTaskButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  addTaskButtonText: {
    color: '#FFFFFF',
  },
  composeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  composeAddButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    justifyContent: 'center',
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
  menuDots: {
    fontSize: 18,
    paddingHorizontal: Spacing.one,
  },
  importantStar: {
    fontSize: 15,
  },
  menuBox: {
    position: 'absolute',
    width: MENU_WIDTH,
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingVertical: Spacing.one,
    // Soft shadow so the popover reads as floating above the page.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  menuItem: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  menuDivider: {
    height: 1,
    marginHorizontal: Spacing.two,
  },
});
