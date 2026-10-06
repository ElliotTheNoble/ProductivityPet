import { Pressable, StyleSheet, View } from 'react-native';

import { TaskIcon } from '@/components/task-icon';
import { TaskMenu, type TaskMenuItem } from '@/components/task-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DisplayAppointment } from '@/utils/tasks';

type AppointmentsCardProps = {
  appointments: DisplayAppointment[];
  onToggleAppointment: (id: string) => void;
  onDeleteAppointment: (id: string) => void;
  onStopRepeating: (id: string) => void;
  onRemoveToday: (id: string) => void;
};

// Appointments are added from the Tasks tab, same as before. An
// appointment (kind: 'event') now gets the same checkbox TaskCard uses —
// tapping it calls onToggleAppointment, which uses the exact same
// completion storage a task does, so it earns Paw Tokens the same way
// (see @/utils/paw-tokens.ts). A birthday is still never completable —
// its row stays exactly as it was, with no checkbox and not pressable.
export function AppointmentsCard({
  appointments,
  onToggleAppointment,
  onDeleteAppointment,
  onStopRepeating,
  onRemoveToday,
}: AppointmentsCardProps) {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElementOverlay" style={styles.card}>
      <View style={styles.cardHeader}>
        <ThemedText style={styles.cardTitle}>Today&apos;s Appointments</ThemedText>
      </View>

      <View style={styles.list}>
        {appointments.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
            No appointments for today. Add one from the Tasks tab.
          </ThemedText>
        ) : (
          appointments.map((appointment, index) => (
            <View
              key={appointment.id}
              style={[
                styles.row,
                index !== appointments.length - 1 && {
                  borderBottomWidth: 1,
                  borderBottomColor: theme.backgroundSelected,
                },
              ]}>
              {appointment.kind === 'birthday' ? (
                <>
                  <ThemedText style={styles.cakeIcon}>🎂</ThemedText>
                  <View style={styles.textGroup}>
                    <ThemedText>{appointment.text}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {appointment.time ? appointment.time : appointment.category}
                    </ThemedText>
                  </View>
                </>
              ) : (
                <Pressable
                  onPress={() => onToggleAppointment(appointment.id)}
                  style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
                  <View
                    style={[
                      styles.checkbox,
                      { borderColor: theme.backgroundSelected },
                      appointment.completed && { backgroundColor: theme.mint, borderColor: theme.mint },
                    ]}>
                    {appointment.completed ? <ThemedText style={styles.checkmark}>✓</ThemedText> : null}
                  </View>
                  <TaskIcon category={appointment.category} />
                  <View style={styles.textGroup}>
                    <ThemedText
                      style={appointment.completed && styles.completedText}
                      themeColor={appointment.completed ? 'textSecondary' : 'text'}>
                      {appointment.text}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {appointment.time ? appointment.time : appointment.category}
                    </ThemedText>
                  </View>
                </Pressable>
              )}

              <TaskMenu
                items={buildAppointmentMenuItems(
                  appointment,
                  onDeleteAppointment,
                  onStopRepeating,
                  onRemoveToday
                )}
              />
            </View>
          ))
        )}
      </View>
    </ThemedView>
  );
}

function buildAppointmentMenuItems(
  appointment: DisplayAppointment,
  onDeleteAppointment: (id: string) => void,
  onStopRepeating: (id: string) => void,
  onRemoveToday: (id: string) => void
): TaskMenuItem[] {
  const label = appointment.kind === 'birthday' ? 'Birthday' : 'Appointment';

  if (appointment.isRepeating) {
    return [
      {
        key: 'stop-repeating',
        label: '⏹ Stop Repeating From Here',
        onPress: () => onStopRepeating(appointment.id),
        destructive: true,
      },
      {
        key: 'remove-today',
        label: '🗑️ Remove Just This Day',
        onPress: () => onRemoveToday(appointment.id),
        destructive: true,
      },
    ];
  }

  return [
    {
      key: 'delete',
      label: `🗑️ Delete ${label}`,
      onPress: () => onDeleteAppointment(appointment.id),
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  list: {
    gap: 0,
  },
  emptyText: {
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  textGroup: {
    flex: 1,
    gap: 2,
  },
  cakeIcon: {
    fontSize: 22,
    width: 28,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flex: 1,
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
  completedText: {
    textDecorationLine: 'line-through',
  },
});
