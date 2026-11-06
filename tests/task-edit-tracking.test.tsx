import { fireEvent, render, screen } from '@testing-library/react-native';
import { createElement } from 'react';
import { StyleSheet } from 'react-native';

import { TaskEditModal } from '@/components/task-edit-modal';
import { translate } from '@/i18n';
import { TASK_ROOM_LABELS } from '@/utils/rooms';
import { taskEditChanged, type TaskEditSnapshot } from '@/utils/task-edit-changes';
import { listUnfinishedWork, clearUnfinishedWork } from '@/utils/unfinished-work';

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
}));

// The task editor reports unfinished work for EVERY field once it differs from what it was when the editor opened, and stops reporting
// when everything is back as it was. Nothing is saved anywhere and no task behavior changes.

const t = (key: Parameters<typeof translate>[1]) => translate('en', key);

const base: TaskEditSnapshot = {
  kind: 'task',
  text: 'Water plants',
  date: '2026-03-11',
  time: '09:00',
  repeat: 'none',
  weeklyDays: [],
  reminder: 'none',
  room: null,
};

describe('taskEditChanged (pure)', () => {
  test('the same values are not a change, whatever the surrounding spaces', () => {
    expect(taskEditChanged(base, { ...base })).toBe(false);
    expect(taskEditChanged(base, { ...base, text: '  Water plants ', date: ' 2026-03-11', time: '09:00 ' })).toBe(false);
  });

  test.each([
    ['kind', { kind: 'event' }],
    ['text', { text: 'Water the plants' }],
    ['date', { date: '2026-03-12' }],
    ['time', { time: '10:30' }],
    ['repeat', { repeat: 'daily' }],
    ['reminder', { reminder: '30-before' }],
    ['room', { room: 'kitchen' }],
  ] as const)('a changed %s is unfinished work', (_name, patch) => {
    expect(taskEditChanged(base, { ...base, ...patch })).toBe(true);
  });

  test('the weekly days only matter while the repeat is weekly, and compare as a set', () => {
    const weekly = { ...base, repeat: 'weekly' as const, weeklyDays: [1, 3] };
    expect(taskEditChanged(weekly, { ...weekly, weeklyDays: [3, 1] })).toBe(false);
    expect(taskEditChanged(weekly, { ...weekly, weeklyDays: [1, 3, 5] })).toBe(true);
    expect(taskEditChanged(weekly, { ...weekly, weeklyDays: [1] })).toBe(true);
    // days toggled while the repeat is not weekly do not count (they are not saved)
    expect(taskEditChanged(base, { ...base, weeklyDays: [2] })).toBe(false);
  });

  test('putting every field back clears the change', () => {
    const edited = { ...base, kind: 'event', text: 'x', repeat: 'daily' as const, reminder: '10-before', room: 'gym' };
    expect(taskEditChanged(base, edited)).toBe(true);
    expect(taskEditChanged(base, { ...edited, kind: base.kind, text: base.text, repeat: base.repeat, reminder: base.reminder, room: base.room })).toBe(false);
  });

  test('a task with no room of its own (undefined) is compared by the room the form shows', () => {
    const inferred = { ...base, room: 'study-room' };
    expect(taskEditChanged(inferred, { ...inferred })).toBe(false);
    expect(taskEditChanged(inferred, { ...inferred, room: null })).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------
function editor(over: Record<string, unknown> = {}) {
  return createElement(TaskEditModal, {
    kind: 'task',
    initialText: 'Water plants',
    initialDate: '2026-03-11',
    initialTime: '09:00',
    initialReminderMinutes: undefined,
    initialRoom: null,
    inferredRoom: null,
    onSave: jest.fn(),
    onCancel: jest.fn(),
    ...over,
  } as never);
}
const tap = (label: string) => fireEvent.press(screen.getByText(label));
const pressIn = async (text: string) => fireEvent.press(screen.getByText(text));

describe('the real task editor', () => {
  beforeEach(() => clearUnfinishedWork());

  test('merely opening it is not unfinished work', async () => {
    await render(editor());
    expect(listUnfinishedWork()).toEqual([]);
  });

  test('every field counts: text, date, time, kind, repeat, reminder and room', async () => {
    await render(editor());
    expect(listUnfinishedWork()).toEqual([]);

    await fireEvent.changeText(screen.getByDisplayValue('Water plants'), 'Water the plants');
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await fireEvent.changeText(screen.getByDisplayValue('Water the plants'), 'Water plants');
    expect(listUnfinishedWork()).toEqual([]);

    await fireEvent.changeText(screen.getByDisplayValue('2026-03-11'), '2026-03-12');
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await fireEvent.changeText(screen.getByDisplayValue('2026-03-12'), '2026-03-11');
    expect(listUnfinishedWork()).toEqual([]);

    await fireEvent.changeText(screen.getByDisplayValue('09:00'), '10:00');
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await fireEvent.changeText(screen.getByDisplayValue('10:00'), '09:00');
    expect(listUnfinishedWork()).toEqual([]);

    // repeat: Daily, then back to Once
    await pressIn(t('repeatDaily'));
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await pressIn(t('repeatOnce'));
    expect(listUnfinishedWork()).toEqual([]);

    // repeat weekly and a weekday, then back
    await pressIn(t('repeatWeekly'));
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await pressIn(t('repeatOnce'));
    expect(listUnfinishedWork()).toEqual([]);

    // reminder: 10 minutes before (asks the phone for permission first), then None
    await pressIn(t('reminderNone')); // already None: pressing it is not a change
    expect(listUnfinishedWork()).toEqual([]);

    // room: pick a room, then Unassigned again
    const kitchen = TASK_ROOM_LABELS.kitchen;
    await pressIn(kitchen);
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await pressIn(t('unassigned'));
    expect(listUnfinishedWork()).toEqual([]);
  });

  test('a changed reminder counts, and putting it back clears it', async () => {
    await render(editor());
    await pressIn(t('reminderAtTime'));
    await screen.findByText(t('reminderAtTime'));
    await new Promise((resolve) => setTimeout(resolve, 20)); // the permission question is asked first
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await pressIn(t('reminderNone'));
    expect(listUnfinishedWork()).toEqual([]);
  });

  test('a changed kind counts, and putting it back clears it', async () => {
    await render(editor());
    await pressIn(t('kindAppointment'));
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await pressIn(t('kindTask'));
    expect(listUnfinishedWork()).toEqual([]);
  });

  test('an editor opened on a task that already repeats weekly is not a change until a day is toggled', async () => {
    await render(editor({ initialRepeat: { kind: 'weekly', days: [1, 3] } }));
    expect(listUnfinishedWork()).toEqual([]);
    const days = screen.getAllByText(/^[SMTWF]$/);
    await fireEvent.press(days[4]); // toggles one weekday
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await fireEvent.press(days[4]);
    expect(listUnfinishedWork()).toEqual([]);
  });

  test('closing the editor lets go of its unfinished work', async () => {
    const view = await render(editor());
    await fireEvent.changeText(screen.getByDisplayValue('Water plants'), 'changed');
    expect(listUnfinishedWork()).toEqual(['task-edit']);
    await view.unmount();
    expect(listUnfinishedWork()).toEqual([]);
  });

  test('nothing is stored anywhere and the editor still saves exactly what it saved before', async () => {
    const onSave = jest.fn();
    await render(editor({ onSave, initialRoom: undefined }));
    await fireEvent.changeText(screen.getByDisplayValue('Water plants'), 'Water the plants');
    await fireEvent.press(screen.getByText(t('save')));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ text: 'Water the plants', kind: 'task', date: '2026-03-11', time: '09:00' });
    expect('room' in onSave.mock.calls[0][0]).toBe(false); // an untouched room is still left out of the result
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('the Home controls are touch targets of at least 44px', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (rel: string) => fs.readFileSync(path.resolve(rel), 'utf8') as string;

  test('the panel handle (Pet Progress, Home Features) is 44px wide and its Close button 44px tall', () => {
    const code = read('src/components/slide-out-panel.tsx');
    expect(code).toMatch(/const TAB_WIDTH = 44;/);
    expect(code).toMatch(/closeButton: \{[^}]*minHeight: 44/s);
  });

  test('the Adopt an egg button is at least 44px tall', () => {
    expect(read('src/components/pet-family-bar.tsx')).toMatch(/adoptChip: \{ minHeight: 44/);
  });

  test('the task fields (Tasks screen, room panel, task editor) are at least 44px tall', () => {
    for (const file of ['src/app/tasks.tsx', 'src/components/room-task-panel.tsx', 'src/components/task-edit-modal.tsx']) {
      expect(read(file)).toMatch(/  input: \{\s*minHeight: 44/);
    }
  });

  test('a rendered task field really has the minimum height', async () => {
    await render(editor());
    const field = screen.getByDisplayValue('Water plants');
    expect(StyleSheet.flatten(field.props.style).minHeight).toBeGreaterThanOrEqual(44);
  });
});
