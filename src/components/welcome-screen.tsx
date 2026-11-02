import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Card, ChoiceCard, Field, PageShell } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { LANGUAGES, useT, type LanguageCode, type StringKey } from '@/i18n';
import { saveParentProfile, useHousehold } from '@/utils/household';
import {
  chooseMode,
  completeOnboarding,
  setLanguage,
  setStep,
  skipOnboarding,
  useOnboarding,
  type UserMode,
} from '@/utils/onboarding';

// The first-time welcome flow: 1) language, 2) who is using the app, 3) (Parent / Guardian only) a local parent
// profile. Child and Independent only show a "coming soon" note: they create nothing and don't change the app.
// The chosen language and the current step are saved as you go, so a refresh resumes where you were. Nothing
// here reads or writes pets, tasks, tokens or Pawadise data.

export function WelcomeScreen() {
  const router = useRouter();
  const { t } = useT();
  const onboarding = useOnboarding();
  const household = useHousehold();
  const [placeholder, setPlaceholder] = useState<UserMode | null>(null);
  const [name, setName] = useState('');
  const [family, setFamily] = useState('');
  const [error, setError] = useState<StringKey | null>(null);
  const [busy, setBusy] = useState(false);

  // Prefill the profile form from a profile that already exists (e.g. someone re-running setup).
  useEffect(() => {
    if (household?.parent) {
      setName((n) => n || household.parent!.displayName);
      setFamily((f) => f || household.parent!.familyName);
    }
  }, [household?.parent]);

  if (!onboarding) return <PageShell>{null}</PageShell>;

  const step = onboarding.step;
  const lang = onboarding.language;

  async function finish() {
    if (busy) return;
    setBusy(true);
    const result = await saveParentProfile(name, family);
    if (!result.ok) {
      setError('nameRequired');
      setBusy(false);
      return;
    }
    await completeOnboarding('parent');
    setBusy(false);
    router.replace('/parent');
  }

  async function skip() {
    await skipOnboarding();
    router.replace('/');
  }

  return (
    <PageShell maxWidth={640}>
      <View style={styles.hero}>
        <ThemedText style={styles.paw}>🐾</ThemedText>
        <ThemedText style={styles.title}>{step === 'language' ? t('welcomeLanguageTitle') : step === 'mode' ? t('modeTitle') : t('parentSetupTitle')}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.subtitle}>
          {step === 'language' ? t('welcomeLanguageSubtitle') : step === 'mode' ? t('modeSubtitle') : ''}
        </ThemedText>
      </View>

      {step === 'language' ? (
        <>
          {LANGUAGES.map((l) => (
            <ChoiceCard key={l.code} title={l.nativeName} selected={lang === l.code} onPress={() => void setLanguage(l.code as LanguageCode)} />
          ))}
          <Button label={t('continue')} onPress={() => void setStep('mode')} />
        </>
      ) : null}

      {step === 'mode' ? (
        <>
          {placeholder ? (
            <Card color="#FFF4E3" title={t('placeholderTitle')}>
              <ThemedText type="small">{placeholder === 'child' ? t('placeholderChild') : t('placeholderIndependent')}</ThemedText>
              <Button label={t('back')} tone="soft" onPress={() => setPlaceholder(null)} />
            </Card>
          ) : (
            <>
              <ChoiceCard title={t('modeParent')} description={t('modeParentDesc')} onPress={() => void chooseMode('parent')} />
              <ChoiceCard title={t('modeChild')} description={t('modeChildDesc')} badge={t('comingSoon')} onPress={() => setPlaceholder('child')} />
              <ChoiceCard
                title={t('modeIndependent')}
                description={t('modeIndependentDesc')}
                badge={t('comingSoon')}
                onPress={() => setPlaceholder('independent')}
              />
              <Button label={t('back')} tone="soft" onPress={() => void setStep('language')} />
            </>
          )}
        </>
      ) : null}

      {step === 'profile' ? (
        <>
          <Card>
            <ThemedText type="small" style={styles.explain}>
              {t('parentSetupExplain')}
            </ThemedText>
          </Card>
          <Card>
            <Field
              label={t('parentNameLabel')}
              placeholder={t('parentNamePlaceholder')}
              value={name}
              onChangeText={(v) => {
                setName(v);
                setError(null);
              }}
              maxLength={40}
            />
            <Field label={t('familyNameLabel')} placeholder={t('familyNamePlaceholder')} value={family} onChangeText={setFamily} maxLength={40} />
            <ThemedText type="small" themeColor="textSecondary">
              {t('privacyNote')}
            </ThemedText>
            {error ? (
              <ThemedText type="smallBold" accessibilityRole="alert" style={styles.error}>
                {t(error)}
              </ThemedText>
            ) : null}
          </Card>
          <View style={styles.row}>
            <Button label={t('back')} tone="soft" onPress={() => void setStep('mode')} />
            <Button label={t('finishSetup')} onPress={() => void finish()} disabled={busy} />
          </View>
        </>
      ) : null}

      <View style={styles.skipWrap}>
        <Button label={t('skipForNow')} tone="soft" small onPress={() => void skip()} />
      </View>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: Spacing.one, paddingTop: Spacing.four },
  paw: { fontSize: 52, lineHeight: 60 },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '800', textAlign: 'center' },
  subtitle: { textAlign: 'center' },
  explain: { lineHeight: 22 },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  error: { color: '#C0392B' },
  skipWrap: { alignItems: 'center', marginTop: Spacing.three },
});
