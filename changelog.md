# Changelog

Track notable changes to the project here. Newest entries at the top.

## Template

## [YYYY-MM-DD]

### Added
-

### Changed
-

### Fixed
-

### Removed
-

---

## [2026-10-13]

### Added
- **Summary:** built a full Egg-to-Hatchling hatching transition system — new Egg artwork, a new permanent Hatchling picture, a timed 5-second "just hatched" sequence with no image overlap, a developer-only Replay Hatching Animation control for repeatable testing, delayed pet-needs bars and pet-care buttons during that sequence, a fix for the needs bars shifting position between stages, and a fix for the message bubble getting covered by oversized artwork — plus the documentation for all of it (FEATURE-039, BUG-009 through BUG-011 in `bugs.md`).
- Egg stage now shows `assets/images/pets/stats_egg.png` (reused from the Stats page) instead of `egg_nest.png`, enlarged (`EGG_SCALE`, 1.625×) and nudged up (`EGG_OFFSET_Y_PX`, -40px) in `src/components/pet-placeholder.tsx`. `egg_nest.png` is left on disk, unreferenced.
- New permanent Hatchling picture, `assets/images/pets/pet_hatchling.png`, cropped from the existing `pet_growth_stages.png` sheet's own unused Hatchling pose (measured via an alpha-channel bounding-box scan, visually verified before cropping).
- 5-second hatching sequence: right when a real hatch happens, `kitten_nest.png` (enlarged ~1.69× for just these 5 seconds, via `HATCHLING_INTRO_SCALE`) shows for exactly `HATCHLING_INTRO_DURATION_MS` (5000ms) before switching to the new permanent Hatchling picture. New `PetProfile.hatchedAt` field (`src/utils/pet-profile.ts`) records the real moment this happens, so it never replays on reopening the app and is never backfilled for older saves.
- Developer-only "Replay Hatching Animation" button (gated behind new `DEV_ENABLE_HATCH_INTRO_PREVIEW` flag in `src/utils/dev-flags.ts`, shown on Home alongside the other developer test controls) simulates the exact same timed sequence for repeatable visual testing — purely local state, never touches the saved Pet Profile or task progression.
- Hunger/Cleanliness/Happiness/Energy bars and the Feed/Bath/Play/Rest buttons are now both withheld (not rendered, not just disabled) for the same 5 seconds as the hatching sequence, reusing the same `isShowingHatchIntro` flag rather than a separate timer — unaffected by the regular Developer Stage Preview and by Baby/Young/Adult.
- BUG-009, BUG-010, and BUG-011 documented in `bugs.md` (the temporary/permanent Hatchling images overlapping, the needs bars shifting position between stages, and the message bubble getting covered by oversized artwork) — all fixed and manually tested; see Fixed below.
- FEATURE-039 documented in `features.md`: the full hatching transition system described above.

### Changed
- `src/components/pet-placeholder.tsx`'s `getStageImage` now takes an `isShowingHatchIntro` flag and returns exactly one `{source, aspectRatio}` pair at a time (the temporary or the permanent Hatchling picture, never both) — this mutually-exclusive rendering is what BUG-009's fix relies on.
- `isShowingHatchIntro` is now computed fresh on every render directly from `hatchedAt` and the clock, instead of via `useState`/`useEffect` that started wrong for one render and self-corrected a moment later — removes a possible one-frame flash of the wrong picture/bars/buttons right when a real hatch happens.
- `petWrap`'s box (`src/components/pet-placeholder.tsx`) now always uses a fixed `PET_ART_BOX_ASPECT_RATIO` (square) instead of sizing itself off whichever stage's picture is currently showing — see BUG-010.
- The message bubble (`styles.bubble`) now sits 40px further from Kitty's own box and has `zIndex: 1` so it always paints above any oversized/offset pet or Egg artwork — see BUG-011.

### Fixed
- BUG-009: the temporary and permanent Hatchling pictures could both render at once, with the permanent one showing through gaps around the temporary one's different-shaped edges; fixed by mutually-exclusive rendering (see Changed above).
- BUG-010: the needs bars moved vertically whenever the displayed pet picture changed, because the box around the art was sized off that picture's own aspect ratio; fixed with a fixed box ratio decoupled from the picture (see Changed above).
- BUG-011: the message bubble could be partially covered by Kitty's/the Egg's own oversized artwork overflowing above its box; fixed with more clearance plus `zIndex` (see Changed above).

### Removed
-

---

## [2026-10-12]

### Added
- **Summary:** built the full poop system end to end — random accumulation (up to 5 piles, one every 2 hours while neglected), Small/Medium/Large piles with their own cleanup difficulty, random non-overlapping floor placement on both sides of Kitty, click/tap-to-clean with animated feedback, a horizontal needs-bar layout, and a fix for poop/pet-care leaking into the Egg stage — plus a pass of beginner-friendly explanatory comments across all of it ahead of starting the bathing system next.
- Beginner-friendly code comments added across the poop system (`src/utils/pet-poop.ts`, `src/utils/pet-profile.ts`, `src/utils/pet-needs.ts`, `src/components/pet-placeholder.tsx`, `src/app/index.tsx`, `src/app/_layout.tsx`) — short "Simple explanation" notes above the important functions/sections, kept alongside (not replacing) the existing detailed comments. No behavior changed.
- BUG-007 and BUG-008 documented in `bugs.md` (poop piles overlapping, and the per-pile button row covering too much of the Living Room) — both fixed and manually tested; see the Added entries below for the fixes themselves.
- FEATURE-037 and FEATURE-038 documented in `features.md`: the Egg stage's full pet-care restrictions, and Dirty Kitty staying dirty until an actual bath (`needsBath`) — both already implemented and tested in earlier work, now written up as standalone features.
- Poop pile accumulation (FEATURE-034): Kitty can now have up to 5 independent poop piles on the floor at once instead of just one. The first pile still appears after a random 3-8 hour wait; left uncleaned, another pile piles on every 2 hours up to the cap. Each pile rolls its own Small/Medium/Large size and cleanup difficulty (1/2/3 clicks) and gets its own floor artwork and "Clean Up!" button — cleaning one pile never affects the others.
- `src/utils/pet-profile.ts`: new `poopPiles: PoopPile[]` field (replacing the old single `hasPoop`/`poopSize`/`poopCleanupRemaining`) and `MAX_POOP_PILES` (5). Profiles saved in the older single-poop shape are migrated automatically on load.
- `src/utils/pet-poop.ts`: `applyPoopAccumulation` — the real time-based accumulation scheduler, with a bounded catch-up pass so reopening the app after several hours away adds exactly as many piles as should have accumulated (capped at 5), not just one. `applyCleanUpPile(profile, pileId)` clears one cleanup click from one named pile only.
- Developer-only test controls: add a pile of a specific or random size instantly, a "Fast-Forward Accumulation (+2h)" button that simulates one real accumulation tick via the actual production logic, and a "Clear All Piles" bulk reset — all disabled while the real pet is still an Egg.
- BUG-006 documented in `bugs.md`: poop/pet-care controls were still reachable while viewing the Egg (specifically when previewing the Egg via the developer Stage Preview on an already-hatched, already-dirty pet) — fixed and manually tested.
- Random, stable poop-pile floor positions (FEATURE-035): each pile now appears at a random floor spot (picked from a fixed set of 6 non-overlapping slots, plus a small random jitter) instead of lining up left-to-right, staying grounded, away from Kitty, and away from the Clean Up buttons. A pile's position is generated once at creation and persisted — it never changes on rerender or app reopen, only new piles get a fresh random spot. `src/utils/pet-profile.ts`'s `PoopPile` gained `slotIndex`/`jitterXPx`/`jitterYPx`; `src/utils/pet-poop.ts`'s `createPoopPile` now picks an unused slot among the pile's current siblings (correctly avoiding collisions even when several piles are added at once during a multi-hour catch-up).
- Horizontal pet-needs bars (FEATURE-035): Hunger/Cleanliness/Happiness/Energy now render side by side in one wrapping row (`src/components/pet-placeholder.tsx`'s new `needsRow`/`needBarHorizontal` styles) instead of stacked vertically, falling back to a 2x2 grid on narrow phone screens via plain flexbox wrapping — no new breakpoint logic. Shortens the panel noticeably, leaving more of the floor visible.
- Random both-sides, collision-aware poop placement: replaced the 6-slot grid above with real placement logic (`placePoopPile` in `src/utils/pet-poop.ts`) that randomly picks either side of Kitty (not favoring one), checks each candidate against every existing pile's own real size-based footprint with a required ~25px gap, retries on collision, and falls back to a safe fixed position as a last resort. `PoopPile.slotIndex`/`jitterXPx`/`jitterYPx` were replaced by a single fully-resolved `offsetXPx`/`offsetYPx` per pile.
- Kitty nudged up ~30px in the Living Room (`KITTY_LIVING_ROOM_OFFSET_Y_PX` in `src/components/pet-placeholder.tsx`) for Hatchling/Baby/Young/Adult — the Egg, and every other room, are unaffected.
- Tap/click-to-clean poop (FEATURE-036): each pile's own artwork is now the cleanup control (click on web, tap on Android/iOS) — no more separate "Clean Small/Medium/Large" buttons. Gives wiggle/shrink feedback on every click, a brief "N left!" bubble for Medium/Large piles with clicks remaining, and a sparkle + shrink/fade animation on the final click before the pile disappears. Built with React Native's `Animated` API (no new dependency); includes `accessibilityRole`/`accessibilityLabel` for screen readers and keyboard activation on web, a `hitSlop`-enlarged tap target, and a short per-pile press lock to prevent double-activation.

### Changed
- `isPetDirty` (`src/utils/pet-needs.ts`) now checks `poopPiles.length > 0` instead of the old single boolean — still one combined dirty check with Cleanliness/`needsBath`, so multiple accumulated piles don't stack the Happiness/Energy penalty.
- Poop floor artwork positioning: Young/Adult nudged further right (now 250px from baseline) and Hatchling/Baby nudged left (-100px from baseline) — now used as each side's *minimum* distance from Kitty's center rather than a single fixed direction, since piles can land on either side.
- Egg-stage pet-care gating (`src/app/index.tsx`) now correctly distinguishes the real saved stage (used to guard every profile-writing handler) from the currently *displayed* stage, which includes the developer Pet Stage Preview (used to decide what's actually visible) — see BUG-006.

### Fixed
- BUG-006: poop artwork, the Clean Up button, and other pet-care controls could still render while viewing the Egg if gating only checked the real saved stage; now gated on the displayed stage for visibility and separately backstopped on the real stage for every state-mutating action.

### Removed
- The old single-poop model (`hasPoop: boolean` / `poopSize: PoopSize | null` / `poopCleanupRemaining: number` fields, `applyPoopTrigger`/`applyPoopScheduling`/`applyCleanUpPoop`/`checkForPoopEvent`) — superseded by the `poopPiles` accumulation system above. Existing saved profiles using the old shape are migrated automatically, not reset.
- The per-pile "Clean Small/Medium/Large" button row — cleaning now happens by pressing the poop artwork itself (see FEATURE-036 above).

---

## [2026-10-02]

### Added
- Built a real, functional Stats page (`src/components/stats-screen.tsx`), replacing the "Coming soon" placeholder.
- Pet Progress section showing the user's real pet growth stage, level, progress bar, and completed-task progress, using the same pet progression data as the rest of the app.
- Dynamic pet growth-stage artwork (Egg, Hatchling, Baby, Young, Adult) that automatically updates to match the user's real progress.
- Lifetime Stats showing the real total number of completed tasks and completed Important tasks.
- Completed by Category statistics showing real completed-task counts for Study, Exercise, Clean, Health, and Personal.
- New full-screen pastel purple cloud background for the Stats page (`assets/images/stats/stats_background.png`), extending behind the header/navigation the same way Home and Tasks already do.
- New custom cloud background inside the Pet Progress card (`assets/images/stats/stats_pet_background.png`).
- New Stats-specific icon artwork (`assets/images/task_icons/stats_Icons.png`) for the category and Lifetime Stats icons, replacing generic icons.
- New custom pastel 3-line accent marks (`assets/images/stats/accent_marks.png`), replacing the generic sparkle/star decorations on Lifetime Stats and Completed by Category.
- Cleaned up the "Your Progress" banner by removing the generic emoji decorations around it, keeping it as simple text.
- Created the persistent Pet Profile foundation (`src/utils/pet-profile.ts`) using AsyncStorage — the foundation for the future virtual pet-care system. Stores Hunger, Cleanliness, Happiness, Energy, Paw Tokens, adoption date, last-updated time, sleeping state, sick state, and a poop-event state.
- A new Pet Profile is created automatically the first time the app runs; an existing one is loaded instead of recreated on every later launch, and the original adoption date is preserved across app launches.
- Connected Pet Profile loading to app startup (`src/app/_layout.tsx`), so a profile now exists in storage from the very first launch. No pet-care UI or behavior yet — this is the data foundation only.
- Tested persistence by reloading the app and confirming the same profile, including the same adoption date, was still there afterward.

---

## [2026-09-08]

### Added
- Redesigned Pet Progress (`src/components/pet-progress.tsx`): "Pet Progress" / "Level X" header row, a pastel progress bar, "X / 10 tasks to next stage" text, and an Egg → Hatchling → Baby → Young → Adult stage row with arrows, the current stage highlighted with an accent-colored ring. 10 completed tasks per stage.
- Added `assets/images/pets/pet_stages.png`, a real illustrated 5-stage sprite (Egg/Hatchling/Baby/Young/Adult), and a new `src/components/pet-stage-icon.tsx` (`PetStageIcon`) that crops the matching stage out of it — same sprite-crop technique already used for `TaskIcon`. Replaces the 🥚🐣🐱😺🐈 emoji placeholders in each stage's circle. Crop boundaries were computed by analyzing the source image's pixel data (row/column opacity density) and verified against test crops before wiring them in.
- Automatic pet growth: the living-room pet now changes automatically (Egg → Hatchling → Baby → Young → Adult) as completed tasks cross each Pet Progress stage boundary, instead of via double-tap. New `src/utils/pet-stage.ts` centralizes the stage formula (`getPetStage`, `getPetStageIndex`, `TASKS_PER_STAGE`) so Pet Progress and the living-room pet always agree. `src/app/index.tsx` passes the derived `petStage` down through `PetRoom` to `PetPlaceholder`.
- Added `assets/images/pets/pet_growth_stages.png` (source sprite for Baby/Young/Adult) and three pre-cropped standalone files — `pet_baby.png`, `pet_young.png`, `pet_adult.png` — generated from it by analyzing the source's pixel opacity to locate each pose, then verified visually before wiring in.
- Today's Mood card (`src/components/today-mood.tsx`): a static pastel card showing "Happy 😊", placed under Today's Tasks in the left column on the wide/desktop layout (and right after it in the narrow/mobile stacked layout). Not dynamic yet — that's the planned next step.
- Redesigned Today's Mood with real illustrated icons: new `src/components/mood-icon.tsx` (`MoodIcon`) crops each of the 6 moods (Happy/Calm/Focused/Stressed/Tired/Sick) out of the new `assets/images/moods/pet_moods.png` sprite. Clicking a mood selects it; the selected mood shows larger next to a cute per-mood encouraging message; the selection persists via `AsyncStorage` (`@ProductivityPet:mood`, same load/save pattern as tasks). Moods are still chosen manually, not connected to task activity yet.
- The pet's speech bubble now shows the selected mood's message: new `src/utils/mood.ts` holds 4 hand-written cute messages per mood (24 total); one is picked at random on mood change and occasionally (every 60s, only when nothing more urgent is showing) re-rolled to a different one from the same pool.
- Rooms card (`src/components/rooms-card.tsx`): a 3×2 grid of 6 room previews (Living Room, Study Room, Gym, Bedroom, Bathroom, Kitchen), "Rooms" / "View All →" header row, Living Room shown selected/highlighted (real art thumbnail; the other 5 use emoji placeholders since they don't exist yet). Visual layout only — not clickable, room switching doesn't work yet. Sits in the right column below the living room on desktop (beside Today's Mood), stacked at the end on mobile.
- Replaced all 6 Rooms card placeholders with real illustrated previews cropped from the new `assets/images/rooms/room_previews.png` (a 3×2 grid, each cell a fused illustration + label pill). Pre-cropped into 6 standalone files (`room_preview_living/study/gym/bedroom/bathroom/kitchen.png`), same approach as the pet growth stages. Living Room now uses this same purpose-built card art instead of a crop of the large `living-room.png` scene, for visual consistency with the other 5.
- Room detail pages: clicking a room preview card now opens a page for that room (header/nav, prominent artwork, name, a cute one-line description, and a "← Back to Rooms" button). New `src/app/rooms/[room].tsx` (dynamic route, coexisting with the existing flat `src/app/rooms.tsx`), `src/components/room-detail-screen.tsx` (shared screen shell), and `src/utils/rooms.ts` (room name/description/art data — Living Room uses the big `living-room.png` scene, the other 5 reuse their existing small preview card art shown larger). Works on both desktop and mobile via the same centered, capped-width layout used elsewhere in the app.
- Rooms are now genuinely functional. Added 5 new full-size background images (`assets/images/rooms/backgrounds/Study_Room.png`, `Gym_Room.png`, `Bedroom.png`, `Bath_Room.png`, `Kitchen_Room.png`) — backgrounds only, no pet/cat art. Living Room's preview card now navigates back to Home instead of a detail page (`src/utils/rooms.ts` dropped `'living-room'` from its data entirely; `src/components/rooms-card.tsx` sends it to `/` via a small `openRoom()` helper). The other 5 room detail pages now show their real background large and prominent — `src/components/room-detail-screen.tsx`'s art is full-width (was capped at 420px) and the screen gained a `ScrollView` so it stays responsive now that the art is much bigger.

### Changed
- `src/components/rooms-card.tsx`: "View All →" now navigates to the existing Rooms tab (`router.push('/rooms')`). The 6 room preview cards themselves are still non-interactive — no `Pressable`, no room switching — only this one link works.
- `src/components/rooms-card.tsx`: the 6 room preview cards are now `Pressable` and navigate to `/rooms/[room]` (Expo Router's typed routes need the `{ pathname, params }` object form for dynamic segments, not an interpolated string). The `width: '31%'` grid sizing moved from the inner `View` to the new outer `Pressable` so it still resolves against the right parent — visual appearance is unchanged.
- Pet Progress is now driven by real data instead of being a static placeholder: `src/app/index.tsx` passes `completedTaskCount` (live count of currently-completed tasks) down as a prop; `PetProgress` derives stage/level/progress from it on every render. Unchecking a task lowers `completedTaskCount` and therefore the displayed progress (and can drop a stage) the same way completing one raises it — no separate "lower progress" logic was needed. Progress persists across refresh for the same reason FEATURE-021's completion tracker does: it's derived from the already-persisted `tasks` list, not stored separately.
- `src/components/pet-progress.tsx` now imports its stage list/formula from `src/utils/pet-stage.ts` instead of defining its own local copy (no behavior change, just de-duplicated against FEATURE-024's shared logic).
- `src/components/pet-stage-icon.tsx`: `PetStage` type is now imported from `src/utils/pet-stage.ts` instead of being declared locally.
- `src/components/pet-room.tsx`: now takes a required `stage: PetStage` prop and passes it through to `PetPlaceholder`.
- `src/app/index.tsx`: `leftColumn` gained a `gap` so the newly-stacked `TaskCard` + `TodayMood` cards have spacing between them.
- `src/components/today-mood.tsx`: rewritten as a controlled component (`mood`, `message`, `onSelectMood` props) — mood state and its `AsyncStorage` persistence moved up to `src/app/index.tsx` so the pet's speech bubble can use it too. `src/components/mood-icon.tsx`: `Mood` type now imported from `src/utils/mood.ts` instead of declared locally.
- `src/app/index.tsx`: renamed `petMessage`/`setPetMessage` to `temporaryMessage`/`setTemporaryMessage` and gave the task-completion message the same 3s auto-revert the uncheck message already had (previously it had none and would sit forever) — both branches now share one timeout ref. The bubble shown to `PetRoom` is `temporaryMessage ?? moodMessage`.
- `src/app/index.tsx`: `rightColumn` gained a `gap` now that it stacks `PetRoom` + `RoomsCard`, mirroring `leftColumn`.
- `src/components/rooms-card.tsx`: removed the per-card `ThemedText` room-name label (the new artwork already shows the name, so a separate label would have duplicated it); `contentFit` changed from `cover` to `contain` so each card's full illustration and label pill are always fully visible.

### Fixed
-

### Removed
- Double-tap-to-hatch entirely: `src/components/pet-placeholder.tsx` no longer has any tap handling, `hasHatched`/`showCrackMessage` state, or the "Crack!" message — the component is now a plain, non-interactive image that simply renders whichever stage it's told to via props. `kitten_nest.png` is kept as the dedicated Hatchling image, per instructions.

---

## [2026-09-07]

### Added
- Pet placeholder component (`src/components/pet-placeholder.tsx`) shown on the home screen.
- Basic task list on the home screen with an empty-state message.
- Ability to add a task via a text input.
- Ability to mark a task complete/incomplete by tapping it (checkbox glyph + strikethrough).
- Pet reaction: shows a positive message near the pet when a task is marked complete, cycling through "Yippee!", "Yay!", "Woohoo!", and "I knew you could do it!" (in order, one per completion); cleared when a task is un-completed.
- Pastel dashboard visual redesign: "Productivity Pet" header/tagline, a pastel pet card showing an egg, and a static "Egg Stage — 0 / 5 tasks to hatch" progress card (`src/components/pet-progress.tsx`) as a placeholder foundation for the future growth system.
- Cozy living-room pet scene (`src/components/pet-room.tsx`): initially a decorative pastel room built from plain View shapes, since replaced by an illustrated background (see below).
- Added `assets/images/rooms/living-room.png`, a real illustrated living-room background.
- Simple nest shape underneath the egg (`src/components/pet-placeholder.tsx`), built from basic `View` shapes.
- Added `assets/images/pets/egg_nest.png`, a real illustrated egg-in-nest image.
- Double-tap interaction on the egg/nest: shows a temporary "hatching" state (dimmed egg + 🐣 overlay, "Crack!" message) for 1.8 seconds, as a first step toward a real hatching feature.
- Hatching is now permanent: once double-tapped, the pet stays hatched (dimmed egg + overlay) until the page is refreshed, instead of reverting back to the egg. The overlay is now a "🐱" kitten placeholder instead of a chick, matching the app's kitten pet.
- Added `assets/images/pets/kitten_nest.png`, a real illustrated kitten-in-nest image, now shown once the egg hatches (replacing the "🐱" emoji placeholder).
- Global top header (`src/components/app-header.tsx`) with paw icon, "Productivity Pet" title, tagline, and rounded pastel nav buttons for Home, Tasks, Rooms, Shop, and Stats. The active section is highlighted with a new `purple` theme color.
- Four placeholder routes/screens: `src/app/tasks.tsx`, `rooms.tsx`, `shop.tsx`, `stats.tsx`, each showing the section name and "Coming soon" via a shared `src/components/coming-soon-screen.tsx`.
- "Today's Tasks" card (`src/components/task-card.tsx`): rounded pastel card with a pink "+ Add Task" button, per-task category emoji icon, category label, and a decorative three-dot menu icon per row.
- Added a `category` field to tasks (defaults to "Personal" for new tasks; no category picker yet).
- Two-column dashboard layout on wide/web screens (`src/app/index.tsx`): Today's Tasks now renders beside the living room (tasks left, room right) instead of stacked above it, using a `useWindowDimensions()` breakpoint at 700px width. Narrow/mobile screens are unchanged (still stacked). Pet Progress renders full-width below the row for now; it and Today's Mood are not yet part of the left-column layout.
- Local task persistence: tasks now survive a browser refresh or app reload via `@react-native-async-storage/async-storage` (`src/app/index.tsx`), loaded once on mount and saved on every change. No accounts, backend, or cloud sync.
- Automatic keyword-based task categorization (`src/utils/categorize-task.ts`): new tasks are now assigned Study, Exercise, Clean, or Personal based on keywords in the task name, instead of always defaulting to Personal.
- Illustrated task category icons (`src/components/task-icon.tsx`), cropped from the new `assets/images/task_icons/task_icons.png` sprite sheet, replacing the per-category emoji next to each task.
- Added a 5th task category, Health, with its own keyword list and its own icon (`assets/images/task_icons/health_icon.png`, shown directly rather than cropped from the sprite sheet).
- Greatly expanded the Health keyword list (`src/utils/categorize-task.ts`) with real-world phrasings — doctor/dentist/chiro/PT appointment variants, checkups, self-care, etc. — plus `"studying"` added to Study and `"organizing"` added to Clean.
- Functional three-dot task menu (`src/components/task-card.tsx`): tapping the `⋮` icon opens a small popover with "Mark as Important" / "Remove Important" (shows a ⭐ next to the task) and "Delete Task". Tapping outside the menu closes it. Both actions persist through the existing task storage.
- Task completion tracker (`src/components/task-card.tsx`): a "X% complete" label and pastel progress bar near the top of the Today's Tasks card, computed as completed ÷ total × 100 with no task-count limit. Updates immediately on add/complete/uncomplete/delete and persists across refresh (it's derived from the already-persisted `tasks` list, not separately stored). Shows "0% complete" with an empty bar when there are no tasks. No confetti/celebration yet.
- 100% completion celebration: confetti burst + "All tasks complete! Amazing job! 🎉" message, shown briefly (2.2s) only when the user's action of completing a task brings the list to 100% — not on refresh, not repeatedly while at 100%, but it can fire again after an uncheck-then-recomplete cycle. New `src/components/confetti-burst.tsx` implements the confetti using React Native's built-in `Animated` API — no new dependency added.
- Pet reaction for unchecking a completed task (`src/app/index.tsx`): the speech bubble briefly (3s) shows "Aww, not done yet? You got this! 💕", then clears back to no message, the same way the existing completion messages and "Crack!" hatching message already work (a `setTimeout` tracked in a ref, cleared/replaced on the next toggle).

### Changed
- Much more confetti (`src/components/confetti-burst.tsx`): pieces are now arranged in 7 horizontal bands stacked down the full screen height (77 pieces total, up from 16 in one strip at the top), so the celebration reads as covering the whole screen rather than a thin band falling from the top. Still short (~0.9–1.4s per piece), still `pointerEvents="none"`, still fully contained by the existing full-screen overlay and duration/trigger logic — no other behavior changed.
- Confetti now renders as a full-screen overlay (`src/app/index.tsx`, absolutely positioned above `SafeAreaView`, `pointerEvents="none"`) instead of being clipped inside the Today's Tasks card — it now visually covers the living room and the rest of the dashboard too, without affecting layout or blocking clicks. `src/components/task-card.tsx` no longer renders `ConfettiBurst` or the pink completion banner; the outer card's now-unneeded `overflow: 'hidden'` was removed.
- The "All tasks complete! Amazing job! 🎉" message no longer appears as a separate banner — it now temporarily replaces the "X% complete" text above the progress bar (`src/components/task-card.tsx`) while `isCelebrating` is true, then reverts automatically. The progress bar keeps showing 100% underneath throughout. Trigger conditions (only on user-driven completion to 100%, never on refresh, never repeatedly, can re-fire after uncheck→recomplete) are unchanged.
- `src/components/task-card.tsx`: moved the important-task ⭐ indicator from before the task name to the right side of the row, near the three-dot menu. Mark as Important / Remove Important behavior and persistence are unchanged.
- `src/app/index.tsx`: Home dashboard now uses its own wider `HOME_MAX_WIDTH` (1400px) instead of the shared `MaxContentWidth` (800px), so it fills most of the browser width on wide/web screens instead of leaving large empty side margins. The header and other screens still use the shared 800px cap and are unaffected. The two dashboard columns' `minWidth` floors and gap were also increased (240→320 / 280→380 / gap 24→32) so they scale up along with the wider container; the outer page margin (24px) is unchanged.
- Added `@react-native-async-storage/async-storage` as a dependency (installed via `npx expo install` for SDK compatibility) to support local task persistence.
- `src/components/task-card.tsx`: `Task.category` changed from a free-form `string` to a `TaskCategory` union (`'Study' | 'Exercise' | 'Clean' | 'Personal'`); the per-category emoji lookup (including the now-unused "Health" 💧 entry) was removed in favor of `TaskIcon`.
- `src/utils/categorize-task.ts`: `TaskCategory` now includes `'Health'`; the Study and Exercise keyword lists were updated to drop `"practice"` / `"practice problems"`, which used to make those two categories overlap.
- `src/app/index.tsx`'s `toggleTask` now detects the exact moment the user's action completes the last remaining task and triggers the celebration state (`isCelebrating`, auto-reset after 2.2s via a cleared/replaced `setTimeout`); `src/components/task-card.tsx` gained an `isCelebrating` prop and `overflow: 'hidden'` on its outer card (confirmed this doesn't affect the three-dot menu, which renders via `Modal`'s portal outside the card's hierarchy).
- `src/utils/categorize-task.ts`: removed the old bare `"appointment"` Health keyword in favor of specific compound phrases (`"doctor appointment"`, `"dentist appointment"`, etc.); deliberately never added a standalone `"app"` keyword so tasks like "work on my app" aren't miscategorized as Health.
- `src/components/task-card.tsx`: `Task` gained an `important: boolean` field; `TaskCardProps` gained `onToggleImportant`/`onDeleteTask`; the three-dot icon is now its own `Pressable` (with `event.stopPropagation()`) instead of static, non-interactive text.
- Replaced the default Expo starter content in `src/app/index.tsx` with the pet + task list screen.
- Replaced the app's black/dark color palette in `src/constants/theme.ts` with a soft pastel palette (cream, blush pink, lavender, mint, peach); light and dark mode now use the same pastel colors.
- Restyled the task list with custom checkbox indicators (mint when checked) and an accent-colored "Add" button.
- `src/components/pet-placeholder.tsx` simplified to just the egg "nest" and message bubble (no longer its own outer room card) now that `PetRoom` provides the room; `src/app/index.tsx` renders `PetRoom` in its place.
- `src/components/pet-room.tsx` rewritten to render the illustrated `living-room.png` (via `expo-image`, `contentFit="contain"`, aspect ratio locked to the image's real pixel dimensions so it's never stretched) instead of building the room out of `View` rectangles/circles. The egg and its message are overlaid on top, positioned proportionally so they stay roughly on the rug across screen sizes.
- `src/components/pet-placeholder.tsx`: removed the large pastel circle behind the egg, enlarged the egg, and added a small nest shape underneath it so it looks nestled into the room instead of floating on top.
- `src/components/pet-placeholder.tsx` rewritten again: the coded emoji egg + shape-built nest are replaced by the illustrated `egg_nest.png`, sized as a responsive percentage of the room's width (clamped 150–260px) instead of a fixed pixel size.
- `src/components/pet-room.tsx`: overlay `pointerEvents` changed from `none` to `box-none` so the egg can be tapped while the rest of the overlay still passes touches through to the room.
- `src/components/pet-placeholder.tsx`: renamed the transient `isHatching` state to a permanent `hasHatched` (no revert timeout, further taps ignored once hatched); split the "Crack!" bubble text into its own short-lived `showCrackMessage` state so the reaction-message bubble (FEATURE-005) still works normally after hatching.
- `src/components/pet-placeholder.tsx`: image source and container `aspectRatio` now switch together based on `hasHatched` — `egg_nest.png` (1536x1024) before, `kitten_nest.png` (1381x1139) after — replacing the "🐱" emoji-over-dimmed-egg placeholder with the real illustrated kitten art.
- `src/app/_layout.tsx`: replaced `NativeTabs`-based `AppTabs` with the new `AppHeader` rendered above `expo-router`'s `<Slot />`, so navigation is a normal-flow top header instead of a native bottom tab bar.
- `src/app/index.tsx`: removed the in-page "Productivity Pet" header/tagline block (now lives in the global `AppHeader`) and the `BottomTabInset`-based bottom padding (no longer meaningful without a bottom tab bar).
- `src/constants/theme.ts`: added a `purple` color token for the active nav pill; removed the now-unused `BottomTabInset` export.
- Task list UI moved out of `src/app/index.tsx` into `src/components/task-card.tsx`; `index.tsx` now only owns the `tasks`/`petMessage` state and passes callbacks down. The always-visible add-task input row was replaced by a toggleable compose row behind the new "+ Add Task" button. Task rows no longer render as separate rounded chips — they're flat rows inside one card, separated by thin dividers.

### Fixed
- BUG-001: Tapping a task did not mark it complete. `toggleTask` in `src/app/index.tsx` was assigning `completed: task.completed` instead of `completed: !task.completed`, so the value never flipped. Restored the negation.
- Adjusted for a React Native API change in the installed RN/Expo version: `StyleSheet.absoluteFillObject` no longer exists and was replaced with `StyleSheet.absoluteFill` in `src/components/pet-room.tsx`.

### Removed
- Unused `HintRow` component (`src/components/hint-row.tsx`), left over from the starter template and no longer referenced after the home screen rewrite.
- Expo-starter leftovers no longer reachable after the header/nav redesign: `src/app/explore.tsx`, `src/components/app-tabs.tsx`, `app-tabs.web.tsx`, `external-link.tsx`, `web-badge.tsx`, and `ui/collapsible.tsx`.

---

<!-- Add new entries above this line, newest first -->
