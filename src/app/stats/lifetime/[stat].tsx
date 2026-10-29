import { useLocalSearchParams } from 'expo-router';

import { ComingSoonScreen } from '@/components/coming-soon-screen';
import { LifetimeStatScreen } from '@/components/lifetime-stat-screen';
import { slugToLifetimeStat } from '@/utils/category-accomplishments';

export default function LifetimeStatPage() {
  const { stat: statParam } = useLocalSearchParams<{ stat: string }>();
  const stat = slugToLifetimeStat(statParam);

  if (!stat) {
    return <ComingSoonScreen title="Stat not found" />;
  }

  return <LifetimeStatScreen stat={stat} />;
}
