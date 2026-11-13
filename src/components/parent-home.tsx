import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChildAccomplishmentsSection, ChildActivitySection, ChildTasksSection } from '@/components/child-activity-sections';
import { ChildJournalSection, SharedEntryScreen } from '@/components/child-journal-section';
import { Button, Card, PageShell } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { hoverLift } from '@/constants/hover';
import { Spacing } from '@/constants/theme';
import { useT, type StringKey } from '@/i18n';
import { readChildActivity, type ChildActivityResult } from '@/utils/child-activity';
import {
  readChildOverview,
  readDashboardChildren,
  type ChildOverview,
  type DashboardChild,
  type OverviewPetState,
} from '@/utils/child-overview';
import { avatarFor } from '@/utils/family-picker-model';
import { useHousehold } from '@/utils/household';
import { useFreshHousehold } from '@/hooks/use-fresh-household';

// The Parent Dashboard: what Main shows in family mode (see @/components/parent-shell.tsx). It lists the ACTIVE children (real profiles,
// nothing hardcoded), opens a read-only overview of one child, and links to Family Settings (the existing /parent screen, where children
// are added, renamed and archived). It sits behind the Parent Gate like every parent-only screen (see src/app/dashboard.tsx).
//
// LOOK ONLY: nothing on this page or in the overview writes anything, switches profile or opens a child's game. All it reads comes from
// @/utils/child-overview.ts (who the children are and how their pets are doing). It never reads a journal, a task list or a purchase.

const STATE_TEXT: Record<OverviewPetState, StringKey> = {
  healthy: 'phStateHealthy',
  'needs-care': 'phStateNeedsCare',
  sick: 'phStateSick',
  critical: 'phStateCritical',
  deceased: 'phStateDeceased',
  pawadise: 'phStatePawadise',
};

// The most worrying state first.
const WORST_FIRST: OverviewPetState[] = ['critical', 'sick', 'deceased', 'needs-care', 'healthy', 'pawadise'];
const STATE_DOT: Record<OverviewPetState, string> = {
  healthy: '#7FD9B6',
  'needs-care': '#F6C99A',
  sick: '#F6B7B7',
  critical: '#EE7AA0',
  deceased: '#B9AFC4',
  pawadise: '#A9D6E8',
};

function worstState(overview: Extract<ChildOverview, { status: 'ok' }>): OverviewPetState | null {
  for (const state of WORST_FIRST) if (overview.pets.some((p) => p.state === state)) return state;
  return null;
}

type ListState = { kind: 'loading' } | { kind: 'ok'; children: DashboardChild[] } | { kind: 'not-allowed' } | { kind: 'unreadable' };

export function ParentHome() {
  const { t } = useT();
  useFreshHousehold();
  const router = useRouter();
  const household = useHousehold();
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [summaries, setSummaries] = useState<Record<string, ChildOverview>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reloads whenever the household changes (a child archived or added in Family Settings).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await readDashboardChildren();
      if (cancelled || !mounted.current) return;
      if (result.status !== 'ok') {
        setList({ kind: result.status });
        return;
      }
      setList({ kind: 'ok', children: result.children });
      const entries = await Promise.all(result.children.map(async (c) => [c.id, await readChildOverview(c.id)] as const));
      if (cancelled || !mounted.current) return;
      setSummaries(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [household]);

  const back = useCallback(() => setSelected(null), []);

  const chosen = list.kind === 'ok' && selected ? list.children.find((c) => c.id === selected) : undefined;
  if (chosen) return <ChildOverviewView child={chosen} onBack={back} />;

  return (
    <PageShell maxWidth={820}>
      <View style={styles.header}>
        <View style={styles.headerBadge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="parent-header-icon">
          <Ionicons name="shield-checkmark" size={34} color="#7B5CC4" />
        </View>
        <ThemedText type="subtitle" accessibilityRole="header" style={styles.center}>
          {t('phTitle')}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {t('phSubtitle')}
        </ThemedText>
      </View>

      <Card title={t('phChildren')}>
        {list.kind === 'loading' ? <ThemedText type="small">{t('phLoading')}</ThemedText> : null}
        {list.kind === 'not-allowed' ? <ThemedText type="small">{t('phNotAllowed')}</ThemedText> : null}
        {list.kind === 'unreadable' ? <ThemedText type="small">{t('phUnreadable')}</ThemedText> : null}
        {list.kind === 'ok' && list.children.length === 0 ? <ThemedText type="small">{t('phNoChildren')}</ThemedText> : null}
        {list.kind === 'ok'
          ? list.children.map((child) => <ChildCard key={child.id} child={child} summary={summaries[child.id]} onOpen={() => setSelected(child.id)} />)
          : null}
      </Card>

      <Card title={t('phSettings')} color="#FFF4E3">
        <Button tone="mint" label={t('phSettingsOpen')} onPress={() => router.push('/parent')} />
      </Card>
    </PageShell>
  );
}

function useSummaryText(summary: ChildOverview | undefined): string {
  const { t, tn } = useT();
  if (!summary) return t('phLoading');
  if (summary.status === 'not-started') return t('phNotStarted');
  if (summary.status !== 'ok') return t('phPetsUnreadable');
  const worst = worstState(summary);
  const count = tn('phPets', summary.pets.length);
  return worst ? `${count} · ${t(STATE_TEXT[worst])}` : count;
}

function ChildCard({ child, summary, onOpen }: { child: DashboardChild; summary: ChildOverview | undefined; onOpen: () => void }) {
  const { t } = useT();
  const avatar = avatarFor(child.id);
  const text = useSummaryText(summary);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t('phOpenChild', { name: child.nickname })}
      style={(state) => [styles.childCard, state.pressed && styles.pressed, hoverLift(state, true)]}>
      <View style={[styles.avatar, { backgroundColor: avatar.fill }]}>
        <ThemedText style={styles.avatarEmoji}>{avatar.emoji}</ThemedText>
      </View>
      <View style={styles.childText}>
        <ThemedText type="smallBold" numberOfLines={1} style={styles.childName}>
          {child.nickname}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {text}
        </ThemedText>
      </View>
      <ThemedText style={styles.chevron}>›</ThemedText>
    </Pressable>
  );
}

// The read-only overview of one child. Reads fresh each time it opens.
function ChildOverviewView({ child, onBack }: { child: DashboardChild; onBack: () => void }) {
  const { t } = useT();
  const [overview, setOverview] = useState<ChildOverview | null>(null);
  const [activity, setActivity] = useState<ChildActivityResult | null>(null);
  // The shared journal entry being read (a page of its own); nothing is kept once it is closed.
  const [entryId, setEntryId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void readChildOverview(child.id).then((result) => {
      if (!cancelled) setOverview(result);
    });
    void readChildActivity(child.id).then((result) => {
      if (!cancelled) setActivity(result);
    });
    return () => {
      cancelled = true;
    };
  }, [child.id]);
  const avatar = avatarFor(child.id);

  if (entryId !== null) return <SharedEntryScreen childId={child.id} nickname={child.nickname} entryId={entryId} onBack={() => setEntryId(null)} />;

  return (
    <PageShell maxWidth={820} scrollKey={child.id}>
      <View style={styles.backRow}>
        <Button tone="soft" label={`‹ ${t('phBack')}`} onPress={onBack} />
      </View>
      <View style={styles.header}>
        <View style={[styles.avatarLarge, { backgroundColor: avatar.fill }]}>
          <ThemedText style={styles.avatarLargeEmoji}>{avatar.emoji}</ThemedText>
        </View>
        <ThemedText type="subtitle" accessibilityRole="header" style={styles.center}>
          {child.nickname}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
          {t('phReadOnly')}
        </ThemedText>
      </View>

      <Card title={t('phPetsTitle')}>
        {overview === null ? <ThemedText type="small">{t('phLoading')}</ThemedText> : null}
        {overview?.status === 'not-started' ? <ThemedText type="small">{t('phNotStarted')}</ThemedText> : null}
        {overview?.status === 'unreadable' ? <ThemedText type="small">{t('phPetsUnreadable')}</ThemedText> : null}
        {overview?.status === 'not-allowed' ? <ThemedText type="small">{t('phNotAllowed')}</ThemedText> : null}
        {overview?.status === 'not-a-child' ? <ThemedText type="small">{t('phNotAChild')}</ThemedText> : null}
        {overview?.status === 'ok' && overview.pets.length === 0 ? <ThemedText type="small">{t('phNoPets')}</ThemedText> : null}
        {overview?.status === 'ok'
          ? overview.pets.map((pet) => (
              <View key={pet.id} style={styles.petRow}>
                <View style={[styles.dot, { backgroundColor: STATE_DOT[pet.state] }]} />
                <ThemedText type="smallBold" style={styles.petName}>
                  {pet.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t(STATE_TEXT[pet.state])}
                </ThemedText>
              </View>
            ))
          : null}
      </Card>

      {activity === null ? (
        <Card>
          <ThemedText type="small">{t('phLoading')}</ThemedText>
        </Card>
      ) : null}
      {activity !== null && activity.status !== 'ok' ? (
        <Card>
          <ThemedText type="small">{activity.status === 'not-allowed' ? t('phNotAllowed') : activity.status === 'not-a-child' ? t('phNotAChild') : t('paUnavailable')}</ThemedText>
        </Card>
      ) : null}
      {activity?.status === 'ok' ? (
        <>
          <ChildTasksSection activity={activity} />
          <ChildAccomplishmentsSection activity={activity} />
          <ChildActivitySection activity={activity} />
        </>
      ) : null}

      {/* Only entries the child chose to share are ever read (see @/components/child-journal-section.tsx). */}
      <ChildJournalSection childId={child.id} nickname={child.nickname} onOpen={setEntryId} />
    </PageShell>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  headerBadge: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E6DBF8' },
  center: { textAlign: 'center' },
  backRow: { alignItems: 'flex-start' },
  childCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    minHeight: 64,
    padding: Spacing.two,
    borderRadius: Spacing.four,
    backgroundColor: '#FCEEF1',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 26, lineHeight: 32 },
  avatarLarge: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  avatarLargeEmoji: { fontSize: 44, lineHeight: 52 },
  childText: { flex: 1, minWidth: 0, gap: 2 },
  childName: { fontSize: 17, lineHeight: 22 },
  chevron: { fontSize: 28, lineHeight: 32, color: '#A78BDB' },
  petRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap', minHeight: 36 },
  petName: { flexShrink: 1 },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
