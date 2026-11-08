import { Card } from '@/components/family-ui';
import { ThemedText } from '@/components/themed-text';
import { useT } from '@/i18n';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';

// Shown on the Parent dashboard ONLY (never inside a child's profile), and only in family mode, when the private notifications of an
// earlier profile could not be confirmed as cleared. It says nothing about any child, pet or task, offers no button (a retry from here
// could cancel the reminders of the profile that is open now; the clean-up retries by itself whenever the profile list is showing),
// and disappears when the clean-up is verified. See @/utils/notification-cleanup.ts.
export function NotificationCleanupNotice() {
  if (!FAMILY_MODE_ENABLED) return null;
  return <Notice />;
}

function Notice() {
  const { t } = useT();
  const { useCleanupSnapshot } = require('@/utils/notification-cleanup') as typeof import('@/utils/notification-cleanup');
  const snapshot = useCleanupSnapshot();
  if (snapshot.state !== 'unverified') return null;
  return (
    <Card title={t('ncNoticeTitle')}>
      <ThemedText type="small" themeColor="textSecondary" accessibilityRole="alert">
        {t('ncNoticeBody')}
      </ThemedText>
    </Card>
  );
}
