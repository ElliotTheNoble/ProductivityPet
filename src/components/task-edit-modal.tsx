import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ensureNotificationPermission } from '@/utils/notifications';
import { reminderOffsetLabel, type ReminderOffsetMinutes, type RepeatRule, type TaskKind } from '@/utils/tasks';

const WEEKDAY_TOGGLE_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type RepeatOption = 'none' | 'daily' | 'weekly';

function repeatToOption(repeat: RepeatRule | undefined): RepeatOption {
  return repeat?.kind ?? 'none';
}

type ReminderOption = 'none' | 'at-time' | '10-before' | '30-before' | '60-before';

const REMINDER_UI_OPTIONS: ReminderOption[] = ['none', 'at-time', '10-before', '30-before', '60-before'];

function reminderMinutesToOption(minutes: ReminderOffsetMinutes | undefined): ReminderOption {
  switch (minutes) {
    case 0:
      return 'at-time';
    case 10:
      return '10-before';
    case 30:
      return '30-before';
    case 60:
      return '60-before';
    default:
      return 'none';
  }
}

function reminderOptionToMinutes(option: ReminderOption): ReminderOffsetMinutes | undefined {
  switch (option) {
    case 'at-time':
      return 0;
    case '10-before':
      return 10;
    case '30-before':
      return 30;
    case '60-before':
      return 60;
    default:
      return undefined;
  }
}

function reminderOptionLabel(option: ReminderOption): string {
  if (option === 'none') return 'None';
  return reminderOffsetLabel(reminderOptionToMinutes(option) as ReminderOffsetMinutes);
}

export type TaskEditValues = {
  text: string;
  date: string;
  time?: string;
  repeat?: RepeatRule;
  reminderMinutesBefore?: ReminderOffsetMinutes;
};

type TaskEditModalProps = {
  kind: TaskKind;
  initialText: string;
  initialDate: string;
  initialTime?: string;
  initialRepeat?: RepeatRule;
  initialReminderMinutes?: ReminderOffsetMinutes;
  onSave: (values: TaskEditValues) => void;
  onCancel: () => void;
};

// Shared edit form for both tasks and appointments. The caller mounts this
// keyed by the item's id, so opening a different item gets fresh initial
// state for free instead of needing manual reset-on-open logic.
export function TaskEditModal({
  kind,
  initialText,
  initialDate,
  initialTime,
  initialRepeat,
  initialReminderMinutes,
  onSave,
  onCancel,
}: TaskEditModalProps) {
  const theme = useTheme();
  const [text, setText] = useState(initialText);
  const [date, setDate] = useState(initialDate);
  const [time, setTime] = useState(initialTime ?? '');
  const [repeatOption, setRepeatOption] = useState<RepeatOption>(repeatToOption(initialRepeat));
  const [weeklyDays, setWeeklyDays] = useState<Set<number>>(
    new Set(initialRepeat?.kind === 'weekly' ? initialRepeat.days : [])
  );
  const [reminderOption, setReminderOption] = useState<ReminderOption>(
    reminderMinutesToOption(initialReminderMinutes)
  );

  function toggleWeeklyDay(day: number) {
    setWeeklyDays((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  // Requests notification permission only at the moment the user actually
  // picks a reminder — never just from opening this form.
  async function selectReminderOption(option: ReminderOption) {
    if (option !== 'none') {
      const granted = await ensureNotificationPermission();
      if (!granted) return;
    }
    setReminderOption(option);
  }

  function handleSave() {
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const trimmedDate = date.trim();
    const isValidDate =
      ISO_DATE_PATTERN.test(trimmedDate) &&
      !Number.isNaN(new Date(`${trimmedDate}T00:00:00`).getTime());
    const finalDate = isValidDate ? trimmedDate : initialDate;

    let repeat: RepeatRule | undefined;
    if (kind === 'task') {
      if (repeatOption === 'daily') {
        repeat = { kind: 'daily' };
      } else if (repeatOption === 'weekly' && weeklyDays.size > 0) {
        repeat = { kind: 'weekly', days: Array.from(weeklyDays).sort() };
      }
    }

    onSave({
      text: trimmedText,
      date: finalDate,
      time: time.trim() || undefined,
      repeat,
      reminderMinutesBefore: reminderOptionToMinutes(reminderOption),
    });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.overlay} onPress={onCancel}>
        <Pressable onPress={(event) => event.stopPropagation()}>
          <ThemedView type="background" style={[styles.modalBox, { borderColor: theme.backgroundSelected }]}>
            <ThemedText type="smallBold" style={styles.title}>
              {kind === 'task' ? 'Edit Task' : 'Edit Appointment'}
            </ThemedText>

            <View style={styles.fieldGroup}>
              <ThemedText type="small" themeColor="textSecondary">
                Name
              </ThemedText>
              <TextInput
                autoFocus
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
                ]}
                placeholder={kind === 'task' ? 'What do you need to do?' : 'What is the appointment?'}
                placeholderTextColor={theme.textSecondary}
                value={text}
                onChangeText={setText}
              />
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText type="small" themeColor="textSecondary">
                Date (YYYY-MM-DD)
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
                ]}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textSecondary}
                value={date}
                onChangeText={setDate}
              />
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText type="small" themeColor="textSecondary">
                Time (optional)
              </ThemedText>
              <TextInput
                style={[
                  styles.input,
                  { color: theme.text, borderColor: theme.backgroundSelected, backgroundColor: theme.background },
                ]}
                placeholder="e.g. 3:00 PM"
                placeholderTextColor={theme.textSecondary}
                value={time}
                onChangeText={setTime}
              />
            </View>

            {time.trim() ? (
              <View style={styles.fieldGroup}>
                <ThemedText type="small" themeColor="textSecondary">
                  Reminder
                </ThemedText>
                <View style={styles.pillRow}>
                  {REMINDER_UI_OPTIONS.map((option) => (
                    <Pressable
                      key={option}
                      onPress={() => selectReminderOption(option)}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <View
                        style={[
                          styles.pill,
                          { backgroundColor: reminderOption === option ? theme.purple : theme.background },
                        ]}>
                        <ThemedText
                          type="small"
                          style={reminderOption === option ? styles.pillTextActive : undefined}>
                          {reminderOptionLabel(option)}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {kind === 'task' ? (
              <View style={styles.fieldGroup}>
                <ThemedText type="small" themeColor="textSecondary">
                  Repeat
                </ThemedText>
                <View style={styles.pillRow}>
                  {(['none', 'daily', 'weekly'] as RepeatOption[]).map((option) => (
                    <Pressable
                      key={option}
                      onPress={() => setRepeatOption(option)}
                      style={({ pressed }) => pressed && styles.pressed}>
                      <View
                        style={[
                          styles.pill,
                          { backgroundColor: repeatOption === option ? theme.purple : theme.background },
                        ]}>
                        <ThemedText
                          type="small"
                          style={repeatOption === option ? styles.pillTextActive : undefined}>
                          {option === 'none' ? 'Once' : option === 'daily' ? 'Daily' : 'Weekly'}
                        </ThemedText>
                      </View>
                    </Pressable>
                  ))}
                </View>

                {repeatOption === 'weekly' ? (
                  <View style={styles.pillRow}>
                    {WEEKDAY_TOGGLE_LABELS.map((label, day) => {
                      const isActive = weeklyDays.has(day);
                      return (
                        <Pressable
                          key={day}
                          onPress={() => toggleWeeklyDay(day)}
                          style={({ pressed }) => pressed && styles.pressed}>
                          <View
                            style={[
                              styles.weekdayToggle,
                              { backgroundColor: isActive ? theme.purple : theme.background },
                            ]}>
                            <ThemedText type="small" style={isActive ? styles.pillTextActive : undefined}>
                              {label}
                            </ThemedText>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.buttonRow}>
              <Pressable onPress={handleSave} style={({ pressed }) => pressed && styles.pressed}>
                <ThemedView type="accent" style={styles.saveButton}>
                  <ThemedText type="smallBold" style={styles.saveButtonText}>
                    Save
                  </ThemedText>
                </ThemedView>
              </Pressable>
              <Pressable onPress={onCancel} style={({ pressed }) => pressed && styles.pressed}>
                <View style={[styles.cancelButton, { backgroundColor: theme.background }]}>
                  <ThemedText type="smallBold">Cancel</ThemedText>
                </View>
              </Pressable>
            </View>
          </ThemedView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  modalBox: {
    width: 340,
    maxWidth: '100%',
    borderRadius: Spacing.four,
    borderWidth: 1,
    padding: Spacing.four,
    gap: Spacing.three,
    // Soft shadow so the modal reads as floating above the page.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  title: {
    fontSize: 18,
  },
  fieldGroup: {
    gap: Spacing.one,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  pill: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  weekdayToggle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  saveButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  saveButtonText: {
    color: '#FFFFFF',
  },
  cancelButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
});
