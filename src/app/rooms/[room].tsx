import { useLocalSearchParams } from 'expo-router';

import { ComingSoonScreen } from '@/components/coming-soon-screen';
import { RoomDetailScreen } from '@/components/room-detail-screen';
import { ROOMS, isRoomSlug } from '@/utils/rooms';

export default function RoomPage() {
  const { room: roomParam, focus } = useLocalSearchParams<{ room: string; focus?: string }>();

  if (!isRoomSlug(roomParam)) {
    return <ComingSoonScreen title="nfRoom" />;
  }

  return <RoomDetailScreen room={ROOMS[roomParam]} focusToken={Array.isArray(focus) ? focus[0] : focus} />;
}
