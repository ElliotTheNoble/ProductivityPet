import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { hoverLift } from '@/constants/hover';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { NEW_PIN_LENGTH } from '@/utils/pin-crypto';

// PIN entry with a custom on-screen number pad. Digits are only ever shown as dots, and nothing about the digits is ever
// announced or logged: a screen reader hears "3 digits entered", never the digits. Why a custom pad and not the system
// keyboard: no autofill or password-manager prompt, no clipboard, no predictive or third-party keyboard that could learn or
// log the digits, big consistent targets.
//
// Other ways in, so nobody is stuck:
//  - A physical keyboard works (a hidden field receives the keys; on the web it is focused automatically; on a phone or tablet
//    tap the dots).
//  - "Use the device keyboard instead": a normal masked number field (with autofill, suggestions, the context menu and
//    correction all switched off). It is the DEFAULT while a screen reader (TalkBack or VoiceOver) is on, because it works
//    better with assistive technology, and it can be chosen by anyone.
// On a short landscape screen (a phone on its side) the number pad sits beside the dots and the screen's buttons instead of
// above them, so the whole pad and the main button fit without scrolling. `children` are the screen's own error line and
// buttons: below the pad on a tall screen, beside it on a short landscape one.
// `value` is controlled and lives in the caller's state only (never stored); the caller clears it when the screen is left,
// the app goes to the background or the profile changes.

const DOT_SLOTS = NEW_PIN_LENGTH; // a Parent PIN is exactly 4 digits: four dots

type Props = {
  // The most digits this box takes: exactly 4 (NEW_PIN_LENGTH) on every Parent PIN screen, creating or checking.
  maxLength?: number;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  label: string;
  disabled?: boolean;
  children?: ReactNode;
};

// A phone on its side: wider than tall, and short. The screens that wrap a PIN pad use it too, so they agree.
export function useShortLandscape(): boolean {
  const { width, height } = useWindowDimensions();
  return width > height && height < 560 && width >= 640;
}

const digitsOnly = (text: string, limit: number) => text.replace(/\D/g, '').slice(0, limit);

export function PinEntry({ value, onChange, onSubmit, label, disabled, children, maxLength = NEW_PIN_LENGTH }: Props) {
  const { t, tn } = useT();
  const theme = useTheme();
  const sideBySide = useShortLandscape();
  const [mode, setMode] = useState<'pad' | 'keyboard'>('pad');
  const [chosen, setChosen] = useState(false); // once the person picks a mode, a screen reader change no longer overrides it
  const hiddenRef = useRef<TextInput>(null);

  useEffect(() => {
    let cancelled = false;
    // react-native-web reports a screen reader as always on, so on the web the number pad stays the default (the device
    // keyboard link is still there for anyone who wants it).
    const apply = (on: boolean) => {
      if (Platform.OS === 'web') return;
      if (!cancelled) setMode((current) => (chosen ? current : on ? 'keyboard' : 'pad'));
    };
    AccessibilityInfo.isScreenReaderEnabled?.()
      ?.then(apply)
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('screenReaderChanged', apply);
    return () => {
      cancelled = true;
      sub?.remove?.();
    };
  }, [chosen]);

  const add = (digit: string) => {
    if (!disabled && value.length < maxLength) onChange(value + digit);
  };
  const choose = (next: 'pad' | 'keyboard') => {
    setChosen(true);
    setMode(next);
  };

  const keys: { id: string; label: string; onPress: () => void; a11y: string }[] = [
    ...['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => ({ id: d, label: d, a11y: d, onPress: () => add(d) })),
    { id: 'clear', label: 'C', a11y: t('pinKeyClear'), onPress: () => !disabled && onChange('') },
    { id: '0', label: '0', a11y: '0', onPress: () => add('0') },
    { id: 'back', label: '⌫', a11y: t('pinKeyBackspace'), onPress: () => !disabled && onChange(value.slice(0, -1)) },
  ];

  const slots = Math.max(DOT_SLOTS, value.length);

  if (mode === 'keyboard') {
    return (
      <>
        <View style={styles.wrap}>
          <TextInput
            testID="pin-keyboard-input"
            accessibilityLabel={label}
            value={value}
            onChangeText={(text) => onChange(digitsOnly(text, maxLength))}
            onSubmitEditing={onSubmit}
            editable={!disabled}
            secureTextEntry
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={maxLength}
            autoComplete="off"
            importantForAutofill="noExcludeDescendants"
            textContentType="none"
            autoCorrect={false}
            spellCheck={false}
            contextMenuHidden
            placeholderTextColor="#A58FB0"
            style={[styles.input, { color: theme.text }]}
          />
          <Pressable accessibilityRole="button" onPress={() => choose('pad')} style={linkStyle}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.link}>
              {t('pinUsePad')}
            </ThemedText>
          </Pressable>
        </View>
        {children}
      </>
    );
  }

  const keySize = sideBySide ? KEY_SIDE : KEY;
  const hardwareField = (
    // A physical keyboard types into this hidden field. It is invisible to assistive technology (the pad is the control).
    <TextInput
      testID="pin-hardware-input"
      ref={hiddenRef}
      value={value}
      onChangeText={(text) => onChange(digitsOnly(text, maxLength))}
      onSubmitEditing={onSubmit}
      editable={!disabled}
      autoFocus={Platform.OS === 'web'}
      secureTextEntry
      keyboardType="number-pad"
      inputMode="numeric"
      maxLength={maxLength}
      showSoftInputOnFocus={false}
      caretHidden
      autoComplete="off"
      importantForAutofill="noExcludeDescendants"
      textContentType="none"
      autoCorrect={false}
      spellCheck={false}
      contextMenuHidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.hidden}
    />
  );
  const dotsBlock = (
    <>
      <Pressable accessibilityLabel={label} accessibilityRole="text" onPress={() => hiddenRef.current?.focus()}>
        <View style={styles.dots} accessible accessibilityLabel={label} accessibilityValue={{ text: tn('pinDigitsEntered', value.length) }}>
          {Array.from({ length: slots }, (_, i) => (
            <View key={i} style={[styles.dot, { borderColor: theme.accent }, i < value.length && { backgroundColor: theme.accent }]} />
          ))}
        </View>
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite" style={styles.count}>
        {tn('pinDigitsEntered', value.length)}
      </ThemedText>
    </>
  );
  const padBlock = (
    <View accessibilityLabel={t('pinPadLabel')} style={[styles.pad, { width: keySize * 3 + Spacing.two * 2 }]}>
      {keys.map((key) => (
        <Pressable
          key={key.id}
          accessibilityRole="button"
          accessibilityLabel={key.a11y}
          accessibilityState={{ disabled: !!disabled }}
          disabled={disabled}
          onPress={key.onPress}
          style={(state) => [
            styles.key,
            // The key turns a deeper pink while pressed (touch) or hovered (mouse, web), on top of the lift and shrink.
            { width: keySize, height: keySize, borderRadius: keySize / 2, backgroundColor: state.pressed || (state as { hovered?: boolean }).hovered === true ? '#F6C6D8' : theme.backgroundElement },
            state.pressed && styles.pressed,
            disabled && styles.disabled,
            hoverLift(state, !disabled),
            (state as { focused?: boolean }).focused === true && { borderColor: theme.purple, borderWidth: 3 },
          ]}>
          <ThemedText style={styles.keyLabel} maxFontSizeMultiplier={1.3}>
            {key.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
  const keyboardLink = (
    <Pressable accessibilityRole="button" onPress={() => choose('keyboard')} style={linkStyle}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.link}>
        {t('pinUseKeyboard')}
      </ThemedText>
    </Pressable>
  );

  if (sideBySide) {
    return (
      <View style={styles.sideRow}>
        <View style={styles.sidePad}>{padBlock}</View>
        <View style={styles.sideInfo}>
          {hardwareField}
          {dotsBlock}
          {keyboardLink}
          {children ? <View style={styles.sideExtras}>{children}</View> : null}
        </View>
      </View>
    );
  }

  return (
    <>
      <View style={styles.wrap}>
        {hardwareField}
        {dotsBlock}
        {padBlock}
        {keyboardLink}
      </View>
      {children}
    </>
  );
}

// The two text links (use the device keyboard / the number pad) show a pink pill while pressed (touch) or hovered (mouse, web).
const linkStyle = (state: unknown) => [
  styles.linkTarget,
  (state as { hovered?: boolean }).hovered === true && styles.linkHover,
  (state as { pressed?: boolean }).pressed === true && styles.linkPressed,
];

const KEY = 68;
const KEY_SIDE = 56; // the pad on a short landscape screen (still well above the 44 px minimum)
const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: Spacing.two },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  dots: { flexDirection: 'row', gap: Spacing.two, paddingVertical: Spacing.two, justifyContent: 'center', flexWrap: 'wrap' },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  count: { textAlign: 'center' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, justifyContent: 'center' },
  key: { alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'transparent' },
  keyLabel: { fontSize: 26, lineHeight: 32, fontWeight: '600' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.94 }] },
  disabled: { opacity: 0.45 },
  // The whole row is the tap target (at least 44 px tall and wide); only the words are underlined.
  linkTarget: { minHeight: 44, minWidth: 44, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  link: { textAlign: 'center', textDecorationLine: 'underline' },
  linkHover: { backgroundColor: 'rgba(246, 198, 216, 0.35)', borderRadius: 16 },
  linkPressed: { backgroundColor: 'rgba(246, 198, 216, 0.75)', borderRadius: 16 },
  sideRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: Spacing.four },
  sidePad: { flexShrink: 0 },
  sideInfo: { flex: 1, minWidth: 0, alignItems: 'center', gap: Spacing.one },
  sideExtras: { alignSelf: 'stretch', alignItems: 'center', gap: Spacing.two },
  input: {
    minWidth: 200,
    textAlign: 'center',
    fontSize: 24,
    letterSpacing: 6,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F6C6D8',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
});
