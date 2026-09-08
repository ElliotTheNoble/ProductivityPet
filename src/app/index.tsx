import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PetProgress } from '@/components/pet-progress';
import { PetRoom } from '@/components/pet-room';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Task = {
  id: string;
  text: string;
  completed: boolean;
};

const COMPLETION_MESSAGES = ['Yippee!', 'Yay!', 'Woohoo!', 'I knew you could do it!'];

export default function HomeScreen() {
  const theme = useTheme();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState('');
  const [petMessage, setPetMessage] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);

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
    if (completed) {
      setPetMessage(COMPLETION_MESSAGES[messageIndex]);
      setMessageIndex((prev) => (prev + 1) % COMPLETION_MESSAGES.length);
    } else {
      setPetMessage(null);
    }
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, completed } : task)));
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="subtitle" style={styles.brand}>
              🐾 Productivity Pet
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.tagline}>
              Complete tasks to help your pet grow.
            </ThemedText>
          </View>

          <PetRoom message={petMessage} />
          <PetProgress />

          <View style={styles.taskSection}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Tasks
            </ThemedText>

            <View style={styles.addRow}>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.backgroundSelected,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
                placeholder="Add a task"
                placeholderTextColor={theme.textSecondary}
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={addTask}
                returnKeyType="done"
              />
              <Pressable onPress={addTask} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="accent" style={styles.addButton}>
                  <ThemedText type="smallBold" style={styles.addButtonText}>
                    Add
                  </ThemedText>
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
                    <View
                      style={[
                        styles.checkbox,
                        { borderColor: theme.backgroundSelected },
                        task.completed && { backgroundColor: theme.mint, borderColor: theme.mint },
                      ]}>
                      {task.completed && <ThemedText style={styles.checkmark}>✓</ThemedText>}
                    </View>
                    <ThemedText
                      style={task.completed && styles.completedText}
                      themeColor={task.completed ? 'textSecondary' : 'text'}>
                      {task.text}
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
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
    maxWidth: MaxContentWidth,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.four,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.half,
  },
  brand: {
    textAlign: 'center',
  },
  tagline: {
    textAlign: 'center',
  },
  taskSection: {
    gap: Spacing.three,
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
  addButtonText: {
    color: '#FFFFFF',
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
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmark: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  completedText: {
    textDecorationLine: 'line-through',
  },
});
