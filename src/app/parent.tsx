import { ParentDashboard } from '@/components/parent-dashboard';
import { ParentGate } from '@/components/parent-gate';

// Parent-only: the dashboard is only rendered when the parent area is open (see @/components/parent-gate.tsx), so
// opening /parent directly cannot skip the PIN screen.
export default function ParentPage() {
  return (
    <ParentGate>
      <ParentDashboard />
    </ParentGate>
  );
}
