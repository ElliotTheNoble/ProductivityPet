import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { Button } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useT } from '@/i18n';
import { copyText, readClipboard } from '@/utils/clipboard';

// Showing and typing a recovery code. The code is shown only when the parent taps "Show code" (it is NEVER revealed
// automatically, not on opening the screen and not on coming back from the background; the owner of the state hides it on
// both) and it is not selectable text. It can be copied ONLY with the "Copy code" button, only while it is shown, and only after the
// parent has read a warning that the clipboard can be read outside the app and agreed (it is never copied automatically).
// Typing it allows pasting (the keyboard, or the "Paste code" button), so a code kept in a password manager works.

// True once the screen protection a recovery step asked for has been settled (blocked, or the parent chose to allow screenshots).
// "Show code", the code field and "Paste code" stay off until then, so nothing sensitive can appear before the block is in place.
// Outside a protected page (no provider) there is nothing to wait for.
export const CaptureReadyContext = createContext(true);

const GROUP = 5;
const GROUPS = 5;
const TOTAL = GROUP * GROUPS;

// "abcde-fghij ..." in any case, with or without dashes and spaces -> "ABCDE-FGHIJ-..." (at most 25 characters). Characters
// that cannot be part of a code are dropped; whether it is a VALID code is decided by normalizeRecoveryCode (pin-crypto.ts).
export function formatRecoveryInput(raw: string): string {
  const chars = raw.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, TOTAL);
  return (chars.match(new RegExp(`.{1,${GROUP}}`, 'g')) ?? []).join('-');
}

// What a screen reader says: every character on its own, groups separated by a pause ("A 4 K 7 B, 9 ...").
export function spellOutCode(code: string): string {
  return code
    .split('-')
    .map((group) => Array.from(group).join(' '))
    .join(', ');
}

export function RecoveryCodeDisplay({
  code,
  revealed,
  onReveal,
  onHide,
}: {
  code: string;
  revealed: boolean;
  onReveal: () => void;
  onHide: () => void;
}) {
  const { t } = useT();
  const theme = useTheme();
  const ready = useContext(CaptureReadyContext);
  const shown = revealed && code.length > 0;
  const text = shown ? code : code ? code.replace(/[^-]/g, '•') : '';
  const [asking, setAsking] = useState(false);
  const [copyNote, setCopyNote] = useState<'copied' | 'needs-update' | 'failed' | null>(null);
  // Hiding the code takes the Copy question and the note away for good (showing it again starts clean), and a copy still in progress
  // when the code is hidden does not leave its note behind.
  const [wasShown, setWasShown] = useState(shown);
  if (wasShown !== shown) {
    setWasShown(shown);
    if (!shown) {
      setAsking(false);
      setCopyNote(null);
    }
  }
  const hides = useRef(0);
  useEffect(() => {
    if (!shown) hides.current += 1;
  }, [shown]);
  const copy = async () => {
    setAsking(false);
    const before = hides.current;
    const result = await copyText(code);
    if (hides.current === before) setCopyNote(result);
  };
  return (
    <View style={styles.wrap}>
      <View
        accessible
        accessibilityLabel={shown ? t('rcShown', { spoken: spellOutCode(code) }) : t('rcHidden')}
        style={[styles.box, { backgroundColor: 'rgba(255,255,255,0.92)', borderColor: theme.accent }]}>
        <ThemedText
          selectable={false}
          maxFontSizeMultiplier={1.4}
          style={[styles.code, Platform.OS === 'web' ? ({ userSelect: 'none' } as object) : null]}>
          {text}
        </ThemedText>
      </View>
      {shown ? (
        <>
          <Button tone="soft" label={t('rcCopy')} onPress={() => setAsking(true)} />
          {copyNote ? (
            <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
              {copyNote === 'copied' ? t('rcCopied') : copyNote === 'needs-update' ? t('rcCopyNeedsUpdate') : t('rcCopyFailed')}
            </ThemedText>
          ) : null}
          <Button tone="soft" label={t('rcHide')} onPress={onHide} />
        </>
      ) : (
        <Button tone="mint" label={t('rcReveal')} onPress={onReveal} disabled={code.length === 0 || !ready} />
      )}
      <ConfirmModal visible={asking} title={t('rcCopyTitle')} confirmLabel={t('rcCopyConfirm')} onConfirm={() => void copy()} onCancel={() => setAsking(false)}>
        <ThemedText type="small">{t('rcCopyBody')}</ThemedText>
      </ConfirmModal>
    </View>
  );
}

export function RecoveryCodeField({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
}) {
  const { t } = useT();
  const theme = useTheme();
  const ready = useContext(CaptureReadyContext);
  const [pasteNote, setPasteNote] = useState<'empty' | 'needs-update' | 'failed' | null>(null);
  const paste = async () => {
    const result = await readClipboard();
    if (result.kind !== 'text') return setPasteNote(result.kind);
    if (!result.text.trim()) return setPasteNote('empty');
    setPasteNote(null);
    onChange(formatRecoveryInput(result.text));
  };
  return (
    <View style={styles.wrap}>
      <ThemedText type="smallBold">{t('rcFieldLabel')}</ThemedText>
      <TextInput
        accessibilityLabel={t('rcFieldLabel')}
        accessibilityHint={t('rcFieldHint')}
        value={value}
        onChangeText={(text) => onChange(formatRecoveryInput(text))}
        onSubmitEditing={onSubmit}
        editable={!disabled && ready}
        placeholder={t('rcFieldPlaceholder')}
        placeholderTextColor="#A58FB0"
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        importantForAutofill="noExcludeDescendants"
        textContentType="none"
        // Pasting stays allowed (a code kept in a password manager); only the typed text is formatted.
        maxLength={64}
        style={[styles.field, { color: theme.text }]}
      />
      <ThemedText type="small" themeColor="textSecondary">
        {t('rcFieldHint')}
      </ThemedText>
      <Button tone="soft" label={t('rcPaste')} onPress={() => void paste()} disabled={disabled || !ready} />
      {pasteNote ? (
        <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
          {pasteNote === 'empty' ? t('rcPasteEmpty') : pasteNote === 'needs-update' ? t('rcPasteNeedsUpdate') : t('rcPasteFailed')}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two, alignItems: 'stretch', alignSelf: 'stretch' },
  box: { borderRadius: 20, borderWidth: 2, paddingVertical: Spacing.three, paddingHorizontal: Spacing.two, alignItems: 'center' },
  code: { fontFamily: Fonts.mono, fontSize: 20, lineHeight: 28, letterSpacing: 1, textAlign: 'center', fontWeight: '700' },
  field: {
    minHeight: 48,
    fontFamily: Fonts.mono,
    fontSize: 18,
    letterSpacing: 1,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F6C6D8',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
});
