// English strings for the Parent Gate (the lock screen in front of the parent-only areas). English is the base
// language: every key must exist in parent-gate.es.ts (TypeScript checks this).
export const parentGateEn = {
  pgTitle: 'Parent area',
  pgSubtitle: 'Enter the parent PIN to continue.',
  pgPinLabel: 'Parent PIN',
  pgPinPlaceholder: '4 to 8 digits',
  pgUnlock: 'Unlock',
  pgChecking: 'Checking…',
  pgWrong: "That PIN isn't right.",
  pgTriesLeft_one: '{count} try left before a short pause.',
  pgTriesLeft_other: '{count} tries left before a short pause.',
  pgCooldown: 'Too many tries. Please wait {time} before trying again.',
  pgFormat: 'Enter 4 to 8 digits.',
  pgUnavailable: "The PIN couldn't be checked right now. Nothing was changed. Please try again.",
  pgBackHome: 'Back to Home',
  pgForgotTitle: 'Forgot the PIN?',
  pgForgotText:
    "Use the recovery code you saved to choose a new PIN. If you lost both the PIN and the code, the parent area stays locked and your family's data is kept: it is never deleted to reset a PIN. Parent accounts that can help recover access are planned for a later version.",
  pgHonest: 'This PIN only helps keep children out of the parent area on this device. It does not prove who is using the app.',
  pgVerifierMissing:
    "This device has family data, but its parent PIN can't be found (for example after a restore or on a new device). Your children's data is safe and nothing was changed or deleted. Parent access will need guardian-account recovery, which is planned for a later version.",
  pgUnlockedBar: 'Parent area unlocked',
  pgLockNow: 'Lock now',
  pgCardLocked: 'The parent area is protected by a PIN.',
  pgUnlockButton: 'Unlock parent area',
};
