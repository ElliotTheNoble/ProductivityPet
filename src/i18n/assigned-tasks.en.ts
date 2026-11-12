// English strings for the tasks a parent assigns, as a child sees them (in the rooms and on Home) and as a parent picks a room for them.
// English is the base language: every key must exist in assigned-tasks.es.ts (TypeScript checks this). Placeholders are written {name}.
export const assignedTasksEn = {
  atTitle: 'Tasks from my parent',
  atToDo: 'To do',
  atSentBack: 'Try again',
  atWaiting: 'Waiting for my parent',
  atDone: 'I did it!',
  atDoneFor: 'I did it: {task}',
  atAnywhere: 'Anywhere',
  atOutstanding_one: '{count} to do',
  atOutstanding_other: '{count} to do',
  atWaitingCount: '{count} waiting',
  atTabBadge: '{count} tasks from my parent',
  atUndo: 'Undo',
  atUndoFor: 'Undo: {task}',
  atUndoFailed: "Couldn't undo that. Your parent may have looked at it already.",
  atSendFailed: "Couldn't send that. Please try again.",
  atOpenRoom: 'Open {room}',
  // the parent's room choice (Family Settings)
  atRoomPick: 'Room for this task',
  atAnyRoom: 'Anywhere',
  atParentSentBack: 'Sent back for another try',
  atParentRoomLine: 'Room: {room}',
  atCardLabel: '{task}, {state}',
  atCardHintOpen: 'Shows more about this task',
  atCardHintClose: 'Hides the details of this task',
  // Home's Today's Tasks card
  atFromParent: 'From my parent',
  atFromParentRoom: 'From my parent · {room}',
  atHomeRowLabel: '{task}, {state}, {from}',
  atOpenTasksTab: 'Opens your Tasks tab',
};
