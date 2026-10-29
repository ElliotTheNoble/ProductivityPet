import { useLocalSearchParams } from 'expo-router';

import { PetAlbumDetailScreen } from '@/components/pet-album-screen';

export default function PetAlbumDetailPage() {
  const { petId } = useLocalSearchParams<{ petId: string }>();
  return <PetAlbumDetailScreen petId={petId ?? ''} />;
}
