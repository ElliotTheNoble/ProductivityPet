import { useRouter } from 'expo-router';

import { Button, Card } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { useParentAuthStatus } from '@/hooks/use-parent-auth-status';
import { useT } from '@/i18n';

// The Parent Dashboard's entry to the Parent PIN screens. With family mode off there is no PIN checker at all, so this
// renders nothing and the dashboard is exactly as it always was.
export function ParentPinCard() {
  const status = useParentAuthStatus();
  const { t } = useT();
  const router = useRouter();
  if (status.loading || status.state === 'off' || status.state === 'unsupported' || status.state === 'verifier-missing') return null;
  const on = status.state === 'ready';
  return (
    <Card title={t('pcTitle')}>
      <ThemedText type="small" themeColor="textSecondary">
        {on ? t('pcOn') : status.state === 'pending' ? t('pcPending') : t('pcOff')}
      </ThemedText>
      <Button tone={on ? 'soft' : 'primary'} label={on ? t('pcManage') : t('pcSetup')} onPress={() => router.push('/parent-security')} />
    </Card>
  );
}
