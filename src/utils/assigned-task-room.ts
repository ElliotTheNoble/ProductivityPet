import type { RoomSlug } from '@/utils/rooms';

// The rooms a parent can assign a task to. A task with no room ("anywhere") is also allowed. Kept as plain data, in its own file with no
// pictures or screens behind it, so the household record (a device-level store) can check a saved room without loading anything else.
export const ASSIGNABLE_ROOMS: readonly RoomSlug[] = ['study-room', 'gym', 'bedroom', 'kitchen', 'bathroom'];

export function isAssignableRoom(value: unknown): value is RoomSlug {
  return typeof value === 'string' && (ASSIGNABLE_ROOMS as readonly string[]).includes(value);
}
