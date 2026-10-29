import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// A pastel pie chart with a legend. The project has no SVG library, so the
// disc is a fan of thin colored "spokes" (plain Views rotated about the
// disc's center) clipped to a circle — the same Views-only approach as the
// bar charts, so it renders identically on web and Android. Each slice's
// angle is exactly proportional to its value; slices with value 0 are skipped.

export type PieSlice = { key: string; label: string; value: number; color: string };

const SPOKE_COUNT = 180;

export function PieChart({ slices, size = 170 }: { slices: PieSlice[]; size?: number }) {
  const visible = slices.filter((slice) => slice.value > 0);
  const total = visible.reduce((sum, slice) => sum + slice.value, 0);
  if (total === 0) return null;

  const radius = size / 2;
  // Slightly thicker than the arc each spoke covers, so neighbors overlap
  // and no gaps show.
  const thickness = (2 * Math.PI * radius) / SPOKE_COUNT + 1.5;

  const spokes = [];
  for (let i = 0; i < SPOKE_COUNT; i += 1) {
    const fraction = (i + 0.5) / SPOKE_COUNT;
    let cumulative = 0;
    let color = visible[visible.length - 1].color;
    for (const slice of visible) {
      cumulative += slice.value / total;
      if (fraction <= cumulative) {
        color = slice.color;
        break;
      }
    }
    // Start at 12 o'clock, then sweep clockwise.
    const degrees = fraction * 360 - 90;
    spokes.push(
      <View
        key={i}
        style={{
          position: 'absolute',
          left: radius,
          top: radius - thickness / 2,
          width: radius,
          height: thickness,
          backgroundColor: color,
          transformOrigin: '0% 50%',
          transform: [{ rotate: `${degrees}deg` }],
        }}
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <View
        accessibilityRole="image"
        accessibilityLabel={visible.map((s) => `${s.label} ${s.value}`).join(', ')}
        style={[styles.disc, { width: size, height: size, borderRadius: radius }]}>
        {spokes}
      </View>
      <View style={styles.legend}>
        {visible.map((slice) => (
          <View key={slice.key} style={styles.legendRow}>
            <View style={[styles.swatch, { backgroundColor: slice.color }]} />
            <ThemedText type="small" style={styles.legendLabel}>
              {slice.label}
            </ThemedText>
            <ThemedText type="smallBold">
              {slice.value} · {Math.round((slice.value / total) * 100)}%
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  disc: {
    overflow: 'hidden',
    position: 'relative',
  },
  legend: {
    gap: Spacing.one,
    minWidth: 160,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  swatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  legendLabel: {
    flex: 1,
  },
});
