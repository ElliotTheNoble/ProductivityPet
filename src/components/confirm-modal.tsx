import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';

import { HoverPressable as Pressable } from '@/components/hover-pressable';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';

// A small pastel confirmation dialog (used for adopting an egg and for paying
// to resurrect a pet). `busy` disables both buttons while an action is
// running, so a second tap can never start it twice.
export function ConfirmModal({
  visible,
  title,
  children,
  confirmLabel,
  cancelLabel,
  singleAction,
  confirmDisabled,
  busy,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  // The label of the other button (default: Cancel).
  cancelLabel?: string;
  // Only the confirm button (a notice with one answer, such as "Continue playing"); Back still calls onCancel.
  singleAction?: boolean;
  confirmDisabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useT();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <ThemedView type="background" style={styles.card}>
          {/* Large text or a small screen: the words scroll, the buttons stay in reach. */}
          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
            <ThemedText style={styles.title}>{title}</ThemedText>
            <View style={styles.body}>{children}</View>
          </ScrollView>
          <View style={styles.buttons}>
            {singleAction ? null : (
              <Pressable accessibilityRole="button" accessibilityLabel={cancelLabel ?? t('cancel')} onPress={onCancel} disabled={busy} style={({ pressed }) => [styles.buttonWrap, pressed && styles.pressed]}>
                <ThemedView type="backgroundElement" style={[styles.button, styles.pointer]}>
                  <ThemedText type="smallBold" style={styles.label}>
                    {cancelLabel ?? t('cancel')}
                  </ThemedText>
                </ThemedView>
              </Pressable>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmLabel}
              onPress={onConfirm}
              disabled={busy || confirmDisabled}
              style={({ pressed }) => [styles.buttonWrap, pressed && styles.pressed, (busy || confirmDisabled) && styles.disabled]}>
              <ThemedView type="accent" style={[styles.button, styles.pointer]}>
                <ThemedText type="smallBold" style={[styles.label, styles.confirmText]}>
                  {busy ? t('pleaseWait') : confirmLabel}
                </ThemedText>
              </ThemedView>
            </Pressable>
          </View>
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(60, 40, 70, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  card: { width: '100%', maxWidth: 420, maxHeight: '100%', borderRadius: Spacing.four, padding: Spacing.four, gap: Spacing.three },
  scroll: { flexGrow: 0, flexShrink: 1 },
  scrollContent: { gap: Spacing.three },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  body: { gap: Spacing.two },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.two },
  // At least 44 px tall (a comfortable touch target), centred.
  button: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.five },
  // A long label (large text, Spanish) wraps inside the card instead of running off its edge.
  buttonWrap: { maxWidth: '100%', flexShrink: 1 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
  pointer: { cursor: 'pointer' },
  confirmText: { color: '#FFFFFF' },
  label: { textAlign: 'center' },
});
