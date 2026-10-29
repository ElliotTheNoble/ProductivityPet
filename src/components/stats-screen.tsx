import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PawTokenCoin } from '@/components/paw-token-coin';
import { ResurrectControl } from '@/components/resurrect-control';
import { getPetLabel, getSelectedPet } from '@/utils/pet-family';
import { usePetFamily, useSelectedPetId } from '@/hooks/use-pet-family';
import { PetAvatar } from '@/components/pet-avatar';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { TaskCategory } from '@/utils/categorize-task';
import { categoryToSlug, type LifetimeStat } from '@/utils/category-accomplishments';
import { getDevPreviewStageIndex, subscribeToDevPreviewStageIndex } from '@/utils/dev-stage-preview';
import { getStreakSummary } from '@/utils/streaks';
import { getTokenHistory, subscribeToTokenHistory, sumTokens } from '@/utils/token-history';
import { getEquippedAccessories, type EquippedAccessories } from '@/utils/pet-equipment';
import { getRenderedStage, getRenderedStageProgress } from '@/utils/pet-growth';
import { getPetProfile, subscribeToPetProfile, type PetProfile } from '@/utils/pet-profile';
import { PET_STAGES, TASKS_PER_STAGE } from '@/utils/pet-stage';
import { ALL_CATEGORIES, getCategoryCompletionCounts, getImportantCompletedCount } from '@/utils/stats';
import { getCachedTasks } from '@/utils/task-storage';
import { getCompletedTaskCount, type Task } from '@/utils/tasks';

type Percent = `${number}%`;

// The pet shown in the Pet Progress card is now the SAME kitty Home and the
// Shop draw (PetAvatar — shared body art plus the equipped hat/bow, see
// @/components/pet-avatar.tsx), at this fraction of the art slot's width.
// Less than 1 so a Young-stage kitty (rendered slightly larger than her box,
// same as on Home) and any accessory near her edge still fit inside the card.
const STATS_PET_SIZE_FRACTION = 0.85;
// How far (in px) the whole kitty — body AND any equipped hat/bow together —
// is nudged down inside the Pet Progress card. One value for every growth
// stage; applied as a transform so it never changes the card's or the art
// slot's layout size, and the accessories (children of PetAvatar) can't drift
// from the body.
const STATS_PET_OFFSET_Y = 20;

// Every icon below is cropped from the user's custom icon sheet rather than
// emoji/generic icons. stats_Icons.png is 1570x1002px; every crop box here
// was measured directly from the file's own alpha channel (bounding boxes
// of each icon's actual non-transparent pixels), not guessed.
const STATS_ICONS_SOURCE = require('@/assets/images/task_icons/stats_Icons.png');
const STATS_ICONS_WIDTH = 1570;
const STATS_ICONS_HEIGHT = 1002;

export type IconCrop = { left: number; top: number; width: number; height: number };
export const CLIPBOARD_CROP: IconCrop = { left: 670, top: 47, width: 338, height: 344 };
export const STAR_CROP: IconCrop = { left: 1009, top: 81, width: 378, height: 312 };
const BOOKS_CROP: IconCrop = { left: 172, top: 400, width: 411, height: 280 };
const SHOE_CROP: IconCrop = { left: 623, top: 433, width: 417, height: 259 };
const BROOM_CROP: IconCrop = { left: 1056, top: 393, width: 396, height: 306 };
const HEART_CROP: IconCrop = { left: 73, top: 707, width: 374, height: 256 };
const PERSON_CROP: IconCrop = { left: 458, top: 743, width: 320, height: 231 };
const SPROUT_CROP: IconCrop = { left: 1212, top: 706, width: 292, height: 260 };

export const CATEGORY_ICON_CROP: Record<TaskCategory, IconCrop> = {
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
export const CATEGORY_ACCENT_CROP: Record<TaskCategory, IconCrop> = {
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

export function StatsIcon({ crop, size = 40 }: { crop: IconCrop; size?: number }) {
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

export function AccentMarkIcon({ crop, size = 20 }: { crop: IconCrop; size?: number }) {
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

const REFLECT_LINKS = [
  {
    id: 'mood' as const,
    href: '/stats/mood' as const,
    emoji: '🌈',
    title: 'My Mood Journey',
    description: 'Look back at your mood check-ins and daily reflections.',
    background: '#EFE9FA',
  },
  {
    id: 'review' as const,
    href: '/stats/review' as const,
    emoji: '🎉',
    title: 'My Year in Review',
    description: 'A personal recap of your year, from what you recorded.',
    background: '#FBF3DC',
  },
];

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

// Very light, creamy pastel tint per category — deliberately much lighter
// than the existing sky/mint/apricot/backgroundElement/backgroundSelected
// theme tokens (which read as solid/saturated next to this card's soft
// style), so these are their own local hex values rather than reusing a
// theme token.
export const CATEGORY_CARD_BACKGROUND: Record<TaskCategory, string> = {
  Study: '#E8F4FB', // very light baby blue
  Exercise: '#E6F7EF', // very light mint green
  Clean: '#FBF3DC', // very light creamy yellow
  Health: '#FCEEF1', // very light blush pink
  Personal: '#EFE9FA', // very light lavender
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
  const router = useRouter();
  // Desktop-only hover state (touch never fires onHoverIn) — which single
  // category card, if any, the mouse is over. Same pattern as the Rooms
  // hub's hoveredRoom (see room-hub-screen.tsx).
  const [hoveredCategory, setHoveredCategory] = useState<TaskCategory | null>(null);
  // Same idea for the two Lifetime Stats cards.
  const [hoveredReflect, setHoveredReflect] = useState<'mood' | 'review' | null>(null);
  const [hoveredLifetimeStat, setHoveredLifetimeStat] = useState<LifetimeStat | 'pets' | 'tokens' | 'streak' | null>(null);
  function openLifetimeStat(stat: LifetimeStat) {
    router.push({ pathname: '/stats/lifetime/[stat]', params: { stat } });
  }
  const [tasks, setTasks] = useState<Task[]>([]);
  const [petProfile, setPetProfile] = useState<PetProfile | null>(null);
  // The selected pet if it has passed away: a permanent memorial + Resurrect stays here in Stats.
  const familyForMemorial = usePetFamily();
  const selectedForMemorial = familyForMemorial ? getSelectedPet(familyForMemorial) : null;
  const memorialPet = selectedForMemorial && selectedForMemorial.lifecycle.state === 'deceased' ? selectedForMemorial : null;

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

  // Read-only, via the shared in-memory Pet Profile cache (see
  // @/utils/pet-profile.ts) — only used here to know paidStageIndex, so
  // the pet art below reflects an actual paid Young/Adult growth upgrade
  // (see @/utils/pet-growth.ts) instead of jumping ahead based on task
  // count alone.
  useEffect(() => {
    let cancelled = false;
    getPetProfile()
      .then((profile) => {
        if (!cancelled) setPetProfile(profile);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Same live subscription Home uses, so a profile save made while this
  // page is open (e.g. a growth upgrade) shows up right away instead of
  // only after the next visit.
  useEffect(() => subscribeToPetProfile(setPetProfile), []);

  // The Pet Stage Preview override (see @/utils/dev-stage-preview.ts) —
  // the very same shared value Home, every Room and the Shop read, so the
  // kitty here is always the one shown everywhere else. Display-only: it
  // never touches the progression numbers below.
  const [devPreviewStageIndex, setDevPreviewStageIndexState] = useState<number | null>(() =>
    getDevPreviewStageIndex()
  );
  useEffect(() => subscribeToDevPreviewStageIndex(setDevPreviewStageIndexState), []);

  // The equipped hat and bow, from the same persisted record Home and the
  // Shop read (see @/utils/pet-equipment.ts). Loaded on mount, like Home —
  // Stats remounts on every navigation, so an equip change made in the Shop
  // is picked up when the player comes back here.
  const [equipped, setEquipped] = useState<EquippedAccessories>({ hat: null, bow: null });
  const selectedPetId = useSelectedPetId();
  useEffect(() => {
    let cancelled = false;
    getEquippedAccessories()
      .then((loaded) => {
        if (!cancelled) setEquipped(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedPetId]);

  // Measured width of the pet art slot, so the shared PetAvatar (which takes
  // a pixel size) can fill it.
  const [petSlotWidth, setPetSlotWidth] = useState(0);

  // How many kitties are in the Pet Album: every pet in the family, living or
  // passed away (see @/utils/pet-album.ts).
  const family = usePetFamily();
  const petAlbumCount = family?.pets.length ?? 0;

  // Paw Tokens EARNED (recorded since tracking began — see
  // @/utils/token-history.ts); separate from the current balance.
  const [tokensEarned, setTokensEarned] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getTokenHistory()
      .then((history) => !cancelled && setTokensEarned(sumTokens(history.events)))
      .catch(() => {});
    const off = subscribeToTokenHistory((history) => setTokensEarned(sumTokens(history.events)));
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  // Every number and the pet's own stage below are derived from the exact
  // same Task[] using the project's existing, unmodified helpers — no
  // separate tracking system, nothing hard-coded. getRenderedStageProgress
  // computes the identical stage/level/progress picture PetProgress already
  // shows on Home, just without that component's fixed layout, so this page
  // can lay it out differently while still being driven by the same
  // pet-growth math.
  const completedTaskCount = getCompletedTaskCount(tasks);
  const importantCompletedCount = getImportantCompletedCount(tasks);
  const categoryCounts = getCategoryCompletionCounts(tasks);
  // Floored at paidStageIndex (see @/utils/pet-growth.ts and bugs.md's
  // BUG-004) so the level/progress-bar/"X more tasks" message below can
  // never disagree with renderedStage (the pet art + stage label) about
  // which stage the pet is actually on.
  // Growth is the SELECTED pet's own credit (shared between living pets), not
  // the lifetime task total shown in the Lifetime Stats card below.
  const growthCount =
    petProfile?.growthCredit !== undefined ? Math.floor(petProfile.growthCredit) : completedTaskCount;
  const stageProgress = getRenderedStageProgress(growthCount, petProfile?.paidStageIndex ?? 0);
  // The pet's ACTUAL rendered stage (art + stage label below) — stays in
  // sync with Home's own petStage: Egg/Hatchling/Baby still derive live
  // from completedTaskCount, but Young/Adult only show once paid for via
  // growPet() (see @/utils/pet-growth.ts), never from task count alone.
  const realStage = getRenderedStage(growthCount, petProfile?.paidStageIndex ?? 0);
  const memorialStage = realStage;
  // What the kitty (and the stage pill beside her) actually shows: the same
  // `preview ?? real stage` rule Home and the Shop use for their displayedStage.
  // Level and the progress bar below always stay on the real progression.
  const renderedStage = devPreviewStageIndex !== null ? PET_STAGES[devPreviewStageIndex] : realStage;
  // Same "no accessories on an Egg" rule as Home and the Shop.
  const statsAccessoryIds = renderedStage === 'Egg' ? [] : [equipped.bow, equipped.hat];

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

          {memorialPet ? (
            <ThemedView type="backgroundElementOverlay" style={styles.memorialCard}>
              <PetAvatar stage={memorialStage} size={96} healthState="deceased" />
              <View style={styles.memorialText}>
                <ThemedText type="smallBold">{familyForMemorial ? getPetLabel(memorialPet, familyForMemorial.pets) : 'Your kitty'} — resting in memory</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  Their memories will always be in your Pet Album. You can bring them back whenever you are ready.
                </ThemedText>
                <ResurrectControl petId={memorialPet.id} />
              </View>
            </ThemedView>
          ) : null}

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
                        { aspectRatio: 1 },
                      ]}
                      onLayout={(event) => setPetSlotWidth(event.nativeEvent.layout.width)}>
                      {/* Same kitty as Home and the Shop (body art + equipped
                          hat/bow); the body and accessories are scaled
                          together by PetAvatar's single size, so they stay
                          aligned at any size. */}
                      <View style={styles.petArtImage}>
                        {petSlotWidth > 0 ? (
                          <View style={[styles.petAvatarCenter, { transform: [{ translateY: STATS_PET_OFFSET_Y }] }]}>
                            <PetAvatar
                              stage={renderedStage}
                              equippedAccessoryIds={statsAccessoryIds}
                              healthState={petProfile?.lifeState}
                              size={petSlotWidth * STATS_PET_SIZE_FRACTION}
                            />
                          </View>
                        ) : null}
                      </View>
                    </View>

                    <View style={[styles.petInfo, isWide && styles.petInfoWide]}>
                      <ThemedView type="purple" style={styles.stagePill}>
                        <ThemedText type="smallBold" style={styles.stagePillText}>
                          {renderedStage}
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

                {/* Each Lifetime Stats card is fully clickable and opens its
                    own detail page; hover/press feedback matches the
                    category cards below. */}
                <Pressable
                  onPress={() => openLifetimeStat('tasks')}
                  onHoverIn={() => setHoveredLifetimeStat('tasks')}
                  onHoverOut={() => setHoveredLifetimeStat(null)}
                  accessibilityRole="button"
                  accessibilityLabel="View task completion history"
                  style={({ pressed }) => [
                    styles.statPanel,
                    styles.statPanelInteractive,
                    hoveredLifetimeStat === 'tasks' && [styles.categoryCardHovered, { borderColor: theme.accent }],
                    pressed && styles.categoryCardPressed,
                  ]}>
                  <StatsIcon crop={CLIPBOARD_CROP} size={64} />
                  <View style={styles.statPanelText}>
                    <ThemedText style={[styles.statPanelNumber, { color: theme.mint }]}>
                      {completedTaskCount}
                    </ThemedText>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      Tasks Completed
                    </ThemedText>
                  </View>
                  <AccentMarkIcon crop={YELLOW_ACCENT_CROP} size={32} />
                </Pressable>

                <Pressable
                  onPress={() => openLifetimeStat('important')}
                  onHoverIn={() => setHoveredLifetimeStat('important')}
                  onHoverOut={() => setHoveredLifetimeStat(null)}
                  accessibilityRole="button"
                  accessibilityLabel="View important task history"
                  style={({ pressed }) => [
                    styles.statPanel,
                    styles.statPanelInteractive,
                    hoveredLifetimeStat === 'important' && [styles.categoryCardHovered, { borderColor: theme.accent }],
                    pressed && styles.categoryCardPressed,
                  ]}>
                  <StatsIcon crop={STAR_CROP} size={64} />
                  <View style={styles.statPanelText}>
                    <ThemedText style={[styles.statPanelNumber, { color: theme.accent }]}>
                      {importantCompletedCount}
                    </ThemedText>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      Important Tasks Completed
                    </ThemedText>
                  </View>
                  <AccentMarkIcon crop={PINK_ACCENT_CROP} size={32} />
                </Pressable>

                {/* Pet Album — a look back at every kitty raised. */}
                <Pressable
                  onPress={() => router.push('/stats/lifetime/pets')}
                  onHoverIn={() => setHoveredLifetimeStat('pets')}
                  onHoverOut={() => setHoveredLifetimeStat(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Open Pet Album"
                  style={({ pressed }) => [
                    styles.statPanel,
                    styles.statPanelInteractive,
                    hoveredLifetimeStat === 'pets' && [styles.categoryCardHovered, { borderColor: theme.accent }],
                    pressed && styles.categoryCardPressed,
                  ]}>
                  <StatsIcon crop={HEART_CROP} size={64} />
                  <View style={styles.statPanelText}>
                    <ThemedText style={[styles.statPanelNumber, { color: theme.purple }]}>{petAlbumCount}</ThemedText>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      {petAlbumCount === 1 ? 'Pet in Your Album' : 'Pets in Your Album'}
                    </ThemedText>
                  </View>
                  <AccentMarkIcon crop={PURPLE_ACCENT_CROP} size={32} />
                </Pressable>

                {/* Tokens Earned — lifetime earnings (not the balance). */}
                <Pressable
                  onPress={() => router.push('/stats/lifetime/tokens')}
                  onHoverIn={() => setHoveredLifetimeStat('tokens')}
                  onHoverOut={() => setHoveredLifetimeStat(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Open token earnings history"
                  style={({ pressed }) => [
                    styles.statPanel,
                    styles.statPanelInteractive,
                    hoveredLifetimeStat === 'tokens' && [styles.categoryCardHovered, { borderColor: theme.accent }],
                    pressed && styles.categoryCardPressed,
                  ]}>
                  <View style={styles.statCoinSlot}>
                    <PawTokenCoin size={56} />
                  </View>
                  <View style={styles.statPanelText}>
                    <ThemedText style={[styles.statPanelNumber, { color: theme.apricot }]}>{tokensEarned}</ThemedText>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      Paw Tokens Earned
                    </ThemedText>
                  </View>
                  <AccentMarkIcon crop={YELLOW_ACCENT_CROP} size={32} />
                </Pressable>

                {/* Day Streak — current streak of days with a completed task. */}
                <Pressable
                  onPress={() => router.push('/stats/lifetime/streak')}
                  onHoverIn={() => setHoveredLifetimeStat('streak')}
                  onHoverOut={() => setHoveredLifetimeStat(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Open streak history"
                  style={({ pressed }) => [
                    styles.statPanel,
                    styles.statPanelInteractive,
                    hoveredLifetimeStat === 'streak' && [styles.categoryCardHovered, { borderColor: theme.accent }],
                    pressed && styles.categoryCardPressed,
                  ]}>
                  <View style={styles.statCoinSlot}>
                    <ThemedText style={styles.statEmoji}>🔥</ThemedText>
                  </View>
                  <View style={styles.statPanelText}>
                    <ThemedText style={[styles.statPanelNumber, { color: theme.mint }]}>
                      {getStreakSummary(tasks).current}
                    </ThemedText>
                    <ThemedText type="smallBold" themeColor="textSecondary">
                      Day Streak
                    </ThemedText>
                  </View>
                  <AccentMarkIcon crop={GREEN_ACCENT_CROP} size={32} />
                </Pressable>
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
                // The whole card is the tap target (not just its text) and
                // opens that category's Accomplishments page. Hover reuses
                // the Rooms cards' gentle lift + accent border; touch/click
                // gets pressed feedback (hover never fires on touch).
                <Pressable
                  key={category}
                  onPress={() =>
                    router.push({ pathname: '/stats/[category]', params: { category: categoryToSlug(category) } })
                  }
                  onHoverIn={() => setHoveredCategory(category)}
                  onHoverOut={() => setHoveredCategory(null)}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${category} accomplishments`}
                  style={({ pressed }) => [
                    styles.categoryCard,
                    styles.categoryCardInteractive,
                    styles.shadow,
                    { width: CATEGORY_CARD_WIDTH_PERCENT[columns], backgroundColor: CATEGORY_CARD_BACKGROUND[category] },
                    hoveredCategory === category && [styles.categoryCardHovered, { borderColor: theme.accent }],
                    pressed && styles.categoryCardPressed,
                  ]}>
                  <StatsIcon crop={CATEGORY_ICON_CROP[category]} size={64} />
                  <ThemedText type="smallBold" style={styles.categoryName}>
                    {category}
                  </ThemedText>
                  <View style={styles.categoryNumberRow}>
                    <ThemedText style={styles.categoryNumber}>{categoryCounts[category]}</ThemedText>
                    <AccentMarkIcon crop={CATEGORY_ACCENT_CROP[category]} size={26} />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    completed tasks
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Reflect — the Mood Journey and Year in Review pages. Same hover /
              press behavior as the category cards above. */}
          <View style={[styles.categoryPanel, styles.shadow]}>
            <ThemedText style={styles.cardTitleLarge}>💭 Reflect</ThemedText>
            <View style={styles.categoryGrid}>
              {REFLECT_LINKS.map((link) => (
                <Pressable
                  key={link.id}
                  onPress={() => router.push(link.href)}
                  onHoverIn={() => setHoveredReflect(link.id)}
                  onHoverOut={() => setHoveredReflect(null)}
                  accessibilityRole="button"
                  accessibilityLabel={link.title}
                  style={({ pressed }) => [
                    styles.categoryCard,
                    styles.categoryCardInteractive,
                    styles.shadow,
                    { width: CATEGORY_CARD_WIDTH_PERCENT[columns === 3 ? 2 : columns], backgroundColor: link.background },
                    hoveredReflect === link.id && [styles.categoryCardHovered, { borderColor: theme.accent }],
                    pressed && styles.categoryCardPressed,
                  ]}>
                  <ThemedText style={styles.reflectEmoji}>{link.emoji}</ThemedText>
                  <ThemedText type="smallBold" style={styles.categoryName}>
                    {link.title}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary" style={styles.reflectText}>
                    {link.description}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  memorialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.four,
    marginBottom: Spacing.three,
  },
  memorialText: { flex: 1, flexBasis: 220, gap: Spacing.one + 2 },
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
  petAvatarCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  // Interactive Lifetime Stats cards: a transparent 2px border (so the hover
  // accent border doesn't shift the layout — padding is reduced by the same
  // 2px), pointer cursor, and the same smooth transition as the category cards.
  statPanelInteractive: {
    borderWidth: 2,
    borderColor: 'transparent',
    padding: Spacing.three - 2,
    cursor: 'pointer',
    transitionProperty: 'transform, border-color, box-shadow',
    transitionDuration: '160ms',
  },
  statCoinSlot: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statEmoji: {
    fontSize: 44,
    lineHeight: 52,
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
  // Smooth hover/press transition (web; ignored where unsupported) and a
  // pointer cursor on web.
  categoryCardInteractive: {
    cursor: 'pointer',
    transitionProperty: 'transform, border-color, box-shadow',
    transitionDuration: '160ms',
  },
  // Same gentle lift the Rooms cards use on hover.
  categoryCardHovered: {
    transform: [{ scale: 1.03 }, { translateY: -3 }],
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  categoryCardPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
  reflectEmoji: {
    fontSize: 44,
    lineHeight: 52,
  },
  reflectText: {
    textAlign: 'center',
  },
  categoryName: {
    fontSize: 17,
    lineHeight: 22,
  },
  // Groups the big number with its accent mark so the mark sits directly
  // beside the stat instead of floating in the card's corner.
  categoryNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
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
