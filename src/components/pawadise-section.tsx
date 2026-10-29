import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { DetailEmptyState, DetailPanel } from '@/components/detail-page-parts';
import { PetAvatar } from '@/components/pet-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePetFamily } from '@/hooks/use-pet-family';
import { buildAlbumEntries, type PetAlbumEntry } from '@/utils/pet-album';
import { MAX_LIVING_PETS, canAdoptMore, retirePet, returnPetHome, type PawadiseResult } from '@/utils/pet-family';
import { PawadiseFarewell } from '@/components/pawadise-farewell';
import { PawadisePetPage } from '@/components/pawadise-pet-page';
import { formatDate, speciesLabel } from '@/components/pawadise-postcard-views';
import { getFarewellScenes } from '@/utils/pawadise-farewell';
import { PAWADISE_SCENE, PAWADISE_SCENE_ASPECT_RATIO } from '@/utils/pawadise-art';

// The "Pet Pawadise" section of the Pet Album: a peaceful resort where HEALTHY pets can retire. A retired
// pet is frozen (no needs, sickness, growth or timers), keeps everything it had, frees one of the three
// active slots, and can come home for free whenever a slot is free. All rules live in retirePet /
// returnPetHome (@/utils/pet-family.ts); this file only shows them and asks for confirmation.

const SCENE_CARD = '#E4F4F1'; // soft aqua

function pawadiseError(result: Extract<PawadiseResult, { ok: false }>): string {
  switch (result.reason) {
    case 'not-healthy':
      return 'Only healthy pets can go to Pawadise.';
    case 'egg':
      return "An egg can't go to Pawadise until it has hatched.";
    case 'last-pet':
      return 'Keep at least one pet at home. Adopt another egg first.';
    case 'no-slot':
      return `You already have ${MAX_LIVING_PETS} pets at home. Free a slot first.`;
    case 'already-retired':
    case 'not-retired':
      return 'That pet is already where it should be.';
    case 'busy':
      return 'One moment — that is already happening.';
    default:
      return "Couldn't save on this device. Nothing was changed — please try again.";
  }
}

// Why an active pet can't be sent right now (null = it can).
function sendBlocker(entry: PetAlbumEntry, activeCount: number): string | null {
  if (entry.isEgg) return 'Eggs can go once they hatch.';
  if (entry.lifeState !== 'healthy') return 'Only healthy pets can go.';
  if (activeCount < 2) return 'Keep at least one pet at home.';
  return null;
}

type Pending = { kind: 'retire' | 'return'; entry: PetAlbumEntry } | null;

export function PawadiseSection() {
  const family = usePetFamily();
  const [viewing, setViewing] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The farewell scene (species of the pet that just retired) while it is showing.
  const [farewell, setFarewell] = useState<string | null>(null);
  if (!family) return null;

  const entries = buildAlbumEntries(family);
  const retired = entries.filter((e) => e.isRetired);
  const active = entries.filter((e) => e.isActive);
  const slotFree = canAdoptMore(family);
  // The farewell sits above everything; when it ends we are right back here, on the Pet Pawadise tab.
  const farewellNode = farewell ? <PawadiseFarewell species={farewell} onDone={() => setFarewell(null)} /> : null;
  const viewingEntry = viewing ? (entries.find((e) => e.id === viewing) ?? null) : null;
  // One pet's own Pawadise page (with only its postcards), inside the Pet Pawadise tab.
  if (viewingEntry) return <PawadisePetPage entry={viewingEntry} onBack={() => setViewing(null)} />;

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const result = pending.kind === 'retire' ? await retirePet(pending.entry.id) : await returnPetHome(pending.entry.id);
    setBusy(false);
    if (result.ok) {
      setNotice(
        pending.kind === 'retire'
          ? `${pending.entry.label} is now relaxing in Pet Pawadise.`
          : `${pending.entry.label} is home again!`
      );
      setPending(null);
      // Only after a SUCCESSFUL retirement, and only for species that have a farewell scene (cats).
      if (pending.kind === 'retire' && getFarewellScenes(pending.entry.species)) setFarewell(pending.entry.species);
      return;
    }
    setError(pawadiseError(result));
  }

  return (
    <View style={styles.wrap}>
      {farewellNode}
      {/* Resort scene (the player's own artwork, shown whole at its real proportions). */}
      <View style={styles.scene}>
        <Image source={PAWADISE_SCENE} contentFit="cover" style={styles.sceneImage} accessibilityLabel="Pet Pawadise resort" />
      </View>
      <ThemedView style={[styles.intro, { backgroundColor: SCENE_CARD }]}>
        <ThemedText style={styles.introTitle}>🌴 Pet Pawadise</ThemedText>
        <ThemedText type="small" style={styles.introText}>
          A peaceful retirement resort for healthy pets. While they relax here, their needs, growth and health are
          paused, so nothing changes — and you can bring them home for free whenever you have a free pet slot.
        </ThemedText>
      </ThemedView>

      {notice ? (
        <ThemedText type="smallBold" accessibilityRole="alert" style={styles.notice}>
          {notice}
        </ThemedText>
      ) : null}

      <DetailPanel title="🏝️ Relaxing in Pawadise">
        {retired.length === 0 ? (
          <DetailEmptyState
            icon={<ThemedText style={styles.emptyEmoji}>🌺</ThemedText>}
            title="Pawadise is quiet right now"
            text="When a healthy pet retires, they'll relax here, safe and happy, until you bring them home."
          />
        ) : (
          <View style={styles.grid}>
            {retired.map((entry) => (
              <View key={entry.id} style={styles.petCard}>
                {/* Only the picture and facts open the pet's page, so Bring Home stays its own button (a button can't sit inside another). */}
                <Pressable
                  onPress={() => setViewing(entry.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${entry.label}'s Pawadise page`}
                  style={({ pressed }) => [styles.petCardTap, styles.petCardInteractive, pressed && styles.pressed]}>
                <View style={styles.petAvatar}>
                  <PetAvatar stage={entry.stage} equippedAccessoryIds={entry.isEgg ? [] : entry.equippedAccessoryIds} size={110} />
                </View>
                <ThemedText type="smallBold" style={styles.petName}>
                  {entry.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {`Species: ${speciesLabel(entry.species)}`}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {`Growth stage: ${entry.stage}`}
                </ThemedText>
                {formatDate(entry.retiredAt) ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {`Retired ${formatDate(entry.retiredAt)}`}
                  </ThemedText>
                ) : null}
                </Pressable>
                <Pressable
                  disabled={!slotFree}
                  onPress={() => {
                    setError(null);
                    setNotice(null);
                    setPending({ kind: 'return', entry });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Bring ${entry.label} home`}
                  style={({ pressed }) => [pressed && styles.pressed, !slotFree && styles.disabled]}>
                  <ThemedView type="mint" style={styles.button}>
                    <ThemedText type="smallBold">Bring Home</ThemedText>
                  </ThemedView>
                </Pressable>
                {!slotFree ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
                    {`You have ${MAX_LIVING_PETS} pets at home. Free a slot first.`}
                  </ThemedText>
                ) : null}
              </View>
            ))}
          </View>
        )}
      </DetailPanel>

      <DetailPanel title="🧳 Send a pet to Pawadise">
        {active.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            You have no pets at home right now.
          </ThemedText>
        ) : (
          active.map((entry) => {
            const blocker = sendBlocker(entry, active.length);
            return (
              <View key={entry.id} style={styles.sendRow}>
                <View style={styles.sendAvatar}>
                  <PetAvatar stage={entry.stage} equippedAccessoryIds={entry.isEgg ? [] : entry.equippedAccessoryIds} size={56} />
                </View>
                <View style={styles.sendInfo}>
                  <ThemedText type="smallBold">{entry.label}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {blocker ?? `${entry.stage} · ready for a rest`}
                  </ThemedText>
                </View>
                <Pressable
                  disabled={!!blocker}
                  onPress={() => {
                    setError(null);
                    setNotice(null);
                    setPending({ kind: 'retire', entry });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Send ${entry.label} to Pet Pawadise`}
                  style={({ pressed }) => [pressed && styles.pressed, !!blocker && styles.disabled]}>
                  <ThemedView type="accent" style={styles.button}>
                    <ThemedText type="smallBold" style={styles.whiteText}>
                      Send to Pawadise
                    </ThemedText>
                  </ThemedView>
                </Pressable>
              </View>
            );
          })
        )}
      </DetailPanel>

      <ConfirmModal
        visible={pending !== null}
        title={
          pending?.kind === 'retire'
            ? `Send ${pending.entry.label} to Pet Pawadise?`
            : pending
              ? `Bring ${pending.entry.label} home?`
              : ''
        }
        confirmLabel={pending?.kind === 'retire' ? 'Send to Pawadise' : 'Bring Home'}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => {
          if (!busy) {
            setPending(null);
            setError(null);
          }
        }}>
        <ThemedText type="small">
          {pending?.kind === 'retire'
            ? "They'll relax in Pawadise. Their needs, growth and health pause, so nothing changes while they're away, and everything about them is kept safe. You can bring them home for free whenever you have a free pet slot."
            : "It's free. They'll pick up exactly where they left off — the time spent in Pawadise doesn't count."}
        </ThemedText>
        {error ? (
          <ThemedText type="smallBold" accessibilityRole="alert">
            {error}
          </ThemedText>
        ) : null}
      </ConfirmModal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.three },
  scene: {
    width: '100%',
    // Not larger than needed on wide screens; centered.
    maxWidth: 820,
    alignSelf: 'center',
    aspectRatio: PAWADISE_SCENE_ASPECT_RATIO,
    borderRadius: Spacing.four,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  sceneImage: { width: '100%', height: '100%' },
  intro: {
    padding: Spacing.three,
    borderRadius: Spacing.four,
    gap: Spacing.one,
    alignItems: 'center',
  },
  introTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800' },
  introText: { textAlign: 'center', lineHeight: 20 },
  notice: { textAlign: 'center' },
  emptyEmoji: { fontSize: 40, lineHeight: 48 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.three, justifyContent: 'center' },
  petCard: {
    width: 210,
    maxWidth: '100%',
    alignItems: 'center',
    gap: Spacing.one,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.7)',
    backgroundColor: SCENE_CARD,
  },
  petCardTap: { alignItems: 'center', gap: Spacing.one, alignSelf: 'stretch' },
  petCardInteractive: { cursor: 'pointer' },
  petAvatar: { width: 140, height: 130, alignItems: 'center', justifyContent: 'center' },
  petName: { fontSize: 17, lineHeight: 22 },
  center: { textAlign: 'center' },
  button: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.one + 2, borderRadius: Spacing.five },
  whiteText: { color: '#FFFFFF' },
  sendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', paddingVertical: Spacing.one },
  sendAvatar: { width: 64, height: 60, alignItems: 'center', justifyContent: 'center' },
  sendInfo: { flex: 1, minWidth: 120 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
