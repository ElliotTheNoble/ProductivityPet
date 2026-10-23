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
