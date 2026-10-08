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
