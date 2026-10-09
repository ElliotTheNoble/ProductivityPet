# Bugs

Track known bugs here. Copy the template for each new bug.

## Template

### [BUG-ID] Short title

- **Status:** Open | Investigating | Fixed | Won't Fix
- **Date reported:**
- **Symptoms:** What is observed going wrong?
- **Hypothesis:** What do we think is causing it?
- **Evidence:** Logs, repro steps, screenshots, or test results supporting the hypothesis.
- **Fix:** What was changed to resolve it (leave blank until fixed).

---

<!-- Add new bugs below this line -->

### [BUG-001] Tapping a task does not mark it complete

- **Status:** Fixed
- **Date reported:** 2026-09-07
- **Symptoms:** Clicking/tapping a task in the task list does nothing — the checkbox glyph and text never change to show the task as completed. Adding tasks, the empty-state message, and the pet placeholder all still work normally.
- **Hypothesis:** The bug is in the completion-toggle logic in the `toggleTask` function in `src/app/index.tsx`. The function finds the tapped task correctly (`task.id === id`), but the object it produces for that task doesn't actually flip the `completed` value — so React re-renders with a "new" task object that has the exact same `completed` value as before, which looks identical on screen.
- **Evidence:** In `src/app/index.tsx`, `toggleTask` builds the updated task as:
  `{ ...task, completed: task.completed }`
  This assigns `completed` to itself instead of negating it. The negation operator (`!`) that would flip `true`/`false` is missing, so the value never changes no matter how many times a task is tapped.
- **Fix:** Restored the negation in `toggleTask` in `src/app/index.tsx`, changing `completed: task.completed` to `completed: !task.completed`, so tapping a matched task now flips its completed state as intended. No other logic was changed.

### [BUG-002] Manually edited PetProfile values in Local Storage appeared to be ignored during Rest/needs testing

- **Status:** Fixed
- **Date reported:** NEEDS DATE — see note below, not guessed
- **Symptoms:** While manually testing the pet Rest/needs system, directly editing PetProfile fields (e.g. `energy`) in the browser's Local Storage did not reliably affect the next pet action as expected. The app would sometimes behave as if the manual edit had never happened, and performing an action afterward could overwrite the manually-edited Local Storage value entirely with the old data.
- **Hypothesis:** `src/utils/pet-profile.ts` keeps a module-level in-memory cache (`cachedProfile`) alongside the persisted Local Storage copy. If the profile had already been loaded once that session, `getPetProfile()` would keep returning the in-memory copy directly instead of re-reading storage — so a manual Local Storage edit made after that point would be invisible to the app. If an action then called `savePetProfile()`, it would write the stale in-memory profile straight back over the manually-edited Local Storage value.
- **Evidence:** In `src/utils/pet-profile.ts`, `cachedProfile` is a module-level variable (`let cachedProfile: PetProfile | null = null;`), and `getPetProfile()` returns it immediately (`if (cachedProfile !== null) return cachedProfile;`) without touching AsyncStorage/Local Storage once it's set. `savePetProfile()` always persists whatever profile object it's given — `{ ...profile, lastUpdatedAt: new Date().toISOString() }` — back into both the in-memory cache and Local Storage, with no re-check against what's currently stored. `loadPetProfileWithNeedsUpdate()` in `src/utils/pet-needs.ts` (the function Rest and the other care actions use to load the profile) calls `getPetProfile()` internally, so it inherits the exact same caching behavior. This matches what we observed: once the profile was loaded in-memory for the session, a manual Local Storage edit stayed invisible to the app until that in-memory cache was cleared.
- **Fix:** This was a testing/debugging procedure issue, not a production code defect — no application code was changed to resolve it. The correct testing procedure is to reload the web page after manually editing a PetProfile value in Local Storage, before testing the dependent pet action. Reloading the page resets `cachedProfile` to `null`, so the next `getPetProfile()` call hydrates fresh from the edited Local Storage value instead of continuing to use stale in-memory state.

### [BUG-003] Kitty Memory Match first-row card artwork clipped at the top

- **Status:** Fixed
- **Date reported:** 2026-10-07
- **Symptoms:** In Kitty Memory Match's active gameplay grid, the first row of cards had their rounded top edges and top decorative details (e.g. the card back's top-left and top-right hearts) visibly cut off at the top of the play area. An initial fix that reserved extra vertical space above the grid did not fully resolve the clipping.
- **Hypothesis:** Two different causes needed to be told apart before trusting either fix: (1) a container/layout clipping problem — the gap reserved between the HUD and the first row wasn't actually reliable, or (2) an incorrect sprite crop rectangle — the card-back image's crop coordinates might themselves be excluding part of the artwork. Fixing the wrong one would not have resolved the visible symptom.
- **Evidence:** For the layout cause: the first attempted fix, in `src/components/mini-games/memory-match-game.tsx`, subtracted a constant (`GRID_VERTICAL_INSET`) from the board's measured height in JavaScript before computing the grid layout, then added that same constant back as the grid's own `paddingVertical`. This only produces a real gap if that manual subtraction matches Flexbox/Yoga's own fractional/sub-pixel layout math exactly — any small sizing/rounding difference could consume the intended gap and let the first row render clipped against the HUD above. For the sprite-crop cause: we separately re-inspected the card-back crop rectangle defined in `src/utils/memory-match.ts` against the source sheet (`assets/images/mini-games/memory_match_icons.png`) using a pixel/alpha-channel scan of the actual image. That confirmed the crop coordinates themselves were correct (no part of the card-back artwork was being excluded by the crop), ruling out an incorrect crop and confirming the clipping was a layout/rendering issue rather than an image-cropping issue.
- **Fix:** Restructured the layout in `src/components/mini-games/memory-match-game.tsx` so the reserved gap is real structural padding instead of manually computed and cancelled-out spacing: the vertical inset is now actual `paddingVertical` on the outer `board` container, and a new inner `boardSurface` view (with no padding of its own) is the element actually measured via `onLayout`. Because `boardSurface` is a plain flex child of the padded `board`, the layout engine hands it a size that already excludes the padding automatically, removing the manual "subtract, then add back" arithmetic entirely. This gives the grid a true content box that already has the reserved clearance built in, so the first row can no longer render flush against (or past) the top edge.

### [BUG-004] Pet Progress panel disagreed with the main pet image about the pet's stage

- **Status:** Fixed
- **Date reported:** 2026-10-09
- **Symptoms:** After paying to grow the pet to Adult and then removing completed tasks (to test what Baby Kitty looks like), the Pet Progress panel on Home dropped back to "Level 1" with "0/10 tasks" — but the main pet image on Home kept showing Adult Kitty. The two parts of the same screen disagreed about what stage the pet was actually on.
- **Hypothesis:** The main pet image and the Pet Progress panel were computing the pet's stage two different ways. The main pet image used `getRenderedStage()`/`getRenderedStageIndex()` in `src/utils/pet-growth.ts`, which correctly factors in `paidStageIndex` (the permanent record of a paid Young/Adult upgrade — see `src/utils/pet-profile.ts`) and never lets the shown stage fall below whatever has already been paid for. Pet Progress (`src/components/pet-progress.tsx`), however, called `getPetStageIndex()` in `src/utils/pet-stage.ts` directly — a pure function of `completedTaskCount` alone, with no knowledge of `paidStageIndex` at all. The Stats page had the same split: its pet art used the paid-aware `getRenderedStage()`, but its own progress bar used the plain, task-count-only `getStageProgress()`.
- **Evidence:** In `src/utils/pet-growth.ts`, `getRenderedStageIndex()` is `Math.max(Math.min(getPetStageIndex(completedTaskCount), FREE_AUTO_MAX_STAGE_INDEX), paidStageIndex)` — i.e. floored at `paidStageIndex`, which `growPet()` only ever increases, never decreases, even if `completedTaskCount` later drops. In `src/components/pet-progress.tsx` (before this fix), `stageIndex` was `getPetStageIndex(completedTaskCount)` — no `paidStageIndex` anywhere in the file, confirmed by `grep -n "paidStageIndex" src/components/pet-progress.tsx` returning no matches before the fix. So once `paidStageIndex` had been raised to Adult, removing tasks dropped `completedTaskCount` (and with it, Pet Progress's self-computed stage) back toward Egg, while the main image — correctly reading `paidStageIndex` — stayed at Adult. The same inspection also turned up a second, related gap in the same code: since `getPetStageIndex()` alone is not capped at Baby, a high enough `completedTaskCount` could make Pet Progress claim Young or Adult from task count alone, with nothing ever actually paid for — the opposite direction of the same underlying problem (Pet Progress not being paid-stage-aware at all).
- **Fix:** Added `getRenderedStageProgress(completedTaskCount, paidStageIndex)` to `src/utils/pet-growth.ts` — the same stage/level/progress-bar shape as the old `getStageProgress()`, but built on the paid-aware `getRenderedStageIndex()` instead of raw task count, with "tasks into this stage" clamped to `[0, TASKS_PER_STAGE]` (it can't stay a meaningful raw difference once the shown stage is held up by payment rather than task count). `src/components/pet-progress.tsx` now takes a `paidStageIndex` prop and calls this instead of `getPetStageIndex()` directly; `src/components/stats-screen.tsx` now calls it instead of `getStageProgress()`. Both call sites in `src/app/index.tsx` were updated to pass `petProfile?.paidStageIndex ?? 0`. Pet Progress and the Stats page's progress bar can no longer show a stage below the one actually rendered on the pet, and can no longer show Young/Adult without an actual paid upgrade.

  Separately, added a development-only **Pet Stage Preview** control (gated behind the new `DEV_ENABLE_STAGE_PREVIEW` flag in `src/utils/dev-flags.ts`) so Egg/Hatchling/Baby/Young/Adult can each be previewed on the main pet image and its accessory placement for visual testing, with a "Reset to actual stage" button to return to the real stage. This is local React state only (`devPreviewStageIndex` in `src/app/index.tsx`) — it is never written to the saved Pet Profile, never touches `completedTaskCount`/`paidStageIndex`/Paw Tokens, and never feeds into Pet Progress, the Stats page, or growth eligibility, so it cannot affect real saved progression; a page reload always returns to the real stage. This directly replaces the previous ad-hoc workaround of removing real completed tasks to preview an earlier stage, which is what surfaced this bug in the first place.
