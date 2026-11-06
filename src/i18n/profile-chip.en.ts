// English strings for the profile switch chip in the app header (family mode only) and its dialogs. English is the base language:
// every key must exist in profile-chip.es.ts (TypeScript checks this). Placeholders are written {name}.
export const profileChipEn = {
  pcSwitch: 'Switch',
  pcLabel: 'Switch player. Playing as {name}.',
  pcHint: 'Goes back to the list of players. Your pets and progress are saved first.',

  // asked only when something unfinished would be lost
  pcConfirmTitle: 'Switch player?',
  pcConfirmIntro: 'These are not saved yet and will be lost if you switch now:',
  pcConfirmSaved: 'Everything else is already saved.',
  pcConfirmSwitch: 'Switch player',
  pcCancel: 'Cancel',
  pcKindKitty: 'Your Kitty Catch round',
  pcKindMemory: 'Your Memory Match round',
  pcKindBathing: 'The bath you started',
  pcKindTaskDraft: 'The task you are writing',
  pcKindTaskEdit: 'The changes to the task you are editing',
  pcKindJournal: 'The reflection you are writing',

  // when leaving did not work: always say that nothing was lost
  pcFailTitle: "Couldn't switch players",
  pcFailSave: "Some of your changes couldn't be saved yet, so you are still in {name}'s profile. Nothing was lost. Try again in a moment.",
  pcFailSlow: "Saving is taking longer than usual, so you are still in {name}'s profile. Nothing was lost. Try again in a moment.",
  pcFailBusy: "Something is still being saved, so you are still in {name}'s profile. Nothing was lost. Try again in a moment.",
  pcFailOther: "Something went wrong, so you are still in {name}'s profile. Nothing was lost. Try again in a moment.",
  pcTryAgain: 'Try again',
  pcKeepPlaying: 'Keep playing',
};
