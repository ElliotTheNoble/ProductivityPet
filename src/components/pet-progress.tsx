import { StyleSheet, View } from 'react-native';

import { PetStageIcon } from '@/components/pet-stage-icon';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PET_STAGES, TASKS_PER_STAGE, getPetStageIndex } from '@/utils/pet-stage';

type PetProgressProps = {
  completedTaskCount: number;
};

const MAX_STAGE_INDEX = PET_STAGES.length - 1;

export function PetProgress({ completedTaskCount }: PetProgressProps) {
  const theme = useTheme();

  // Live-derived from the current completed-task count (shared with the
  // living-room pet via getPetStageIndex), so unchecking a task lowers
  // progress — and can drop a stage — the same way checking one raises it.
  const stageIndex = getPetStageIndex(completedTaskCount);
  const isMaxStage = stageIndex === MAX_STAGE_INDEX;
  const tasksIntoStage = isMaxStage
    ? TASKS_PER_STAGE
    : completedTaskCount - stageIndex * TASKS_PER_STAGE;
  const progressPercent = Math.round((tasksIntoStage / TASKS_PER_STAGE) * 100);
  const level = stageIndex + 1;

  return (
    <ThemedView type="peach" style={styles.container}>
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
        {PET_STAGES.map((stage, index) => (
          <View key={stage} style={styles.stageWithArrow}>
            <View style={styles.stageItem}>
              <View
                style={[
                  styles.stageIconWrap,
                  { borderColor: theme.backgroundElement },
                  index === stageIndex && { borderColor: theme.accent },
                ]}>
                <PetStageIcon stage={stage} size={40} />
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {stage}
              </ThemedText>
            </View>
            {index !== PET_STAGES.length - 1 ? (
              <ThemedText themeColor="textSecondary" style={styles.arrow}>
                →
              </ThemedText>
            ) : null}
          </View>
        ))}
      </View>
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
});
