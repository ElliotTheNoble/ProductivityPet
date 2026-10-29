import { useLocalSearchParams } from 'expo-router';

import { CategoryAccomplishmentsScreen } from '@/components/category-accomplishments-screen';
import { ComingSoonScreen } from '@/components/coming-soon-screen';
import { slugToCategory } from '@/utils/category-accomplishments';

export default function StatsCategoryPage() {
  const { category: categoryParam } = useLocalSearchParams<{ category: string }>();
  const category = slugToCategory(categoryParam);

  if (!category) {
    return <ComingSoonScreen title="Category not found" />;
  }

  return <CategoryAccomplishmentsScreen category={category} />;
}
