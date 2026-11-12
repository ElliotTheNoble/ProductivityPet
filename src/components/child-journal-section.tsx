import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, PageShell } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { hoverLift } from '@/constants/hover';
import { Spacing } from '@/constants/theme';
import { getLocale, useT } from '@/i18n';
import { readSharedJournal, type SharedJournalResult } from '@/utils/journal-sharing';

// The Shared Journals part of a child's overview on the Parent Dashboard, and the read-only page for one entry. EVERYTHING here comes from
// readSharedJournal (@/utils/journal-sharing.ts), which hands back ONLY the entries the child has explicitly shared with a parent. This file
// never imports the journal store, so no private entry, date, preview or count can reach it; it also never shows how many entries are
// private or hidden ("nothing shared" looks the same whether the child wrote nothing or kept everything private).
//
// Looking only: no text field, no button that edits, deletes, shares or changes a privacy setting. Nothing is kept between visits: the list
// is read again every time it appears and whenever the app comes back to the foreground, and an entry is read again before it is shown, so
// an entry the child stopped sharing (or deleted) disappears from the parent's view. The parent gate removes this content the moment the
// session ends, and what was read lives only in this component's state, so it is gone with it.

export const JOURNAL_PAGE_SIZE = 50;
const PREVIEW_LENGTH = 90;

type Entry = Extract<SharedJournalResult, { status: 'ok' }>['entries'][number];

// A short, word-safe preview of one entry (only ever called with text of an entry that is shared).
export function previewOf(text: string, max = PREVIEW_LENGTH): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function formatDate(iso: string, options: Intl.DateTimeFormatOptions): string {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(getLocale(), options);
}

type Loaded = { kind: 'loading' } | { kind: 'ok'; entries: Entry[] } | { kind: 'not-allowed' } | { kind: 'not-a-child' } | { kind: 'unreadable' };

// Reads the child's shared entries now, and again each time the app returns to the foreground.
function useSharedEntries(childId: string): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const alive = useRef(true);
  const load = useCallback(async () => {
    const result = await readSharedJournal(childId);
    if (!alive.current) return;
    setLoaded(result.status === 'ok' ? { kind: 'ok', entries: result.entries } : { kind: result.status });
  }, [childId]);
  useEffect(() => {
    alive.current = true;
    void load();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, [load]);
  return loaded;
}

// ---------------------------------------------------------------------------------------------------------
export function ChildJournalSection({ childId, nickname, onOpen }: { childId: string; nickname: string; onOpen: (entryId: string) => void }) {
  const { t } = useT();
  const loaded = useSharedEntries(childId);
  const [shown, setShown] = useState(JOURNAL_PAGE_SIZE);
  return (
    <Card title={t('phJournals')} color="rgba(255,255,255,0.88)">
      <ThemedText type="small" themeColor="textSecondary">
        {t('phJournalsText')}
      </ThemedText>
      {loaded.kind === 'loading' ? <ThemedText type="small">{t('phLoading')}</ThemedText> : null}
      {loaded.kind === 'not-allowed' ? <ThemedText type="small">{t('phNotAllowed')}</ThemedText> : null}
      {loaded.kind === 'not-a-child' ? <ThemedText type="small">{t('phNotAChild')}</ThemedText> : null}
      {loaded.kind === 'unreadable' ? <ThemedText type="small">{t('pjUnreadable')}</ThemedText> : null}
      {loaded.kind === 'ok' && loaded.entries.length === 0 ? <ThemedText type="small">{t('pjEmpty', { name: nickname })}</ThemedText> : null}
      {loaded.kind === 'ok'
        ? loaded.entries.slice(0, shown).map((entry) => <EntryCard key={entry.id} entry={entry} onOpen={() => onOpen(entry.id)} />)
        : null}
      {loaded.kind === 'ok' && loaded.entries.length > shown ? <Button tone="soft" label={t('pjShowMore')} onPress={() => setShown((n) => n + JOURNAL_PAGE_SIZE)} /> : null}
    </Card>
  );
}

function EntryCard({ entry, onOpen }: { entry: Entry; onOpen: () => void }) {
  const { t } = useT();
  const label = formatDate(entry.dateISO, { weekday: 'short', month: 'short', day: 'numeric' });
  const preview = previewOf(entry.text);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t('pjOpenEntry', { date: label })}
      style={(state) => [styles.card, state.pressed && styles.pressed, hoverLift(state, true)]}>
      <View style={styles.heart}>
        <Ionicons name="heart-outline" size={22} color="#D9578A" accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      <View style={styles.cardText}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {preview}
        </ThemedText>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------------------
// One entry, read-only. It is read again before it is shown; if it is no longer shared (or no longer there) the page says so and shows nothing
// of it. The page scrolls, so the whole text (up to 500 characters) is readable on a small screen.
export function SharedEntryScreen({ childId, nickname, entryId, onBack }: { childId: string; nickname: string; entryId: string; onBack: () => void }) {
  const { t } = useT();
  const loaded = useSharedEntries(childId);
  const entry = loaded.kind === 'ok' ? loaded.entries.find((e) => e.id === entryId) : undefined;
  const missing = loaded.kind === 'ok' && !entry;
  return (
    <PageShell maxWidth={820} scrollKey={entryId}>
      <View style={styles.backRow}>
        <Button tone="soft" label={`‹ ${t('pjBack')}`} onPress={onBack} />
      </View>
      {loaded.kind === 'loading' ? <ThemedText type="small">{t('phLoading')}</ThemedText> : null}
      {loaded.kind === 'not-allowed' ? <ThemedText type="small">{t('phNotAllowed')}</ThemedText> : null}
      {loaded.kind === 'not-a-child' ? <ThemedText type="small">{t('phNotAChild')}</ThemedText> : null}
      {loaded.kind === 'unreadable' ? <ThemedText type="small">{t('pjUnreadable')}</ThemedText> : null}
      {missing ? (
        <Card>
          <ThemedText type="small">{t('pjGone')}</ThemedText>
        </Card>
      ) : null}
      {entry ? (
        <>
          <View style={styles.header}>
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.center}>
              {formatDate(entry.dateISO, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.center}>
              {t('pjReadOnly', { name: nickname })}
            </ThemedText>
          </View>
          <Card color="#FCEEF1">
            <ThemedText style={styles.entryText}>{entry.text}</ThemedText>
          </Card>
        </>
      ) : null}
    </PageShell>
  );
}

const styles = StyleSheet.create({
  card: {
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
  heart: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, minWidth: 0, gap: 2 },
  backRow: { alignItems: 'flex-start' },
  header: { alignItems: 'center', gap: Spacing.one, paddingVertical: Spacing.two },
  center: { textAlign: 'center' },
  entryText: { fontSize: 18, lineHeight: 28 },
});
