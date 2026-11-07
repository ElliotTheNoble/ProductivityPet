// English strings for the single-tab screens and the hand-over question (family mode on the web only). English is the base language:
// every key must exist in tab-lock.es.ts (TypeScript checks this). The blocked screens use the BROWSER's language (nothing is read from
// storage), so they must say nothing about any profile.
export const tabLockEn = {
  // the neutral screens of a tab that does not own ProductivityPet
  tlChecking: 'Checking…',
  tlCheckingBody: 'Making sure only one tab uses ProductivityPet.',

  tlBlockedTitle: 'ProductivityPet is open in another tab',
  tlBlockedBody: "To keep everyone's pets safe, only one tab can use ProductivityPet at a time. Go back to the other tab, or close it.",
  tlAsk: 'Ask the other tab to hand over',
  tlWaitingTitle: 'Waiting for the other tab to close',
  tlWaitingBody: "This browser can't ask the other tab. ProductivityPet will be ready here as soon as the other tab is closed.",

  tlAskingTitle: 'Waiting for the other tab',
  tlAskingBody: 'Go to the other tab and answer its question. This tab switches by itself once the other tab lets go.',

  tlUnansweredTitle: "The other tab didn't answer",
  tlUnansweredBody: 'It may be busy, in the background or stuck. Go back to the other tab, or close it. This tab never takes over by force.',
  tlAskAgain: 'Try asking again',

  tlDeclinedTitle: 'The other tab said no',
  tlDeclinedBody: 'Someone is using it right now, so it kept control. Nothing was changed.',
  tlSaveFailedTitle: "The other tab couldn't save safely",
  tlSaveFailedBody: 'It kept control, so nothing was lost. Try again in a moment.',
  tlNotReadyTitle: "The other tab isn't ready",
  tlNotReadyBody: 'Wait a moment, then ask again.',

  tlFreeTitle: 'ProductivityPet is free',
  tlFreeBody: 'The other tab was closed or let go. You can use this tab now.',
  tlUseThisTab: 'Use this tab',

  tlSwitchingTitle: 'Switching to this tab…',
  tlSwitchingBody: 'One moment. ProductivityPet is opening here.',

  tlReleasedTitle: 'This tab gave ProductivityPet to another tab',
  tlReleasedBody: 'Everything was saved first. You can keep using the other tab.',
  tlLostTitle: 'This tab lost control',
  tlLostBody: 'Something else took over the storage, so nothing more will be saved from this tab. Close this tab, or use the other one.',

  tlUnsupportedInsecureTitle: "This address isn't secure",
  tlUnsupportedInsecureBody: 'ProductivityPet needs a secure address to make sure only one tab uses it. Open it from https:// or from http://localhost.',
  tlUnsupportedNoLocksTitle: "This browser can't keep to one tab",
  tlUnsupportedNoLocksBody: "This browser doesn't support what ProductivityPet needs to make sure only one tab uses it. Try an up-to-date browser.",
  tlUnsupportedNoStorageTitle: "This browser isn't letting ProductivityPet save",
  tlUnsupportedNoStorageBody: 'Saving is blocked (a private window or a browser setting). Allow it for this site, then reload the page.',

  // the question in the tab that IS in use (shown inside the app)
  tlHandoffTitle: 'Another tab wants to use ProductivityPet',
  tlHandoffBody: 'If you let it, this tab saves everything and goes back to the list of players. Then the other tab takes over.',
  tlHandoffUnfinished: 'These are not saved yet and will be lost:',
  tlHandoffLet: 'Let the other tab take over',
  tlHandoffKeep: 'Keep using this tab',
  tlHandoffSaving: 'Saving everything…',
  tlHandoffFailedTitle: "Couldn't save safely",
  tlHandoffFailedBody: "Some changes couldn't be saved, so this tab keeps control and nothing was lost.",
};
