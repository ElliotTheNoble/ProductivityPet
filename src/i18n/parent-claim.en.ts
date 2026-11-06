// English strings for the protected first-time Parent PIN setup (a household that already has children but no Parent PIN).
// English is the base language: every key must exist in parent-claim.es.ts (TypeScript checks this).
export const parentClaimEn = {
  pkTitle: 'Finish parent setup',
  pkWhy: "This family has children but no parent PIN yet. Before a PIN can be set up, this device's own security check is needed first.",
  pkHonest:
    'The check only confirms that someone can unlock this device. It does not prove who you are or that you are a parent or guardian, so keep the device passcode private.',
  pkCheck: 'Check device security',
  pkChecking: 'Waiting for the device security check…',
  pkPrompt: 'Confirm to set up the parent PIN',
  pkCancelLabel: 'Cancel',
  pkNotSecured:
    'This device has no screen lock yet. Turn on a passcode, pattern, fingerprint or face unlock in the device settings, then try again. Nothing was changed.',
  pkCancelled: 'The check was cancelled. Nothing was changed.',
  pkFailed: "The device security check didn't succeed. Nothing was changed. You can try again.",
  pkLockout: 'Too many tries. Wait a moment, or unlock the device normally, then try again. Nothing was changed.',
  pkUnavailable: "Device security can't be checked right now. Nothing was changed.",
  pkUnsupported: 'This can only be done in the phone or tablet app, not in a web browser. Nothing was changed.',
  pkClaimRequired: 'The device security check has to be done first.',
  pkBack: 'Back',
  pkPickerButton: 'Finish parent setup',
  pkPickerHint: 'A parent needs to finish setup before Main can be opened.',
  pkCardText: 'A parent has to finish setting up the parent PIN first.',
};
