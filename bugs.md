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

### [BUG-005] Kitty Becomes Clean After Poop Cleanup

- **Status:** Fixed and tested.
- **Date:** October 10, 2026
- **Description:** Kitty returns to her clean appearance immediately after the player cleans up poop, even though she hasn't been bathed.
- **Expected behavior:** The poop disappears, but Kitty remains dirty until she receives a bath.
- **Actual behavior:** Kitty becomes clean when `hasPoop` is cleared and Cleanliness is above 20%.
- **Cause:** The current dirty-state logic does not remember that Kitty still needs a bath after poop cleanup.
- **Proposed fix:** Add a persistent `needsBath` state that remains active after poop cleanup and is cleared by the completed bathing process.
- **Fix implemented:** Added a persistent `needsBath` field that remembers Kitty needs a bath even after `hasPoop` becomes false. Dirty-state logic now treats Kitty as dirty whenever Cleanliness is at/below 20%, `hasPoop` is true, OR `needsBath` is true, so cleaning up the poop (which only clears `hasPoop`) and restoring Cleanliness no longer clear the dirty appearance on their own — only a completed bathing process will clear `needsBath`.
- **Test results:** Manually tested October 10, 2026 and confirmed working correctly:
  - Triggering poop makes Kitty dirty.
  - Clicking "Clean Up!" removes the poop.
  - Kitty remains dirty after the poop is removed.

### [BUG-006] Poop still active during the Egg stage

- **Status:** Fixed and manually tested successfully.
- **Date:** October 12, 2026
- **Description:** Poop events and poop artwork were still active during the Egg stage, even though the Egg is meant to be a pre-hatching stage with no pet-care features.
- **Expected behavior:** The Egg should have no poop or pet-care features — no poop events, no poop artwork, no Clean Up button, no accessories, no Feed/Bath/Play/Rest, and no Dirty Kitty artwork — regardless of whether the Egg is the pet's real saved stage or is only being shown via the developer Pet Stage Preview.
- **Actual behavior:** Poop artwork and the Clean Up button (and other pet-care controls) could still render while viewing the Egg if the gating only checked the real saved stage — specifically, previewing the Egg (via the developer Stage Preview) on an already-hatched pet with an active poop/dirty state left those controls visible, since they were keyed only on the real stage, not on what was actually being displayed. The developer poop-trigger buttons were also not blocked from writing poop state onto a genuinely unhatched real Egg.
- **Cause:** Egg-stage restrictions were applied inconsistently: pet-care props passed to the Living Room pet were gated on the real saved stage only, which correctly protected real data but didn't hide controls while previewing the Egg on a different real stage. Separately, the developer poop-trigger controls had no Egg guard at all.
- **Fix:** Egg-stage restrictions were applied to poop scheduling, triggering, and rendering: the real poop-event scheduler (`applyPoopScheduling` in `src/utils/pet-poop.ts`) already refused to trigger on a real Egg; rendering is now gated on the currently-*displayed* stage (`isDisplayedEgg`, covering both the real stage and the Pet Stage Preview override) so previewing the Egg correctly hides poop artwork, the Clean Up button, need bars, accessories, and Feed/Bath/Play/Rest; every handler that actually writes to the saved profile (`handleFeed`/`handleBathe`/`handlePlay`/`handleRest`/`handleCleanUpPoop`, and the dev poop-trigger handlers) is separately guarded by the *real* saved stage (`isRealEgg`), so previewing a later stage can never be used to sneak in a real pet-care mutation while the pet is genuinely still an unhatched Egg. The developer poop-trigger buttons are now hidden (with an explanatory note) whenever the real pet is an Egg.
- **Test results:** Manually tested and confirmed working — previewing the Egg hides all pet-care UI even on an already-dirty/hatched pet, a genuinely unhatched Egg shows no poop/Clean Up/accessories/need bars, the developer poop-trigger buttons are disabled on a real Egg, and task completion/hatching progression continue to work normally.

### [BUG-007] Poop piles overlapping or appearing too close together

- **Status:** Fixed and tested.
- **Date:** October 12, 2026
- **Description:** When several poop piles had accumulated on the floor, their random positions could land too close together or directly on top of each other, since the earlier positioning system picked a position for each pile without checking it against its siblings' real size on screen.
- **Expected behavior:** Every pile should have clear visible spacing from every other pile, Kitty, the needs bars, and the Clean Up controls, regardless of how many piles (up to 5) are currently on the floor or which random side of Kitty they land on.
- **Actual behavior:** Piles could be placed close enough to touch or overlap, especially once several had accumulated.
- **Cause:** The original random-placement system picked each pile's spot independently, without comparing its own size (Small/Medium/Large render at different widths/heights) against where other piles already were.
- **Fix:** Added real collision-aware placement (`placePoopPile` in `src/utils/pet-poop.ts`): a new pile's candidate position is checked against every existing pile's own real size-based footprint, requiring a minimum ~25px visible gap. Invalid positions are retried (up to 40 random attempts), with a small set of fixed, still-checked fallback positions used as a last resort so a pile is never left unplaced.
- **Test results:** Manually tested and confirmed working — accumulated piles (including all 5 at once) no longer overlap or sit flush against each other, on both sides of Kitty.

### [BUG-008] Excessive cleanup buttons covering the Living Room

- **Status:** Fixed and tested.
- **Date:** October 12, 2026
- **Description:** Each poop pile had its own separate "Clean Small/Medium/Large" button rendered below Kitty. With up to 5 piles accumulated at once, this row of buttons took up too much of the Living Room screen.
- **Expected behavior:** Cleaning up poop shouldn't require a large, growing block of buttons that crowds out the rest of the Living Room.
- **Actual behavior:** Up to 5 separate orange buttons stacked/wrapped below Kitty, visually dominating the screen whenever several piles were active.
- **Cause:** Cleanup was implemented as one dedicated button per pile rather than an interaction on the poop artwork itself.
- **Fix:** Removed the per-pile button row entirely. Each poop pile's own artwork is now the cleanup control — click it on web, tap it on Android/iOS — with wiggle/shrink feedback on every click, a temporary "N left!" indicator for Medium/Large piles, and a sparkle-and-shrink animation on the final click. See FEATURE-036 in `features.md` for the full implementation.
- **Test results:** Manually tested and confirmed working — poop piles can be cleaned by clicking/tapping directly on them, no separate buttons appear, and the Living Room stays uncluttered even with 5 piles active.

### [BUG-009] Temporary and permanent Hatchling images overlapping during the hatching transition

- **Status:** Fixed and manually tested.
- **Date:** October 13, 2026
- **Description:** During the 5-second hatching sequence, the original (temporary) "just hatched" Kitty picture and the new permanent Hatchling picture were both visible at once — parts of the new Kitty showed through underneath/around the original artwork.
- **Expected behavior:** Only the temporary hatching picture should be visible for the full 5 seconds; the permanent Hatchling picture should stay completely hidden until exactly then, with the two never shown together, even briefly (a plain swap, not a crossfade).
- **Actual behavior:** The implementation rendered two stacked `Image` elements at once — a base image always showing the new permanent Hatchling picture, with an animated overlay fading in/out the old temporary picture on top of it.
- **Cause:** The two pictures have different real aspect ratios (the temporary picture is noticeably wider relative to its height than the permanent one). Since the shared box was sized to the permanent picture's own ratio, the temporary picture — rendered via `contentFit="contain"` inside a box shaped for a different ratio — left thin transparent letterbox gaps around its edges, through which the always-present permanent picture underneath showed through.
- **Fix:** Switched to mutually exclusive rendering. `getStageImage` (`src/components/pet-placeholder.tsx`) now takes an `isShowingHatchIntro` flag and returns exactly ONE `{source, aspectRatio}` pair at a time; the component renders a single `Image` for whichever one was returned. The overlay `Animated.View`, its styles, and the fade/crossfade logic were removed entirely in favor of a direct swap.
- **Test results:** Manually tested via both a real hatch and the Developer Replay Hatching Animation control — the two pictures are never visible together at any point in the 5-second sequence.

### [BUG-010] Pet-needs bars shifting position when Kitty's growth stage or artwork changed

- **Status:** Fixed and manually tested.
- **Date:** October 13, 2026
- **Description:** The Hunger, Cleanliness, Happiness, and Energy bars visibly moved up or down whenever the displayed pet image changed (e.g. switching growth stages, or during the hatching transition).
- **Expected behavior:** The four needs bars should stay at one fixed vertical position regardless of which stage/picture Kitty is currently showing, only ever hidden (not shifted) during the Egg stage or the hatching transition.
- **Actual behavior:** The bars' vertical position changed depending on which pet picture was being displayed.
- **Cause:** The box around Kitty's own artwork (`petWrap` in `src/components/pet-placeholder.tsx`) had its height driven directly by `{ aspectRatio }` from `getStageImage`'s return value — each stage's own real picture ratio (Hatchling, Baby, Young, Adult, Egg, and the temporary hatching picture are all slightly different). Since the box's width was fixed but its ratio varied, its actual rendered height changed every time the picture changed, and the needs-bar row — a plain sibling laid out directly below that box — inherited the same shift.
- **Fix:** Added a fixed `PET_ART_BOX_ASPECT_RATIO` (square) constant; `petWrap` now always uses this one ratio instead of the current picture's own ratio, completely decoupling the box's layout size from whichever stage/picture is showing. The pet's own picture still never stretches — `contentFit="contain"` already scales it using its own true intrinsic dimensions regardless of the box's shape — it just letterboxes slightly inside the box where the two ratios differ.
- **Test results:** Manually tested across Hatchling, Baby, Young, and Adult, and throughout the 5-second hatching transition — the needs bars now stay at exactly the same position the whole time, only disappearing (not shifting) during Egg/the hatching transition.

### [BUG-011] Kitty's message bubble partially cut off or covered by her own artwork

- **Status:** Fixed and manually tested.
- **Date:** October 13, 2026
- **Description:** The speech-bubble message shown above Kitty sat too close to her artwork and could be partially covered when that artwork rendered larger or shifted upward (e.g. the enlarged Egg, or the enlarged temporary hatching picture).
- **Expected behavior:** The message bubble and its text should always be fully visible, never overlapped by Kitty's or the Egg's own artwork, regardless of how big or how far up that artwork currently renders.
- **Actual behavior:** Kitty's/the Egg's artwork is deliberately allowed to visually overflow above its own box when scaled up (the box itself never clips, so the art can grow in place) — because the message bubble is the next sibling rendered just before that box, the overflowing artwork could paint on top of it wherever the two visually overlapped.
- **Cause:** The bubble had only a small, fixed gap from Kitty's own box (`styles.bubble`'s `marginBottom`) and no explicit paint-order control, so it lost to the pet artwork's overflow whenever that overflow reached far enough up.
- **Fix:** In `src/components/pet-placeholder.tsx`, increased the bubble's `marginBottom` by 40px (more clearance from the art below it) and added `zIndex: 1`, which makes the bubble always paint on top of any overflowing artwork regardless of how big a given stage's picture renders — combined with the bubble's own solid background, it and its text now stay fully visible no matter what's behind them.
- **Test results:** Manually tested across Egg, Hatchling, Baby, Young, Adult, and the 5-second hatching animation — the bubble remains fully visible and uncovered in every case.

### [BUG-012] Cleanliness never actually updated after bathing

- **Status:** Fixed
- **Date:** October 21, 2026
- **Description:** Washing Kitty in the Bathroom never changed her saved Cleanliness or `needsBath` — returning to Home (or anywhere else) still showed her as dirty no matter how many times "Wash Kitty" was pressed.
- **Expected behavior:** Finishing a real bath restores Cleanliness to 100% and clears `needsBath`, and Home reflects that immediately.
- **Actual behavior:** The Bathroom's "Wash Kitty" button only ever swapped Kitty to a static soapy picture (`isWashing` local state) and left it there — it never called any persistence function, so Cleanliness/`needsBath` in the saved `PetProfile` never moved.
- **Cause:** The real wash→rinse→dry sequence, and the "a bath just finished" event that should save anything, simply hadn't been built yet — `isWashing` was explicitly step 1 of a planned sequence, with no completion step wired up at all. Separately, Home's own `petProfile` state was only ever loaded once on mount, with no subscription to saves made from other screens, so even a fix on the Bathroom side alone wouldn't have reached Home.
- **Fix:** Added `completeBathing()` (`src/utils/pet-bathing.ts`) — the real "a bath just finished" event, restoring Cleanliness to 100, clearing `needsBath`, and stamping a new `lastBathCompletedAt` timestamp (see FEATURE-041). Wired it to fire once the full interactive Soap → Rinse → Blow Dry mini-game actually completes (`src/components/room-detail-screen.tsx`). Home (`src/app/index.tsx`) now also subscribes to `subscribeToPetProfile` (`src/utils/pet-profile.ts`, an existing mechanism previously only used for the Paw Token balance) so a save made from the Bathroom is reflected on Home immediately, without needing a reload or re-navigation.
- **Test results:** Manually tested — completing a bath now shows Cleanliness at 100% and a clean Kitty on both the Bathroom and Home screens right away.

### [BUG-013] Could not bathe Kitty more than once

- **Status:** Fixed
- **Date:** October 21, 2026
- **Description:** After successfully completing one bath, there was no way to start another — the Soap/Shower Hose/Blow Dryer buttons disappeared from the Bathroom entirely.
- **Expected behavior:** The player can start a new bath at any time, regardless of Cleanliness, `needsBath`, or whether Kitty is currently showing her post-bath Dry pose.
- **Actual behavior:** The whole tool-select row was hidden for the entire 30-minute post-bath Dry-pose hold.
- **Cause:** The row's render condition in `src/components/room-detail-screen.tsx` included `&& !isShowingBathDryHold`. The moment a bath completed, `isShowingBathDryHold` became `true` for the next 30 minutes, hiding every tool button for that whole window — even though the mini-game's own progress counts were already correctly reset and ready to go.
- **Fix:** Removed the `!isShowingBathDryHold` condition from the tool row entirely. Bathing is now always available in the Bathroom (for any real, non-Egg stage), independent of Cleanliness/`needsBath`/the Dry hold.
- **Test results:** Manually tested — a second (and third) bath can now be started immediately after finishing the previous one, including while the Dry pose from the previous bath is still showing.

### [BUG-014] Kitty's sprite incorrectly reverted to Dirty between bathing phases

- **Status:** Fixed
- **Date:** October 21, 2026
- **Description:** Mid-bath, right after fully completing the Soap phase (or Rinse, or Blow Dry), Kitty's picture would flash back to her Dirty sprite for a moment instead of holding the last pose from the phase that just finished (`soap_4`, `rinse_5`, or `dry_5`).
- **Expected behavior:** Kitty keeps showing the last completed phase's own sprite while waiting for the player to pick the next tool, and transitions directly to that next phase's first frame (`rinse_1`, `dry_1`) once selected — never showing Dirty mid-bath.
- **Actual behavior:** The live sprite frame disappeared the instant each phase hit 100%, since the tool auto-deselects right then and the frame calculation only ever produces a value while a tool is both selected and not yet done.
- **Cause:** `miniGameFrame` in `src/components/room-detail-screen.tsx` was `undefined` whenever no tool was selected or the active tool's own phase had just finished. Cleanliness/`needsBath` stay at their dirty values for the entire bath (only `completeBathing()`, at the very end, clears them) — so in that gap, `RoomPet` had nothing authoritative to show and fell through to its normal/Dirty branch, which read as Dirty for however long the gap lasted.
- **Fix:** Added `lastBathingFrameRef`, a ref that remembers the last real frame `miniGameFrame` produced and is shown in its place (`bathingFrame = miniGameFrame ?? lastBathingFrameRef.current`) whenever `miniGameFrame` itself goes `undefined`. It's cleared only once `completeBathing()` is confirmed complete, at which point the real Dry-pose hold takes over display instead.
- **Test results:** Manually tested — Kitty now visibly holds `soap_4`/`rinse_5`/`dry_5` between phases with no Dirty flash, and transitions cleanly to `rinse_1`/`dry_1` the moment the next tool is picked.

### [BUG-015] Kitty returned to Dirty immediately after completing a full bath

- **Status:** Fixed
- **Date:** October 21, 2026
- **Description:** Finishing all three phases (Soap, Rinse, Blow Dry) sometimes showed Kitty as Dirty right away instead of her final Dry pose, and the Soap/Rinse/Blow Dry progress bars snapped back to 0% on their own — looking like the whole bath had silently failed or restarted.
- **Expected behavior:** A successfully completed bath shows the final Dry pose immediately and keeps the mini-game visibly in a "completed" state (100% bars) until the player explicitly chooses to bathe again.
- **Actual behavior:** Two separate issues combined: (1) if an old, already-existing poop pile was still sitting on the floor (uncleaned) when the bath finished, Kitty still read as dirty overall, overriding the Dry pose even though she herself had genuinely just been bathed; (2) the completion effect reset all three progress counts to 0 immediately in its own `finally()`, right as the bath finished.
- **Cause:** (1) The Dry-pose hold's render guard checked the broad `isDirty` (which also includes `poopPiles.length > 0`), not realizing a pre-existing, unrelated floor mess has nothing to do with whether Kitty herself was just bathed. (2) Nothing was wrong with the reset itself, but doing it automatically and immediately made a genuinely successful completion visually indistinguishable from the mini-game spontaneously restarting.
- **Fix:** (1) Changed the Dry-pose hold's override guard from `!isDirty` to `!needsBath` specifically, in both `src/components/room-pet.tsx` and `src/components/pet-placeholder.tsx` — `completeBathing()` always clears `needsBath`, and it can only become `true` again from a genuinely NEW poop event, so a stale pre-existing pile no longer masks a bath that just succeeded, while a fresh accident still correctly overrides it. (2) Removed the automatic reset from the completion effect; the three progress counts now only reset when the player explicitly reselects the Soap tool to start a new bath (`handleSelectTool` in `src/components/room-detail-screen.tsx`), and the Soap button is never disabled so that click always reaches the handler.
- **Test results:** Manually tested, including with an uncleaned poop pile left on the floor during a bath — the Dry pose now shows immediately and reliably on completion, and the progress bars stay at 100% until a new bath is explicitly started.

### [BUG-016] Dirty sprite failed to appear when poop occurred during the Dry-pose hold

- **Status:** Fixed
- **Date:** October 21, 2026
- **Description:** If a new poop accident happened while Kitty was still showing her 30-minute post-bath Dry pose, she kept showing clean/Dry instead of switching to Dirty.
- **Expected behavior:** A genuinely new poop accident should make Kitty look dirty immediately, even mid-hold, overriding the Dry pose.
- **Actual behavior:** The Dry pose kept showing for the rest of the 30 minutes regardless of the new poop.
- **Cause:** The render branch for the Dry-pose hold (`src/components/room-pet.tsx`, `src/components/pet-placeholder.tsx`) originally checked only `isShowingBathDryHold`, with no awareness of Kitty's current dirty state at all.
- **Fix:** Added a dirty-state check to that same branch so it only applies while Kitty isn't currently dirty (later refined, alongside BUG-015's fix, from a broad `isDirty` check to the more precise `!needsBath`, so an old uncleaned pile doesn't ALSO incorrectly trigger this).
- **Test results:** Manually tested — triggering a poop event while the Dry pose is showing now switches Kitty to Dirty immediately, and the Dry pose for the bath that already finished does not reappear.

### [BUG-017] Home screen's Play button (and Feed/Rest/Clean Up) stopped responding on an already-hatched pet

- **Status:** Fixed
- **Date:** October 22, 2026
- **Description:** Pressing Play on Home did nothing — the Mini-Games screen never opened, even for a pet well past the Egg stage (confirmed at the Young stage). Feed/Rest/Clean Up share the exact same guard as Play, so they were equally at risk.
- **Expected behavior:** Play should navigate to `/mini-games` for any real, non-Egg pet, regardless of growth stage; Feed/Rest/Clean Up should likewise fire normally.
- **Actual behavior:** `handlePlay()` (`src/app/index.tsx`) hit its own `if (isRealEgg) return;` guard and returned before ever calling `router.push('/mini-games')` — confirmed via temporary `console.log` calls placed directly in the handler (one before the guard, one right before the navigation call): the first log printed, the second never did.
- **Cause:** `isRealEgg` was computed as a plain `petStage === 'Egg'`, and `petStage` is a pure function of `completedTaskCount` (from the `tasks` state) and `petProfile.paidStageIndex`. Both `tasks` and `petProfile` start at their initial, "not loaded yet" `useState` defaults (`[]` and `null`) before their real async loads from storage resolve — and those defaults are mathematically indistinguishable from "genuinely 0 completed tasks, no paid upgrade" once plugged into the stage formula. So for as long as a render happened before both loads finished, `petStage` misread as `'Egg'` for a pet at ANY real stage, incorrectly blocking every `isRealEgg`-guarded action. Separately (found during the same investigation, a related but independent gap): the free Egg→Hatchling crossing had no protection against ever reading back as `'Egg'` later, unlike the paid Young/Adult stages, which are permanently floored by `paidStageIndex` (see BUG-004) — `hatchedAt` (the one-time, permanently-set record of a real hatch, in `src/utils/pet-profile.ts`) was never consulted by `isRealEgg` at all.
- **Fix:** In `src/app/index.tsx`, `isRealEgg` is now `isHydrated && petProfile !== null && petStage === 'Egg' && !petProfile.hatchedAt` — `isHydrated` (tasks' own existing "finished loading" flag) and `petProfile !== null` together require real, loaded data before `isRealEgg` can ever be `true`, so it can no longer be fooled by either value's own temporary unloaded default; `!petProfile.hatchedAt` additionally floors it permanently false once a real hatch has ever been recorded, mirroring `paidStageIndex`'s own protection for Young/Adult. A genuinely unhatched Egg (`hatchedAt === ''`, real data loaded, `petStage` genuinely `'Egg'`) is completely unaffected — the real restriction is preserved. Also added, while investigating (defensive hardening, not the actual cause but a real latent gap found along the way): Kitty's own picture in `src/components/pet-placeholder.tsx` is now wrapped in a plain `View` with `pointerEvents="none"` instead of passing that prop directly to `expo-image`'s `<Image>` (which silently ignores it — confirmed by grepping its compiled source, zero references anywhere), `petWrap` itself now has `pointerEvents="box-none"`, and the Feed/Play/Rest row (`actionsRow`) was moved 40px lower and given an explicit `zIndex` so it reliably paints/hit-tests above anything that might ever overlap it.
- **Test results:** Manually tested with a Young-stage pet — Play now opens Mini-Games. Feed/Rest/Clean Up share this exact same `isRealEgg` guard, so they're fixed by the same change, but the player only explicitly confirmed Play.

### [BUG-018] Shop Displays Incorrect Kitty Growth Stage

- **Status:** Fixed and tested.
- **Date:** October 23, 2026
- **Description:** When selecting Hatchling, Baby, or Young through the developer Pet Stage Preview on Home (`devPreviewStageIndex` — see BUG-004), the Shop page's Kitty preview displayed the Adult kitty instead of the previewed stage.
- **Expected behavior:** The Shop's Kitty preview should display whatever stage is currently shown on Home, including an active Pet Stage Preview override.
- **Actual behavior:** The Shop kept showing the pet's real saved stage (Adult, for the reporting player) no matter which stage was being previewed on Home.
- **Cause:** Confirmed by inspecting `src/components/shop-screen.tsx` directly — this is not a hardcoded image. The Shop independently computes its own `petStage` via `getRenderedStage(completedTaskCount, paidStageIndex)` (the same real-progression formula Home uses) and was passing that straight to `PetAvatar`. It had no knowledge of `devPreviewStageIndex` (`src/utils/dev-stage-preview.ts`) — the shared, in-memory, never-persisted override Home's own Pet Progress panel sets when a stage icon is tapped. So the Shop always rendered the real stage, with no way to reflect a preview that was active only in that separate module-level value.
- **Fix:** `src/components/shop-screen.tsx` now imports `getDevPreviewStageIndex`/`subscribeToDevPreviewStageIndex` from the exact same `@/utils/dev-stage-preview` module Home uses (no separate preview system was created), subscribes to it the same way Home does, and computes `displayedStage = devPreviewStageIndex !== null ? PET_STAGES[devPreviewStageIndex] : petStage` — the identical formula as Home's own `displayedStage`. `PetAvatar`'s `stage` prop, and the Egg-stage accessory-hiding check, both now use `displayedStage` instead of the real `petStage`. Real progression (`completedTaskCount`/`paidStageIndex`) is untouched, so this is purely a display fix, same as the preview itself.
- **Test results:** Verified via `npx tsc --noEmit` and a clean dev-server bundle; the player has not yet re-confirmed the exact repro (preview each stage on Home, then check Shop) live in the browser.

### [BUG-019] Shop banner cropped on the left edge after enlarging it

- **Status:** Fixed.
- **Date:** October 22, 2026
- **Description:** After an attempt to make the Shop banner (`Shop_Banner.png`) about 20% larger by extending it past its column's left edge (a negative `marginLeft` on `bannerWrap`), the banner's left side — including Kitty's own artwork painted into the banner — was visibly cut off.
- **Expected behavior:** The banner should always render at its full width with nothing cropped, regardless of how large it's sized.
- **Actual behavior:** The left portion of the banner was missing/clipped.
- **Cause:** The enlargement relied on `bannerWrap` extending wider than its parent (`mainColumn`) via a negative `marginLeft`, with the math checked only against the true screen edge. That check didn't account for the Shop page's own `ScrollView`, which clips horizontal overflow — so the bled-left portion of the banner was being rendered past the scrollable content's own edge and cut off there, regardless of how much room was actually left before the true screen edge.
- **Fix:** Reverted `bannerWrap` to a plain `width: '100%'` of `mainColumn` with no margin/offset of any kind — a box that's exactly 100% of its parent's width can never overflow it, so the banner is always fully visible and correctly centered by construction. The later "75% bigger" Kitty enlargement (see FEATURE-042) resized the Kitty preview instead, which doesn't share this risk.
- **Test results:** Verified via `npx tsc --noEmit` and a clean dev-server bundle; the player confirmed the banner displays correctly after this fix.

### [BUG-020] Pet Stage Preview selection did not survive a page refresh

- **Status:** Fixed.
- **Date:** October 23, 2026
- **Description:** After manually selecting a growth stage to preview (e.g. Baby) via the clickable stage icons on Home's Pet Progress panel, refreshing the browser (or closing and reopening the app) silently reverted the displayed Kitty back to her real saved stage (Adult, for the reporting player) instead of staying on the selected preview.
- **Expected behavior:** A manually selected preview stage should persist across a refresh/app restart, the same as any other saved preference, and should stay synchronized across every screen that shows the Kitty (Home, every individual Room, and the Shop's Kitty preview) without needing a refresh to pick up a change made elsewhere.
- **Actual behavior:** The preview reset to `null` (no override, falling back to the real stage) on every fresh page load.
- **Cause:** Investigated `@/utils/dev-stage-preview.ts` directly rather than assuming. The cross-screen synchronization the player asked to verify was already working correctly — it's a shared, module-level value (`previewStageIndex` + a listener set) that Home, every Room (via the shared `RoomDetailScreen` component), and the Shop's Kitty preview all already read from and subscribe to, by design (see BUG-004/BUG-018, which first added this pattern). The actual bug was narrower: this module was explicitly, deliberately **in-memory only** — its own top-of-file comment stated "NEVER persisted to AsyncStorage" — so `setDevPreviewStageIndex()` never wrote the selection anywhere durable, and a fresh page load always started from `previewStageIndex = null`.
- **Fix:** `@/utils/dev-stage-preview.ts` now persists the selection to `AsyncStorage` (key `@ProductivityPet:devPreviewStageIndex`, the same storage mechanism/naming convention `pet-profile.ts` already uses) whenever `setDevPreviewStageIndex()` is called — `null` (clearing the preview) removes the saved key instead of writing it, so a cleared preview also stays cleared after a refresh. On module load (i.e., once per app session, at startup), the saved value is read from storage and applied to the existing in-memory variable, then delivered to every already-mounted screen through the exact same `subscribeToDevPreviewStageIndex` listener mechanism already used for a live selection change — so no consumer file (`src/app/index.tsx`, `src/components/room-detail-screen.tsx`, `src/components/shop-screen.tsx`) needed any changes at all; they already called `getDevPreviewStageIndex()`/`subscribeToDevPreviewStageIndex()` the same way, and the exported functions' signatures didn't change. The load path never calls `setDevPreviewStageIndex()` itself (it sets the plain variable directly and notifies listeners), so hydrating from storage can never overwrite the very value it's reading. Real progression (`completedTaskCount`, `paidStageIndex`, Paw Tokens) is untouched — this remains a display-only override, exactly as before.
- **Test results:** Verified via `npx tsc --noEmit` and a clean dev-server bundle. The player has not yet re-confirmed the full test scenario list (select each stage + refresh, cross-screen sync, clearing the preview, Play/Feed/Rest still gated on the real stage) live in the browser.

### [BUG-021] Shop Kitty preview showed misaligned accessories at the Young growth stage

- **Status:** Fixed.
- **Date:** October 23, 2026
- **Description:** On the Shop's Kitty preview, equipping an accessory while viewing the Young stage showed it in the wrong position — e.g. the White Cat-Ear Beanie sat too high and was cut off at the top of Kitty's head. The same beanie on the same Young-stage Kitty on Home was positioned correctly. Baby and Adult were unaffected.
- **Expected behavior:** The Shop preview should use the exact same accessory position/scale/rotation as Home, for every stage.
- **Actual behavior:** Only Young-stage accessories were misaligned in the Shop; the underlying placement DATA (`pet-accessory-placement.ts`/`pet-accessories.ts`) was always the same shared source both screens already read from — confirmed by inspection, not assumed — so the bug was in how that shared data gets rendered, not in the data itself.
- **Cause:** Home's pet renderer (`src/components/pet-placeholder.tsx`) renders Kitty's body image at `youngScale` (1.21x, via a `transform: scale` on the Image only) specifically while the stage is Young — every Young-stage accessory placement percentage in the shared data was tuned BY EYE against that already-enlarged body. Critically, the accessory's own overlay is never itself scaled on Home (`accessoryOverlay`'s transform only ever carries `translateY`, confirmed in `pet-placeholder.tsx`) — it's positioned purely as a percentage of the surrounding box, which stays a fixed size regardless of the body's own scale. `src/components/pet-avatar.tsx` (the Shop's Kitty preview) reused that same placement data correctly, but never applied `youngScale` to its own body image at all — rendering the body at a flat 1x while using placement percentages tuned for a 1.21x-bigger body. The same percentage math, applied to a visibly smaller head, pushed hats up and off it. `pet-avatar.tsx`'s outer box also had its own `overflow: 'hidden'` (added when the component was first built, to guarantee it could never overflow a small header slot it no longer actually occupies), which would have clipped the correctly-scaled body/accessory once this was fixed.
- **Fix:** Exported `YOUNG_SCALE` from `pet-placeholder.tsx` (previously module-local) instead of adding a second hardcoded copy, and imported it into `pet-avatar.tsx` — the single shared source of truth the player's investigation request asked for. `PetAvatar` now computes `youngScale` with the exact same `stage === 'Young' ? YOUNG_SCALE : 1` logic as Home and applies it to its body Image's own transform, mirroring Home's rendering exactly; the accessory overlay itself was already, correctly, never scaled directly (matching Home) — only the body needed the change. Removed `overflow: 'hidden'` from `PetAvatar`'s outer box, matching Home's own `petWrap`, which also deliberately never clips, specifically so a stage's scaled-up body and any accessory near its edge are never cut off. No accessory placement data, and no part of `pet-placeholder.tsx`'s own Home rendering, was modified — only how `pet-avatar.tsx` renders using that same existing data.
- **Trade-off, disclosed rather than hidden:** the Shop's Young-stage Kitty now renders about 21% larger than she did immediately before this fix (matching Home's own Young-stage size, rather than the flat size every stage rendered at before) — this is an unavoidable, direct consequence of fixing the actual cause (rendering her at the wrong, smaller size relative to her accessories' tuned placement was the bug). Baby and Adult render at exactly the same size as before — only Young is affected. The enlarged Young body/accessory may now also extend very slightly past the preview's own box, the same way Young Kitty is deliberately allowed to overflow her box on Home.
- **Test results:** Verified via `npx tsc --noEmit` and a clean dev-server bundle. The player has not yet re-confirmed the fix live in the browser across Baby/Young/Adult and multiple accessory types (hats, bows, bandanas).

---

## Bug review — 2026-10-26 (documentation pass before the next commit)

**Status vocabulary used below.** "Fixed in code" = the cause was found and changed and `npx tsc --noEmit` passes. "Manually verified" = the player explicitly confirmed it in the running app. A bug is only called manually verified when there is evidence of that; everything else is left as "not yet manually verified". Original descriptions above are unchanged.

- **BUG-018** (Shop showed the wrong growth stage): fixed in code. Its original test note says the exact repro (preview each stage on Home, then open the Shop) was not re-confirmed live. Still **not manually verified**. Since then the Shop's kitty became the shared `PetAvatar` (hat + bow slots, artwork-following placements), which BUG-018's shared preview store still drives.
- **BUG-019** (Shop banner cropped): fixed and **manually verified** by the player (see its test results).
- **BUG-020** (Pet Stage Preview lost on refresh): **fixed in code, not yet manually verified.** Still outstanding, from its own test list: pick each stage and refresh the page; check Home, a Room and the Shop all agree; clear the preview with "Reset to Actual Stage" and refresh (it should stay cleared); confirm Play/Feed/Rest still follow the real stage. Nothing in later work changed `src/utils/dev-stage-preview.ts`, and Stats now also reads the same store (FEATURE-047).
- **BUG-021** (Young-stage accessories misaligned in the Shop): **fixed in code, not yet manually verified against its own test list.** There is indirect evidence only: after the fix the player tuned and finalized all Young hat and bow positions, but never explicitly confirmed the fix on Baby/Young/Adult across hat, bow and bandana types in the Shop. Still outstanding: compare the same hat on Home and in the Shop at Baby, Young and Adult. Later changes touched the same code path (`PetAvatar` now draws a hat and a bow, and looks placements up through `getPlacementStageForArtwork`), so this is worth re-checking after the Hatchling/Baby swap.
- **BUG-001 to BUG-017:** each already records its own fix and manual test result; none was re-opened, and nothing in this round changed the code they cover except the shared task-saving path (`persistCachedTasks`, now also checks for the hatch), which BUG-017's "Home actions don't respond on an already-hatched pet" guard does not depend on. Not re-tested in this pass.

### Recent areas reviewed (no new defect found in code, manual testing still pending)

- **Stats / kitty stage sync.** Stats now reads the same pieces as Home and the Shop (`getRenderedStage`, the shared preview store, `subscribeToPetProfile`, `getEquippedAccessories`, `PetAvatar`). Fixed in code; not manually verified. The Stats page only reads the equipped accessories when it opens, so an equip change made while Stats is open (not possible today, since equipping happens in the Shop) would not show until the next visit.
- **Hat + bow equipment sync.** Two independent saved slots with a one-time migration of the old single id. Fixed in code; not manually verified (equip both, change each, unequip each, restart).
- **Hatch-date recording.** Moved into `persistCachedTasks` so it no longer depends on Home being open. Fixed in code; not manually verified (complete the 10th task from the Tasks page and from a Room, check Pet Album "Born On", restart). Pets that hatched before this have no date by design.
- **Mood history persistence.** Append-only log in AsyncStorage with a live subscription. Not manually verified across a restart.
- **Token history duplication.** Task earnings use an id derived from the occurrence and recording an existing id is a no-op; mini-game rewards are recorded once per payout. Not manually verified (refresh and restart after earning).
- **Streak calculations.** Derived on the fly from tasks with the "today isn't over yet" rule. Logic reviewed by reading; not run against multi-day data. Needs a manual or date-shifted test.
- **Year in Review accuracy.** Counts only dated data and stops at today for the current year. One defect found (BUG-022).

### [BUG-022] Year in Review can hide a pet milestone that happened today (UTC date vs. local date)

- **Status:** Fixed in code (2026-10-26) — **not yet manually verified**
- **Date reported:** 2026-10-26 (found while reviewing code; not reproduced in the app)
- **Symptoms:** For the current year ("Your Year So Far"), a kitty milestone (egg arrival, hatch or end date) that happened late in the player's local day may not appear until the next day, and near a year boundary could land in the wrong year's date check.
- **Hypothesis:** `src/components/year-review-screen.tsx` decides whether a pet milestone is "up to today" with `upToToday(m.iso.slice(0, 10))`. That slice is the UTC calendar date of the ISO timestamp, but `today` is the player's LOCAL date. In time zones behind UTC, an evening local time has a UTC date of "tomorrow", so the check `dateISO <= today` fails. (The year filter itself uses the local year and is fine.)
- **Evidence:** Code reading only; no user report. Everything else on the page uses local dates (`dateToISO`).
- **Fix:** `src/components/year-review-screen.tsx` now converts a pet milestone's stored timestamp to the player's LOCAL calendar date with a new `localDateOf()` (`dateToISO(new Date(iso))`) and uses that for both the year check and the "up to today" check, instead of slicing the UTC date out of the ISO string. Stored timestamps are unchanged. Local-date conversion handles time-zone offsets, daylight saving and New Year boundaries because it uses the local year/month/day of that exact moment. Other date handling was reviewed and was already local: mood check-ins and token events store a local `dateISO`, task dates use `dateToISO`, and the Pet Album formats dates with `toLocaleDateString`. The app records only egg-arrival, hatch and (future) end dates for pets — it does not record growth-stage dates, so there are none to place.
- **Test results:** `npx tsc --noEmit` passes. **Not yet manually verified.** To check: set the device time zone behind UTC (or test in the evening), hatch or adopt a kitty, and confirm "Your Year So Far" lists the milestone on the same local day; also check a milestone dated December 31 / January 1.

### [BUG-023] Hatchling/Baby artwork swap was not applied to the Room and bathing sprites

- **Status:** Fixed in code (2026-10-26) — **not yet manually verified** (see Fix and the checklist below)
- **Date reported:** 2026-10-26
- **Symptoms:** Home, the Shop, Stats, the Pet Album and the Bathroom's normal/dirty pose show the swapped Hatchling/Baby kitties, but the four activity Rooms (Study Room, Gym, Bedroom, Kitchen) and the Bathroom's bathing and drying frames still use the old per-stage sprite sheets, so a Hatchling or Baby can look like the other kitty depending on the page.
- **Hypothesis:** The swap was made only in `getStageImage()` (`src/components/pet-placeholder.tsx`), as requested. The Rooms read `src/utils/room-pet-art.ts` (one sheet per room) and the bathing art `src/utils/bathing-stage-art.ts`, which are keyed by stage and were deliberately left alone.
- **Evidence:** Code reading (`room-pet-art.ts` lists separate `Hatchling` and `Baby` crops per room sheet).
- **Fix:** One shared swap, `getArtworkStage()` in `src/utils/pet-stage.ts` (Hatchling ↔ Baby; Egg, Young and Adult map to themselves), now drives every lookup that is tied to a specific kitty picture, so the data stays attached to the artwork it was made for and nothing tuned was rewritten:
  - **Pictures:** `getStageImage()` (normal and Dirty art, used by Home, the Shop, Stats, the Pet Album and the Bathroom) now selects its original per-picture table through `getArtworkStage` instead of having the entries hand-swapped. `getRoomPetArt()` (Study Room, Gym, Bedroom, Kitchen), `getWashingKittyArt()` and `getBathingStepArt()` (soap, rinse and dry frames) in `src/utils/room-pet-art.ts` / `bathing-stage-art.ts` look their crops up the same way. The crop boxes, files and animation timing are unchanged.
  - **Data tuned to a picture:** accessory placements (`getPlacementStageForArtwork`, which now just calls the shared function) and each room's pet size/offset (`resolveRoomPetPlacement` in `room-pet-placement.ts`) read the entry belonging to the picture now shown, so the Hatchling stage uses what was tuned for the former Baby artwork and vice versa. No placement value was changed.
  - **Pet Progress stage icons** (`pet-stage-icon.tsx`) follow the swap too, so the Hatchling and Baby icons match the kitties. This was not explicitly requested; revert by removing the one `getArtworkStage` call there.
  - **Checked and left alone:** the poop-spot minimum distance (`POOP_ZONE_MIN_X_BY_STAGE`) is 100 for both stages, so the swap changes nothing there. The temporary "just hatched" nest picture is a Hatchling-stage special case and is unchanged (see BUG-024). Young, Adult and Egg artwork, accessories and growth requirements were not touched. To undo the whole swap, make `getArtworkStage` return `stage` unchanged.
- **Test results:** `npx tsc --noEmit` passes. **Not yet manually verified.** To check: with the Hatchling and then the Baby stage (use the Pet Stage Preview), compare Home, the Shop, Stats, Pet Album, Study Room, Gym, Bedroom, Kitchen, the Bathroom and a full bath (soap, rinse and dry frames, plus the Dirty look) — the Hatchling should show the former Baby kitty everywhere and the Baby the former Hatchling; confirm a worn hat and bow sit correctly on both, the kitty is sized and placed sensibly in each room, and the Pet Progress icons match.

### [BUG-024] During the 5-second "just hatched" picture, accessories use the swapped Baby-art placement

- **Status:** Investigating (unverified)
- **Date reported:** 2026-10-26
- **Symptoms:** Possible: if a hat or bow is worn at the moment of hatching, it may sit slightly off the temporary nest picture (`kitten_nest.png`) for those few seconds.
- **Hypothesis:** The nest picture is still a Hatchling-stage image, but Hatchling now reads the placement entries tuned for the former Baby artwork (`getPlacementStageForArtwork`). Before the swap it used placements tuned for the permanent Hatchling art, which was already a different picture from the nest art, so this may not be new.
- **Evidence:** Code reading only; never seen on screen.
- **Fix:** None yet. Check by hatching (or the developer "preview hatching animation" control) while wearing a hat.

### [BUG-025] Reflection "Saved ✓" confirmation may not appear

- **Status:** Fixed in code (2026-10-26) — **not yet manually verified**
- **Date reported:** 2026-10-26
- **Symptoms:** Possible: after pressing Save/Update on a daily reflection, the small "Saved ✓" text may flash too briefly or not at all (the reflection itself is saved either way).
- **Hypothesis:** In `src/components/mood-journey-screen.tsx`, saving updates the stored reflection, which re-runs an effect that resets `savedFlash` to false; whether that happens before or after `handleSave` sets it to true depends on React's update ordering.
- **Evidence:** Code reading only; cosmetic.
- **Investigation result:** confirmed by reading the code, and not timing-dependent. One effect in `src/components/mood-journey-screen.tsx` reset the status message AND re-synced the editor, and it depended on the saved reflection's text. Saving a new or changed reflection changes that text, so the effect re-ran right after `handleSave` set the message and cleared it again (it would only have survived when re-saving unchanged text). A second weakness: the message showed after every save attempt, because saving never reported whether storage actually succeeded.
- **Fix:** the effect is split in two: one clears the status only when the selected day changes; the other keeps the editor in sync with the stored text without touching the status. `saveReflection` / `deleteReflection` (`src/utils/journal.ts`) now return `true` only if the write to device storage succeeded (listeners and the in-memory list still update immediately, as before). The screen shows "Saved ✓" only on success, shows "Couldn't save on this device — please try again." on failure, shows nothing when saving empty text just clears a day, and ignores a result that arrives after the player has moved to another day. Editing, deleting and the stored format are unchanged, so existing entries are untouched.
- **Test results:** `npx tsc --noEmit` passes. **Not yet manually verified.** To check: save a new reflection, edit and update it, delete it, switch days right after saving, and restart the app to confirm entries persist.

### [BUG-026] Developer test controls and bypass flags are switched on

- **Status:** Open (release checklist item, not a code defect)
- **Date reported:** 2026-10-26
- **Symptoms:** `src/utils/dev-flags.ts` has `DEV_ALLOW_UNOWNED_ACCESSORY_EQUIP`, `DEV_BYPASS_GROWTH_TASK_REQUIREMENT`, `DEV_ENABLE_TEST_PAW_TOKEN_GRANT` (1500 tokens), `DEV_ENABLE_STAGE_PREVIEW`, `DEV_ENABLE_DIRTY_TEST_CONTROLS` and `DEV_ENABLE_HATCH_INTRO_PREVIEW` all set to `true`. These were already `true` in the last commit and were not changed in this round.
- **Hypothesis:** Left on deliberately for testing (hat tuning, growth, previews).
- **Evidence:** File contents. Note: the test token grant adds to the balance without a token-history event, so the balance can exceed recorded earnings while it is used.
- **Fix:** None. Set these to `false` before any public release.


### [BUG-027] Resurrection hospital-truck artwork is a temporary stand-in

- **Status:** Fixed in code (2026-10-26) — **not yet manually verified**. `assets/images/resurrection/ambulance.png` (1774 x 887, transparent) is now used, and `Memorial_Tombstone.png` (1536 x 1024, transparent) shows on Home for a passed-away pet. Both are referenced from `src/utils/resurrection-art.ts`; the temporary 🚑 card was removed. Check: resurrect a pet and watch the truck (whole picture slides in from the left, stops centre, bar fills over 60 seconds, slides out right, pet revealed; Skip; reduced motion), and check the tombstone on Home on web and Android.
- **Date reported:** 2026-10-26
- **Symptoms:** The resurrection animation shows a pastel card with a 🚑 emoji instead of a hospital-truck picture.
- **Hypothesis:** No truck artwork exists in the project and none was invented. The slot is `HOSPITAL_TRUCK_SOURCE` in `src/utils/resurrection-art.ts`.
- **Evidence:** File contents.
- **Fix:** Provide a transparent-background PNG of the pastel (pink / mint / cream, paw-print and heart decorations) veterinary truck, side view, facing right, about 1200 x 600 px (2:1), then set `HOSPITAL_TRUCK_SOURCE` to `require(...)` it.

### [BUG-028] A deceased pet's care tools are still visible in the Rooms

- **Status:** Fixed in code (2026-10-28) via BUG-047; not separately verified on screen
- **Update (2026-10-28):** the Room care tools and bathing are now hidden for a deceased pet (see BUG-047; `petDeceased` gating in `room-detail-screen.tsx`). Checked by code reading, not on screen.
- **Date reported:** 2026-10-26
- **Symptoms:** Possible: with a passed-away pet selected, the Room pages (for example the Bathroom tools) still show their controls. Home hides them.
- **Hypothesis:** Only Home was gated. Care actions on a deceased pet are ignored at the storage layer (`savePetProfileForSelectedPet` only accepts Paw Token changes for a deceased pet), so nothing is changed or charged, but the controls look usable.
- **Evidence:** Code reading; not seen on screen.
- **Fix:** Not fixed. Suggested: hide or disable the room care controls when `petProfile.lifeState === 'deceased'`.

### [BUG-029] Pet family, health alerts and flashlight are not yet tested in the running app

- **Status:** Open (testing outstanding)
- **Date reported:** 2026-10-26
- **Symptoms:** None known. The health rules (37 checks) and the family store (47 checks: migration, adoption limit, growth split, health, resurrection, failed saves, restart) passed in throwaway automated runs, and `npx tsc --noEmit` passes, but the screens, notifications and flashlight have not been tried on a device.
- **Hypothesis / things to check manually:** switching pets on every page (accessories, needs, stage follow the selected pet); adopting up to 3 and the 4th refused; migration keeps the existing kitty, tokens and accessories; Sick / Critical / death using the developer buttons on /pet-alerts, including a 96-hour jump; recovery at 50; Energy 0 sleep; resurrection (500 charged once, same pet, needs 75, animation resume and Skip); token amounts 10/15, 20/30, 30/45; notifications and the three-flash alert in a new development build (Expo Go cannot do these); Samsung Camera Flash Notification; an Android emulator or a real device.
- **Fix:** n/a.

### [BUG-030] Pet Stage Preview was shared by all pets, so adopted pets looked stuck as Eggs

- **Status:** Fixed in code (2026-10-26) — **not yet manually verified**. `npx tsc --noEmit` passes.
- **Date reported:** 2026-10-26
- **Symptoms:** After adopting 3 pets, the Pet Stage Preview seemed to keep every pet an Egg, and the temporary developer controls seemed to treat pets as Eggs.
- **Cause (from reading the code; not reproduced on screen):** (1) The preview was ONE global value, not tied to a pet, so a choice made for one pet was shown for whichever pet was selected, and could not be set per pet. (2) New adopted pets really are Eggs (by design, with no decay, sickness or care), and the lifecycle / poop developer tools correctly do nothing on a real Egg — with no way to give a new pet real growth, that looked like "stuck as Eggs". (3) The Hatching replay's local screen state was not cleared when switching pets. The Pet Family chips and the Pet Album show each pet's REAL stage by design, not the preview.
- **Fix:** The preview is now stored per pet (keyed by pet id, new storage key `@ProductivityPet:devPreviewStageIndexByPet`; the old global key is not migrated). Switching pets shows each pet's own preview; "Reset to Actual Stage" clears only the selected pet's. It is display-only, never changes growth, hatch dates or needs, and does nothing outside development builds (`__DEV__`). Real Eggs still get no care or mini-games from a preview (gameplay uses the real stage). The Hatching replay is cancelled when the selected pet changes. A profile read for a different pet can no longer overwrite the selected pet when saving. New dev-only button "+10 growth tasks" on Pet Care & Alerts > Developer Tools adds REAL growth to the selected pet only (hatching an Egg normally and recording its hatch date). Developer controls: +1500 Paw Tokens changes the shared wallet; Cleanliness / piles / needsBath / lifecycle controls change the selected pet only.
- **Files:** `src/utils/dev-stage-preview.ts`, `src/components/pet-progress.tsx`, `src/utils/pet-family.ts`, `src/app/index.tsx`, `src/components/pet-alerts-screen.tsx`.
- **To test manually:** preview Kitty 1 Adult, Kitty 2 Baby, Kitty 3 Hatchling; switch between them on Home, Rooms, Shop, Stats; Reset to Actual Stage; confirm an Egg with an Adult preview still has no Feed/Play/Rest; refresh the page; use "+10 growth" on one pet and confirm the others are unchanged; +1500 Paw Tokens shows the same total for every pet.

### [BUG-031] A previewed stage did not unlock gameplay (feature request: "Dev: Set Actual Stage")

- **Status:** Added in code (2026-10-26) — **not yet manually verified**. `npx tsc --noEmit` passes.
- **Date reported:** 2026-10-26
- **Symptoms:** With the Pet Stage Preview set to an older stage, Home still says "Poop triggers disabled — Kitty is still an Egg." This is expected: the preview is display-only by design.
- **Fix:** New development-only control on Pet Care & Alerts > Developer Tools: "Dev: Set Actual Stage" (Egg / Hatchling / Baby / Young / Adult), behind a confirmation that explains the change is saved. It uses the existing stage rules instead of an override: the SELECTED pet's growth credit is set to the stage threshold (0 / 10 / 20 / 30 / 40 completed-task credits) and `paidStageIndex` to 3 or 4 for Young / Adult (0 otherwise), so Home, Pet Family, Pet Album, Rooms, Shop, Stats and every age check read the same stage, and it survives a refresh. No Paw Tokens, completed tasks or award records are created. Pet id, needs, health state, equipment, purchases and event history are untouched. A hatch date and "hatched" album event are recorded only if the pet never hatched; the "highest stage reached" never goes down (so lowering a stage keeps the old peak). After the change the pet's visual preview is cleared. The Pet Stage Preview is unchanged. Deceased pets are ignored. Later real tasks add to the new credit as usual, and lowering a stage lowers the credit (the already-awarded task records are not re-awarded).
- **Files:** `src/utils/pet-family.ts` (`devSetSelectedPetActualStage`), `src/components/pet-alerts-screen.tsx`.
- **To test manually:** set Kitty 1 Adult, Kitty 2 Baby, Kitty 3 Young; confirm the poop message, Feed / Bathe / Play / Rest and the mini-games unlock for the grown pets; switch pets and refresh to confirm each keeps its stage; check Home, Pet Family, Album, Rooms, Shop and Stats agree; lowering a stage back to Egg stops decay and sickness; confirm Paw Tokens did not change.

### [BUG-032] Sick and Critical kitties still show their happy artwork (artwork needed)

- **Status (2026-10-27 update):** Artwork now connected in code — **not yet manually verified**, and the head alignment is an estimate that may need nudging. `npx tsc --noEmit` passes. The supplied sheets `assets/images/pets/Sick/sick_kitty.png` and `critical_kitty.png` (four kitties each, smallest to largest = the `pet_hatchling` / `pet_baby` / `pet_young` / `pet_adult` pictures; the sheets are untouched) were cropped, like the Dirty kitties, into 8 standalone transparent PNGs in `assets/images/pets/health/` (`sick_*.png`, `critical_*.png`, original pixels, no resampling) and wired into `src/utils/pet-health-art.ts`, keyed by artwork stage so the Hatchling/Baby swap still holds. A Sick / Critical pet shows that picture on Home and in every Room (a running bath still wins); recovering returns to the normal picture; Eggs never use it. **Critical kitties (2026-10-27 clarification):** the four Critical kitties are intentionally lying down and are shown exactly as drawn, resting on the floor — their paws/belly sit on the same floor line as the healthy picture and they are centred under it, at a scale that keeps them inside the pet box (Hatchling 1.0, Baby 1.1, Young 1.4, Adult 1.3). Sick kitties keep their sitting/standing poses (head-aligned). Worn hats and bows keep their saved placements and are moved (and slightly resized) with the head by an extra transform on the accessory layer only, so the lower, lying head still wears them. **Alignment (Sick):** saved accessory offsets and placements were not changed. Each sick picture is instead scaled and positioned so its head lines up with the healthy picture's head (`HEALTHY`, `SCALE` and per-picture `domeX/domeY` in `pet-health-art.ts`, estimated by eye from overlays), so existing hats/bows should land on the head; if one is off for a state/stage, nudge those numbers. Rooms show no accessories, so nothing to align there. Health rules, timers, progress and saved data are untouched.
- **Earlier status (2026-10-26):** Structure added in code; waiting for artwork.
- **Date reported:** 2026-10-26
- **Symptoms:** A Sick or Critical kitty keeps its normal picture.
- **Fix so far:** `src/utils/pet-health-art.ts` + a `healthState` prop through Home → `PetRoom` → `PetPlaceholder`. No existing picture, size or accessory placement was changed; the size/aspect ratio of the normal picture is reused so hats and bows stay where they are tuned.
- **Assets needed (8 transparent PNGs), save in `assets/images/pets/health/`** — each the SAME pixel size and framing (same pose area, same position inside the canvas) as the picture it is based on, so the accessories line up:
  - `sick_hatchling.png` and `critical_hatchling.png` — 429 x 407, based on `pet_hatchling.png`
  - `sick_baby.png` and `critical_baby.png` — 540 x 540, based on `pet_baby.png`
  - `sick_young.png` and `critical_young.png` — 827 x 752, based on `pet_young.png`
  - `sick_adult.png` and `critical_adult.png` — 769 x 780, based on `pet_adult.png`
  - Names follow the PICTURE file, not the stage name: because the Hatchling and Baby artwork are swapped, the stage called "Baby" in the app currently shows `pet_hatchling.png`, so it uses `sick_hatchling.png` / `critical_hatchling.png`, and the "Hatchling" stage uses the `_baby` pair. Sick = tired / sad / unwell; Critical = weaker and resting. No Egg versions are needed.
  - Optional later: Dirty-and-Sick combinations are not planned; a Sick picture takes priority over the Dirty one while it exists.
- **To finish:** put the files in that folder and replace the matching `null` entries in `src/utils/pet-health-art.ts` with `require('@/assets/images/pets/health/<file>.png')` (a `require` of a missing file would stop the app bundling, so the entries cannot be pre-wired). Ask me and I'll do it.
- **To test manually:** the banner text and name for Kitty 1 / 2 / 3; it does not repeat the speech bubble; narrow and wide screens; the Happiness 0 / 25 / 50 / 100 buttons change only the selected pet; raising Hunger, Cleanliness and Happiness all to 50+ clears the banner and returns to Healthy.

### [BUG-033] Poop and bathing while a pet is Sick or Critical (design change) + Sick Baby kitty height in the Rooms

- **Status:** Done in code (2026-10-27) — **not yet manually verified**. `npx tsc --noEmit` passes; the two earlier throwaway test runs (health rules, family store) still pass.
- **Poop / bathing paused (that pet only):** while a pet is Sick or Critical it makes no new poop (the accumulation check, the schedule and the dev "add pile" buttons all do nothing), its existing piles stay on the floor, "Clean Up!" on the piles is hidden / ignored, and the bathing mini-game tools are replaced in the Bathroom by a single free **Gentle Wipe-Down** (+25 Cleanliness per tap, no Paw Tokens, touches Cleanliness only). That is the accessible way to reach Cleanliness 50 without developer tools; Feed, Play, Rest and everything else are untouched, and the sickness timers, the 50 recovery threshold and resurrection are unchanged. `completeBathing` also refuses to finish a bath for an unwell pet, and a bath in progress is cancelled if the pet becomes unwell. When the pet recovers to Healthy, bathing and poop work again automatically; its poop schedule is set to "pick a fresh time" on recovery (`nextPoopEventAt` cleared) so the illness isn't counted as time piles should have appeared, and existing piles / `needsBath` / bathing progress are never reset. Healthy pets are unaffected. Hint texts that said "give her a bath" now say "a gentle wipe-down in the Bathroom".
- **Sick Baby kitty lower in the Rooms:** the Sick picture shown at the **Baby** stage (artwork key `Hatchling`, via the Hatchling/Baby swap) is moved 10 px down in all rooms and the bathroom (`SICK_BABY_ROOM_OFFSET_Y_PX` in `src/utils/pet-health-art.ts`; nudge to taste). Home, healthy Baby, Critical Baby and every other stage/state are unchanged; PNGs untouched; Rooms show no accessories so accessory alignment (Home) is unaffected.
- **Files:** `src/utils/pet-poop.ts`, `src/utils/pet-bathing.ts`, `src/utils/pet-lifecycle-core.ts`, `src/utils/pet-life-messages.ts`, `src/utils/pet-health-art.ts`, `src/components/room-detail-screen.tsx`, `src/components/room-pet.tsx`, `src/app/index.tsx`.
- **To test manually:** make a pet Sick (Dev: Happiness 0), confirm no new piles (fast-forward button does nothing), pile "Clean Up!" hidden but piles stay, Bathroom shows only the Gentle Wipe-Down and no soap/hose/dryer, two wipes take Cleanliness 0 to 50, and with Hunger/Happiness at 50+ the pet recovers; then bathing and piles return; a healthy second pet still poops and bathes normally the whole time; Critical behaves the same; Sick Baby is slightly lower in every room and the bathroom while other stages are unchanged.

### [BUG-034] Sick Baby height, Gentle Wipe-Down mini-game, and Sick/Critical artwork + browse-only Shop

- **Status:** Done in code (2026-10-27) — **not yet manually verified**. `npx tsc --noEmit` passes.
- **Sick Baby lower:** the Sick picture at the **Baby** stage (artwork key `Hatchling`, via the Hatchling/Baby swap) is another 10 px lower: 20 px total in the Rooms and Bathroom, and 10 px on Home (worn hats/bows on Home move with it by the same amount; saved placements are untouched). `SICK_BABY_ROOM_OFFSET_Y_PX` and `SICK_BABY_HOME_OFFSET_Y_PX` in `src/utils/pet-health-art.ts`. Healthy Baby, Critical Baby and all other stages/states are unchanged. The small Shop / Stats / family-chip portraits don't get this nudge.
- **Gentle Wipe-Down mini-game** (`src/components/gentle-wipe-game.tsx`): while a pet is Sick or Critical the Bathroom shows its Sick / Critical picture and, instead of soap / shower / blow-dry, a pastel washcloth the player drags over the kitty (mouse on desktop, finger on mobile; the browser scroll/selection is blocked during the drag). A small progress bar above the kitty fills only from real dragging over the kitty (about 1200 px of travel); at 100% it awards exactly +25 Cleanliness once (free; nothing else changes) via `gentleWipePet`, then offers "Wipe again" if Cleanliness is still under 100. The kitty keeps its Sick / Critical artwork unless the pet actually recovers, at which point the normal Bathroom bathing returns. The normal bathing mini-game for Healthy pets is untouched.
- **Sick / Critical artwork everywhere:** besides Home and the Rooms, `PetAvatar` (Shop preview, Stats, family chips) now takes the pet's health state, so each pet's picture follows its own health (Healthy normal, Sick, Critical; deceased keeps the existing memorial on Home). Pet Album entries still show their real stage in normal artwork.
- **Shop while Sick / Critical:** the Shop opens and can be browsed (the preview kitty shows the Sick / Critical picture); all Buy and Equip / Unequip buttons are disabled and ignored, with the note "Your kitty needs some rest! Shopping will be available when she feels better." Purchases, equipped accessories and the shared Paw Token balance are untouched; Healthy pets shop normally. (A deceased pet keeps its earlier rule: buying allowed, equipping paused.)
- **Files:** `src/utils/pet-health-art.ts`, `src/components/pet-placeholder.tsx`, `src/components/pet-avatar.tsx`, `src/components/gentle-wipe-game.tsx` (new), `src/components/room-detail-screen.tsx`, `src/components/shop-screen.tsx`, `src/components/stats-screen.tsx`, `src/components/pet-family-bar.tsx`.
- **To test manually:** Sick Baby slightly lower on Home / Rooms / Bathroom with paws on the floor and a hat still on its head; wipe with mouse and touch; progress only grows while dragging over the kitty; completion gives exactly +25 once, "Wipe again" works, nothing else changes; recovering switches back to normal bathing and normal art; each pet shows its own artwork in Home, Rooms, Shop, Stats and the chips when switching; Shop browse works but Buy / Equip are disabled with the message for a Sick / Critical pet and work again for a Healthy one; Critical artwork in the Shop and Stats portraits looks right (alignment there is estimated).

### [BUG-035] Sick Young kitty too high; Gentle Wipe-Down finished too quickly

- **Status:** Done in code (2026-10-27) — **not yet manually verified**. `npx tsc --noEmit` passes.
- **Sick Young lower:** the Sick Young picture is 10 px lower on Home (worn hats/bows move with it through the existing health accessory transform; saved placements untouched) and 10 px lower in the **Bathroom only** (new `bathroomOffsetY`, applied in `room-pet.tsx` only when `roomSlug === 'bathroom'`; other rooms unchanged). `SICK_YOUNG_HOME_OFFSET_Y_PX` / `SICK_YOUNG_BATHROOM_OFFSET_Y_PX` in `src/utils/pet-health-art.ts`. Healthy/Critical Young, Sick Baby, Hatchling, Adult and the PNGs are unchanged.
- **Gentle Wipe-Down longer:** `WIPE_PATH_PX` 1200 -> 1800 (50% more valid dragging) in `src/components/gentle-wipe-game.tsx`. Nothing else changed: no timer, no progress from holding still or dragging outside the kitty, still exactly +25 Cleanliness once per session, free, "Wipe again" unchanged. Normal bathing untouched.
- **To test manually:** Sick Young sits lower on Home and in the Bathroom with paws on the floor and hat/bow still on the head; other rooms and other stages look the same as before; a wipe session takes about 1.5x the dragging and still awards +25 once.

### [BUG-036] Sick Young kitty still too high on Home

- **Status:** Done in code (2026-10-27) — **not yet manually verified**. `npx tsc --noEmit` passes.
- **Change:** `SICK_YOUNG_HOME_OFFSET_Y_PX` 10 -> 40 in `src/utils/pet-health-art.ts` (30 px lower on Home only). The existing offset is reused, so there is no second positioning rule: the picture and the hat/bow layer both use `homeOffsetY`, and the horizontal position is untouched. The Bathroom offset (`SICK_YOUNG_BATHROOM_OFFSET_Y_PX`), other rooms, Healthy/Critical Young, Sick Baby, other stages, PNGs, saved accessory offsets, Gentle Wipe-Down and health rules are unchanged.
- **Clipping:** the shift is a pixel transform, not a layout change, and the pet area has no clipping container (only each accessory's own frame clips), so smaller screens behave like larger ones; worth a visual check on a narrow window.
- **To test manually:** Sick Young sits on the pink rug with paws resting naturally and fully visible, centred; hat/bow still on her head; try a narrow window; Bathroom and other pets/stages look as before.

### [BUG-037] Sick Young Home offset changes "not visible" — investigation

- **Status:** Investigated 2026-10-27. The code path is correct; a stale dev bundle is the most likely reason the changes weren't seen. **Not confirmed on the user's machine — please re-test after restarting the dev server with a cleared cache** (`npx expo start -c`, then hard-refresh the browser).
- **Rendering path (traced):** `src/app/index.tsx` -> `PetRoom` -> `PetPlaceholder` (`src/components/pet-placeholder.tsx`). With `healthState` sick/critical, `getHealthArt(stage, healthState)` (stage `Young` -> artwork key `Young`; the Hatchling/Baby swap doesn't touch Young) returns `homeOffsetY = SICK_YOUNG_HOME_OFFSET_Y_PX`, and the picture's wrapper gets `translateY: kittyOffsetY(-30) + homeOffsetY` then `scale(1.21)`. The hat/bow layer gets the same `homeOffsetY` through `getHealthAccessoryTransform`. No other transform, wrapper or style overrides it (translate is applied before the Young scale, so it is a flat pixel shift). One rule, no stacked offsets.
- **Measured in a real run (web build in headless Edge, seeded Sick Young pet):** with the offset at 40 the wrapper's computed transform was `matrix(1.21,0,0,1.21,0,10)` (-30 + 40) and the Sick Young image sat at y=448; with a temporary 100 it was `...,0,70` and y=508 — the constant moves the final position 1:1.
- **Why changes looked unchanged:** while testing, the running Expo dev server kept serving the old bundle after edits (constant still 40 after I changed it to 100) until the server was restarted. A stale bundle explains "no visible difference" across several edits.
- **Change made (readout since removed, see BUG-039):** no position change (stays 40 = 30 px lower than before on Home). Added a development-only readout under the Home pet while Sick/Critical, e.g. `health offset: -30 + 40 = 10px`, so a stale bundle is obvious (if it doesn't match `SICK_YOUNG_HOME_OFFSET_Y_PX`, the app is running old code). It never shows in a production build. Remove the `__DEV__ && healthArt` block in `pet-placeholder.tsx` when no longer needed.
- **Unchanged:** Bathroom and other Rooms, Healthy/Critical Young, Sick Baby and other stages, artwork, saved accessory placements, Gentle Wipe-Down, health rules.
- **To test manually:** restart with `npx expo start -c`; the readout should read `-30 + 40 = 10px`; the kitty should sit lower than before on the rug with hat/bow on her head. If you want her lower still, change `SICK_YOUNG_HOME_OFFSET_Y_PX` and confirm the readout changes.

### [BUG-038] Sick Young kitty another 60 px lower on Home (offset 100) without overlapping the needs bars

- **Status:** Done in code (2026-10-27). `npx tsc --noEmit` passes. Looked at in a real web run (1070x905 viewport, seeded Sick Young pet) — **not yet checked on a phone-sized layout or with hats/bows**.
- **Change:** `SICK_YOUNG_HOME_OFFSET_Y_PX` 40 -> 100 (`src/utils/pet-health-art.ts`). Measured: the Sick Young picture moved from y=448 to y=508 on screen (exactly 60 px; wrapper transform `translateY(70)` = -30 + 100), horizontally unchanged. Hats/bows use the same offset.
- **Overlap fix:** at 100 the kitty would have covered the Hunger/Cleanliness/Happiness/Energy bars. `pet-placeholder.tsx` now shifts the needs bars and the Feed/Play/Rest row down by `homeOffsetY - HEALTH_FREE_SPACE_PX(55)` = 45 px, visually only (a first attempt adding real space under the pet box moved the whole bottom-anchored layout *up* and undone the move, so I switched to a transform). Needs values, bar functionality and buttons are unchanged; this only applies to Sick/Critical pets whose Home offset exceeds 55 (today only Sick Young), so Healthy pets and every other stage/state keep their layout.
- **Seen in the run:** the paws sit on the rug, just above the bars; on this window width the Energy bar's right end now passes under the right-hand "Temporary test control" card (a translucent card overlapping it), and Feed/Play/Rest sit near the bottom edge of the window (page can scroll). Worth a look at your own window size.
- **Dev readout** (from BUG-037) now reads `-30 + 100 = 70px` for this pet; remove it when no longer needed.
- **Unchanged:** Bathroom and other Rooms, Healthy/Critical Young, Sick Baby and other stages, artwork, saved accessory placements, Gentle Wipe-Down, health rules, pet progress.

### [BUG-039] Sick/Critical artwork positioning "not working" on Home — the "just bathed" Dry pose was taking priority

- **Status:** Fixed in code (2026-10-27) and confirmed by the user on a Home screenshot (Sick/Critical artwork displays correctly). The temporary debug visuals used to find it have been removed. `npx tsc --noEmit` passes.
- **What happened:** after a normal bath, Home shows a freshly bathed Dry pose for 30 minutes (`lastBathCompletedAt`, `BATH_DRY_HOLD_MS`). That Dry pose was being prioritized over the Sick/Critical artwork, so a pet that got sick within 30 minutes of a bath kept showing the healthy Dry kitty on Home. Every Sick/Critical positioning change (the Sick Young Home offset raised 10 -> 40 -> 100, hat/bow alignment) was applied to a picture that wasn't on screen, which made it look as though our health artwork positioning changes weren't working. The offsets themselves were correct: with the Dry pose out of the way, the Sick Young image moved exactly 1:1 with the constant (y=448 at 40, y=508 at 100) at desktop and 390 px widths.
- **Fix:** `src/components/pet-placeholder.tsx` — the Dry pose is skipped whenever a Sick/Critical picture exists (`!healthArt &&`), so Sick/Critical artwork always takes priority over the Dry pose. Healthy pets still keep their normal 30-minute Dry pose. A code comment next to the condition explains why it must stay.
- **Where:** `PetPlaceholder` (Home) only; the Dry-pose branch was the one rendering instead of the health artwork.
- **Cleanup:** the red outline and DEBUG label (stage / health state / dry pose / offset) added during the investigation, with their styles, are gone.
- **Unchanged:** offsets, Bathroom/Rooms, other stages/states, artwork, accessory placements, Gentle Wipe-Down, health rules, saved data.

### [BUG-040] Sick Baby lower in the Bathroom; narrow-screen Home spacing under a lowered Sick kitty

- **Status:** Done in code (2026-10-27) — `npx tsc --noEmit` passes; Home was looked at in a real web run at 1070 px and 390 px widths. Bathroom position **not yet checked on screen**.
- **Sick Baby in the Bathroom:** another 15 px down, Bathroom only (`SICK_BABY_BATHROOM_OFFSET_Y_PX` in `src/utils/pet-health-art.ts`, the existing `bathroomOffsetY`, on top of the existing Rooms offset, applied once in `room-pet.tsx`). Home and other Rooms, Critical/Healthy Baby, Sick Young and every other stage are unchanged; artwork and accessory placements untouched.
- **Mobile Home overlap:** on the narrow (phone) layout the lowered Sick Young kitty's paws touched the needs bars. The desktop layout is bottom-anchored, so it keeps the visual 45 px shift of the bars/buttons (unchanged). The narrow layout flows top-to-bottom, so `PetRoom` -> `PetPlaceholder` now gets `reserveHealthSpace` (set by the narrow `<PetRoom>` in `src/app/index.tsx`) and reserves real space under the pet box (45 px + 20 px clearance, `HEALTH_NARROW_CLEARANCE_PX`): the bars, Feed/Play/Rest row and the cards below move down together instead of overlapping, and the kitty stays on the rug. Only Sick/Critical pets whose Home offset is above 55 px (today: Sick Young) get any extra space, so Healthy pets and all other stages/states keep their layout. Needs values, health rules and care actions are untouched.
- **Seen at 390 px:** Sick Young clear of the bars, buttons and speech bubble; Sick Adult and Healthy Young unchanged. Sick Baby, Critical Young and Critical/Healthy at other stages were not individually shot (their Home offsets are under the 55 px threshold, so their layout code path is unchanged).
- **To test manually:** Sick Baby in the Bathroom (paws on the rug, centered, nothing else moved; Home/other rooms unchanged); phone-width Home for Sick/Critical/Healthy pets at each stage (no overlap with bars/buttons/bubble; page scrolls normally); desktop Home unchanged.

### [BUG-041] Sick Baby "not moving" in the Bathroom (same Dry-pose trap as BUG-039); Sick Young lower in the Bathroom; phone-width header scrolled sideways

- **Status:** Done in code (2026-10-27) — `npx tsc --noEmit` passes; checked in a real web run (headless Edge, seeded pets) at 1070, 390 and 360 px widths. Bathroom Sick Baby/Young **final look still needs your eye**.
- **Why Sick Baby wasn't moving in the Bathroom:** `RoomPet` (`src/components/room-pet.tsx`) skipped the Sick/Critical picture whenever it thought a bath was in progress (`bathInProgress`: a bathing frame was set, or the 30-minute freshly-bathed Dry pose was active and `needsBath` false). A pet that was bathed while healthy and then got sick kept showing the healthy bathing / Dry art in the Bathroom, so the Sick Baby offsets (20 Rooms + 15 Bathroom) were applied to a picture that wasn't on screen. Same root cause as BUG-039 on Home. Checked and ruled out: the artwork lookup (Sick Baby = artwork key `Hatchling`, via the Hatchling/Baby swap, is correct and the offset is keyed on it), the Gentle Wipe-Down (it is an overlay on the same `RoomPet` image, not a second pet image), other styles/transforms (none override the translate; the Bathroom has only the `bathroomOffsetY` rule).
- **Fix:** `RoomPet` now always shows the Sick/Critical picture when one exists (the `bathInProgress` bypass is removed; a comment explains why). Sick/Critical pets can't take a normal bath, so nothing is lost; healthy pets and their bathing art are unchanged. In the test run a Sick Young bathed 'just now' now shows the Sick picture in the Bathroom.
- **Sick Baby:** no new offset — the existing 35 px total in the Bathroom (20 Rooms + 15 Bathroom-only) now actually shows. Raise `SICK_BABY_BATHROOM_OFFSET_Y_PX` only if it still looks high after you've seen it.
- **Sick Young in the Bathroom:** another 20 px down (`SICK_YOUNG_BATHROOM_OFFSET_Y_PX` 10 -> 30, Bathroom only; Home and other Rooms, Healthy/Critical Young unchanged).
- **Phone-width Home — what I found:** the Home page scrolled sideways by ~109 px at 390 px (and 360 px) for every pet, caused by the header nav row (Home/Tasks/Rooms/Shop/Stats + bell, ~499 px wide) not shrinking (react-native-web items default to `flexShrink: 0`). Fix: `src/components/app-header.tsx` nav gets `maxWidth: '100%'` and `flexShrink: 1`, so the pills wrap onto a second row. After the fix `scrollWidth == innerWidth` and no sideways scroll at 390 and 360 px. The needs-bars overlap from BUG-040 was already fixed and was re-checked: no overlap with bars, buttons or the speech bubble for Sick Young (390 and 360), Sick/Critical Baby (390 and 360 / 390), Critical Young (390) and Healthy Young/Baby (390). At 360x740 the Feed/Play/Rest row for the Sick pets is below the visible window until you scroll.
- **Unchanged:** desktop Home, Gentle Wipe-Down (1800 px), other stages and health art, accessory placements, PNGs, health rules, Shop restrictions, saved data.
- **To test manually:** Bathroom with Sick Baby and Sick Young (paws on the rug, centered, not hidden behind "Back to Rooms" on phone widths); do a normal bath on a healthy pet, make it sick, and check the Bathroom shows the Sick picture; header wraps nicely on a real phone; Critical Young/Baby and Healthy pets on phone widths in your own browser.

### [BUG-042] Phone-width Rooms: Kitchen kitty off-screen, oversized Back button, task pill over pet chips, wipe-down in every room

- **Status:** Done in code (2026-10-27) — `npx tsc --noEmit` passes; Kitchen, Bathroom and Gym looked at in a real web run (headless Edge, seeded Critical Young) at 390 px (and Kitchen/Bathroom at 360 px). Not run on a real phone; the Study Room and Bedroom were not screenshotted.
- **Gentle Wipe-Down only in the Bathroom (the important one):** `GentleWipeGame` was rendered for any Sick/Critical pet in *every* room (the room check only existed on the instruction banner), so the washcloth and bar appeared in the Kitchen, Gym, etc. and wiping there awarded Cleanliness. Now `room-detail-screen.tsx` renders it only when `room.slug === 'bathroom'`; the completion handler also refuses outside the Bathroom; the session is keyed to room + pet (switching either restarts/removes it); and `gentleWipePet(now, expectedPetId)` in `pet-bathing.ts` awards nothing if the selected pet is no longer the one the session started with. Unchanged: 1800 px requirement, exactly +25 per completed session, washcloth look and mouse/touch behaviour, normal Bathroom bathing for Healthy pets. Checked in the app: the wipe bar/text exist in the Bathroom (390 and 360 px) and not in the Kitchen (390, 360) or Gym (390).
- **Kitchen kitty off-screen on phones:** Kitchen's pet placement pushes the pet box right by fixed pixels (280 px + 120–180 px per stage), tuned for desktop; on a 390 px screen that moved the pet off the right edge and made the page scroll sideways. `resolveRoomPetPlacement` (`src/utils/room-pet-placement.ts`) now caps the rightward shift at 60 px below 700 px width (desktop >= 700 px untouched). Result at 390/360 px: kitty fully visible on the kitchen floor/rug, no sideways scroll.
- **Back to Rooms smaller on phones:** under 700 px it is a smaller pill (13 px text, tighter padding, ~32 px tall) in the bottom-left corner (`room-detail-screen.tsx`); desktop styling unchanged; same navigation.
- **Task pill covering the pet chips / banner area:** the collapsed room-task pill ("Kitchen (0/0)") was positioned inside its own zero-height wrapper, so it appeared right under the header at the top-left/right, over the pet chips. It is now anchored to the bottom row (`room-task-panel.tsx`), on the right on phones (Kitchen no longer docks it left on phones so it doesn't collide with Back to Rooms). The health banner also gets 8 px extra top spacing on phones (`pet-family-bar.tsx`). Banner icon/message/countdown unchanged. At 390 and 360 px the banner no longer overlaps the nav, chips or any pill.
- **Unchanged:** desktop room layouts, other pet/health artwork positions, saved data, health rules, Shop restrictions.
- **To test manually:** on a phone or Chrome responsive mode (360/390): Kitchen with Healthy, Sick and Critical pets at every stage (kitty visible, not behind the stool/Back button more than before); Study Room, Bedroom, Gym; Back to Rooms easy to tap and not over the face; expand the task pill (it opens as a bottom panel); wiping only in the Bathroom, and switching room/pet mid-wipe awards nothing; desktop Kitchen/Rooms unchanged.

### [BUG-043] Bathroom phone banner overlap (one combined message); Kitchen phone framing and kitty height

- **Status:** Done in code (2026-10-27) — `npx tsc --noEmit` passes; Bathroom and Kitchen looked at in a real web run at 390 px and 360 px (plus desktop Kitchen/Bathroom at 1070 px). Not run on a real phone.
- **Bathroom message overlap:** on a phone the urgent-care banner and the separate "Too poorly for a bath…" message overlapped. Now, only while a Sick/Critical pet is in the Bathroom, the banner's description reads "Too sick for a bath — gently drag the washcloth over her to freshen her up." (name, heart-pulse icon and the real countdown unchanged; it grows to fit the text), and the separate message is hidden on phone widths (< 700 px). Other rooms keep "Help her feel better by restoring her needs."; Healthy pets keep the normal Bathroom bathing instructions and tools. Files: `pet-family-bar.tsx` (uses `usePathname`), `room-detail-screen.tsx`. Health timers and wipe-down mechanics untouched. Note: on desktop the Bathroom still shows the separate message too (only phones hide it), so desktop now shows the instruction twice (banner + message) — easy to hide as well if you prefer.
- **Kitchen framing on phones:** the background is `cover`-fitted by height and centred, which showed the sink and almost no floor. On phone widths the Kitchen background is now framed toward the right (`contentPosition` left 62%, `_layout.tsx`) so the flowered rug and floor fill the bottom of the screen. Desktop and every other room's background unchanged.
- **Kitchen kitty height on phones:** `phonePaddingBottomPx: 48` for the Kitchen (was 32) in `room-pet-placement.ts` puts her paws on the rug (about 60–70 px higher than before) instead of the very bottom edge; the Kitchen's Hatchling-picture "down 60 px" nudge (desktop tuning, it pushed Sick/Healthy Baby into the Back to Rooms button) is ignored on phones (downward nudges only; upward nudges in other rooms still apply). Desktop Kitchen (width >= 700) and the Bathroom, Gym, Bedroom, Study Room and Home positions are untouched.
- **Seen in the run (390 px unless noted):** Critical Young lying on the rug, Sick Young (360 px), Healthy Young with the bucket sprite, Sick Baby (844 px tall): whole body/head/tail visible, nothing overlapping Back to Rooms or the Kitchen label.
- **To test manually:** Kitchen on a phone with each stage and health state (especially Healthy Hatchling/Adult, Critical Baby/Adult, which I did not shoot) and different phone heights; Bathroom banner readable at 360/390 with Sick and Critical pets, and the normal banner text in other rooms; desktop Bathroom/Kitchen unchanged.

### [BUG-044] Home redesign (two slide-out panels) — notes and open checks

- **Status:** Done in code (2026-10-27); `npx tsc --noEmit` passes. Not manually verified on a real touch device.
- **What changed / where:** `src/app/index.tsx` (Home now only the kitty overlay + two `SlideOutPanel`s; the old wide/narrow card layouts and the inline developer cards were removed), new `src/components/slide-out-panel.tsx`, `src/components/pet-alerts-screen.tsx` (new `DeveloperTools` sections), new `src/utils/dev-hatch-replay.ts` (carries the "replay hatching" request from Alerts to Home), `src/components/pet-placeholder.tsx` (a bit of extra clearance for a lowered Sick/Critical kitty on small pet boxes).
- **Seen in the web run (mouse):** tabs open/close panels, swipe closes, edge swipe opens, wheel scrolling inside a panel leaves the page at scrollTop 0, no horizontal overflow at 360/390/844x390/1070 px, only one panel opens at a time, Sick and Critical kitties stay clear of the bars and Feed/Play/Rest on phone widths, all six developer sections and their buttons exist under Alerts.
- **Known limits / to check:** touch (not just mouse) swiping, especially against the browser's own back-swipe gesture at the screen edge; the Pet Stage Preview is now inside the Pet Progress panel and the preview picture shows once the panel is closed; if the pet group is scaled down in a very short landscape window its buttons are smaller; "Replay Hatching Animation" navigates to Home to play it. Not changed: health rules, growth thresholds, artwork, accessory placements, Bathroom/Kitchen positions, Gentle Wipe-Down, bathing, Shop, tokens, tasks/appointments.

### [BUG-045] Gym kitty looked smaller than in other rooms on narrow portrait screens

- **Status:** Done in code (2026-10-27); `npx tsc --noEmit` passes. Looked at in a real web run at 390 px (healthy Young: Gym vs Study Room; Sick Young and healthy Adult in the Gym at 360 px). Not run on a real phone.
- **Cause:** stage-specific scaling. In `ROOM_PET_PLACEMENTS` (`src/utils/room-pet-placement.ts`) the Study Room (1.2), Bedroom (1.15), Bathroom (1.25) and Kitchen (79% box) all enlarge the kitty, while the Gym had no stage scale at all — just a 55%-of-width box. On a phone the 55% box is only ~200 px wide, so she looked clearly smaller there; on wide screens the 320 px cap hid most of the difference. The sprite crops and scene container were not the cause.
- **Fix:** new optional `phoneScale` on a room's placement, applied only below 700 px window width and not to the Egg; the Gym sets `phoneScale: 1.2` (same as the Study Room). Sick and Critical pictures use the same box, so they scale too. Landscape/desktop Gym (>= 700 px) and every other room are unchanged; the Egg is unchanged (other rooms don't scale it either).
- **Seen:** the Gym kitty now matches the Study Room's size at 390 px, stays fully visible, and clears Back to Rooms and the Gym task pill (Sick Young and healthy Adult at 360 px as well).
- **To test manually:** Gym at 360/390 px with Egg, Hatchling, Baby, Young and Adult (healthy, Sick, Critical) — especially that the larger kitty doesn't touch the task pill or Back button; landscape and desktop Gym look the same as before; other rooms unchanged.

### [BUG-046] Developer tools couldn't leave Deceased; memorial message shown twice on Home

- **Status:** Done in code (2026-10-28); `npx tsc --noEmit` passes. Store logic verified with a throwaway test; Home/Alerts not re-checked in the browser.
- **Developer tools:** the illness-timer buttons only act on a living, already-ill pet, so a Deceased pet could never be brought back for testing. Added `devSetSelectedHealthState` (`src/utils/pet-family.ts`) and the "Developer Health State" picker + "Apply State" (see FEATURE-067). Tested: Healthy/Sick/Critical/Deceased in every direction, timers consistent (no immediate transition after a re-check), tokens unchanged, no revival animation, identity/stage kept, other pets untouched, Critical survives a restart, Eggs refused.
- **Duplicate memorial text:** yes, redundant. Home showed the memorial sentence in the card under the navigation (with the resurrection button) AND as the speech bubble above the tombstone (`getPetLifeMessage` returns it for a deceased pet). The bubble is now hidden for a passed-away pet (`src/app/index.tsx`); the card keeps the message and the resurrection control. The Pet Album's own wording is untouched.
- **To test manually:** Alerts -> Developer Tools -> Health and Lifecycle Testing: apply each state and check Home (banner, artwork, tombstone with a single message), Rooms, Shop (Sick/Critical browse-only), Stats; Deceased -> Critical/Sick/Healthy; refresh; other pets unchanged; Paw Token total unchanged.

### [BUG-047] Care supplies, deceased pet artwork across tabs, larger tombstone, plain speech bubbles

- **Status:** Done in code (2026-10-28); `npx tsc --noEmit` passes. Not manually verified by the user.
- **Deceased state wasn't consistent:** only Home showed the tombstone. `PetAvatar` (Shop preview, Stats, pet chips) and `RoomPet` (all Rooms) had no deceased case and showed the living kitty. Both now show the memorial picture for a deceased pet, and the Room care tools / bathing are hidden for it. Pet Album and the revival animation untouched.
- **Shop for a deceased pet:** previously buying was still allowed; now accessories and supplies are paused with the memorial / resurrection (500) message.
- **Speech-bubble emoji:** stripped in `PetPlaceholder` only (`stripDecorativeEmoji`). While testing I first shipped a broken regex that deleted letters from the bubble; fixed before finishing (verified: bubble reads normally without the emoji).
- **Tombstone:** drawn ~2x (and 20 px lower) on Home only; memorial-card hint text no longer clipped on narrow cards.
- **Testing note:** the Expo dev server in my test environment sometimes kept serving a stale bundle after edits (restart it with `npx expo start -c` if something looks unchanged).
- **Open / to test manually:** buying each item (token deduction exactly once), using one washcloth in a real wipe-down (and leaving mid-wipe), a second wipe-down needing another washcloth, medicine amounts and recovery, insufficient-token messages, restart persistence, several pets, deceased pet in every tab, developer health-state switching, tombstone size at 360/390 px and on desktop (not screenshotted after the final 2.0 scale), and that a Sick/Critical pet can always be recovered through tasks -> Paw Tokens -> washcloth plus normal Feed/Play (the free emergency washcloth was removed again, see BUG-048).

### [BUG-048] Free emergency washcloth removed

- **Status:** Done in code (2026-10-28); `npx tsc --noEmit` passes. Not manually verified.
- **Change:** per design, supplies are part of the normal productivity loop: Paw Tokens are earned by completing tasks (existing reward system, untouched, so no new duplicate-reward paths). The emergency washcloth (`canClaimEmergencyWashcloth` / `claimEmergencyWashcloth` in `pet-family.ts`, the Shop card and the Bathroom button) is removed entirely. A Gentle Washcloth costs 10 Paw Tokens, is used only when a wipe-down is COMPLETED (never when the pet gets sick, the Bathroom is opened or a session is abandoned). With too few tokens the Shop ("complete your tasks to earn more!") and the Bathroom card / health banner say so. Tasks have no health gating, so they stay reachable for Healthy, Sick, Critical and Deceased pets. Illness timers, recovery rules and the wipe-down mechanics are unchanged.
- **To test manually:** Sick pet with 0 tokens: Bathroom shows the "complete your tasks" message and no free option; Shop shows the same; complete a task, buy a washcloth, finish one wipe-down (one washcloth used); quit mid-wipe (none used); Tasks tab reachable in every health state.

### [BUG-049] Shop: landscape kitty cut off, portrait supplies unreachable, no hover on supply cards, "emergency washcloth" still visible

- **Status:** Done in code (2026-10-28); `npx tsc --noEmit` passes. Checked in a web run: 390 px portrait (page scrolls to both supply cards and on to the items), 1070 px desktop, and a short wide window (1000x420, kitty on the right, sticky while scrolling). Not run on a phone; the final short-landscape kitty size (150-240 px) was changed after my last screenshot, so recheck it.
- **Emergency washcloth still showing:** no old UI or store code remains in the source (searched `src/`: no "emergency washcloth", "Short on Paw", `claimEmergencyWashcloth`, or duplicate Shop section; the bundle served by a fresh dev server contains none either). The text in your screenshot came from an outdated running bundle: during my own testing the Expo dev server repeatedly kept serving old code after edits. Restart with `npx expo start -c` and hard-refresh.
- **Landscape kitty cut off:** the Shop docks the kitty at the bottom of a fixed-height body, and in a short wide window (< 620 px tall) that body is tiny, so she was pushed below the visible area. In that case the whole page now scrolls and the kitty sits in her own column on the right (sticky, sized to the window, 150-240 px); in a normal-height desktop window her size shrinks to fit the panel instead (max 315 as before). `shop-screen.tsx` only; Home/Rooms untouched.
- **Portrait supplies unreachable:** `CareSuppliesSection` lived in the fixed header, which never scrolled. It now lives inside the scrolling body, and on narrow screens the whole page (banner, categories, supplies, items) scrolls as one list (desktop keeps its fixed header + scrolling grid + docked kitty). The two cards stack on a phone and sit side by side when there's room (`flexBasis: 220`).
- **Hover/pressed feedback:** each supply card gets the same gentle lift + pastel highlight + coloured border as other Shop cards on hover, and a slight press-down on touch; disabled buttons keep their dimmed look.
- **Unchanged:** prices/effects, inventory, washcloth and medicine behaviour, accessory restrictions, deceased rules, tokens and task rewards, artwork.
- **To test manually:** portrait 360/390 (scroll through everything, no clipped card, no sideways scroll); real phone landscape (kitty visible on the right); desktop; hover and touch feedback; Healthy/Sick/Critical/Deceased kitty in the Shop.

### [BUG-050] Shop for unwell pets, sticky preview, phone header gap

- **Status:** Done in code (2026-10-28); `npx tsc --noEmit` passes. Seen at 390 px healthy (sticky preview while scrolling), 360 px Sick (supplies only), 390 px Deceased (memorial message only), 1000x420 healthy. Not seen: Critical (same code path as Sick), Kitty 2/3 pet switching, 1070 px desktop after this change, other tabs' headers.
- **Changes:** `shop-screen.tsx` — catalog/categories/preview hidden for Sick/Critical, supplies and catalog hidden for Deceased, preview toggle moved out of the header into a sticky wrapper (phone); `app-header.tsx` — `paddingBottom` 16 -> 4 under 700 px wide, shared by every tab.
- **To test manually:** header on Home, Tasks, Rooms, Shop, Stats, Alerts at 360/390 (no overlap with Paw Token pill, bell, health banner); switching pets Healthy <-> Sick <-> Deceased in the Shop; landscape kitty on the right; desktop unchanged.

### [BUG-051] Memorial message stuck on every tab; Resurrect only on Home

- **Status:** Done in code (2026-10-28); `npx tsc --noEmit` passes. Not manually verified.
- **Change:** see FEATURE-070. The always-visible memorial card (in the shared pet bar, so on every tab) is now a 5-second tappable notification; the permanent memorial + Resurrect is in Stats. No second resurrection implementation: `ResurrectControl` / `resurrectPet` are reused, now with hover feedback.
- **Seen:** toast under the nav at 390 px (heart icon, no overlap), gone after switching to Stats, Stats memorial with disabled Resurrect and "Needs 500 more Paw Tokens", Bathroom message at 360 px.
- **To test manually:** toast dismiss by tap and by timeout; no reappearance after refresh; second pet dying; resurrecting from Stats (cost, animation, slot limit); hover/pressed effects on Go to Shop, the supply buttons and Resurrect; Healthy/Sick/Critical unchanged. Shop's deceased message now points to Stats.

### [BUG-052] Duplicate washcloth text in the Bathroom health warning; warning now names the needs to check

- **Status:** Done in code (2026-10-28); `npx tsc --noEmit` passes. Seen at 360 px in the Bathroom with one low need ("Check Happiness.") and two ("Check Hunger and Cleanliness."), both on a Sick pet. Not run: three low needs, Critical, live need changes with the Bathroom open (the line is computed from the live pet data on every render, so it should update by itself).
- **Change:** `pet-family-bar.tsx` (the shared banner shown on every tab). The line under the heading ("<name> needs urgent care" / "isn't feeling well") now lists the recovery needs below 50 (`RECOVERY_NEED_THRESHOLD`): "Check Hunger.", "Check Hunger and Cleanliness.", "Check Hunger, Cleanliness, and Happiness." Energy is never listed. If all three are 50+ no line is shown (the existing recovery logic does the transition). The generic "Help her feel better by restoring her needs." and the washcloth shop text are gone from the banner in every room; the lower Bathroom washcloth card and Go to Shop button are untouched. When the player owns a washcloth the Bathroom banner still appends the short "gently drag the washcloth..." instruction (on phones the separate page message is hidden).
- **To test manually:** three low needs; Critical; raising a need (Feed/Play/Wipe-Down) while the Bathroom or Home is open and watching the line change; all needs 50+ (line disappears); the line on Home, Rooms and Shop; 390 px.

### [BUG-053] Washcloth requested for a Sick/Critical kitty with Cleanliness already high

- **Status:** Done in code (2026-10-28); `npx tsc --noEmit` passes. Seen at 360 px on a Sick pet: Cleanliness 49 with a washcloth -> wipe-down + drag hint; 49 without -> washcloth card + Go to Shop; 50 either way -> "Your kitty doesn't need a gentle bath right now." (no card/button). The completed-wipe washcloth use and +25 weren't re-driven by dragging in this run.
- **Player testing (2026-10-28):** the player tested the toy/Shop/health work and reported it working (a general sign-off, not an itemised check of this one).
- **Cause:** the Bathroom offered the wipe-down / washcloth requirement whenever Cleanliness was below 100.
- **Fix:** `room-detail-screen.tsx` uses `RECOVERY_NEED_THRESHOLD` (50), live from the selected pet; `applyGentleWipe` also refuses at 50+ so a washcloth can never be consumed then; the banner's drag hint follows the same rule.

### [BUG-054] Toy disappeared late / never when a session was started on another screen

- **Status:** Found and fixed while building FEATURE-071 (2026-10-28).
- **Player testing (2026-10-28):** the player tested the toy/Shop/health work and reported it working (a general sign-off, not an itemised check of this one).
- **Cause:** the session hook cached its result (the React compiler treated it as depending only on the pet id), so Home kept showing the toy after the 30 s timer ended if the session had started on the Shop.
- **Fix:** `useToySession` now uses `useSyncExternalStore`. Verified: toy gone ~30 s after starting from the Shop and from Home.

### [BUG-055] Toy artwork clipped in the Shop (mouse tail, fish, shadows)

- **Status:** Done in code (2026-10-28); `npx tsc --noEmit` passes. Seen at 360 and 1280 px (mouse and yarn tails now complete); 390 and landscape captured but only glanced at.
- **Player testing (2026-10-28):** the player tested the toy/Shop/health work and reported it working (a general sign-off, not an itemised check of this one).
- **Cause:** the toys are not evenly spaced on `kitty_toys.png`, but the crops were an even 6 x 4 grid: row 1's art runs to y=246 while the cell ended at y=222, and the row above leaked into the next row's crop.
- **Fix:** `cat-toy-art.ts` now uses each toy's measured bounding box (from the sheet's transparent gaps) plus about 8 px padding for all 24 slots, so no neighbouring toy is included. The image file is untouched; scaling is still "contain" (no stretching).

### [BUG-056] Toy Buy and Play buttons stacked vertically in narrow portrait

- **Status:** Fixed (hardened 2026-10-28; confirmed by the player in portrait). `npx tsc --noEmit` passes. It could not be reproduced in my own web run: with the current code Buy and Play already shared one row at 320/360/390 px, 844x390 landscape and 1280 px desktop.
- **Player confirmation (2026-10-28):** the player tested portrait mode and confirmed Buy and Play now appear side by side.
- **Likely causes:** (1) the row was `flexWrap: 'wrap'`, so on a card (or text size) too narrow for both buttons (~165 px) the second button dropped below; (2) a stale Expo bundle from before the side-by-side change, when the buttons were separate stacked items in a column card.
- **Fix:** `toy-shop-section.tsx` — the button row is now `flexWrap: 'nowrap'` and each button may shrink (`flexShrink: 1`, `minWidth: 0`, single-line label) instead of wrapping; colours, sizes and hover/pressed feedback unchanged.
- **Verified by measurement, not styles:** in the browser I read each card's Buy and Play bounding rectangles — identical `y` for all three toys at 320, 360, 390, 844x390 and 1280 px (e.g. 360 px: Buy x58 w97, Play x163 w60, both y952). A stress test forcing a card to 140 px wide still kept them on one row (the buttons shrank to 59 and 37 px). The served dev bundle contains the new code.
- **If it still stacks on your device:** reload the browser tab hard (Ctrl+Shift+R / clear site data) or restart Expo with `npx expo start -c`; a phone with a very large system font may also make the buttons shrink.

### [BUG-057] Toy price could be clipped by the "Buy" word on narrow cards

- **Status:** Done in code (2026-10-28). Not a separate defect to chase: fixed as part of FEATURE-075 by removing the word "Buy" (coin + price only) and tightening the padding.
- **Player testing (2026-10-28):** the player tested the toy/Shop/health work and reported it working (a general sign-off, not an itemised check of this one).
- **Checked:** at 360 and 390 px all 24 cards: Buy and Play on the same row (identical vertical position), no price text clipped, nothing past the right edge, no horizontal page scroll (document width equals the window width).

## Status summary (2026-10-28)

Fixed this milestone (see each entry for the solution): BUG-049 and BUG-050 (Shop layout and the unwell-pet Shop), BUG-051 (memorial message), BUG-052 (health warning text), BUG-053 (Gentle Wipe-Down only when Cleanliness is below 50), BUG-054 (toy stayed visible after its session), BUG-055 (clipped toy art), BUG-056 (Buy/Play stacking in portrait, confirmed by the player), BUG-057 (clipped Paw Token prices).

Still open or unverified (not marked fixed): BUG-024 (investigating), BUG-026 (release checklist: turn developer flags off), BUG-029 (pet family / alerts / flashlight testing on a real device), and the "not yet manually verified" notes on older entries.

### [BUG-058] Swiping the postcard with a mouse did nothing (the browser dragged the picture instead)

- **Status:** Fixed in code (2026-10-29); verified with a scripted mouse drag.
- **Cause:** the browser's own image drag cancelled the swipe.
- **Fix:** the picture ignores pointer events; the swipe area underneath receives them.

### [BUG-059] Pawadise mailbox appeared too small on Home

- **Status:** Fixed in code (2026-10-29); `npx tsc --noEmit` passes. Looked at in a web run at 360, 844x390 and 1280 px (Young kitty; Adult checked at 1280 px). The player tested and approved the result.
- **Cause:** the mailbox used a fixed 76-92 px width, far smaller than the kitty.
- **Fix:** `pawadise-mailbox.tsx` sizes it from the kitty's visible size (passed from Home, using a per-stage estimate) and the mailbox picture's own ~93% visible area, about 5% bigger than the kitty, within limits. The Hatchling and Baby ratios are estimates and were not separately checked.

### [BUG-060] Pawadise mailbox slid around instead of hopping

- **Status:** Changed in code (2026-10-29) (a requested behaviour change, not a crash); `npx tsc --noEmit` passes. Measured in a web run: three hops in six seconds, 58-86 px of vertical travel, still after one tap. The player tested and approved it.
- **Fix:** the slide was replaced with a hop cycle (crouch, arc jump with sideways movement only in the air, landing bounce, rest). During testing the top of a jump could rise above the Home area; resting spots now start one jump-height down so the whole arc stays inside it.

### [BUG-061] Nested button warning on the Pawadise gallery cards

- **Status:** Fixed in code (2026-10-29); found by the developer while building the pet pages, and the warning was gone in a later web run.
- **Cause:** the whole retired-pet card was a button that contained the Bring Home button (a button inside a button, which the browser reports as an error).
- **Fix:** only the picture and facts open the pet's page; Bring Home is a separate sibling button.

### [BUG-062] Expo web: `barcode-detector` Metro error and "12000ms timeout exceeded" (CAUSE NOT ESTABLISHED)

- **Status:** Open / unresolved cause. The player's Expo web stopped loading with a Metro error for `node_modules/barcode-detector/dist/es/index.js` ("none of the expected files exist") and a browser "Uncaught Error: 12000ms timeout exceeded". After restarting Expo it stopped occurring. This is NOT confirmed as permanently fixed.
- **What was checked (2026-10-29):** `barcode-detector` 3.2.3 is a dependency of `expo-camera` 57.0.6 only, the files existed on disk, and a fresh `npx expo start -c` plus `npx expo export --platform web` bundled without error. No code or dependency was changed.
- **Hypothesis (unproven):** a stale Metro cache or file index, or a second running Expo server. If it returns, stop all Expo servers, run `npx expo start -c`, confirm the file exists, and record the exact terminal output.

## Status summary (2026-10-29): Pet Pawadise

Fixed: BUG-058 (postcard mouse-swipe), BUG-059 (mailbox size), BUG-060 (mailbox hopping), BUG-061 (nested button on gallery cards). Unresolved or unverified: BUG-062 (barcode-detector / 12000 ms timeout; cause unknown, stopped after restarting Expo) and the earlier open items in the 2026-10-28 summary (BUG-024, BUG-026, BUG-029). Pawadise behaviour on real phones (finger swipe, double-tap timing) has not been separately verified.

### [BUG-063] Missing hover highlighting in portrait mode (cause: Chrome's mobile touch emulation); controls that had no hover styling were improved

- **Status:** Resolved (2026-10-29). `npx tsc --noEmit` passes. The player confirmed that the hover highlighting missing in portrait mode was caused by Chrome's mobile (touch) emulation, NOT by a portrait layout defect in the app. With touch emulation the browser reports touch instead of a mouse, so no page can show hover.
- **Investigation:** a scripted real-mouse hover test (computed-style change under the pointer) at 1280x800, 390x844, 360x800 and 844x390 showed every existing hover effect (Stats cards, room cards, Shop item cards and Buy buttons, Pet Album tabs and cards, supply and toy cards, farewell buttons) behaving identically at every size; no width, orientation or `Platform.OS` condition surrounds any of them.
- **Separate finding (kept as a record):** some controls had no hover styling at ANY size, only pressed feedback: the header navigation pills and alerts bell, the pet chips and "Adopt an egg", the Shop category tabs and Feed/Play/Rest.
- **Improvement:** those controls now lift on mouse hover using one shared look (`src/constants/hover.ts`, also used by the Pet Album tabs and Shop cards). Selected or active ones (current page, selected pet chip, selected Shop tab, disabled care buttons) don't lift; pressed feedback is unchanged; the effect only responds to a real mouse so touch taps can't leave a control stuck highlighted. Verified at the four sizes above.
- **Not tested:** a real touchscreen.

### [BUG-064] Pet Safety (Gentle Mode) and approval rewards are saved but not enforced (planned integration, OPEN)

- **Status:** Open by design (2026-11-01). Not a defect in the new screens: the settings are stored and shown, and the dashboard says on screen that they are not enforced yet. NOT fixed and not claimed as fixed.
- **Death trigger trace (for the future Gentle Mode work):** in normal play a pet can only become Deceased in ONE place: `evaluateLifecycle` in `src/utils/pet-lifecycle-core.ts`, when a Sick or Critical pet has been unwell for 96 hours (24 h Sick + 72 h Critical), computed from saved timestamps, so it also happens for time spent offline (via `advancePet` at launch, on resume and once a minute). The only other path is the development-only "Developer Health State" tool (`devSetSelectedHealthState`). Retired Pawadise pets are skipped. Gentle Mode would therefore be enforced in that one function (for example by keeping the pet Critical instead of deceased, still preserving its identity and progress), with the child's setting passed in per pet.
- **What blocks it today:** pets, the wallet and the task list are one shared set, not per child, so a per-child setting has no pet to apply to.
- **Approval rewards:** the reward system pays Paw Tokens and pet growth when a GLOBAL task is saved as complete (`reconcilePawTokenEarnings`); child tasks live in the child's profile on purpose so pending ones can never pay early. Paying on approval needs the per-child pet first.
- **Other open item from this milestone:** profiles have no PIN or password (see FEATURE-083).

### [BUG-065] Spanish task titles are not auto-categorised (FIXED 2026-11-01)

- **Status:** Fixed (2026-11-01): Spanish keyword lists were added next to the English ones in `src/utils/categorize-task.ts` (accent- and case-insensitive whole-word matching). English detection is unchanged (the Spanish lists are only an extra OR in the same category order), a category is still only assigned when a task is created or its text is edited (saved tasks keep theirs), and the task text is never changed. Checked with 24 sample titles in both languages (0 mismatches) and in the browser (Estudiar -> Estudio, correr -> Ejercicio, vitaminas -> Salud, "Llamar a mamá" -> Personal). Mixed or ambiguous titles follow the same Study > Exercise > Clean > Health order as English, so "Clase de natación" is Study. Original report:  A task's category (Study, Exercise, Clean, Health, Personal) is guessed from English keywords in the title (`src/utils/categorize-task.ts`). A task typed in Spanish usually falls back to "Personal". The category NAMES are translated; the keyword matching is not. Fixing it needs a Spanish keyword list and a decision on mixed-language titles; it was not changed because it alters which category (and icon) tasks get.

### [BUG-066] Mood Journey year legend showed English mood names in Spanish (FIXED)

- **Status:** Fixed (2026-11-01). Found while checking the Stats pages in Español: the colour legend under the yearly grid printed the stored English mood key. It now uses the translated mood name. Verified by type-check only; the Spanish legend was not re-screenshotted after the fix.

### [BUG-067] English leaks found in the final Spanish audit (FIXED)

- **Status:** Fixed (2026-11-01). Found by walking every screen in Español: the task category on the Home task card and the appointment card (for example "Clean"); "tokens" / "Paw Tokens" in the Home adopt dialog and the Parent Dashboard rewards note instead of "fichas de patita"; the "YYYY-MM-DD" date placeholder in the task edit window. All three now follow the language. Verified in a web run; type-check clean.
- **Follow-up (fixed 2026-11-01):** temporary one-line messages (Pawadise notice and errors, Resurrect errors, adopt errors, Pet Care & Alerts messages, Parent Dashboard note, Welcome name error) used to be stored as finished text and stayed in the old language after a switch. They are now stored as a key plus values and shown in the current language. Verified live on the Pet Care & Alerts page (Español -> English -> Español); the other messages use the same mechanism and were type-checked but not each triggered in the browser.

### [BUG-068] Home mailbox's Open mail button cut off at the bottom in landscape (FIXED)

- **Status:** Fixed (2026-11-01). At 844x390 the mailbox's resting area was only about 190 px tall, so with the bubble and button hanging under it they could pass the bottom of the screen (English and Spanish alike). Fixed in pawadise-mailbox.tsx with responsive bounds (see FEATURE-084): room is reserved for the bubble and button, or they go beside the mailbox when the area is too short, and a resize or rotation re-clamps it. Measured at four screen sizes in both languages, 24 of 24 stops fully visible. Not tested on a real phone.


### [BUG-069] An unreadable "already paid" record would re-pay every completed task (FIXED 2026-11-02)

- **Status:** Fixed in the M1 hardening pass (`src/utils/paw-tokens.ts`); found by the M1 tests. Normal reward amounts, task completion, the format of a valid record and every other saved value are unchanged.
- **The problem:** the permanent list of paid task occurrences (`@ProductivityPet:awardedTaskTokens`) was treated as empty when it existed but could not be parsed, so every task marked done would be paid again (Paw Tokens and growth). If the key could not be read at all, it was treated like a first launch and the stored list was replaced by only today's completed tasks.
- **Now:**
  - *Valid record:* used exactly as before (status `ok`).
  - *No record:* a brand-new player (nothing completed, no earnings history) is recorded as `new-player`; a returning player whose record is gone (tasks already done, or earnings history exists) is `recovered-missing`. Either way what is already completed is recorded as paid and nothing is paid for it, as the first-launch rule always did.
  - *Unreadable record:* the original text is first copied to `@ProductivityPet:awardedTaskTokens.corrupt-<time>` (same convention as the pet family record). Only if that copy is stored, the record is rebuilt from every key still readable in the damaged text plus everything currently completed; nothing is paid on that call (status `recovered-corrupt` with the backup key). This can skip a reward for a task that was done but never paid, but cannot repeat one. After that, new completions pay normally and old ones never do.
  - *Storage cannot be read, or the backup cannot be written:* nothing is paid, nothing is overwritten, status `unreadable`, and the next call tries again.
  - The wallet and the pet family record are never touched by recovery.
- **Known trade-off:** during a recovery from a damaged record, a task that was completed but had NOT yet been paid at that moment is marked as paid and is not rewarded. The recovery is built to skip a reward rather than ever repeat one; the damaged original is kept (`awardedTaskTokens.corrupt-<time>`) so a missed reward could be checked by hand.
- **How it is surfaced:** `getRewardHistoryStatus()` and `subscribeToRewardHistoryStatus()` in `paw-tokens.ts`, plus a console warning. **Future improvement (NOT implemented):** an on-screen recovery notice in English and Spanish. It was left out on purpose because it adds visible text and changes a layout, and needs the player's decision.
- **Tests:** 12 new tests in `tests/rewards.test.ts` (corrupt in five shapes, partial salvage, restart after recovery, backup failure, read failure, valid, empty-list, missing for a new and a returning player, wallet untouched). They fail against the old code and pass now.
- **Not covered:** a real device with a genuinely damaged store; the status is not shown to the player.

### [BUG-070] Dependency security audit: 47 findings (OPEN, deliberately deferred to a separate milestone, 2026-11-02)

- **Status:** Documented only. Nothing was upgraded, and no `npm audit fix` (with or without `--force`) was run. The lockfile change from adding the test tools added 249 packages and changed no existing package version.
- **Counts:** now 47 = 1 critical, 9 high, 32 moderate, 5 low. Before the test tools (the committed lockfile) it was 25 = 1 critical, 9 high, 13 moderate, 2 low. The test tools (Jest) account for 22 of the 47 (19 moderate, 3 low), none critical or high, almost all through `babel-plugin-istanbul` -> `test-exclude` -> `glob` / `minimatch`.
- **Where they sit:** nearly all are build or dev-server tooling that is not part of the app people install: the critical `shell-quote` (via `react-native` -> `react-devtools-core`), and the high `@expo/cli`, `compression`, `node-forge`, `source-map-js`, `brace-expansion` and `zod` (the CLI and its helpers), plus the config-plugin and `glob`/`minimatch`/`xcode`/`uuid` moderates. The only highs that can end up in the app bundle are `decode-uri-component` and `query-string` (via `expo-router`): a denial of service on malformed percent-encoded URLs, low practical risk for an offline app.
- **What a safe update would do:** a plain `npm audit fix` would move about 50 packages within the Expo SDK 57 patch line (for example expo 57.0.20 -> 57.0.31, expo-router 57.0.19 -> 57.0.29) and `xcode` 3 -> 4. Simulated on a copy of the lockfile it leaves 40 findings (0 critical, 5 high, 30 moderate, 5 low). The five remaining highs (`@expo/cli`, `zod`, `expo-router`, `query-string`, `decode-uri-component`) only have npm "fixes" that downgrade Expo to 51/53 or jump to expo-router 58, which must NOT be applied.
- **Plan:** handle compatible security updates as a separate milestone, with `npx expo install --check`, the tests, and a check of the app afterwards.

### [BUG-071] Running dev server can corrupt the generated route types (dev tooling, WORKAROUND, 2026-11-02)

- **Status:** Not an app bug; a development-tool quirk. `.expo/types/router.d.ts` is generated by the Expo dev server and is git-ignored. While the server runs, files created in the project (any folder) are added to it as bogus routes such as `/../utils/paw-tokens` or `/../../tests/helpers`, and the file can be left half-written, which makes `npx tsc --noEmit` report syntax errors in that file. It happened during the localization work (new `src/i18n`, `src/utils`, `src/components` files) and again when `tests/` was added. A fresh generation is clean: checked in a scratch copy (no `tests/` or `/../` entries; routes come only from `src/app`), so `tests/` is NOT part of the real route types.
- **What to do if it happens:** stop the dev server (Ctrl+C in its terminal) and start it again (`npx expo start`); it regenerates the file. Do not hide it by excluding files in tsconfig. Project code type-checks with 0 errors.

### [BUG-072] Inactive profiles' pets still age and get no reminders (documented limitation, OPEN by design, 2026-11-02)

- **Status:** Open by design (decided for M2): not a defect to fix in Stage 1. Pet needs, sickness and death are driven by saved timestamps (unchanged mortality rules), so a profile that nobody has opened keeps aging: its pets can become Sick (after a need reaches 0), Critical 24 hours later and die 96 hours after sickness began, with no reminder, because phone alerts and task reminders are scheduled only for the ACTIVE profile (the profile being left has its scheduled ones cancelled when the profile changes). Opening that profile later catches up to the right moment (checked by a test: a pet that died while its profile was unused is recorded as dying at its deadline). Free recovery still works as soon as the profile is opened.
- **Related (fixed 2026-11-02):** a switch that fails (registry cannot be saved, a save fails during the switch, a store cannot reset) now changes nothing and cancels no notification; the old profile's reminders stay in place. After a REAL switch, everything scheduled or shown is cancelled and cleared from the tray so another child cannot see it. Real-device verification of the cancel/clear calls is still outstanding (see FEATURE-086).
- **Future options (not decided):** scheduling alerts for every child's pets (with the child's name), or a "family overview" on the shared device.
- **Decision (2026-11-05):** a read-only "needs care" badge per child comes with the picker (`peekProfileCare` exists since FEATURE-090: it advances a copy of a profile's pets and writes nothing). Cross-profile care alerts (phone notifications for every child's pets, with generic text that names no child or pet) must be done BEFORE public release, not before development testing. Archiving cannot pause aging (mortality is timestamp-driven), so the archive confirmation must say that archived pets keep aging.

### [BUG-073] Home crashes if a saved task has an unknown category (FIXED 2026-11-02)

- **Status:** Fixed. A saved task could carry a category this version does not know (an older or damaged save, or a hand-built test fixture using "Home"); `TaskIcon` then threw "Cannot destructure property 'col' of 'GRID_POSITION[category]'" and Home rendered blank. Now `displayCategory()` shows any unknown, outdated or missing category as Personal (icon, label, Stats counts, Personal accomplishments, legacy room inference) in English and Spanish. The saved task and its category are NEVER rewritten, loading and saving preserve the value, and reward amounts, categories and completion behavior are unchanged.
- **Tests:** 9 regression tests; they fail without the fix. Web run at 390x844 on Home, Tasks, Stats, a Stats category page and Rooms in both languages: no errors, no overflow, saved categories unchanged.
- **Not covered:** the unknown category is shown as "Personal" (there is no separate "unknown" label); other places that never looked categories up are unaffected. Not checked on a real phone.

### [BUG-074] Profile switching: remaining risks after the hardening pass (documented, OPEN, 2026-11-02)

- A crash exactly between saving the registry and the in-memory swap makes the next start open the NEW profile. Everything stays consistent and separate (all saves finished first), but the player may find themselves in the profile they were switching to.
- The phone clean-up after a real switch runs a moment after the swap; an alert due in that instant could still appear. Practically negligible.
- Cancelling "all" scheduled notifications assumes every notification this app schedules belongs to the active profile (true today); a future feature that schedules device-wide notifications must account for it.
- Three unverifiable backup copies stop further backup attempts (safe mode); a very large save (over about 2 MB on Android, or more than roughly half of the browser's 5 MB) can fail the one-time backup and stay in safe mode (BUG-072, FEATURE-086 for the numbers).
- Not tested on a real device: notification cancel/clear, a full device.
- **Update (2026-11-05, FEATURE-090):** the "crash between saving the registry and the swap opens the new profile" case stops mattering once the picker exists, because a cold start will always show the picker (the saved id is only a last-used pointer). Registry writes now carry a revision and refuse a stale copy (two browser tabs); AsyncStorage still has no atomic compare-and-set, so a tiny window between the check and the write remains until the web single-tab lock exists.

### [BUG-075] Parent PIN: storage and recovery not implemented; security limits of a local PIN (OPEN, decision needed, 2026-11-03)

- **Status (updated 2026-11-03):** Open. The PIN verifier and the recovery-code design are now implemented behind the disabled family-mode flag (FEATURE-088: scrypt via @noble/hashes, native secure storage, one-time recovery code, restored-data states). The setup, unlock, recovery and management screens now exist (FEATURE-089, development builds with the flag only), nothing is protected for any user, and the scrypt settings and secure-storage behavior are unverified on real devices. Recovery decisions made: a recovery code is offered; device authentication alone must NOT reset a PIN; if family data exists but its PIN record is missing (a restore or new device) parent access stays locked and guardian-account recovery will be needed; if the PIN and the code are both lost, parent-only access stays locked; no data is ever deleted to reset a PIN.
- **Known limits of any local PIN (to be repeated wherever the PIN is described):** it is not verified parental identity; a 4-8 digit PIN has so few possibilities that a verifier someone can read can be guessed offline whatever hash is used; attempt limits depend on the device clock (a clock moved forwards ends a pause early; backwards does not shorten it) and on data stored on the device; on the web the stored data is readable with the browser's developer tools; clearing the app's data removes the PIN together with all saves (the app never deletes family data to reset a PIN, and no PIN reset exists); a child who learns the PIN or the device passcode is not stopped.
- **Forgotten PIN:** the app cannot recover it today. Without guardian accounts any recovery is either impossible or weaker than the PIN. Options: (1) none until accounts exist (safest; a forgotten PIN locks the parent area, children's play and all data stay intact); (2) a one-time recovery code shown at setup (same strength as the PIN if found); (3) the device's own lock (OS biometrics/passcode) on native only; (4) guardian account recovery in the cloud milestones.
- **Not mitigated yet:** the lock screen is unverified on real devices (BUG-072 and BUG-074 also still apply to family mode).
- **Related, still open:** BUG-064 (parent-assigned tasks do not reach children's real Tasks tab; deferred by decision), BUG-072 (inactive profiles still age; the picker needs a needs-care indicator and eventually family-wide alerts before real users).

### [BUG-084] Profile switching chip, Stage 4.2: known limits (documented, OPEN, 2026-11-06)

- **Unfinished-work tracking is by screen, not by magic:** only the screens listed in FEATURE-095 report it. A new screen with a text field or a game has to use `useUnfinishedWork` or it is silently unprotected (the chip then switches without asking). A static test lists the current screens; nothing checks future ones.
- **Task editor: fixed (2026-11-06):** every field (text, date, time, kind, repeat, weekly days, reminder, room) is tracked against its opening value; opening it, or putting everything back, is not unfinished work.
- **Home panel handles and hidden panels:** the closed Pet Progress and Home Features panels are slid off-screen, not removed, so their Close buttons still exist off to the side (the preview reports them as beyond the screen edge); keyboard focus can reach them. Not changed in this pass.
- **A game round counts as unfinished from its first moment** (nothing is saved until it ends), so the question appears even right after a round starts.
- **Nothing connects the idle timer yet** (Stage 4.3): the failed-switch dialog here offers Keep playing, which only closes it; resetting an inactivity timer comes with 4.3.
- **The chip is hidden for a household with no child record** and for a profile that is not in the family list; if the family list cannot be read the chip is simply absent (the picker's own error handling still applies on the next start).
- **Not verified on a real device:** screen-reader reading order of the chip and its dialogs, and touch behavior on phones and tablets (only the browser preview and automated tests).

### [BUG-083] Profile switching and session management, Stages 4.0 and 4.1: known limits (documented, OPEN, 2026-11-06)

- **Pet-care alerts stop after a return to the picker (BUG-072, must be resolved before public release):** every release cancels ALL scheduled phone notifications (the interim privacy rule). Once the live idle rule exists, a child who is returned to the picker stops getting pet-care alerts until someone is chosen again. A per-profile (or family-wide) alert design is needed first.
- **Nothing triggers the return yet:** `leaveProfile()` has no caller in the app (header chip 4.2, live idle timer 4.3, web-tab lock 4.4 come next), so nothing in this stage changes what a person sees.
- **A parent loses the parent session when a leave fails or hangs** (the lock comes first, by design); they enter the PIN again.
- **Profile-owner protection covers the audited paths, not every possible future caller (FEATURE-094):** delayed work that changes profile data checks its owner (see the hardening note there). The simple "intent" functions of the stores (add tokens, buy or play with a toy, buy care supplies, select a pet, shop purchase, grow, equip) take no owner: today every caller is a tap or an effect of a mounted screen, so none can run after its profile was left (all call sites were checked), but a future component that calls one after an `await` of something that is NOT a store call (a permission prompt, a timer) has to capture and check an owner itself. A complete guarantee for any future code would need store handles bound to the profile session (a larger change across about a dozen store modules and their callers); not started.
- **The leave waits for pending saves up to 15 seconds** (the profile layer's limit) while the cover is shown; a longer hang ends as a timeout and the person stays in their profile.
- **Unfinished game rounds and unsent text are not saved** when someone leaves (by design: no draft saving is added). The warning that names them is designed, not built.
- **Cover on the web and native is tested at the property level only:** `inert`, `aria-hidden`, the iOS and Android accessibility-hiding props and the pointer block are asserted in the test renderer; real keyboard focus, VoiceOver and TalkBack behavior need a device or browser check (Stage 4.5).
- **A household whose children are all archived now always shows the picker** with only Main (behind the PIN). A parent who archived everything and has no PIN yet has to finish the protected PIN setup from the picker before Main opens.
- **Clock limits:** a clock moved forwards by less than 10 minutes only shortens the time left; a monotonic clock that also stops during sleep cannot tell sleep from idleness, which is fine because both count as idle.
- **Not verified on a real device:** the cover with a screen reader, real sleep and foreground behavior.

### [BUG-082] Family management in the Parent Dashboard: known limits (documented, OPEN, 2026-11-06)

- **Orphans are reported, never fixed:** unused empty profiles and profiles that hold data but belong to no child are only counted. There is no delete, merge or re-link control by design; a safe repair flow needs its own design (and the user's decision).
- **Duplicate permanent IDs make the family list read-only** (nothing can be added, renamed, archived or restored) until someone resolves them outside the app. The Family health card explains this; no automatic repair exists.
- **Archived children keep aging:** a long-archived child's pet can become sick or pass away. This is explained in the confirmation, but nothing reminds a parent that a child has been archived for a long time.
- **Archive is blocked for the profile that is open** (Main or a child); the parent has to leave that profile first. There is no way back to the picker until Stage 4's header chip (see BUG-080).
- **The "may be full" hint is a guess by design:** it appears only after two storage failures in a row and says "may". The cause is not measured; the counter is in memory and restarts with the app.
- **Two tabs or devices:** a change made elsewhere is refused with a conflict message and nothing is overwritten; the parent has to try again.
- **Family health is checked on demand** (when the dashboard opens and on "Check again"), not live.
- **The preview's synthetic data is written into browser storage by a scratch-only helper**, because a PIN-less household with children cannot be set up on the web (BUG-081); the real screens and storage code were used for everything else.
- **Not verified on a real device:** screen-reader reading order and wording, the Spanish text.
- **Preview note:** at 150% text on a 360px phone, the page's own Back button is flagged as touching the screen edge in one full-length capture; it looks fine in the picture and was not changed.

### [BUG-081] Protected first PIN setup and parent-session checks: known limits (documented, OPEN, 2026-11-06)

- **The device check is not identity.** A child who knows the device passcode (or whose face or fingerprint unlocks it) can pass it and become the one who sets the first PIN, which would lock the real parent out of Main and parent management (the recovery code would be shown to that person). Only guardian accounts can fix this; the screen and the docs say so.
- **A lost PIN stays lost in family mode** (a restore, a new device, cleared secure storage): Main and parent management stay locked, no data is deleted, no bypass exists. A separate recovery design is needed. Family mode off still opens Main as always.
- **A device with no screen lock cannot finish this setup** (refused with an explanation, no fallback): device security has to be turned on first.
- **No browser support:** the claim path fails closed on the web; a PIN-less household with children cannot be set up from a browser.
- **A session can end between two taps.** Every action re-checks, but a form on screen can outlive its session; the next save is refused ("locked") and the Parent Gate shows the lock screen. Stage 3.2+ screens must show those refusals instead of ignoring them (the existing dashboard still ignores failures).
- **`addTask` by a child (when allowed) is not parent-only** and is not checked; only the dashboard's "preview as child" calls it today.
- **Weak biometrics pass.** The prompt uses the library's default biometric class (weak), plus the device credential, so a weak biometric (some face-unlock implementations) is accepted. Requiring strong biometrics only would be a stricter later choice; the device credential would stay allowed either way.
- **A very small window remains** between the last permission check and the write itself (milliseconds inside one storage call). A session revoked in exactly that instant is not caught; nothing can be, with this storage. A refusal after "add a child" has registered its profile leaves the known empty orphan profile (reported, never deleted).
- **The claim is in memory only.** An app restart in the middle of a setup loses it (the unfinished record protects nothing and the device check is asked again).
- **Not verified on a real device:** the native prompt, lockout behavior and Face ID wording (see FEATURE-092).

### [BUG-080] Family picker: known limits (documented, OPEN, 2026-11-05)

- **No way back yet:** until the header chip (Stage 4) the picker only comes back on the next cold start (`returnToPicker()` exists and is tested).
- **No children, no picker (changed 2026-11-06, FEATURE-094):** the picker is skipped only when the household has NO child record at all; a household whose children are all archived still shows it, with Main behind the PIN. Before: with no active child the app opened straight into Main as it always has, PIN or not (nobody to choose between). Once an active child exists the picker applies and Main FAILS CLOSED: without a working, confirmed Parent PIN (never set up, unfinished, unconfirmed recovery code, secret missing, storage unavailable) Main and "Add a child" stay disabled with an explanation, children still play, and nothing creates or resets a PIN.
- **RESOLVED for households with children (2026-11-06, FEATURE-092):** the parent routes and actions below fail closed and the first PIN needs the device security check; the first-setup limits that remain are in BUG-081. Original note: **(parent routes in a household with no PIN):** `/parent`, `/welcome` and `/parent-security` are protected by the Parent Gate only when a PIN exists. In a household that has children but never set up a PIN (older or development data; new households have to set it up before adding children) those routes are open so that a PIN CAN be created, which is the first-setup race of BUG-077: a child could open the dashboard from Pet Care. Closing it needs a new, protected "set up the PIN" path (a design decision), so it was not changed in Stage 2.
- **Same avatar twice:** avatars are worked out from the child id, so two children can share a picture; the name and the spoken label always differ.
- **A slow switch waits up to 15 seconds** (the profile layer's own limit) before the timeout message; the loading screen is shown the whole time.
- **Care badges use the device clock** and one read per profile every minute; the first paint says "Checking…". Main's badge is shown without the PIN (counts only, no pet names).
- **Not verified on a real device:** screen-reader reading order, the PIN pad on a phone, real notification clean-up when switching.

### [BUG-079] Task reminders were lost after leaving a profile and coming back (FIXED 2026-11-05)

- **Status:** Fixed (found in the Stage 1 safety review, before anything was committed). Leaving a profile cancels everything scheduled on the phone, but each saved task keeps `scheduledNotificationId` and `scheduledNotificationFor`, and Home and Tasks skip the sync pass that fires only because their tasks finished loading. So after a profile swap the reminders of the profile you returned to were never scheduled again until a task was edited or the app restarted and a task changed. The bug existed in the profile switching of FEATURE-086; the family picker would have made it common.
- **Fix:** a notification epoch counted only when a swap or release really happened; reminder and alert scheduling wait for the phone clean-up (at most 10 seconds); the first pass after an epoch change reschedules (old id cancelled first, so never twice); the two screens run that pass on load when it is needed. Failed or timed-out swaps and releases do not count, cancel or reschedule anything. Saved tasks are not changed except by the normal reschedule. 12 regression tests (they fail without the fix).
- **Not verified:** real notifications on a real phone.

### [BUG-078] Family picker data layer: remaining risks (documented, OPEN, 2026-11-05)

- **Two tabs / two windows (web development preview):** the revision check refuses a stale write and a read-back catches a racing one, but AsyncStorage has no compare-and-set, so a very small window remains. A single-tab lock is planned for the web preview; family mode is never supported on the web for real users.
- **Orphan profiles:** a child creation that stops between the registry step and the household step leaves an empty registry profile with no household record. It is invisible, holds no data, is reported by reconciliation and is never deleted automatically; a later screen has to let a parent link or ignore it.
- **Duplicate child ids or unreadable entries:** the household becomes read-only (duplicates) or is copied aside before the first change (unreadable entries). There is no screen yet to resolve a duplicate; until there is, a household in that state cannot be changed.
- **Leaving Main empties its alert-schedule bookkeeping:** switching or releasing away from the Main profile sets its `petAlertSchedule` record to `[]` because its phone notifications are cancelled (existing behavior, FEATURE-086). Every other Main key stays byte for byte (tested). The reminders themselves come back when Main is selected again: pet alerts are rebuilt from the pets, task reminders by the BUG-079 fix.
- **Archived children keep aging:** nothing can pause a pet's clock. The archive confirmation (a later stage) must say so, and BUG-072 (alerts for inactive children) still applies.
- **Care summaries are as good as the saved record:** a record that cannot be read is "unreadable" (never "healthy"); the summary is worked out with the device clock, like everything else.
- **Not verified on a real device:** release-and-flush with real secure storage and real notifications.

### [BUG-077] Parent PIN screens: known limits (documented, OPEN, 2026-11-04)

- **First-setup race:** until a PIN exists the parent area is open (as it has always been), so whoever reaches it first can set the PIN, including a child. The setup intro tells the parent to do it themselves. Cannot be fixed without guardian accounts.
- **A PIN is not verified parental identity** and is a local barrier only. If both the PIN and the recovery code are lost, parent-only access stays locked and all family data is kept (no device-passcode reset, no data-wiping recovery) until guardian accounts exist.
- **Screen capture:** protection depends on the platform and OS version (see FEATURE-089) and is unverified on real devices; a screen reader reads the code aloud when it is shown.
- **Layout not browser-checked** (phone, tablet, landscape, Spanish text length) in this pass.

### [BUG-076] Dev server rewrites the generated route types while files are added, so plain `npx tsc --noEmit` can fail (dev tooling, WORKAROUND, 2026-11-04)

- **Status:** Not an app bug; no project source was changed or excluded for it. `.expo/types/router.d.ts` is generated and git-ignored. The running Expo dev server rewrites it whenever files appear in the project, adds bogus routes for them (for example `/../utils/parent-pin`) and sometimes leaves the file half-written (same cause as BUG-071; confirmed earlier that a fresh generation from a clean start has none of these). When it is half-written, plain `npx tsc --noEmit` stops inside that file; when the server finishes rewriting it, the command passes again. On 2026-11-04 plain `npx tsc --noEmit` passed with NO exclusions, and the 318 tests pass.
- **If it fails again (exact steps, your terminal):** 1) click the terminal that runs `npx expo start` and press Ctrl+C; 2) run `npx expo start` again (add `--clear` if it still looks wrong); 3) wait until it prints the QR code or "Waiting on http://localhost:8081"; 4) run `npx tsc --noEmit`. It can recur whenever new files are created while the server is running; stopping the server before a large batch of file changes avoids it.
- **Also noted (pre-existing, NOT changed):** `npx expo install --check` reports expo-system-ui (expected ~57.0.4) and expo-web-browser (expected ~57.0.3) as older than the SDK recommends; this belongs to the separate security/compatible-updates milestone.
