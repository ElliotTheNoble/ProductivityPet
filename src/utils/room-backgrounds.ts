import type { RoomSlug } from '@/utils/rooms';

// Every screen that has its own background image — the 5 individual rooms
// plus Home (the living room) and the Tasks/calendar screen.
export type RoomBackgroundKey = RoomSlug | 'living-room' | 'tasks';

export type SpecialEvent = {
  id: string;
  // Whatever the caller already knows about whether this event is active
  // today (e.g. from useBirthdayMode()) — this module doesn't do any of its
  // own date/task detection, it only resolves which image to show once told.
  isActive: boolean;
  backgrounds: Partial<Record<RoomBackgroundKey, number>>;
};

// Picks a room's background for today: the first active special event that
// has an override for this room wins, otherwise the room's normal image.
// `events` is an ordered priority list — if more than one event were ever
// active on the same day, the first match in the array wins.
export function resolveRoomBackground(
  key: RoomBackgroundKey,
  normalSource: number,
  events: SpecialEvent[]
): number {
  for (const event of events) {
    if (!event.isActive) continue;
    const override = event.backgrounds[key];
    if (override) return override;
  }
  return normalSource;
}

// Birthday Mode's own artwork, one per screen. To add another special event
// later (Christmas, Halloween, Valentine's Day, ...): create a sibling
// backgrounds map like this one (pulling from its own
// assets/images/rooms/backgrounds/Special-events/<Name>/ folder), decide
// how that event's "is it active today" boolean gets computed, and add one
// more { id, isActive, backgrounds } entry to the `events` array wherever a
// screen builds it below — resolveRoomBackground() itself never needs to
// change.
export const BIRTHDAY_BACKGROUNDS: SpecialEvent['backgrounds'] = {
  'living-room': require('@/assets/images/rooms/backgrounds/Special-events/Birthday/Bday_Livingroom.png'),
  tasks: require('@/assets/images/rooms/backgrounds/Special-events/Birthday/Bday_Task.png'),
  'study-room': require('@/assets/images/rooms/backgrounds/Special-events/Birthday/Bday_Study.png'),
  gym: require('@/assets/images/rooms/backgrounds/Special-events/Birthday/Bday_Gym.png'),
  bedroom: require('@/assets/images/rooms/backgrounds/Special-events/Birthday/Bday_bed.png'),
  bathroom: require('@/assets/images/rooms/backgrounds/Special-events/Birthday/Bday_Bathroom.png'),
  kitchen: require('@/assets/images/rooms/backgrounds/Special-events/Birthday/Bday_kitchen.png'),
};
