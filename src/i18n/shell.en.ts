// English strings for the app shell: navigation, the pet selector, shared dialogs and shared words.
// Keys ending in _one / _other are plural forms (see tn() in index.ts).
export const shellEn = {
  // navigation (header)
  navHome: 'Home',
  navTasks: 'Tasks',
  navRooms: 'Rooms',
  navShop: 'Shop',
  navStats: 'Stats',
  navAlerts: 'Pet Care & Alerts',
  brandTagline: 'Small steps. A happier you.',

  // shared words / dialogs
  pleaseWait: 'Please wait…',
  backToStats: '← Back to Stats',

  // pet names and health words
  petLabelKitty: 'Kitty {n}',
  stateHealthy: 'healthy',
  stateSick: 'sick',
  stateCritical: 'critical',
  stateDeceased: 'deceased',
  petChipLabel: '{name}, {state}',

  // pet selector: adopting an egg
  adoptEgg: '＋ Adopt an egg',
  adoptEggLabel: 'Adopt a new egg',
  adoptTitle: 'Adopt a new egg?',
  adoptConfirm: 'Adopt',
  adoptBody:
    'A new egg will join your family. Your other pets, tasks, tokens and history stay exactly as they are. You can care for up to {max} living pets at once ({count} now).',
  adoptLimit: 'You already have {max} living pets.',
  adoptBusy: 'Adoption is already in progress.',
  adoptFail: "Couldn't save the new egg on this device. Nothing was changed — please try again.",

  // language picker (Pet Care & Alerts page)
  languagePickerHelp: 'Choose the language for the app. It changes right away and is remembered.',
};
