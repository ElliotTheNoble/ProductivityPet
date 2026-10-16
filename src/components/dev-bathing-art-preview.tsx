import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { SpriteCrop } from '@/components/sprite-crop';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { BATHING_STEP_COUNTS, getBathingStepArt, type BathingStep } from '@/utils/bathing-stage-art';
import type { RoomPetStage } from '@/utils/room-pet-art';

// TEMPORARY, developer-only — see DEV_ENABLE_BATHING_ART_PREVIEW's own
// comment in @/utils/dev-flags.ts for exactly what this does/doesn't do.
// To remove this whole feature later: delete this file, delete that flag,
// and delete the one line in @/components/room-detail-screen.tsx that
// renders <DevBathingArtPreview />. Nothing else references this file.

const STEPS: BathingStep[] = ['soap', 'rinse', 'dry'];
const STAGES: RoomPetStage[] = ['Hatchling', 'Baby', 'Young', 'Adult'];
const STEP_LABELS: Record<BathingStep, string> = { soap: 'Soap', rinse: 'Rinse', dry: 'Dry' };

// Large enough to actually inspect fine details (soap bubbles, fur,
// whether an edge is cut off) — bigger than this art renders anywhere
// else in the real game, which is exactly the point of a preview tool.
const PREVIEW_SIZE = 300;

// Simple explanation: a small floating panel, closed by default (so it
// never gets in the way until someone actually wants it), that lets you
// pick Soap/Rinse/Dry, which numbered picture, and which growth stage,
// then shows that exact picture nice and big using the project's existing
// SpriteCrop component + getBathingStepArt() lookup
// (@/utils/bathing-stage-art.ts) — the SAME crop rectangles prepared
// earlier, just displayed here for visual spot-checking instead of being
// silently unused. SpriteCrop's own "contain, don't stretch" behavior
// (see that component's own comment) is what guarantees the picture never
// stretches/distorts and, since it only ever reveals exactly the
// cropWidth x cropHeight rectangle we hand it, that no neighboring pose
// can ever show and no part of Kitty's own artwork gets cut off — the
// same guarantee that already protects the other 4 rooms' activity art.
export function DevBathingArtPreview() {
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<BathingStep>('soap');
  const [stepNumber, setStepNumber] = useState(1);
  const [stage, setStage] = useState<RoomPetStage>('Hatchling');

  // Soap only goes up to 4 while Rinse/Dry go up to 5 (see
  // BATHING_STEP_COUNTS) — switching to Soap while "5" was selected needs
  // to fall back to a number that's actually valid for it.
  function handleSelectStep(nextStep: BathingStep) {
    setStep(nextStep);
    setStepNumber((prev) => Math.min(prev, BATHING_STEP_COUNTS[nextStep]));
  }

  const art = getBathingStepArt(step, stepNumber, stage);
  const numberOptions = Array.from({ length: BATHING_STEP_COUNTS[step] }, (_, i) => i + 1);

  return (
    <View style={styles.wrapper} pointerEvents="box-none">
      <Pressable onPress={() => setIsOpen((open) => !open)} style={({ pressed }) => pressed && styles.pressed}>
        <ThemedView type="peachOverlay" style={styles.toggle}>
          <ThemedText type="smallBold">{isOpen ? '🧪 Close Art Preview' : '🧪 Dev: Bathing Art Preview'}</ThemedText>
        </ThemedView>
      </Pressable>

      {isOpen ? (
        <ThemedView type="backgroundElementOverlay" style={styles.panel}>
          <ThemedText type="small" themeColor="textSecondary">
            Temporary test control — spot-check the 14 bathing sprite sheets. Doesn&apos;t touch Kitty&apos;s real
            Cleanliness, needsBath, or the actual Wash Kitty button below.
          </ThemedText>

          <PickerRow label="Phase">
            {STEPS.map((candidate) => (
              <Pressable key={candidate} onPress={() => handleSelectStep(candidate)}>
                <Pill label={STEP_LABELS[candidate]} selected={candidate === step} selectedColor="accent" />
              </Pressable>
            ))}
          </PickerRow>

          <PickerRow label="Number">
            {numberOptions.map((candidate) => (
              <Pressable key={candidate} onPress={() => setStepNumber(candidate)}>
                <Pill label={String(candidate)} selected={candidate === stepNumber} selectedColor="sky" />
              </Pressable>
            ))}
          </PickerRow>

          <PickerRow label="Stage">
            {STAGES.map((candidate) => (
              <Pressable key={candidate} onPress={() => setStage(candidate)}>
                <Pill label={candidate} selected={candidate === stage} selectedColor="mint" />
              </Pressable>
            ))}
          </PickerRow>

          <View style={styles.previewBox}>
            <SpriteCrop {...art} size={PREVIEW_SIZE} />
          </View>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fileLabel}>
            {STEP_LABELS[step]} {stepNumber} — {stage}
          </ThemedText>
        </ThemedView>
      ) : null}
    </View>
  );
}

function PickerRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.pickerRow}>
      <ThemedText type="small">{label}:</ThemedText>
      <View style={styles.pillRow}>{children}</View>
    </View>
  );
}

function Pill({ label, selected, selectedColor }: { label: string; selected: boolean; selectedColor: ThemeColor }) {
  return (
    <ThemedView type={selected ? selectedColor : 'backgroundElement'} style={styles.pill}>
      <ThemedText type="small" style={selected ? styles.pillTextSelected : undefined}>
        {label}
      </ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    top: Spacing.four,
    left: Spacing.four,
    zIndex: 2,
    maxWidth: 360,
  },
  pressed: {
    opacity: 0.7,
  },
  toggle: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
    alignSelf: 'flex-start',
  },
  panel: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    gap: Spacing.two,
  },
  pickerRow: {
    gap: Spacing.one,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
  },
  pill: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.five,
  },
  pillTextSelected: {
    color: '#FFFFFF',
  },
  previewBox: {
    alignSelf: 'center',
    marginTop: Spacing.two,
  },
  fileLabel: {
    textAlign: 'center',
  },
});
