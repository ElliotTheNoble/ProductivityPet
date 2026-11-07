import { Redirect } from 'expo-router';

import { FAMILY_MODE_ENABLED } from '@/utils/dev-flags';

// Parent-only: the dashboard is only rendered when the parent area is open (see @/components/parent-gate.tsx), so
// opening /parent directly cannot skip the PIN screen. With family mode off (every user) there is no household to manage: the address
// just goes back to the app, and neither the gate nor the dashboard is even loaded. The state is never read from the address.
export default function ParentPage() {
  if (!FAMILY_MODE_ENABLED) return <Redirect href="/" />;
  const { ParentGate } = require('@/components/parent-gate') as typeof import('@/components/parent-gate');
  const { ParentDashboard } = require('@/components/parent-dashboard') as typeof import('@/components/parent-dashboard');
  return (
    <ParentGate>
      <ParentDashboard />
    </ParentGate>
  );
}
