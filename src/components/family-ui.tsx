import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { hoverLift } from '@/constants/hover';
import { useTheme } from '@/hooks/use-theme';

// Small pastel building blocks shared by the welcome flow and the Parent Dashboard, so both look like the rest
// of ProductivityPet (rounded, pastel, big tap targets) and every control has the same hover lift (mouse) and
// pressed feedback (touch).

export const FAMILY_BACKGROUND = '#EFE9FA';

// React Native Web's Pressable reports `hovered` (mouse only, so a touch tap never leaves it stuck) and
// `focused` (keyboard) in its state; the native types don't list them.
function isHovered(state: unknown): boolean {
  return (state as { hovered?: boolean }).hovered === true;
}
function isFocused(state: unknown): boolean {
  return (state as { focused?: boolean }).focused === true;
}

// `scrollKey`: when it changes (a new step of a flow) the page goes back to the top, so the new step's heading is never left
// above the visible part. `compact`: tighter padding for a short landscape screen.
export function PageShell({
  children,
  maxWidth = 760,
  scrollKey,
  compact,
}: {
  children: ReactNode;
  maxWidth?: number;
  scrollKey?: string;
  compact?: boolean;
}) {
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [scrollKey]);
  return (
    <View style={styles.page}>
      <SafeAreaView style={styles.safe}>
        <ScrollView
          ref={scroller}
          contentContainerStyle={[styles.scroll, compact && styles.scrollCompact]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={[styles.column, { maxWidth }]}>{children}</View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export function Card({ children, color = 'rgba(255,255,255,0.88)', title }: { children: ReactNode; color?: string; title?: string }) {
  return (
    <View style={[styles.card, { backgroundColor: color }]}>
      {title ? (
        <ThemedText type="smallBold" style={styles.cardTitle}>
          {title}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

type ButtonTone = 'primary' | 'mint' | 'soft' | 'danger';

export function Button({
  label,
  onPress,
  tone = 'primary',
  disabled,
  small,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  disabled?: boolean;
  small?: boolean;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const bg = tone === 'primary' ? theme.accent : tone === 'mint' ? theme.mint : tone === 'danger' ? '#F6B7B7' : theme.backgroundElement;
  // A clearly deeper shade of the same colour while the mouse is over an enabled button.
  const hoverBg = tone === 'primary' ? '#EE7AA0' : tone === 'mint' ? '#5CCB9E' : tone === 'danger' ? '#F19C9C' : '#F6C6D8';
  const light = tone === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={(state) => [
        styles.buttonWrap,
        styles.smooth,
        state.pressed && styles.pressed,
        disabled && styles.disabled,
        hoverLift(state, !disabled),
        isFocused(state) && styles.focusRing,
      ]}>
      {(state: unknown) => (
      <View
        style={[
          styles.button,
          styles.smooth,
          small && styles.buttonSmall,
          { backgroundColor: isHovered(state) && !disabled ? hoverBg : bg },
        ]}>
        <ThemedText type="smallBold" style={[small && styles.smallLabel, light && styles.whiteText]}>
          {label}
        </ThemedText>
      </View>
      )}
    </Pressable>
  );
}

// A big tappable choice (language, user mode, Gentle/Classic). `selected` is shown with a purple border/fill.
export function ChoiceCard({
  title,
  description,
  selected,
  onPress,
  badge,
}: {
  title: string;
  description?: string;
  selected?: boolean;
  onPress: () => void;
  badge?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={title}
      style={(state) => [styles.choiceWrap, styles.smooth, state.pressed && styles.pressed, hoverLift(state, !selected), isFocused(state) && styles.focusRing]}>
      {(state: unknown) => (
      <View
        style={[
          styles.choice,
          styles.smooth,
          {
            borderColor: selected ? theme.purple : isHovered(state) ? '#F28DAE' : 'rgba(255,255,255,0.9)',
            backgroundColor: selected ? '#E4DAF7' : isHovered(state) ? '#FFE9F2' : 'rgba(255,255,255,0.92)',
          },
        ]}>
        <View style={styles.choiceHead}>
          <ThemedText style={styles.choiceTitle}>{title}</ThemedText>
          {badge ? (
            <View style={styles.badge}>
              <ThemedText type="small" style={styles.badgeText}>
                {badge}
              </ThemedText>
            </View>
          ) : null}
        </View>
        {description ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.choiceDesc}>
            {description}
          </ThemedText>
        ) : null}
      </View>
      )}
    </Pressable>
  );
}

export function ToggleRow({
  label,
  help,
  value,
  onChange,
  onLabel,
  offLabel,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  onLabel: string;
  offLabel: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      style={(state) => [styles.toggleRow, styles.smooth, state.pressed && styles.pressed, isHovered(state) && styles.toggleRowHover, isFocused(state) && styles.focusRing]}>
      {(state: unknown) => (
      <>
      <View style={styles.toggleText}>
        <ThemedText type="smallBold">{label}</ThemedText>
        {help ? (
          <ThemedText type="small" themeColor="textSecondary">
            {help}
          </ThemedText>
        ) : null}
      </View>
      <View
        style={[
          styles.pill,
          styles.smooth,
          { backgroundColor: value ? theme.mint : '#E3D9EE' },
          isHovered(state) && styles.pillHover,
        ]}>
        <ThemedText type="smallBold">{value ? onLabel : offLabel}</ThemedText>
      </View>
      </>
      )}
    </Pressable>
  );
}

export function Field(props: TextInputProps & { label: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={styles.field}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#A58FB0"
        maxLength={120}
        {...rest}
        style={[styles.input, style]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: FAMILY_BACKGROUND },
  safe: { flex: 1 },
  scroll: { padding: Spacing.three, paddingBottom: Spacing.six, alignItems: 'center' },
  scrollCompact: { padding: Spacing.two, paddingBottom: Spacing.three },
  column: { width: '100%', gap: Spacing.three },
  card: { borderRadius: Spacing.four, padding: Spacing.three, gap: Spacing.two, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
  cardTitle: { fontSize: 17, lineHeight: 22 },
  buttonWrap: { alignSelf: 'flex-start' },
  button: { minHeight: 44, paddingHorizontal: Spacing.four, paddingVertical: Spacing.two, borderRadius: Spacing.five, alignItems: 'center', justifyContent: 'center' },
  buttonSmall: { minHeight: 44, paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2 },
  smallLabel: { fontSize: 13 },
  whiteText: { color: '#FFFFFF' },
  pressed: { opacity: 0.75, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.45 },
  choiceWrap: { alignSelf: 'stretch' },
  choice: { borderWidth: 3, borderRadius: Spacing.four, padding: Spacing.three, gap: Spacing.one, minHeight: 64, justifyContent: 'center' },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  choiceTitle: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  choiceDesc: { lineHeight: 20 },
  badge: { backgroundColor: '#FBD9B8', borderRadius: Spacing.five, paddingHorizontal: Spacing.two, paddingVertical: 2 },
  badgeText: { fontSize: 12, lineHeight: 16 },
  // The row has its own padding (cancelled by an equal negative margin so the text stays where it was), so the
  // pastel hover background has room around the text.
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    marginHorizontal: -Spacing.two,
    borderRadius: Spacing.three,
    minHeight: 52,
  },
  toggleRowHover: { backgroundColor: 'rgba(247, 182, 203, 0.45)' },
  pillHover: {
    borderWidth: 2,
    borderColor: '#A78BDB',
    transform: [{ scale: 1.08 }],
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  // Smooth colour / lift changes (web).
  smooth: { transitionProperty: 'transform, background-color, border-color, box-shadow, opacity', transitionDuration: '140ms' },
  // Clear keyboard focus ring (shown only when focused with the keyboard).
  focusRing: { outlineColor: '#6F4FB8', outlineStyle: 'solid', outlineWidth: 3, outlineOffset: 2 },
  toggleText: { flex: 1, minWidth: 0, gap: 2 },
  pill: { borderRadius: Spacing.five, paddingHorizontal: Spacing.three - 2, paddingVertical: Spacing.one, minWidth: 56, alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  field: { gap: Spacing.one },
  input: {
    minHeight: 46,
    borderRadius: Spacing.three,
    borderWidth: 2,
    borderColor: '#D9C9EE',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    color: '#4A3550',
  },
});
