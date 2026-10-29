import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { PetAvatar } from '@/components/pet-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePetFamily } from '@/hooks/use-pet-family';
import { useTheme } from '@/hooks/use-theme';
import {
  MAX_LIVING_PETS,
  adoptNewEgg,
  canAdoptMore,
  getCareSupplies,
  getLivingPets,
  getPetLabel,
  getSelectedPet,
  selectPet,
  type PetRecord,
} from '@/utils/pet-family';
import {
  CRITICAL_TO_DEATH_HOURS,
  GROWTH_UNITS_PER_TASK,
  RECOVERY_NEED_THRESHOLD,
  SICK_TO_CRITICAL_HOURS,
} from '@/utils/pet-family-config';
import { getRenderedStage } from '@/utils/pet-growth';
import { MEMORIAL_MESSAGE } from '@/utils/pet-life-messages';

// The pet family bar: a slim, pastel strip under the header on the pet pages
// (Home, Rooms, Shop, Stats) where the player switches between pets, adopts a
// new egg, sees a sick pet's warning and countdown, and — for a pet that has
// passed away — reads the memorial and can resurrect it. Everything is derived
// from @/utils/pet-family.ts; this component stores nothing itself.

const HOUR_MS = 3600 * 1000;

const STATUS_COLORS = {
  healthy: '#7FD9B6',
  sick: '#F6C99A',
  critical: '#E86F8E',
  deceased: '#B8AFC4',
} as const;

function petStage(pet: PetRecord) {
  return getRenderedStage(Math.floor(pet.growthUnits / GROWTH_UNITS_PER_TASK), pet.profile.paidStageIndex);
}

function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const MEMORIAL_SEEN_KEY = '@ProductivityPet:memorialSeen';
const MEMORIAL_TOAST_MS = 5000;
const BATHROOM_SICK_HINT = 'Too sick for a bath — gently drag the washcloth over her to freshen her up.';

export function PetFamilyBar() {
  const theme = useTheme();
  // Phone width: a little more room above the health banner so it sits clearly below
  // the pet chips (desktop spacing is unchanged).
  const isPhone = useWindowDimensions().width < 700;
  // In the Bathroom the banner carries the wipe-down instruction itself (the Bathroom
  // screen hides its separate message on phones), so it never overlaps a second one.
  const inBathroom = usePathname().endsWith('/rooms/bathroom');
  const family = usePetFamily();
  const [now, setNow] = useState(() => Date.now());
  const [adoptOpen, setAdoptOpen] = useState(false);
  const [adoptBusy, setAdoptBusy] = useState(false);
  const [adoptError, setAdoptError] = useState<string | null>(null);
  // The memorial message is a temporary notification: shown once when a pet passes away (it is
  // remembered per death so it doesn't return on tab changes or refreshes), gone after ~5 seconds or
  // when tapped. The permanent memorial + Resurrect lives in Stats.
  const [memorialToast, setMemorialToast] = useState<string | null>(null);
  const memorialKey = (() => {
    const pet = family ? getSelectedPet(family) : null;
    return pet && pet.lifecycle.state === 'deceased' ? `${pet.id}|${pet.lifecycle.diedAt ?? ''}` : null;
  })();
  useEffect(() => {
    if (!memorialKey) {
      setMemorialToast(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    AsyncStorage.getItem(MEMORIAL_SEEN_KEY)
      .then((raw) => {
        let seen: string[] = [];
        try {
          seen = raw ? (JSON.parse(raw) as string[]) : [];
        } catch {}
        if (cancelled || seen.includes(memorialKey)) return;
        AsyncStorage.setItem(MEMORIAL_SEEN_KEY, JSON.stringify([...seen, memorialKey].slice(-50))).catch(() => {});
        setMemorialToast(memorialKey);
        timer = setTimeout(() => setMemorialToast((cur) => (cur === memorialKey ? null : cur)), MEMORIAL_TOAST_MS);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [memorialKey]);

  // A once-a-minute tick keeps the countdowns fresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  if (!family) return null;

  const selected = getSelectedPet(family);
  const living = getLivingPets(family);
  const canAdopt = canAdoptMore(family);
  const balance = family.wallet.pawTokens;
  const state = selected.lifecycle.state;
  // Which of the three recovery needs are below the recovery level (50), from the pet's real values.
  // When none is, no warning line is shown and the normal recovery check handles the change.
  const lowNeeds = (
    [
      ['Hunger', selected.profile.hunger],
      ['Cleanliness', selected.profile.cleanliness],
      ['Happiness', selected.profile.happiness],
    ] as const
  )
    .filter(([, value]) => value < RECOVERY_NEED_THRESHOLD)
    .map(([name]) => name);
  const needsAttention =
    lowNeeds.length === 0
      ? null
      : `Check ${lowNeeds.length === 1 ? lowNeeds[0] : lowNeeds.length === 2 ? lowNeeds.join(' and ') : `${lowNeeds[0]}, ${lowNeeds[1]}, and ${lowNeeds[2]}`}.`;
  const sickSinceMs = selected.lifecycle.sickSince ? new Date(selected.lifecycle.sickSince).getTime() : NaN;

  async function handleAdopt() {
    setAdoptBusy(true);
    setAdoptError(null);
    const result = await adoptNewEgg();
    setAdoptBusy(false);
    if (result.ok) {
      setAdoptOpen(false);
    } else {
      setAdoptError(
        result.reason === 'limit'
          ? `You already have ${MAX_LIVING_PETS} living pets.`
          : result.reason === 'busy'
            ? 'Adoption is already in progress.'
            : "Couldn't save the new egg on this device. Nothing was changed — please try again."
      );
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {family.pets.map((pet) => {
          const isSelected = pet.id === family.selectedPetId;
          const stage = petStage(pet);
          return (
            <Pressable
              key={pet.id}
              onPress={() => selectPet(pet.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${getPetLabel(pet, family.pets)}, ${pet.lifecycle.state}`}
              style={({ pressed }) => pressed && styles.pressed}>
              <ThemedView
                type="backgroundElementOverlay"
                style={[
                  styles.chip,
                  styles.pointer,
                  { borderColor: isSelected ? theme.accent : 'transparent' },
                  pet.lifecycle.state === 'deceased' && styles.chipDeceased,
                ]}>
                <View style={styles.chipAvatar}>
                  <PetAvatar
                    stage={stage}
                    equippedAccessoryIds={stage === 'Egg' ? [] : [pet.equipped.bow, pet.equipped.hat]}
                    size={34}
                    healthState={pet.lifecycle.state}
                  />
                </View>
                <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[pet.lifecycle.state] }]} />
                <ThemedText type="smallBold" style={styles.chipLabel}>
                  {getPetLabel(pet, family.pets)}
                </ThemedText>
                {pet.lifecycle.state === 'deceased' ? <ThemedText style={styles.rainbow}>🌈</ThemedText> : null}
              </ThemedView>
            </Pressable>
          );
        })}

        {canAdopt ? (
          <Pressable
            onPress={() => {
              setAdoptError(null);
              setAdoptOpen(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="Adopt a new egg"
            style={({ pressed }) => pressed && styles.pressed}>
            <ThemedView type="mint" style={[styles.adoptChip, styles.pointer]}>
              <ThemedText type="smallBold">＋ Adopt an egg</ThemedText>
            </ThemedView>
          </Pressable>
        ) : null}
      </View>

      {state === 'sick' || state === 'critical' ? (
        <View
          style={[
            styles.healthPanel,
            isPhone && styles.healthPanelPhone,
            { backgroundColor: state === 'critical' ? '#FFE3EA' : '#FFF1DE', borderColor: STATUS_COLORS[state] },
          ]}
          accessibilityRole="alert">
          <MaterialCommunityIcons name="heart-pulse" size={22} color={STATUS_COLORS[state]} />
          <View style={styles.healthText}>
            <ThemedText type="smallBold">
              {state === 'critical'
                ? `${getPetLabel(selected, family.pets)} needs urgent care`
                : `${getPetLabel(selected, family.pets)} isn't feeling well`}
            </ThemedText>
            {needsAttention ? (
              <ThemedText type="small" themeColor="textSecondary">
                {needsAttention}
                {inBathroom && selected.profile.cleanliness < RECOVERY_NEED_THRESHOLD && getCareSupplies(family).washcloth > 0 ? ` ${BATHROOM_SICK_HINT}` : ''}
              </ThemedText>
            ) : null}
          </View>
          {!Number.isNaN(sickSinceMs) ? (
            <View style={styles.healthTimer}>
              <Ionicons name="time-outline" size={16} color={STATUS_COLORS[state]} />
              <ThemedText type="smallBold">
                {state === 'sick'
                  ? formatRemaining(sickSinceMs + SICK_TO_CRITICAL_HOURS * HOUR_MS - now)
                  : formatRemaining(sickSinceMs + (SICK_TO_CRITICAL_HOURS + CRITICAL_TO_DEATH_HOURS) * HOUR_MS - now)}
              </ThemedText>
            </View>
          ) : null}
        </View>
      ) : null}

      {state === 'deceased' && memorialToast ? (
        <Pressable
          onPress={() => setMemorialToast(null)}
          accessibilityRole="alert"
          accessibilityLabel="Dismiss memorial message"
          style={styles.memorialToastWrap}>
          <View style={[styles.healthPanel, styles.memorialToast, { backgroundColor: '#EFE9FA', borderColor: STATUS_COLORS.deceased }]}>
            <Ionicons name="heart" size={16} color={STATUS_COLORS.deceased} />
            <ThemedText type="small" style={styles.healthText}>
              {MEMORIAL_MESSAGE}
            </ThemedText>
          </View>
        </Pressable>
      ) : null}

      <ConfirmModal
        visible={adoptOpen}
        title="Adopt a new egg?"
        confirmLabel="Adopt"
        busy={adoptBusy}
        onConfirm={handleAdopt}
        onCancel={() => setAdoptOpen(false)}>
        <ThemedText type="small">
          A new egg will join your family. Your other pets, tasks, tokens and history stay exactly as they are.
          You can care for up to {MAX_LIVING_PETS} living pets at once ({living.length} now).
        </ThemedText>
        {adoptError ? <ThemedText type="small" themeColor="accent">{adoptError}</ThemedText> : null}
      </ConfirmModal>

    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    maxWidth: 1400,
    alignSelf: 'center',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.one,
    gap: Spacing.one,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two },
  pressed: { opacity: 0.8 },
  pointer: { cursor: 'pointer' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: 2,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.five,
    borderWidth: 2,
  },
  chipDeceased: { opacity: 0.75 },
  chipAvatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  chipLabel: { fontSize: 13, lineHeight: 18 },
  rainbow: { fontSize: 14 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  adoptChip: { paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: Spacing.five },
  healthPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
  // Floats under the bar so it never pushes the page down or covers the navigation.
  memorialToastWrap: { position: 'absolute', left: Spacing.three, right: Spacing.three, top: '100%', zIndex: 40 },
  memorialToast: { shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  healthPanelPhone: { marginTop: Spacing.two },
  healthText: { flexShrink: 1, flexGrow: 1, flexBasis: 160 },
  healthTimer: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
