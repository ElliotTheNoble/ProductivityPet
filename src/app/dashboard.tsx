import { Redirect } from 'expo-router';

import { useActiveProfileId } from '@/hooks/use-active-profile';
import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';
import { MAIN_PROFILE_ID } from '@/utils/profiles';

// Parent-only: the Parent Dashboard. It is only rendered when the parent area is open (see @/components/parent-gate.tsx), so opening
// /dashboard directly cannot skip the PIN screen. With family mode off (every user today) it is not there at all: the address goes back
// to the app. It belongs to Main only: while a child's profile is open, the address goes back to the app as well, and nothing of the
// dashboard is even loaded.
export default function DashboardPage() {
  const profileId = useActiveProfileId();
  if (!FAMILY_MODE_ENABLED || profileId !== MAIN_PROFILE_ID) return <Redirect href="/" />;
  const { ParentGate } = require('@/components/parent-gate') as typeof import('@/components/parent-gate');
  const { ParentHome } = require('@/components/parent-home') as typeof import('@/components/parent-home');
  return (
    <ParentGate>
      <ParentHome />
    </ParentGate>
  );
}
