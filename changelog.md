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

## [2026-09-08]

### Added
- Redesigned Pet Progress (`src/components/pet-progress.tsx`): "Pet Progress" / "Level X" header row, a pastel progress bar, "X / 10 tasks to next stage" text, and an Egg → Hatchling → Baby → Young → Adult stage row with arrows, the current stage highlighted with an accent-colored ring. 10 completed tasks per stage.
- Added `assets/images/pets/pet_stages.png`, a real illustrated 5-stage sprite (Egg/Hatchling/Baby/Young/Adult), and a new `src/components/pet-stage-icon.tsx` (`PetStageIcon`) that crops the matching stage out of it — same sprite-crop technique already used for `TaskIcon`. Replaces the 🥚🐣🐱😺🐈 emoji placeholders in each stage's circle. Crop boundaries were computed by analyzing the source image's pixel data (row/column opacity density) and verified against test crops before wiring them in.
- Automatic pet growth: the living-room pet now changes automatically (Egg → Hatchling → Baby → Young → Adult) as completed tasks cross each Pet Progress stage boundary, instead of via double-tap. New `src/utils/pet-stage.ts` centralizes the stage formula (`getPetStage`, `getPetStageIndex`, `TASKS_PER_STAGE`) so Pet Progress and the living-room pet always agree. `src/app/index.tsx` passes the derived `petStage` down through `PetRoom` to `PetPlaceholder`.
- Added `assets/images/pets/pet_growth_stages.png` (source sprite for Baby/Young/Adult) and three pre-cropped standalone files — `pet_baby.png`, `pet_young.png`, `pet_adult.png` — generated from it by analyzing the source's pixel opacity to locate each pose, then verified visually before wiring in.
- Today's Mood card (`src/components/today-mood.tsx`): a static pastel card showing "Happy 😊", placed under Today's Tasks in the left column on the wide/desktop layout (and right after it in the narrow/mobile stacked layout). Not dynamic yet — that's the planned next step.
- Redesigned Today's Mood with real illustrated icons: new `src/components/mood-icon.tsx` (`MoodIcon`) crops each of the 6 moods (Happy/Calm/Focused/Stressed/Tired/Sick) out of the new `assets/images/moods/pet_moods.png` sprite. Clicking a mood selects it; the selected mood shows larger next to a cute per-mood encouraging message; the selection persists via `AsyncStorage` (`@ProductivityPet:mood`, same load/save pattern as tasks). Moods are still chosen manually, not connected to task activity yet.
- The pet's speech bubble now shows the selected mood's message: new `src/utils/mood.ts` holds 4 hand-written cute messages per mood (24 total); one is picked at random on mood change and occasionally (every 60s, only when nothing more urgent is showing) re-rolled to a different one from the same pool.

### Changed
- Pet Progress is now driven by real data instead of being a static placeholder: `src/app/index.tsx` passes `completedTaskCount` (live count of currently-completed tasks) down as a prop; `PetProgress` derives stage/level/progress from it on every render. Unchecking a task lowers `completedTaskCount` and therefore the displayed progress (and can drop a stage) the same way completing one raises it — no separate "lower progress" logic was needed. Progress persists across refresh for the same reason FEATURE-021's completion tracker does: it's derived from the already-persisted `tasks` list, not stored separately.
- `src/components/pet-progress.tsx` now imports its stage list/formula from `src/utils/pet-stage.ts` instead of defining its own local copy (no behavior change, just de-duplicated against FEATURE-024's shared logic).
- `src/components/pet-stage-icon.tsx`: `PetStage` type is now imported from `src/utils/pet-stage.ts` instead of being declared locally.
- `src/components/pet-room.tsx`: now takes a required `stage: PetStage` prop and passes it through to `PetPlaceholder`.
- `src/app/index.tsx`: `leftColumn` gained a `gap` so the newly-stacked `TaskCard` + `TodayMood` cards have spacing between them.
- `src/components/today-mood.tsx`: rewritten as a controlled component (`mood`, `message`, `onSelectMood` props) — mood state and its `AsyncStorage` persistence moved up to `src/app/index.tsx` so the pet's speech bubble can use it too. `src/components/mood-icon.tsx`: `Mood` type now imported from `src/utils/mood.ts` instead of declared locally.
- `src/app/index.tsx`: renamed `petMessage`/`setPetMessage` to `temporaryMessage`/`setTemporaryMessage` and gave the task-completion message the same 3s auto-revert the uncheck message already had (previously it had none and would sit forever) — both branches now share one timeout ref. The bubble shown to `PetRoom` is `temporaryMessage ?? moodMessage`.

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
