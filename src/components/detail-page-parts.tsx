import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CompletedEntry, DayBucket } from '@/utils/category-accomplishments';

// Shared building blocks for the Stats section's detail pages — the
// per-category Accomplishments pages and the Lifetime Stats pages — so they
// all share one layout, chart, and list look instead of each keeping its own
// copy. Purely presentational: every number shown comes from the caller.

// Same width cap the Stats page itself uses, so a detail page reads as one
// more page of that section rather than a separate screen.
const PAGE_MAX_WIDTH = 1000;
const CHART_BAR_AREA_HEIGHT = 140;

// Page frame: transparent container (so the Stats background shows through),
// scrolling content, and the Back button (to Stats unless told otherwise —
// e.g. a Pet Album detail page goes back to the album).
export function DetailPageShell({
  children,
  backHref = '/stats',
  backLabel = '← Back to Stats',
}: {
  children: ReactNode;
  backHref?: Href;
  backLabel?: string;
}) {
  const router = useRouter();
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.page}>
            <Pressable
              onPress={() => router.replace(backHref)}
              accessibilityRole="button"
              accessibilityLabel={backLabel.replace('← ', '')}
              style={({ pressed }) => [styles.backButtonWrap, pressed && styles.pressed]}>
              <ThemedView type="backgroundElementOverlay" style={styles.backButton}>
                <ThemedText type="smallBold">{backLabel}</ThemedText>
              </ThemedView>
            </Pressable>
            {children}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

export function DetailTitleCard({
  icon,
  title,
  backgroundColor,
}: {
  icon: ReactNode;
  title: string;
  backgroundColor: string;
}) {
  return (
    <View style={[styles.titleCard, { backgroundColor }]}>
      {icon}
      <ThemedText style={styles.title}>{title}</ThemedText>
    </View>
  );
}

// A row of big-number cards.
export function SummaryRow({ children }: { children: ReactNode }) {
  return <View style={styles.summaryRow}>{children}</View>;
}

export function SummaryCard({
  value,
  label,
  backgroundColor,
}: {
  value: number;
  label: string;
  backgroundColor: string;
}) {
  return (
    <View style={[styles.summaryCard, { backgroundColor }]}>
      <ThemedText style={styles.summaryNumber}>{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.summaryLabel}>
        {label}
      </ThemedText>
    </View>
  );
}

export function DetailPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.panel}>
      <ThemedText type="smallBold" style={styles.panelTitle}>
        {title}
      </ThemedText>
      {children}
    </View>
  );
}

// Pastel bar chart: one bar per bucket (zero days included), whole-number
// vertical axis, weekday/date labels along the bottom. `labelEvery` thins
// out the bottom labels for long ranges so they don't overlap.
export function CompletedBarChart({
  buckets,
  color,
  labelEvery = 1,
}: {
  buckets: DayBucket[];
  color: string;
  labelEvery?: number;
}) {
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const showValues = buckets.length <= 10;
  return (
    <View style={styles.chartRow}>
      <View style={[styles.yAxis, { height: CHART_BAR_AREA_HEIGHT }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {maxCount}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          0
        </ThemedText>
      </View>
      <View style={[styles.bars, buckets.length > 10 && styles.barsDense]}>
        {buckets.map((bucket, index) => {
          const barHeight = (bucket.count / maxCount) * CHART_BAR_AREA_HEIGHT;
          return (
            <View key={bucket.dateISO} style={styles.barColumn}>
              <View style={[styles.barArea, { height: CHART_BAR_AREA_HEIGHT }]}>
                {showValues ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.barValue}>
                    {bucket.count}
                  </ThemedText>
                ) : null}
                <View
                  style={[
                    styles.bar,
                    { height: bucket.count > 0 ? Math.max(barHeight, 6) : 2, backgroundColor: color },
                    buckets.length > 10 && styles.barDense,
                  ]}
                />
              </View>
              <View style={styles.barLabelSlot}>
                {index % labelEvery === 0 ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.barLabel} numberOfLines={1}>
                    {bucket.weekdayLabel}
                  </ThemedText>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function DetailNote({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={styles.note}>
      {children}
    </ThemedText>
  );
}

function formatShortDate(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

// One completed task row. `showCategory` adds the task's category (used on
// the cross-category Lifetime pages).
export function CompletedEntryRow({ entry, showCategory = false }: { entry: CompletedEntry; showCategory?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.entryRow, { borderColor: theme.backgroundSelected }]}>
      <ThemedText style={styles.entryCheck}>✓</ThemedText>
      <View style={styles.entryTextWrap}>
        <ThemedText type="smallBold">
          {entry.text}
          {entry.important ? '  ⭐' : ''}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {showCategory ? `${entry.category} · ` : ''}
          {entry.dateISO ? formatShortDate(entry.dateISO) : 'Date not recorded'}
        </ThemedText>
      </View>
    </View>
  );
}

export function DetailEmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <ThemedText type="smallBold" style={styles.emptyTitle}>
        {title}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.emptyText}>
        {text}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    padding: Spacing.three,
    paddingBottom: Spacing.six,
  },
  page: {
    width: '100%',
    maxWidth: PAGE_MAX_WIDTH,
    gap: Spacing.three,
  },
  backButtonWrap: {
    alignSelf: 'flex-start',
  },
  backButton: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.five,
  },
  pressed: {
    opacity: 0.8,
  },
  titleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.five,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  title: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '800',
    flexShrink: 1,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
  },
  summaryCard: {
    flexGrow: 1,
    flexBasis: 200,
    alignItems: 'center',
    padding: Spacing.three,
    borderRadius: Spacing.four,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  summaryNumber: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: '800',
  },
  summaryLabel: {
    textAlign: 'center',
  },
  panel: {
    width: '100%',
    borderRadius: Spacing.five,
    padding: Spacing.four,
    gap: Spacing.two,
    backgroundColor: 'rgba(255, 249, 251, 0.92)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  panelTitle: {
    fontSize: 18,
    lineHeight: 24,
  },
  chartRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  yAxis: {
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 2,
    minWidth: 20,
  },
  bars: {
    flex: 1,
    flexDirection: 'row',
    gap: Spacing.one,
  },
  barsDense: {
    gap: 2,
  },
  barColumn: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.one,
  },
  barArea: {
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 2,
  },
  barValue: {
    fontSize: 12,
    lineHeight: 16,
  },
  bar: {
    width: '70%',
    maxWidth: 48,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  barDense: {
    width: '80%',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },
  // Fixed slot so a thinned-out label never shifts the bars above it.
  barLabelSlot: {
    height: 18,
    width: '100%',
    alignItems: 'center',
    overflow: 'visible',
  },
  barLabel: {
    fontSize: 11,
    lineHeight: 16,
    width: 40,
    textAlign: 'center',
  },
  note: {
    marginTop: Spacing.one,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  entryCheck: {
    fontSize: 18,
    fontWeight: '800',
  },
  entryTextWrap: {
    flex: 1,
    gap: 2,
  },
  emptyState: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.four,
  },
  emptyTitle: {
    fontSize: 17,
    lineHeight: 22,
  },
  emptyText: {
    textAlign: 'center',
  },
});
