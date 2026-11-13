// English strings for the onboarding and Parent Dashboard screens (one area of the catalog; see index.ts for how
// the areas are combined). English is the base language: every key must exist in every other language file
// (TypeScript checks this).
export const familyEn = {
  // shared
  appName: 'ProductivityPet',
  back: 'Back',
  continue: 'Continue',
  cancel: 'Cancel',
  save: 'Save',
  edit: 'Edit',
  add: 'Add',
  select: 'Select',
  selected: 'Selected',
  remove: 'Remove',
  comingSoon: 'Coming soon',
  skipForNow: 'Skip for now and use the app as it is',

  // welcome: language
  welcomeLanguageTitle: 'Welcome to ProductivityPet!',
  welcomeLanguageSubtitle: 'Choose your language',

  // welcome: mode
  modeTitle: 'Who is this for?',
  modeSubtitle: 'You can change this later.',
  modeParent: 'Parent / Guardian',
  modeParentDesc: 'Set up and look after a family: add children, assign tasks and review them.',
  modeChild: 'Child',
  modeChildDesc: 'A child account that a parent sets up first.',
  modeIndependent: 'Independent User (16+)',
  modeIndependentDesc: 'Use ProductivityPet on your own.',
  placeholderTitle: 'Coming soon',
  placeholderChild: 'The Child experience is not ready yet. A parent or guardian will set up child profiles from the Parent / Guardian mode. Nothing was created.',
  placeholderIndependent: 'The Independent (16+) experience is not ready yet. Nothing was created, and your current app is unchanged.',

  // welcome: parent profile
  parentSetupTitle: 'Set up your Parent profile',
  parentSetupExplain:
    'The Parent Dashboard is where you add children, give them tasks, review finished tasks and choose each child\'s settings. This profile is saved only on this device. It is not an online account and has no password.',
  parentNameLabel: 'Your name or nickname',
  parentNamePlaceholder: 'For example: Mom, Sam',
  familyNameLabel: 'Family name (optional)',
  familyNamePlaceholder: 'For example: The Garcia Family',
  privacyNote: 'We only ask for nicknames. Please do not enter full legal names, birth dates, emails or addresses.',
  finishSetup: 'Finish setup',
  nameRequired: 'Please enter a name or nickname.',

  // dashboard
  dashboardTitle: 'Family Settings',
  dashboardFor: 'Family',
  localProfileNote: 'Profiles are saved on this device only. They are not secure online accounts.',
  children: 'Children',
  addChild: 'Add a child',
  childNickname: 'Child\'s nickname',
  childNicknamePlaceholder: 'A nickname, not a full name',
  noChildrenTitle: 'No children yet',
  noChildrenText: 'Add a child to start assigning tasks.',
  selectChildFirst: 'Select a child to see their tasks and settings.',
  childProfiles: 'Child profiles',
  tasksWord: 'tasks',
  editChild: 'Edit child',
  saveChild: 'Save',

  assignedTasks: 'Assigned tasks',
  pendingApprovals: 'Pending approvals',
  completedTasks: 'Completed tasks',
  noAssigned: 'Nothing assigned right now.',
  noPending: 'Nothing is waiting for your approval.',
  completedToday: 'Completed today',
  noCompleted: 'Nothing completed today.',
  addTask: 'Add a task',
  taskPlaceholder: 'What should they do?',
  assign: 'Assign',
  approve: 'Approve',
  sendBack: 'Send back',
  deleteTask: 'Delete',
  createdByChild: 'Added by the child',
  createdByParent: 'Added by you',
  waitingForApproval: 'Waiting for your approval',
  approvedOn: 'Approved',
  rewardsNote: 'Approving gives the child the task’s Paw Tokens. Try again gives none.',

  childSettings: 'Child settings',
  childCanCreate: 'Child can create tasks',
  requireApproval: 'Completion needs my approval',
  on: 'On',
  off: 'Off',

  petSafety: 'Pet Safety',
  gentleMode: 'Gentle Mode',
  gentleDesc: 'Pets cannot permanently die. They can still get hungry, tired, dirty or sick, and care still helps them recover.',
  classicMode: 'Classic Mode',
  classicDesc: 'The original rules, including a pet passing away if it is not cared for, and paid resurrection.',

  language: 'Language',
  languageSettings: 'Language settings',

  parentProfile: 'Parent profile',
  editParent: 'Edit profile',

  // entry point for existing users
  familyModeTitle: 'Family & Parent mode',
  familyModeText: 'Set up a Parent / Guardian profile, add children and review their tasks. Your pets, tasks and tokens are not changed.',
  openDashboard: 'Open Family Settings',
  startSetup: 'Set up Parent / Guardian mode',
};

export type FamilyStrings = typeof familyEn;
