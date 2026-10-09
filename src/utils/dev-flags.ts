import type { AccessoryPlacement } from '@/utils/pet-accessory-placement';

// Temporary development/testing flags — none of these belong in a real
// release build. Each one is meant to be flipped to false (or this file
// deleted and its imports removed) once the thing it unblocks is done.
// Keeping them in one small, obviously-named file makes them easy to find
// and remove later, instead of scattering `true`/`false` constants across
// unrelated modules.

// When true, @/utils/pet-equipment.ts's equipAccessory() skips its normal
// "must already own this item" check — letting any Pet Accessory be
// equipped for visual testing without actually purchasing it first. This
// exists so hat placements (see @/utils/pet-accessories.ts) can be tuned
// on the real Baby pet without spending Paw Tokens on every hat first.
//
// What this flag does NOT do, by design:
// - It never writes to the real owned-items record (@/utils/shop-inventory.ts)
//   — equipping this way does not mark anything as purchased/owned.
// - It never touches Paw Tokens — no purchase call is made at all.
// - It does not change what "✓ Owned" means anywhere in the Shop.
// Turn this back to false (or delete this flag and the `if` that reads
// it in pet-equipment.ts, plus the dev-only Shop button that uses it in
// shop-screen.tsx) once all hat placements are tuned.
export const DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP = true;

// Read by pet-placeholder.tsx ONLY while DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP
// is true, and ONLY for a headHat item that has no placementOverrides of
// its own yet — so an untuned hat shows up somewhere on the Baby pet
// (using the approved Cat-Ear Beanie placement as a rough starting point)
// instead of staying invisible, making it possible to actually see what
// needs tuning. Purely a render-time fallback: it is never written into
// PET_ACCESSORY_ART, never becomes a real placementOverride, and an item
// that does have its own override always uses that instead, never this.
// Once DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP goes back to false, this stops
// being read at all and untuned hats simply go back to rendering nothing,
// same as before this fallback existed. Delete alongside that flag.
export const DEV_UNTUNED_HEADHAT_FALLBACK_PLACEMENT: AccessoryPlacement = {
  width: '76%',
  marginTop: '13%',
  marginLeft: '4%',
  rotate: '2deg',
};

// When true, @/utils/pet-growth.ts's getGrowthEligibility() skips the
// completed-task-count requirement (30 tasks for Baby -> Young, 40 for
// Young -> Adult) — so a paid growth upgrade can be tested without
// actually completing that many real tasks first.
//
// What this flag does NOT do, by design:
// - It never skips or discounts the Paw Token cost — growPet() still
//   charges the real 500/1,000 tokens and still fails with
//   'insufficient-funds' if the profile doesn't have enough.
// - It never writes paidStageIndex itself or bypasses growPet()'s own
//   serialized read-check-spend-write cycle — a bypassed-eligibility grow
//   is otherwise a completely normal, fully-charged upgrade.
// Turn this back to false (or delete this flag and the check that reads
// it in pet-growth.ts) once Baby -> Young -> Adult has been tested.
export const DEV_BYPASS_GROWTH_TASK_REQUIREMENT = true;

// When true, shows a TEMPORARY "Dev: +1,500 Paw Tokens" button on Home
// (next to the growth test control — see handleDevAddTestTokens in
// src/app/index.tsx) that adds DEV_TEST_PAW_TOKEN_GRANT_AMOUNT tokens
// directly to the real saved Pet Profile, purely so the paid Baby->Young
// (500) and Young->Adult (1,000) growth upgrades can both be tested
// without having actually earned that many tokens through real task/
// appointment completions first.
//
// What this flag does NOT do, by design:
// - It does not change REGULAR_TASK_REWARD/IMPORTANT_TASK_REWARD/
//   APPOINTMENT_REWARD in @/utils/paw-tokens.ts, or anything about how
//   real Paw Tokens are normally earned.
// - It does not change any Shop item price or any growth cost.
// - It is not shown to, or usable by, anyone unless this flag is true —
//   it's an explicit, visible test button, not a silent/automatic grant.
// Turn this back to false (or delete this flag, DEV_TEST_PAW_TOKEN_GRANT_AMOUNT,
// and the button + handler in src/app/index.tsx) once growth testing is done.
export const DEV_ENABLE_TEST_PAW_TOKEN_GRANT = true;
export const DEV_TEST_PAW_TOKEN_GRANT_AMOUNT = 1500;

// When true, shows a TEMPORARY "Dev: Pet Stage Preview" control on Home
// that lets any pet stage (Egg/Hatchling/Baby/Young/Adult) be shown on the
// main pet image + its accessory placement, for visual testing — e.g.
// checking a hat's placement on Baby without needing to actually reach
// Baby through real (or dev-bypassed) progression first.
//
// What this flag does NOT do, by design:
// - It never writes to the real saved Pet Profile — completedTaskCount
//   (derived from real tasks) and paidStageIndex are completely untouched,
//   so no real progression is gained, lost, or skipped.
// - It never calls growPet() or spends/refunds Paw Tokens.
// - It never changes what Pet Progress (Home) or the Stats page's own
//   stage math shows — both keep reflecting the real saved progression
//   exactly as before, regardless of what's being previewed.
// - It is purely local React state (src/app/index.tsx) — never persisted,
//   so a page reload (or its own "Reset to actual stage" button) always
//   returns to the real rendered stage.
// Turn this back to false (or delete this flag and the control + state in
// src/app/index.tsx) once stage/accessory-placement testing is done.
export const DEV_ENABLE_STAGE_PREVIEW = true;
