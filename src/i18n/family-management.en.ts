// English strings for the Parent Dashboard's family management (add, rename, archive, restore) and Family Health. English is the base
// language: every key must exist in family-management.es.ts (TypeScript checks this). Placeholders are written {name}. The names of
// children are shown exactly as the parent typed them and are never translated.
export const familyManagementEn = {
  // actions
  fmRename: 'Rename',
  fmArchive: 'Archive',
  fmRestore: 'Restore',
  fmRenameLabel: 'Rename {name}',
  fmArchiveLabel: 'Archive {name}',
  fmRestoreLabel: 'Restore {name}',
  fmSelectLabel: 'Select {name}',
  fmArchivedTitle: 'Archived children',
  fmArchivedShow: 'Show archived children ({count})',
  fmArchivedHide: 'Hide archived children ({count})',
  fmArchivedHelp: 'Archived children are hidden from "Who\'s playing today?". Nothing is deleted, and their pets keep aging.',
  fmArchivedAging: 'Their pets keep aging while archived.',
  fmNewName: 'New nickname',

  // confirmation messages (shown only after the change was really saved)
  fmAdded: '{name} was added.',
  fmRenamed: 'Saved. The child is now called {name}.',
  fmArchived: '{name} was archived. Nothing was deleted.',
  fmRestored: '{name} was restored with everything that was saved.',
  fmDismiss: 'Dismiss',

  // a friendly warning, never a block
  fmDuplicate: 'Another child is already called "{name}". You can still use it, but the two will look alike.',

  // errors: always say that nothing was changed
  fmErrorTitle: "That didn't work",
  fmErrStorage: "That couldn't be saved. Nothing was changed. Please try again.",
  fmErrStorageMayBeFull:
    "Saving didn't work twice in a row. The device storage may be full, or something else may be wrong. Nothing was saved. If you can, free some space and try again.",
  fmErrConflict: 'The family list was changed somewhere else. Nothing was overwritten. Please try again.',
  fmErrBlocked: "The family list has a problem (two children share an ID), so it can't be changed. Nothing was changed. See Family health below.",
  fmErrLocked: 'The parent session ended. Unlock the parent area with the PIN and try again. Nothing was changed.',
  fmErrPinRequired: 'A parent PIN has to be set up first. Nothing was changed.',
  fmErrUnconfirmed: 'The recovery code has to be confirmed first. Nothing was changed.',
  fmErrUnavailable: "Family profiles aren't available right now because storage couldn't be checked safely. Nothing was changed.",
  fmErrNotFound: "That child can't be found any more. Nothing was changed.",
  fmErrInvalid: 'Please type a nickname.',
  fmErrActive: "{name} is playing right now. Open Main from \"Who's playing today?\" first, then archive.",
  fmErrOther: 'Something went wrong. Nothing was changed.',

  // archive confirmation
  fmArchiveTitle: 'Archive {name}?',
  fmArchiveSaved: "Nothing is deleted. {name}'s pets, tasks, tokens and everything else stay saved.",
  fmArchiveAging:
    'The pets keep aging while archived. They can get hungry, dirty and sad, may become sick, and may pass away if nobody looks after them.',
  fmArchiveRestoreNote: "Restoring {name} brings everything back as it was, but it does not bring back a pet that passed away.",
  fmArchiveStatus: 'Right now: {status}',
  fmArchiveStatusUnknown: "Right now: the pets' status can't be checked.",
  fmArchiveConfirm: 'Yes, archive {name}',

  // family health
  fmHealthTitle: 'Family health',
  fmHealthIntro: 'Only things that need a look are shown here. Nothing is ever deleted, repaired or merged automatically.',
  fmHealthRefresh: 'Check again',
  fmHealthCareTitle: 'Pets that need care',
  fmHealthCareActive: '{name}: {status}',
  fmHealthCareArchived: '{name} (archived, pets keep aging): {status}',
  fmHealthPetsUnreadable: "{name}: the saved pets can't be read right now. Nothing was changed.",
  fmHealthStoragePaused: 'Family profiles are paused because storage could not be checked safely. Nothing is lost.',
  fmHealthHouseholdUnreadable: "The family list couldn't be read, so nothing can be changed. Nothing was lost.",
  fmHealthUnreadableEntries_one: '{count} entry in the family list could not be understood. A safety copy of the original was kept, and nothing was lost.',
  fmHealthUnreadableEntries_other: '{count} entries in the family list could not be understood. A safety copy of the original was kept, and nothing was lost.',
  fmHealthDuplicate: 'Two or more children share the same permanent ID ({ids}). The family list is read-only until this is sorted out. Nothing was changed.',
  fmHealthInvalidIds_one: "{count} child has an ID that can't be used as a profile, so they are not offered on \"Who's playing today?\". Nothing was changed.",
  fmHealthInvalidIds_other: "{count} children have IDs that can't be used as profiles, so they are not offered on \"Who's playing today?\". Nothing was changed.",
  fmHealthUnlinked_one: "{count} child is not ready to play yet (their profile isn't linked). The app tries again when it starts. Nothing was lost.",
  fmHealthUnlinked_other: "{count} children are not ready to play yet (their profiles aren't linked). The app tries again when it starts. Nothing was lost.",
  fmHealthOrphanEmpty_one: '{count} unused empty profile was left behind by a child that could not be saved. It holds no data and is harmless. Nothing is deleted automatically.',
  fmHealthOrphanEmpty_other: '{count} unused empty profiles were left behind by children that could not be saved. They hold no data and are harmless. Nothing is deleted automatically.',
  fmHealthOrphanData_one: "{count} profile has saved data but no child in the family list. Nothing was deleted, merged or re-linked, and this can't be fixed from here yet.",
  fmHealthOrphanData_other: "{count} profiles have saved data but no child in the family list. Nothing was deleted, merged or re-linked, and this can't be fixed from here yet.",
};
