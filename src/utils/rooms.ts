export type RoomSlug = 'study-room' | 'gym' | 'bedroom' | 'bathroom' | 'kitchen';

export type RoomInfo = {
  slug: RoomSlug;
  name: string;
  description: string;
  image: number;
  // Matches each source image's real pixel ratio so nothing stretches.
  aspectRatio: number;
};

// Living Room is intentionally NOT part of this map: its card on the Rooms
// page navigates straight back to Home (the existing living room) instead of
// a separate detail page — see src/components/rooms-card.tsx.
//
// Each of these 5 rooms has its own full-size illustrated background
// (assets/images/rooms/backgrounds/*.png), shown large/prominent on its
// detail page — the same way the living room background is shown on Home.
// No pet/cat art is shown on these pages yet, per instructions — backgrounds
// only.
export const ROOMS: Record<RoomSlug, RoomInfo> = {
  'study-room': {
    slug: 'study-room',
    name: 'Study Room',
    description: 'Where focused minds (and whiskers) get things done. 📚',
    image: require('@/assets/images/rooms/backgrounds/Study_Room.png'),
    aspectRatio: 1672 / 941,
  },
  gym: {
    slug: 'gym',
    name: 'Gym',
    description: 'Time to stretch those little paws and get moving! 💪',
    image: require('@/assets/images/rooms/backgrounds/Gym_Room.png'),
    aspectRatio: 1672 / 941,
  },
  bedroom: {
    slug: 'bedroom',
    name: 'Bedroom',
    description: 'Sweet dreams and starry nights await. 🌙',
    image: require('@/assets/images/rooms/backgrounds/Bedroom.png'),
    aspectRatio: 1672 / 941,
  },
  bathroom: {
    slug: 'bathroom',
    name: 'Bathroom',
    description: 'Bubbles, bath time, and squeaky-clean fur. 🛁',
    image: require('@/assets/images/rooms/backgrounds/Bath_Room.png'),
    aspectRatio: 1671 / 941,
  },
  kitchen: {
    slug: 'kitchen',
    name: 'Kitchen',
    description: 'Whisking up something delicious together. 🍳',
    image: require('@/assets/images/rooms/backgrounds/Kitchen_Room.png'),
    aspectRatio: 1672 / 941,
  },
};

export const ROOM_ORDER: RoomSlug[] = ['study-room', 'gym', 'bedroom', 'bathroom', 'kitchen'];

export function isRoomSlug(value: string | string[] | undefined): value is RoomSlug {
  return typeof value === 'string' && value in ROOMS;
}
