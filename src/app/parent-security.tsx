import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';

// The Parent PIN screens (set up, management). With family mode off (every user) this route shows nothing and the screens
// are not even loaded. The state is never read from the address: there are no route parameters.
export default function ParentSecurityPage() {
  if (!FAMILY_MODE_ENABLED) return null;
  const { ParentSecurityScreen } = require('@/components/parent-security-screen') as typeof import('@/components/parent-security-screen');
  return <ParentSecurityScreen />;
}
