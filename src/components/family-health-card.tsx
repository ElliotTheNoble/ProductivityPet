import { StyleSheet, View } from 'react-native';

import { Button, Card } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useT } from '@/i18n';
import { BADGE_LABEL, BADGE_LOOK, badgeFor } from '@/utils/family-picker-model';
import { healthHasWarnings, useFamilyHealth } from '@/utils/family-management';

// Family health: a card that appears ONLY when something needs a parent's attention (and never with family mode off). It only reports.
// Nothing here deletes, repairs, merges or re-links anything: orphan profiles and duplicate ids are shown as facts with the reassurance
// that nothing was changed, and the one button re-checks.
export function FamilyHealthCard() {
  const { t, tn } = useT();
  const { health, refresh, checked } = useFamilyHealth();
  if (!checked || !healthHasWarnings(health)) return null;
  return (
    <Card title={t('fmHealthTitle')}>
      <ThemedText type="small" themeColor="textSecondary">
        {t('fmHealthIntro')}
      </ThemedText>

      {health.storagePaused ? <Line text={t('fmHealthStoragePaused')} /> : null}
      {health.householdUnreadable ? <Line text={t('fmHealthHouseholdUnreadable')} /> : null}
      {health.duplicateChildIds.length > 0 ? <Line text={t('fmHealthDuplicate', { ids: health.duplicateChildIds.join(', ') })} /> : null}
      {health.unreadableEntries > 0 ? <Line text={tn('fmHealthUnreadableEntries', health.unreadableEntries)} /> : null}
      {health.invalidIds.length > 0 ? <Line text={tn('fmHealthInvalidIds', health.invalidIds.length)} /> : null}
      {health.unlinkedChildren.length > 0 ? <Line text={tn('fmHealthUnlinked', health.unlinkedChildren.length)} /> : null}
      {health.orphansWithData.length > 0 ? <Line text={tn('fmHealthOrphanData', health.orphansWithData.length)} /> : null}
      {health.orphansEmpty.length > 0 ? <Line text={tn('fmHealthOrphanEmpty', health.orphansEmpty.length)} /> : null}

      {health.needsCare.length > 0 || health.unreadablePets.length > 0 ? (
        <View style={styles.group}>
          <ThemedText type="smallBold">{t('fmHealthCareTitle')}</ThemedText>
          {health.needsCare.map((c) => {
            const kind = badgeFor(c.summary);
            const status = t(BADGE_LABEL[kind]);
            return (
              <View key={c.id} style={[styles.careRow, { backgroundColor: BADGE_LOOK[kind].fill, borderColor: BADGE_LOOK[kind].edge }]}>
                <ThemedText style={styles.icon} accessibilityElementsHidden importantForAccessibility="no">
                  {BADGE_LOOK[kind].icon}
                </ThemedText>
                <ThemedText type="small" style={styles.careText}>
                  {c.archived ? t('fmHealthCareArchived', { name: c.nickname, status }) : t('fmHealthCareActive', { name: c.nickname, status })}
                </ThemedText>
              </View>
            );
          })}
          {health.unreadablePets.map((c) => (
            <Line key={c.id} text={t('fmHealthPetsUnreadable', { name: c.nickname })} />
          ))}
        </View>
      ) : null}

      <View style={styles.row}>
        <Button tone="soft" label={t('fmHealthRefresh')} onPress={refresh} />
      </View>
    </Card>
  );
}

function Line({ text }: { text: string }) {
  return (
    <View style={styles.line}>
      <ThemedText type="small">{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  group: { gap: Spacing.two },
  line: { backgroundColor: '#FFF4E3', borderColor: '#F0B86E', borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.two },
  careRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderWidth: 2, borderRadius: Spacing.three, padding: Spacing.two },
  icon: { fontSize: 18, lineHeight: 24 },
  careText: { flex: 1, minWidth: 0 },
});
