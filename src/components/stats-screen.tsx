import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TaskCategory } from '@/utils/categorize-task';
import { TASKS_PER_STAGE, getStageProgress, type PetStage } from '@/utils/pet-stage';
import { ALL_CATEGORIES, getCategoryCompletionCounts, getImportantCompletedCount } from '@/utils/stats';
import { getCachedTasks } from '@/utils/task-storage';
import { getCompletedTaskCount, type Task } from '@/utils/tasks';

type Percent = `${number}%`;

// Stats-page-only pet art — a separate, differently-styled illustration per
// stage from the one Home/pet-room.tsx use (see pet-placeholder.tsx, which
// is untouched and still drives the pet shown on Home). Each file has its
// own real aspect ratio, so each is paired with its measured width/height
// rather than assuming they're uniform. Keyed by the same PetStage type the
// rest of pet-stage.ts already uses, so looking one up for the current
// stage is just an object lookup — no separate progression system.
const STATS_PET_IMAGES: Record<PetStage, { source: number; aspectRatio: number }> = {
  Egg: { source: require('@/assets/images/pets/stats_egg.png'), aspectRatio: 1300 / 1210 },
  Hatchling: { source: require('@/assets/images/pets/stats_hatchling.png'), aspectRatio: 1388 / 1133 },
  Baby: { source: require('@/assets/images/pets/stats_baby.png'), aspectRatio: 1503 / 1047 },
  Young: { source: require('@/assets/images/pets/stats_young.png'), aspectRatio: 1371 / 1147 },
  Adult: { source: require('@/assets/images/pets/stats_adult.png'), aspectRatio: 1291 / 1218 },
};

// Every icon below is cropped from the user's custom icon sheet rather than
// emoji/generic icons. stats_Icons.png is 1570x1002px; every crop box here
// was measured directly from the file's own alpha channel (bounding boxes
// of each icon's actual non-transparent pixels), not guessed.
const STATS_ICONS_SOURCE = require('@/assets/images/task_icons/stats_Icons.png');
const STATS_ICONS_WIDTH = 1570;
const STATS_ICONS_HEIGHT = 1002;

type IconCrop = { left: number; top: number; width: number; height: number };
const CLIPBOARD_CROP: IconCrop = { left: 670, top: 47, width: 338, height: 344 };
const STAR_CROP: IconCrop = { left: 1009, top: 81, width: 378, height: 312 };
const BOOKS_CROP: IconCrop = { left: 172, top: 400, width: 411, height: 280 };
const SHOE_CROP: IconCrop = { left: 623, top: 433, width: 417, height: 259 };
const BROOM_CROP: IconCrop = { left: 1056, top: 393, width: 396, height: 306 };
const HEART_CROP: IconCrop = { left: 73, top: 707, width: 374, height: 256 };
const PERSON_CROP: IconCrop = { left: 458, top: 743, width: 320, height: 231 };
const SPROUT_CROP: IconCrop = { left: 1212, top: 706, width: 292, height: 260 };

const CATEGORY_ICON_CROP: Record<TaskCategory, IconCrop> = {
  Study: BOOKS_CROP,
  Exercise: SHOE_CROP,
  Clean: BROOM_CROP,
  Health: HEART_CROP,
  Personal: PERSON_CROP,
};

// Decorative 3-line accent marks — 5 colors (blue/green/yellow/pink/purple)
// in one sheet. accent_marks.png is 2171x724px; every crop box below was
// measured directly from the file's own alpha channel, not guessed.
const ACCENT_MARKS_SOURCE = require('@/assets/images/stats/accent_marks.png');
const ACCENT_MARKS_WIDTH = 2171;
const ACCENT_MARKS_HEIGHT = 724;
const BLUE_ACCENT_CROP: IconCrop = { left: 136, top: 192, width: 238, height: 356 };
const GREEN_ACCENT_CROP: IconCrop = { left: 560, top: 195, width: 257, height: 358 };
const YELLOW_ACCENT_CROP: IconCrop = { left: 963, top: 195, width: 255, height: 362 };
const PINK_ACCENT_CROP: IconCrop = { left: 1407, top: 195, width: 261, height: 358 };
const PURPLE_ACCENT_CROP: IconCrop = { left: 1842, top: 198, width: 251, height: 348 };

// Same color pairing already used for each category's card background (see
// CATEGORY_CARD_COLOR below) — one accent mark color per category.
const CATEGORY_ACCENT_CROP: Record<TaskCategory, IconCrop> = {
  Study: BLUE_ACCENT_CROP,
  Exercise: GREEN_ACCENT_CROP,
  Clean: YELLOW_ACCENT_CROP,
  Health: PINK_ACCENT_CROP,
  Personal: PURPLE_ACCENT_CROP,
};

// Renders one icon from a given sprite sheet: the full sheet image is
// scaled up, then offset by the crop's own left/top so only that region
// lands inside a same-aspect-ratio, overflow-hidden frame — the same
// sprite-crop technique already used by PetStageIcon/TaskIcon elsewhere in
// the app.
function SpriteIcon({
  source,
  sheetWidth,
  sheetHeight,
  crop,
  size = 40,
}: {
  source: number;
  sheetWidth: number;
  sheetHeight: number;
  crop: IconCrop;
  size?: number;
}) {
  const scale = size / crop.width;
  return (
    <View style={{ width: size, height: crop.height * scale, overflow: 'hidden' }}>
      <Image
        source={source}
        contentFit="fill"
        style={{
          position: 'absolute',
          width: sheetWidth * scale,
          height: sheetHeight * scale,
          left: -crop.left * scale,
          top: -crop.top * scale,
        }}
      />
    </View>
  );
}

function StatsIcon({ crop, size = 40 }: { crop: IconCrop; size?: number }) {
  return (
    <SpriteIcon
      source={STATS_ICONS_SOURCE}
      sheetWidth={STATS_ICONS_WIDTH}
      sheetHeight={STATS_ICONS_HEIGHT}
      crop={crop}
      size={size}
    />
  );
}

function AccentMarkIcon({ crop, size = 20 }: { crop: IconCrop; size?: number }) {
  return (
    <SpriteIcon
      source={ACCENT_MARKS_SOURCE}
      sheetWidth={ACCENT_MARKS_WIDTH}
      sheetHeight={ACCENT_MARKS_HEIGHT}
      crop={crop}
      size={size}
    />
  );
}

// Custom fluffy-cloud card art for the Pet Progress card's inner area
// (behind the pet art + stage/level/progress/message content) — replaces
// the hand-built overlapping-circle cloud shapes previously used there.
const STATS_PET_CARD_BACKGROUND = require('@/assets/images/stats/stats_pet_background.png');

// This page gets its own (wider than the shared MaxContentWidth) cap so the
// Pet Progress / Lifetime Stats pair and the category panel have room to
// breathe, same reasoning the Rooms hub used for its own wider cap.
const STATS_MAX_WIDTH = 1000;

// One shared "is this a normal desktop/laptop window" threshold for both the
// Pet Progress / Lifetime Stats side-by-side split AND the category grid's
// column count. Deliberately kept well below typical screen widths (not
// just above phone/tablet) — a higher threshold here previously caused an
// ordinary, non-maximized desktop browser window to still read as "narrow".
const DESKTOP_MIN_WIDTH = 760;
const TABLET_MIN_WIDTH = 600;

function useCategoryColumnCount(): 1 | 2 | 3 {
  const { width } = useWindowDimensions();
  if (width >= DESKTOP_MIN_WIDTH) return 3;
  if (width >= TABLET_MIN_WIDTH) return 2;
  return 1;
}

const CATEGORY_CARD_WIDTH_PERCENT: Record<1 | 2 | 3, `${number}%`> = {
  1: '100%',
  2: '48%',
  3: '31%',
};

// A distinct soft pastel per category (blue/green/yellow/pink/purple), all
// pulled from the existing palette — nothing new, same "one token per item"
// pattern already used for the Rooms hub's task-count badges.
const CATEGORY_CARD_COLOR: Record<TaskCategory, ThemeColor> = {
  Study: 'sky',
  Exercise: 'mint',
  Clean: 'apricot',
  Health: 'backgroundElement', // blush pink
  Personal: 'backgroundSelected', // lavender
};

// Faint decorative glyphs scattered across the whole page — purely
// cosmetic, never inside a card.
const DECORATIONS: { glyph: string; top: Percent; left?: Percent; right?: Percent; size: number }[] = [
  { glyph: '🐾', top: '30%', left: '2%', size: 18 },
  { glyph: '☁️', top: '48%', right: '2%', size: 22 },
  { glyph: '💕', top: '66%', left: '2%', size: 20 },
  { glyph: '🐾', top: '88%', right: '3%', size: 20 },
];

export function StatsHubScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= DESKTOP_MIN_WIDTH;
  const columns = useCategoryColumnCount();
  const [tasks, setTasks] = useState<Task[]>([]);

  // Read-only, via the same shared in-memory task cache as useBirthdayMode
  // and the Rooms hub's task-count badges (see @/utils/task-storage) — this
  // screen never writes, so it can't disturb the real saved task data, and
  // it doesn't add a new independent AsyncStorage read.
  useEffect(() => {
    let cancelled = false;
    getCachedTasks()
      .then((cached) => {
        if (!cancelled) setTasks(cached);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Every number and the pet's own stage below are derived from the exact
  // same Task[] using the project's existing, unmodified helpers — no
  // separate tracking system, nothing hard-coded. getStageProgress computes
  // the identical stage/level/progress picture PetProgress already shows on
  // Home, just without that component's fixed layout, so this page can lay
  // it out differently while still being driven by the same pet-growth
  // math.
  const completedTaskCount = getCompletedTaskCount(tasks);
  const importantCompletedCount = getImportantCompletedCount(tasks);
  const categoryCounts = getCategoryCompletionCounts(tasks);
  const stageProgress = getStageProgress(completedTaskCount);

  // Explicit line break (rather than relying on text wrap) so the bubble
  // always reads as two centered lines — "3 more tasks" / "to reach
  // Hatchling!" — regardless of the bubble's rendered width.
  const nextStageMessage = stageProgress.isMaxStage
    ? 'Max stage reached! 🎉'
    : `${stageProgress.tasksUntilNextStage} more ${
        stageProgress.tasksUntilNextStage === 1 ? 'task' : 'tasks'
      }\nto reach ${stageProgress.nextStage}!`;

  return (
    // Transparent so the full-screen background rendered in src/app/_layout.tsx
    // (behind the now-transparent header too — see app-header.tsx's
    // isImmersiveRoute) shows through as one continuous image from the very
    // top of the screen, instead of this screen's own opaque cream fill
    // starting only below the header.
    <ThemedView style={styles.container}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {DECORATIONS.map((deco, index) => (
          <ThemedText
            key={index}
            style={[
              styles.decoration,
              { top: deco.top, left: deco.left, right: deco.right, fontSize: deco.size },
            ]}>
            {deco.glyph}
          </ThemedText>
        ))}
      </View>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.headingWrap}>
            <ThemedView type="backgroundElementOverlay" style={[styles.headingBanner, styles.shadow]}>
              <ThemedText style={styles.heading}>Your Progress</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.subheading}>
                Look how much you and your pet have accomplished together!
              </ThemedText>
            </ThemedView>
          </View>

          <View style={[styles.topRow, isWide && styles.topRowWide]}>
            {/* Pet Progress — two-tone pastel-blue card: a soft baby-blue
                outer card with the custom fluffy-cloud card art
                (stats_pet_background.png) behind the pet + info. */}
            <View style={[styles.column, isWide && styles.petColumnWide]}>
              <ThemedView type="skyOverlay" style={[styles.card, styles.petCard, styles.shadow]}>
                <ThemedText style={styles.petCardTitle}>Pet Progress</ThemedText>

                <View style={styles.cloudSection}>
                  <View style={StyleSheet.absoluteFill} pointerEvents="none">
                    <Image source={STATS_PET_CARD_BACKGROUND} style={StyleSheet.absoluteFill} contentFit="cover" />
                  </View>

                  <View style={[styles.petCardInner, isWide && styles.petCardInnerWide]}>
                    <View
                      style={[
                        styles.petArtForeground,
                        isWide && styles.petArtForegroundWide,
                        { aspectRatio: STATS_PET_IMAGES[stageProgress.stage].aspectRatio },
                      ]}>
                      <Image
                        source={STATS_PET_IMAGES[stageProgress.stage].source}
                        style={styles.petArtImage}
                        contentFit="contain"
                      />
                    </View>

                    <View style={[styles.petInfo, isWide && styles.petInfoWide]}>
                      <ThemedView type="purple" style={styles.stagePill}>
                        <ThemedText type="smallBold" style={styles.stagePillText}>
                          {stageProgress.stage}
                        </ThemedText>
                      </ThemedView>
                      <ThemedText type="smallBold" themeColor="textSecondary" style={styles.levelText}>
                        Level {stageProgress.level}
                      </ThemedText>

                      <View style={styles.progressGroup}>
                        <View
                          style={[
                            styles.progressTrack,
                            { backgroundColor: theme.backgroundSelected, borderColor: theme.purple },
                          ]}>
                          <View style={{ flex: stageProgress.progressPercent, backgroundColor: theme.accent }} />
                          <View style={{ flex: 100 - stageProgress.progressPercent }} />
                          <View style={styles.progressSheen} pointerEvents="none" />
                        </View>
                        <ThemedText type="small" themeColor="textSecondary" style={styles.progressTasksText}>
                          {stageProgress.tasksIntoStage} / {TASKS_PER_STAGE} tasks
                        </ThemedText>
                      </View>

                      <View
                        style={[
                          styles.messageBubble,
                          { backgroundColor: theme.background, borderColor: theme.apricot },
                        ]}>
                        <ThemedText type="smallBold" style={styles.messageBubbleText}>
                          {nextStageMessage}
                        </ThemedText>
                        <View style={styles.messageBubbleSprout}>
                          <StatsIcon crop={SPROUT_CROP} size={22} />
                        </View>
                      </View>
                    </View>
                  </View>
                </View>
              </ThemedView>
            </View>

            {/* Lifetime Stats — pastel-pink card. */}
            <View style={[styles.column, isWide && styles.statsColumnWide]}>
              <ThemedView type="backgroundElementOverlay" style={[styles.card, styles.shadow]}>
                <ThemedText style={styles.cardTitleLarge}>⭐ Lifetime Stats</ThemedText>

                <View style={styles.statPanel}>
                  <StatsIcon crop={CLIPBOARD_CROP} size={64} />
                  <View style={styles.statPanelText}>
                    <ThemedText style={[styles.statPanelNumber, { color: theme.mint }]}>
                      {completedTaskCount}
                    </ThemedText>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      Tasks Completed
                    </ThemedText>
                  </View>
                  <View style={styles.statPanelAccent}>
                    <AccentMarkIcon crop={YELLOW_ACCENT_CROP} size={18} />
                  </View>
                </View>

                <View style={styles.statPanel}>
                  <StatsIcon crop={STAR_CROP} size={64} />
                  <View style={styles.statPanelText}>
                    <ThemedText style={[styles.statPanelNumber, { color: theme.accent }]}>
                      {importantCompletedCount}
                    </ThemedText>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      Important Tasks Completed
                    </ThemedText>
                  </View>
                  <View style={styles.statPanelAccent}>
                    <AccentMarkIcon crop={PINK_ACCENT_CROP} size={18} />
                  </View>
                </View>
              </ThemedView>
            </View>
          </View>

          {/* Completed by Category — one large, near-white pale-pink panel. */}
          <View style={[styles.categoryPanel, styles.shadow]}>
            <View style={styles.categoryHeaderRow}>
              <ThemedText style={styles.cardTitleLarge}>📊 Completed by Category</ThemedText>
              <ThemedText type="small" themeColor="textSecondary" style={styles.categorySubtitleText}>
                See which areas you've been focusing on!
              </ThemedText>
            </View>

            <View style={styles.categoryGrid}>
              {ALL_CATEGORIES.map((category) => (
                <ThemedView
                  key={category}
                  type={CATEGORY_CARD_COLOR[category]}
                  style={[
                    styles.categoryCard,
                    styles.shadow,
                    { width: CATEGORY_CARD_WIDTH_PERCENT[columns] },
                  ]}>
                  <View style={styles.categorySparkle}>
                    <AccentMarkIcon crop={CATEGORY_ACCENT_CROP[category]} size={18} />
                  </View>
                  <StatsIcon crop={CATEGORY_ICON_CROP[category]} size={64} />
                  <ThemedText type="smallBold" style={styles.categoryName}>
                    {category}
                  </ThemedText>
                  <ThemedText style={styles.categoryNumber}>{categoryCounts[category]}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    completed tasks
                  </ThemedText>
                </ThemedView>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: STATS_MAX_WIDTH,
  },
  scrollContent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  headingWrap: {
    position: 'relative',
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
  },
  // Large rounded "game interface" banner — tall, generous padding, big
  // type, rather than a plain page heading.
  headingBanner: {
    borderRadius: 999,
    paddingVertical: Spacing.four,
    paddingHorizontal: Spacing.five,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  heading: {
    textAlign: 'center',
    fontSize: 40,
    lineHeight: 48,
    fontWeight: '800',
    marginBottom: Spacing.one,
  },
  subheading: {
    textAlign: 'center',
    fontSize: 16,
    lineHeight: 22,
  },
  // Subtle "lifted panel" shadow shared by every card on this page.
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  topRow: {
    gap: Spacing.three,
  },
  topRowWide: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  column: {
    width: '100%',
  },
  petColumnWide: {
    flex: 1.2,
  },
  statsColumnWide: {
    flex: 1,
  },
  card: {
    borderRadius: Spacing.five,
    padding: Spacing.four,
    gap: Spacing.two,
    height: '100%',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.75)',
  },
  cardTitleLarge: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    textAlign: 'left',
  },
  // Pet Progress's own outer card gets an extra-bright border on top of the
  // shared `card` border, per the reference.
  petCard: {
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  petCardTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
    textAlign: 'left',
    paddingHorizontal: Spacing.one,
    paddingTop: Spacing.half,
  },
  // Wraps the cloud-card background image + the actual pet/info content.
  // overflow:'hidden' clips the image to this section's own rounded edge;
  // the background image itself is wrapped in a pointerEvents="none" layer
  // so it can never intercept taps/clicks.
  cloudSection: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    marginTop: Spacing.two,
    flex: 1,
  },
  petCardInner: {
    alignItems: 'center',
    gap: Spacing.three,
  },
  petCardInnerWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.four,
  },
  // Narrow/stacked: pet art sized generously (not a small fixed box).
  petArtForeground: {
    width: '72%',
    maxWidth: 260,
  },
  // Wide: pet art and info split the row 50/50 — "pet occupies roughly the
  // left half of the card, information occupies the right half".
  petArtForegroundWide: {
    flex: 1,
    width: undefined,
    maxWidth: undefined,
  },
  petArtImage: {
    width: '100%',
    height: '100%',
  },
  petInfo: {
    width: '100%',
    alignItems: 'center',
    gap: Spacing.one,
  },
  petInfoWide: {
    flex: 1,
    alignItems: 'flex-start',
  },
  // Solid purple rounded "game badge" pill for the stage name — large,
  // bold, with its own small shadow.
  stagePill: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  stagePillText: {
    fontSize: 18,
    lineHeight: 22,
  },
  levelText: {
    fontSize: 16,
    lineHeight: 20,
  },
  // Wraps the bar + "X / 10 tasks" so both stay centered together,
  // regardless of whether petInfo itself is left- or center-aligned.
  progressGroup: {
    width: '100%',
    alignItems: 'center',
    marginTop: Spacing.half,
  },
  // Chibi/game-style capsule meter: thick, fully rounded ends, a visible
  // border, and a translucent "sheen" strip near the top for a glossy look.
  progressTrack: {
    flexDirection: 'row',
    width: '92%',
    height: 20,
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 2,
  },
  progressSheen: {
    position: 'absolute',
    top: 2,
    left: '8%',
    right: '8%',
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  progressTasksText: {
    textAlign: 'center',
    marginTop: Spacing.half,
    fontSize: 14,
  },
  // "X more tasks to reach [stage]!" in its own small bubble: pale cream
  // fill, dashed peach/golden border (borderStyle: 'dashed' renders actual
  // dash marks, not a solid line).
  messageBubble: {
    width: '100%',
    marginTop: Spacing.two,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingRight: Spacing.five,
  },
  messageBubbleText: {
    textAlign: 'center',
  },
  messageBubbleSprout: {
    position: 'absolute',
    bottom: Spacing.one,
    right: Spacing.one,
  },
  // Large stat panel — not a small list row.
  statPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    borderRadius: Spacing.four,
    padding: Spacing.three,
    position: 'relative',
  },
  statPanelText: {
    gap: 2,
    flex: 1,
  },
  statPanelNumber: {
    fontSize: 44,
    lineHeight: 50,
    fontWeight: '800',
  },
  statPanelAccent: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    opacity: 0.85,
  },
  categoryPanel: {
    width: '100%',
    borderRadius: Spacing.five,
    padding: Spacing.four,
    gap: Spacing.three,
    backgroundColor: 'rgba(255, 249, 251, 0.92)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  categoryHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  categorySubtitleText: {
    fontSize: 14,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  categoryCard: {
    borderRadius: Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    gap: Spacing.one,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  categorySparkle: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.two,
    opacity: 0.85,
  },
  categoryName: {
    fontSize: 17,
    lineHeight: 22,
  },
  categoryNumber: {
    fontSize: 38,
    lineHeight: 44,
    fontWeight: '800',
  },
  decoration: {
    position: 'absolute',
    opacity: 0.16,
  },
});
