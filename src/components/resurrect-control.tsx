import { useState } from 'react';
import { useT, type Msg } from '@/i18n';
import { Pressable, StyleSheet, View } from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { PawTokenCoin } from '@/components/paw-token-coin';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePetFamily } from '@/hooks/use-pet-family';
import { MAX_LIVING_PETS, canAdoptMore, resurrectPet } from '@/utils/pet-family';
import { RESURRECTION_COST } from '@/utils/pet-family-config';

// The "Resurrect" button and its confirmation for ONE deceased pet. Shared by
// the pet family bar (selected pet) and the Pet Album detail page. All rules
// (exact 500-token charge, one atomic save, no charge when a living slot isn't
// free or the balance is short, no duplicate charges) live in resurrectPet in
// @/utils/pet-family.ts; this only shows them and asks for confirmation.
export function ResurrectControl({ petId }: { petId: string }) {
  const { t } = useT();
  const family = usePetFamily();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Msg | null>(null);
  const [hover, setHover] = useState(false);
  if (!family) return null;

  const balance = family.wallet.pawTokens;
  const slotFree = canAdoptMore(family);
  const blocked = !slotFree
    ? t('rezSlot', { max: MAX_LIVING_PETS })
    : balance < RESURRECTION_COST
      ? t('rezNeeds', { n: RESURRECTION_COST - balance })
      : null;

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await resurrectPet(petId);
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      return;
    }
    setError(
      result.reason === 'insufficient'
        ? { key: 'rezErrInsufficient', params: { n: result.missing ?? 0 } }
        : result.reason === 'no-slot'
          ? { key: 'rezErrNoSlot', params: { max: MAX_LIVING_PETS } }
          : result.reason === 'not-deceased'
            ? { key: 'rezErrNotDeceased' }
            : result.reason === 'busy'
              ? { key: 'rezErrBusy' }
              : { key: 'rezErrSave' }
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          setError(null);
          setOpen(true);
        }}
        disabled={blocked !== null}
        onHoverIn={() => setHover(true)}
        onHoverOut={() => setHover(false)}
        accessibilityRole="button"
        style={({ pressed }) => [pressed && styles.pressed, blocked !== null && styles.disabled]}>
        <ThemedView
          type="accent"
          style={[styles.button, styles.pointer, hover && blocked === null && styles.buttonHover]}>
          <PawTokenCoin size={18} />
          <ThemedText type="smallBold" style={styles.buttonText}>
            {t('rezButton', { cost: RESURRECTION_COST })}
          </ThemedText>
        </ThemedView>
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
        {blocked ?? t('rezHint')}
      </ThemedText>

      <ConfirmModal
        visible={open}
        title={t('rezTitle')}
        confirmLabel={t('rezConfirm', { cost: RESURRECTION_COST })}
        confirmDisabled={blocked !== null}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setOpen(false)}>
        <ThemedText type="small">
          {t('rezBody', {
            cost: RESURRECTION_COST,
            balance,
            short: balance < RESURRECTION_COST ? t('rezShort', { n: RESURRECTION_COST - balance }) : '',
          })}
        </ThemedText>
        {blocked ? (
          <ThemedText type="small" themeColor="accent">
            {blocked}
          </ThemedText>
        ) : null}
        {error ? (
          <ThemedText type="small" themeColor="accent">
            {t(error.key, error.params)}
          </ThemedText>
        ) : null}
      </ConfirmModal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three, flexWrap: 'wrap' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.five,
  },
  buttonText: { color: '#FFFFFF' },
  buttonHover: {
    transform: [{ scale: 1.04 }, { translateY: -2 }],
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  hint: { flexShrink: 1, flexGrow: 1, flexBasis: 140 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.45 },
  pointer: { cursor: 'pointer' },
});
