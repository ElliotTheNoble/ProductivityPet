import { useLocalSearchParams } from 'expo-router';

import { ComingSoonScreen } from '@/components/coming-soon-screen';
import { RoomDetailScreen } from '@/components/room-detail-screen';
import { ROOMS, isRoomSlug } from '@/utils/rooms';

export default function RoomPage() {
  const { room: roomParam } = useLocalSearchParams<{ room: string }>();

  if (!isRoomSlug(roomParam)) {
    return <ComingSoonScreen title="Room not found" />;
  }

  return <RoomDetailScreen room={ROOMS[roomParam]} />;
}
