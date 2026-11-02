import { tr, type StringKey } from '@/i18n';

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
    get name() {
      return tr('roomStudyRoom');
    },
    get description() {
      return tr('roomDescStudy');
    },
    image: require('@/assets/images/rooms/backgrounds/Study_Room.png'),
    aspectRatio: 1672 / 941,
  },
  gym: {
    slug: 'gym',
    get name() {
      return tr('roomGym');
    },
    get description() {
      return tr('roomDescGym');
    },
    image: require('@/assets/images/rooms/backgrounds/Gym_Room.png'),
    aspectRatio: 1672 / 941,
  },
  bedroom: {
    slug: 'bedroom',
    get name() {
      return tr('roomBedroom');
    },
    get description() {
      return tr('roomDescBedroom');
    },
    image: require('@/assets/images/rooms/backgrounds/Bedroom.png'),
    aspectRatio: 1672 / 941,
  },
  bathroom: {
    slug: 'bathroom',
    get name() {
      return tr('roomBathroom');
    },
    get description() {
      return tr('roomDescBathroom');
    },
    image: require('@/assets/images/rooms/backgrounds/Bath_Room.png'),
    aspectRatio: 1671 / 941,
  },
  kitchen: {
    slug: 'kitchen',
    get name() {
      return tr('roomKitchen');
    },
    get description() {
      return tr('roomDescKitchen');
    },
    image: require('@/assets/images/rooms/backgrounds/Kitchen_Room.png'),
    aspectRatio: 1672 / 941,
  },
};

export const ROOM_ORDER: RoomSlug[] = ['study-room', 'gym', 'bedroom', 'bathroom', 'kitchen'];

export function isRoomSlug(value: string | string[] | undefined): value is RoomSlug {
  return typeof value === 'string' && value in ROOMS;
}

// A task can be explicitly assigned to any of the 6 rooms, including
// Living Room — unlike RoomSlug above (which only covers the 5 rooms with
// their own detail page), since "Living Room" is a real, pre-existing
// task grouping (see @/utils/room-tasks.ts) even though Living Room
// itself has no separate route (it's Home). Defined here, next to
// RoomSlug, so both @/utils/tasks.ts (the Task.room field) and
// @/utils/room-tasks.ts (filtering/assignment logic) can import it
// without either depending on the other.
export type TaskRoom = RoomSlug | 'living-room';

export const TASK_ROOMS: TaskRoom[] = ['living-room', ...ROOM_ORDER];

// Display names are looked up when read (getters), so they follow the current language.
export const TASK_ROOM_LABELS: Record<TaskRoom, string> = {
  get 'living-room'() {
    return tr('roomLivingRoom');
  },
  get 'study-room'() {
    return tr('roomStudyRoom');
  },
  get gym() {
    return tr('roomGym');
  },
  get bedroom() {
    return tr('roomBedroom');
  },
  get bathroom() {
    return tr('roomBathroom');
  },
  get kitchen() {
    return tr('roomKitchen');
  },
};

// The room card on Home identifies rooms by their English name; this gives the name to show.
const ROOM_NAME_KEYS: Record<string, StringKey> = {
  'Living Room': 'roomLivingRoom',
  'Study Room': 'roomStudyRoom',
  Gym: 'roomGym',
  Bedroom: 'roomBedroom',
  Bathroom: 'roomBathroom',
  Kitchen: 'roomKitchen',
};

// "Tareas del cuarto de estudio": the room-task panel heading for each room (a whole phrase, because the
// grammar of the room name changes in Spanish).
const ROOM_TASKS_TITLE_KEYS: Record<string, StringKey> = {
  'living-room': 'roomTasksLiving',
  'study-room': 'roomTasksStudy',
  gym: 'roomTasksGym',
  bedroom: 'roomTasksBedroom',
  bathroom: 'roomTasksBathroom',
  kitchen: 'roomTasksKitchen',
};

export function roomTasksTitle(slug: string): string {
  const key = ROOM_TASKS_TITLE_KEYS[slug];
  return key ? tr(key) : slug;
}

export function roomShortName(slug: string): string {
  return TASK_ROOM_LABELS[slug as TaskRoom] ?? slug;
}

export function roomNameLabel(englishName: string): string {
  const key = ROOM_NAME_KEYS[englishName];
  return key ? tr(key) : englishName;
}

export function isTaskRoom(value: unknown): value is TaskRoom {
  return typeof value === 'string' && (TASK_ROOMS as string[]).includes(value);
}
