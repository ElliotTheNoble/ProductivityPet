import { StyleSheet, View } from 'react-native';

import { TaskIcon } from '@/components/task-icon';
import { TaskMenu, type TaskMenuItem } from '@/components/task-menu';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DisplayAppointment } from '@/utils/tasks';

type AppointmentsCardProps = {
  appointments: DisplayAppointment[];
  onDeleteAppointment: (id: string) => void;
  onStopRepeating: (id: string) => void;
  onRemoveToday: (id: string) => void;
};

// Appointments are read/manage-only here, same as TaskCard — they're added
// from the Tasks tab. No checkboxes: appointments never complete and never
// affect pet progress, which is why this stays a fully separate card from
// TaskCard instead of a checkbox-less row style inside it. The three-dot
// menu reuses the same TaskMenu component (and the same history-safe
// stop/remove pattern) TaskCard uses, for a repeating appointment.
export function AppointmentsCard({
  appointments,
  onDeleteAppointment,
  onStopRepeating,
  onRemoveToday,
}: AppointmentsCardProps) {
  const theme = useTheme();

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
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
              <TaskIcon category={appointment.category} />

              <View style={styles.textGroup}>
                <ThemedText>{appointment.text}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {appointment.time ? appointment.time : appointment.category}
                </ThemedText>
              </View>

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
      label: '🗑️ Delete Appointment',
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
});
