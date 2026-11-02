import { View } from 'react-native';
import { StyleSheet } from 'react-native';

import { Card, ChoiceCard } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { LANGUAGES, useT, type LanguageCode } from '@/i18n';
import { setLanguage } from '@/utils/onboarding';

// Language picker for the whole app, shown on the Pet Care & Alerts page (the app has no separate Settings
// screen). The choice is saved (see @/utils/onboarding.ts) and applies immediately. Language names are always
// shown as "English" and "Español".
export function LanguageCard() {
  const { t, lang } = useT();
  return (
    <Card title={t('languageSettings')}>
      <ThemedText type="small" themeColor="textSecondary">
        {t('languagePickerHelp')}
      </ThemedText>
      <View style={styles.list}>
        {LANGUAGES.map((l) => (
          <ChoiceCard key={l.code} title={l.nativeName} selected={lang === l.code} onPress={() => void setLanguage(l.code as LanguageCode)} />
        ))}
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {t('languageNote')}
      </ThemedText>
    </Card>
  );
}

const styles = StyleSheet.create({ list: { gap: Spacing.two } });
