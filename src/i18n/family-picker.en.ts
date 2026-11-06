// English strings for the family profile picker ("Who's playing today?"). English is the base language: every key must exist in
// family-picker.es.ts (TypeScript checks this). Placeholders are written {name}. The names of children are shown exactly as the
// parent typed them and are never translated.
export const familyPickerEn = {
  fpTitle: "Who's playing today?",
  fpSubtitle: 'Tap your name to play with your pets.',
  fpLoading: 'Getting things ready…',

  // Main / parent
  fpMain: 'Main',
  fpMainSubProtected: "A parent's own pets. Needs the parent PIN.",
  fpMainLocked: 'Locked. Try again in {time}.',
  fpMainMissingShort: 'Parent PIN missing. Children can still play.',
  fpMainNoPin: 'Main stays locked until a parent sets up the parent PIN. Children can still play.',
  fpMainUnconfirmed: "The parent PIN setup isn't finished yet, so Main stays locked. Children can still play.",
  fpMainUnavailable: "The parent PIN can't be used on this device right now, so Main stays locked. Children can still play.",

  // add a child (parent only)
  fpAddChild: 'Add a child',
  fpAddChildSub: 'A parent adds a child with the parent PIN.',
  fpAddChildNeedsPin: 'A parent has to set up the parent PIN first.',
  fpAddChildBlocked: 'Not available until the parent PIN is set up and working.',
  fpAddChildMissing: "Not available: the parent PIN can't be found on this device.",

  // care badges (never colour alone: every badge has words)
  fpBadgeChecking: 'Checking…',
  fpBadgeHealthy: 'All happy',
  fpBadgeNeedsCare: 'Needs care',
  fpBadgeSick: 'Sick',
  fpBadgeCritical: 'Needs help now',
  fpBadgeDeceased: 'A pet has passed away',
  fpBadgeNew: 'New: an egg is waiting',
  fpBadgeUnreadable: "Can't check right now",

  // accessibility
  fpCardLabel: '{name}. {status}. Double tap to play.',
  fpMainCardLabel: 'Main profile for parents. {status}. {hint}',
  fpAddChildLabel: 'Add a child. {hint}',

  // switching, errors
  fpSwitching: "Getting {name}'s pets ready…",
  fpSwitchingMain: 'Opening Main…',
  fpErrorTitle: "That didn't work",
  fpErrTimeout: 'This is taking too long, so it was stopped. Nothing was changed.',
  fpErrStorage: "This profile couldn't be opened because saving isn't working right now. Nothing was changed.",
  fpErrUnsaved: "Some changes couldn't be saved yet, so opening this profile was stopped to keep everything safe. Nothing was lost.",
  fpErrBusy: 'Something is still finishing. Please try again in a moment.',
  fpErrConflict: 'The family list was changed somewhere else. Please try again.',
  fpErrUnknown: "That profile can't be found any more.",
  fpErrUnavailable: "Family profiles aren't available right now because storage couldn't be checked safely. Nothing is lost.",
  fpRetry: 'Try again',
  fpCancel: 'Back',

  // storage problems on the picker itself
  fpSafeModeTitle: 'Family profiles are paused',
  fpSafeModeBody: "Storage couldn't be checked safely, so the players can't be opened right now. Nothing is lost. You can try again.",
  fpHouseholdUnreadableTitle: "The family list can't be read",
  fpHouseholdUnreadableBody: "The list of players couldn't be read, so nothing was changed. You can try again.",

  fpChildrenNotReadyTitle: 'Some players are not ready yet',
  fpChildrenNotReadyBody: "Some players couldn't be prepared just now, so they are hidden. Nothing is lost. You can try again.",
  fpErrMainLocked: 'Main needs the parent PIN, so it was not opened.',

  // parent PIN prompt (the PIN itself is checked by the existing parent gate)
  fpPinTitle: 'Parent PIN',
  fpPinBodyMain: 'Enter the parent PIN to open Main.',
  fpPinBodyAdd: 'Enter the parent PIN to add a child.',
};
