import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, StyleSheet, View, useWindowDimensions } from 'react-native';

import { ConfirmModal } from '@/components/confirm-modal';
import { Button, Card, PageShell } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { translate, useT, type LanguageCode, type StringKey } from '@/i18n';
import {
  getHandoffController,
  installFamilyTabProtection,
  useHandoffView,
  useTabLockSnapshot,
  type HandoffController,
} from '@/utils/family-tab';
import type { TabLock, TabLockSnapshot } from '@/utils/web-tab-lock';
import type { UnfinishedKind } from '@/utils/unfinished-work';

// The gate in front of EVERYTHING in family mode on the web (loaded only behind that flag, see src/app/_layout.tsx). `children` (the
// whole app: onboarding load, profile layer, Parent PIN, family reconciliation, the picker, every screen) is not even rendered until
// this document really holds the family Web Lock. Until then, and in every state where it does not, the person sees a neutral screen:
// fixed words in the BROWSER's language (nothing is read from storage), no profile, nickname, pet, token or any other private detail.
//
// The screens only ever ASK (cooperative takeover): there is no way here to force, steal or bypass the lock. Taking the lock happens in
// a fresh document after a reload (see TabLock.claim), never in the page that was blocked.

// The browser's language, never a stored preference.
export function browserLanguage(): LanguageCode {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const preferred = nav?.languages?.[0] ?? nav?.language ?? 'en';
  return /^es\b/i.test(preferred) ? 'es' : 'en';
}

const KIND_TEXT: Record<UnfinishedKind, StringKey> = {
  'kitty-catch': 'pcKindKitty',
  'memory-match': 'pcKindMemory',
  bathing: 'pcKindBathing',
  'task-draft': 'pcKindTaskDraft',
  'task-edit': 'pcKindTaskEdit',
  journal: 'pcKindJournal',
};

export function WebTabGate({
  children,
  lock: lockProp,
  controller: controllerProp,
  language,
}: {
  children: ReactNode;
  lock?: TabLock;
  controller?: HandoffController;
  language?: LanguageCode;
}) {
  const lock = useMemo(() => lockProp ?? installFamilyTabProtection(), [lockProp]);
  const controller = useMemo(() => controllerProp ?? getHandoffController(), [controllerProp]);
  const lang = useMemo(() => language ?? browserLanguage(), [language]);
  useEffect(() => {
    if (lock) void lock.start();
  }, [lock]);
  // No lock object at all (this build cannot make one): the same as an environment that cannot guarantee a single tab.
  if (!lock) return <Unsupported lang={lang} reason="no-web-locks" />;
  return <Gate lock={lock} controller={controller} lang={lang}>{children}</Gate>;
}

function Gate({ lock, controller, lang, children }: { lock: TabLock; controller: HandoffController; lang: LanguageCode; children: ReactNode }) {
  const snapshot = useTabLockSnapshot(lock);
  if (snapshot.status === 'owned') {
    return (
      <>
        {children}
        <HandoffDialog controller={controller} />
      </>
    );
  }
  return <BlockedScreen lock={lock} snapshot={snapshot} lang={lang} />;
}

// ---------------------------------------------------------------------------------------------------------
// the neutral screens

type Copy = { title: StringKey; body: StringKey; action?: { label: StringKey; run: () => void }; busy?: boolean };

function copyFor(lock: TabLock, snapshot: TabLockSnapshot): Copy {
  const ask = () => void lock.requestHandoff();
  const use = () => void lock.claim();
  if (snapshot.status === 'checking') return { title: 'tlChecking', body: 'tlCheckingBody', busy: true };
  if (snapshot.status === 'unsupported') {
    if (snapshot.reason === 'insecure-context') return { title: 'tlUnsupportedInsecureTitle', body: 'tlUnsupportedInsecureBody' };
    if (snapshot.reason === 'no-storage') return { title: 'tlUnsupportedNoStorageTitle', body: 'tlUnsupportedNoStorageBody' };
    return { title: 'tlUnsupportedNoLocksTitle', body: 'tlUnsupportedNoLocksBody' };
  }
  if (snapshot.claiming) return { title: 'tlSwitchingTitle', body: 'tlSwitchingBody', busy: true };
  // The lock is free: only a person's tap uses it (claim() reloads the page; the new document then asks for the lock).
  if (snapshot.lockFree) return { title: 'tlFreeTitle', body: 'tlFreeBody', action: { label: 'tlUseThisTab', run: use } };
  if (snapshot.status === 'released') return { title: 'tlReleasedTitle', body: 'tlReleasedBody' };
  if (snapshot.status === 'lost') return { title: 'tlLostTitle', body: 'tlLostBody' };
  switch (snapshot.request) {
    case 'asking':
      return { title: 'tlAskingTitle', body: 'tlAskingBody', busy: true };
    case 'unanswered':
      return { title: 'tlUnansweredTitle', body: 'tlUnansweredBody', action: { label: 'tlAskAgain', run: ask } };
    case 'declined': {
      const again = { label: 'tlAskAgain' as const, run: ask };
      if (snapshot.declinedBecause === 'save-failed') return { title: 'tlSaveFailedTitle', body: 'tlSaveFailedBody', action: again };
      if (snapshot.declinedBecause === 'not-ready') return { title: 'tlNotReadyTitle', body: 'tlNotReadyBody', action: again };
      return { title: 'tlDeclinedTitle', body: 'tlDeclinedBody', action: again };
    }
    default:
      return snapshot.canRequest
        ? { title: 'tlBlockedTitle', body: 'tlBlockedBody', action: { label: 'tlAsk', run: ask } }
        : { title: 'tlWaitingTitle', body: 'tlWaitingBody' };
  }
}

function BlockedScreen({ lock, snapshot, lang }: { lock: TabLock; snapshot: TabLockSnapshot; lang: LanguageCode }) {
  const t = (key: StringKey) => translate(lang, key);
  const { width, height } = useWindowDimensions();
  const copy = copyFor(lock, snapshot);
  return (
    <PageShell scrollKey={`${snapshot.status}:${snapshot.request}:${snapshot.lockFree}:${snapshot.claiming}`} compact={height < 500 && width > height}>
      <View style={[styles.center, { minHeight: Math.max(360, height - 140) }]}>
        <ThemedText style={styles.paws} accessibilityElementsHidden importantForAccessibility="no">
          🐾
        </ThemedText>
        <Card>
          <View accessibilityLiveRegion="polite" style={styles.group}>
            {copy.busy ? <ActivityIndicator color="#A78BDB" accessibilityElementsHidden importantForAccessibility="no" /> : null}
            <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>
              {t(copy.title)}
            </ThemedText>
            <ThemedText themeColor="textSecondary">{t(copy.body)}</ThemedText>
          </View>
          {copy.action ? <Button label={t(copy.action.label)} onPress={copy.action.run} tone="primary" /> : null}
        </Card>
      </View>
    </PageShell>
  );
}

function Unsupported({ lang, reason }: { lang: LanguageCode; reason: 'no-web-locks' }) {
  const t = (key: StringKey) => translate(lang, key);
  void reason;
  return (
    <PageShell>
      <View style={styles.center}>
        <Card>
          <ThemedText type="subtitle" accessibilityRole="header" style={styles.title}>
            {t('tlUnsupportedNoLocksTitle')}
          </ThemedText>
          <ThemedText themeColor="textSecondary">{t('tlUnsupportedNoLocksBody')}</ThemedText>
        </Card>
      </View>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------------------------------------
// the question in the tab that IS in use (shown over the app, in the app's own language)

function HandoffDialog({ controller }: { controller: HandoffController }) {
  const { t } = useT();
  const view = useHandoffView(controller);
  const announced = useRef<string | null>(null);
  const titleKey: StringKey = view?.kind === 'failed' ? 'tlHandoffFailedTitle' : 'tlHandoffTitle';
  useEffect(() => {
    // Read out once when the question appears (not again for the saving or failed states of the same question).
    if (view && announced.current === null) {
      announced.current = view.kind;
      AccessibilityInfo.announceForAccessibility?.(t('tlHandoffTitle'));
    }
    if (!view) announced.current = null;
  }, [view, t]);
  if (!view) return null;
  const saving = view.kind === 'saving';
  const failed = view.kind === 'failed';
  return (
    <ConfirmModal
      visible
      title={t(titleKey)}
      confirmLabel={failed ? t('pcTryAgain') : t('tlHandoffLet')}
      cancelLabel={t('tlHandoffKeep')}
      busy={saving}
      onConfirm={() => void controller.accept()}
      onCancel={() => controller.keep()}>
      {failed ? (
        <ThemedText type="small">{t('tlHandoffFailedBody')}</ThemedText>
      ) : (
        <>
          <ThemedText type="small">{saving ? t('tlHandoffSaving') : t('tlHandoffBody')}</ThemedText>
          {view.work.length > 0 ? (
            <>
              <ThemedText type="small">{t('tlHandoffUnfinished')}</ThemedText>
              {view.work.map((kind) => (
                <ThemedText key={kind} type="smallBold">
                  {`• ${t(KIND_TEXT[kind])}`}
                </ThemedText>
              ))}
              <ThemedText type="small">{t('pcConfirmSaved')}</ThemedText>
            </>
          ) : null}
        </>
      )}
    </ConfirmModal>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', gap: Spacing.three, minHeight: 360 },
  paws: { fontSize: 40, lineHeight: 52, textAlign: 'center' },
  group: { gap: Spacing.two },
  title: { fontSize: 24, lineHeight: 30 },
});
