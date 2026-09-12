import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type TaskMenuItem = {
  key: string;
  label: string;
  onPress: () => void;
  // Renders the label in the accent color, for a destructive/ending action
  // (delete, stop repeating, remove this day).
  destructive?: boolean;
};

type TaskMenuProps = {
  items: TaskMenuItem[];
};

// Menu box width, used to position it so its right edge lines up under the
// three-dot icon that was tapped (pageX/pageY come from the tap event).
const MENU_WIDTH = 220;

// The three-dot "⋮" row menu shared by Home's Today's Tasks card and the
// Tasks-tab day list, so both surfaces get identical menu behavior instead
// of two separately-implemented look-alikes.
export function TaskMenu({ items }: TaskMenuProps) {
  const theme = useTheme();
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);

  function close() {
    setAnchor(null);
  }

  return (
    <>
      <Pressable
        hitSlop={8}
        onPress={(event) => {
          event.stopPropagation();
          const { pageX, pageY } = event.nativeEvent;
          setAnchor((prev) => (prev ? null : { x: pageX, y: pageY }));
        }}>
        <ThemedText themeColor="textSecondary" style={styles.menuDots}>
          ⋮
        </ThemedText>
      </Pressable>

      <Modal visible={anchor !== null} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        {anchor ? (
          <ThemedView
            type="background"
            style={[
              styles.menuBox,
              {
                top: anchor.y + Spacing.one,
                left: Math.max(Spacing.two, anchor.x - MENU_WIDTH),
                borderColor: theme.backgroundSelected,
              },
            ]}>
            {items.map((item, index) => (
              <View key={item.key}>
                {index !== 0 ? (
                  <View style={[styles.menuDivider, { backgroundColor: theme.backgroundSelected }]} />
                ) : null}
                <Pressable
                  style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]}
                  onPress={() => {
                    item.onPress();
                    close();
                  }}>
                  <ThemedText type="smallBold" style={item.destructive ? { color: theme.accent } : undefined}>
                    {item.label}
                  </ThemedText>
                </Pressable>
              </View>
            ))}
          </ThemedView>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  menuDots: {
    fontSize: 18,
    paddingHorizontal: Spacing.one,
  },
  pressed: {
    opacity: 0.7,
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
