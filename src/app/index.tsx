import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PetPlaceholder } from '@/components/pet-placeholder';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Task = {
  id: string;
  text: string;
  completed: boolean;
};

export default function HomeScreen() {
  const theme = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState('');
  const [petMessage, setPetMessage] = useState<string | null>(null);

  function addTask() {
    const text = draft.trim();
    if (!text) return;
    setTasks((prev) => [...prev, { id: Date.now().toString(), text, completed: false }]);
    setDraft('');
  }

  function toggleTask(id: string) {
    const target = tasks.find((task) => task.id === id);
    if (!target) return;
    const completed = !target.completed;
    setPetMessage(completed ? 'Great job!' : null);
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, completed } : task)));
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <PetPlaceholder message={petMessage} />

        <ThemedText type="subtitle" style={styles.title}>
          Tasks
        </ThemedText>

        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
            placeholder="Add a task"
            placeholderTextColor={theme.textSecondary}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={addTask}
            returnKeyType="done"
          />
          <Pressable onPress={addTask} style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="backgroundSelected" style={styles.addButton}>
              <ThemedText type="smallBold">Add</ThemedText>
            </ThemedView>
          </Pressable>
        </View>

        <View style={styles.list}>
          {tasks.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              No tasks yet. Add one above.
            </ThemedText>
          )}
          {tasks.map((task) => (
            <Pressable
              key={task.id}
              onPress={() => toggleTask(task.id)}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={styles.taskRow}>
                <ThemedText themeColor={task.completed ? 'textSecondary' : 'text'}>
                  {task.completed ? '☑' : '☐'}
                </ThemedText>
                <ThemedText
                  style={task.completed && styles.completedText}
                  themeColor={task.completed ? 'textSecondary' : 'text'}>
                  {task.text}
                </ThemedText>
              </ThemedView>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    paddingHorizontal: Spacing.four,
    alignItems: 'stretch',
    gap: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: BottomTabInset + Spacing.three,
    maxWidth: MaxContentWidth,
  },
  title: {
    textAlign: 'center',
  },
  addRow: {
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
  addButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  list: {
    gap: Spacing.two,
  },
  taskRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
    alignItems: 'center',
  },
  completedText: {
    textDecorationLine: 'line-through',
  },
});
