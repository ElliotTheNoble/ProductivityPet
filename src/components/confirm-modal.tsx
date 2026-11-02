import type { ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';

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
  confirmDisabled,
  busy,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
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
          <ThemedText style={styles.title}>{title}</ThemedText>
          <View style={styles.body}>{children}</View>
          <View style={styles.buttons}>
            <Pressable onPress={onCancel} disabled={busy} style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView type="backgroundElement" style={[styles.button, styles.pointer]}>
                <ThemedText type="smallBold">{t('cancel')}</ThemedText>
              </ThemedView>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={busy || confirmDisabled}
              style={({ pressed }) => [pressed && styles.pressed, (busy || confirmDisabled) && styles.disabled]}>
              <ThemedView type="accent" style={[styles.button, styles.pointer]}>
                <ThemedText type="smallBold" style={styles.confirmText}>
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
  card: { width: '100%', maxWidth: 420, borderRadius: Spacing.four, padding: Spacing.four, gap: Spacing.three },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  body: { gap: Spacing.two },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  button: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderRadius: Spacing.five },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
  pointer: { cursor: 'pointer' },
  confirmText: { color: '#FFFFFF' },
});
