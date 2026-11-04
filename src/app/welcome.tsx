import { ParentGate } from '@/components/parent-gate';
import { WelcomeScreen } from '@/components/welcome-screen';

// The family set-up flow can create or change the parent profile, so once a parent PIN exists it is parent-only too.
// With no PIN (every install today, including a brand-new one) it opens exactly as before.
export default function WelcomePage() {
  return (
    <ParentGate>
      <WelcomeScreen />
    </ParentGate>
  );
}
