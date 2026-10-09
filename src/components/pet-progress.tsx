import { Pressable, StyleSheet, View } from 'react-native';

import { PetStageIcon } from '@/components/pet-stage-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEV_ENABLE_STAGE_PREVIEW } from '@/utils/dev-flags';
import { getRenderedStageProgress } from '@/utils/pet-growth';
import { PET_STAGES, TASKS_PER_STAGE } from '@/utils/pet-stage';

type PetProgressProps = {
  completedTaskCount: number;
  // The pet's real paidStageIndex (see @/utils/pet-profile.ts) — needed so
  // this panel's stage/level can never read lower than the stage actually
  // shown on the pet (see getRenderedStageProgress in @/utils/pet-growth.ts
  // and bugs.md's BUG-004). Defaults to 0 (no paid upgrade) so existing
  // callers that haven't loaded the profile yet still render something
  // reasonable.
  paidStageIndex?: number;
  // TEMPORARY, dev-preview-only — all three owned by the caller (Home, see
  // src/app/index.tsx's devPreviewStageIndex) so the SAME preview state
  // also drives the main pet image/accessory placement; this component
  // never keeps its own copy. Only read/used at all while
  // DEV_ENABLE_STAGE_PREVIEW is true — see that flag in
  // @/utils/dev-flags.ts for exactly what the preview does and doesn't do.
  // Omit entirely for a read-only Pet Progress (previewStageIndex defaults
  // to null, and the stage icons render as plain, non-interactive views).
  previewStageIndex?: number | null;
  onPreviewStage?: (index: number) => void;
  onResetPreview?: () => void;
};

export function PetProgress({
  completedTaskCount,
  paidStageIndex = 0,
  previewStageIndex = null,
  onPreviewStage,
  onResetPreview,
}: PetProgressProps) {
  const theme = useTheme();
  const isPreviewEnabled = DEV_ENABLE_STAGE_PREVIEW && !!onPreviewStage;

  // Floored at the stage actually shown on the pet (via paidStageIndex),
  // not just the raw completed-task count — so unchecking/removing tasks
  // can still lower progress WITHIN the current stage, but can no longer
  // make this panel disagree with the pet art about which stage it's on.
  const { stageIndex, isMaxStage, tasksIntoStage, progressPercent, level } = getRenderedStageProgress(
    completedTaskCount,
    paidStageIndex
  );

  return (
    <ThemedView type="peachOverlay" style={styles.container}>
      <View style={styles.headerRow}>
        <ThemedText type="smallBold">Pet Progress</ThemedText>
        <ThemedText type="smallBold" themeColor="textSecondary">
          Level {level}
        </ThemedText>
      </View>

      <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
        <View style={{ flex: progressPercent, backgroundColor: theme.mint }} />
        <View style={{ flex: 100 - progressPercent }} />
      </View>

      <ThemedText type="small" themeColor="textSecondary" style={styles.centerText}>
        {isMaxStage
          ? 'Max stage reached! 🎉'
          : `${tasksIntoStage} / ${TASKS_PER_STAGE} tasks to next stage`}
      </ThemedText>

      <View style={styles.stagesRow}>
        {PET_STAGES.map((stage, index) => {
          // The accent border always marks the player's real unlocked
          // stage (stageIndex, already floored at paidStageIndex above) —
          // this never changes based on what's being previewed. The mint
          // border is purely the dev preview's own selection indicator,
          // only ever shown while isPreviewEnabled.
          const stageIcon = (
            <View style={styles.stageItem}>
              <View
                style={[
                  styles.stageIconWrap,
                  { borderColor: theme.backgroundElement },
                  index === stageIndex && { borderColor: theme.accent },
                  isPreviewEnabled && index === previewStageIndex && { borderColor: theme.mint },
                ]}>
                <PetStageIcon stage={stage} size={40} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {stage}
              </ThemedText>
            </View>
          );

          return (
            <View key={stage} style={styles.stageWithArrow}>
              {isPreviewEnabled ? (
                <Pressable onPress={() => onPreviewStage?.(index)}>{stageIcon}</Pressable>
              ) : (
                stageIcon
              )}
              {index !== PET_STAGES.length - 1 ? (
                <ThemedText themeColor="textSecondary" style={styles.arrow}>
                  →
                </ThemedText>
              ) : null}
            </View>
          );
        })}
      </View>

      {isPreviewEnabled && previewStageIndex !== null ? (
        <Pressable onPress={onResetPreview}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.resetPreviewText}>
            ↺ Reset to Actual Stage
          </ThemedText>
        </Pressable>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  track: {
    flexDirection: 'row',
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  centerText: {
    textAlign: 'center',
  },
  stagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingTop: Spacing.one,
  },
  stageWithArrow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stageItem: {
    alignItems: 'center',
    gap: Spacing.half,
    width: 64,
  },
  stageIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    fontSize: 14,
    marginHorizontal: Spacing.half,
  },
  // TEMPORARY — dev-preview-only (see isPreviewEnabled above).
  resetPreviewText: {
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
