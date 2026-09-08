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

### Changed
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

### Fixed
- BUG-001: Tapping a task did not mark it complete. `toggleTask` in `src/app/index.tsx` was assigning `completed: task.completed` instead of `completed: !task.completed`, so the value never flipped. Restored the negation.
- Adjusted for a React Native API change in the installed RN/Expo version: `StyleSheet.absoluteFillObject` no longer exists and was replaced with `StyleSheet.absoluteFill` in `src/components/pet-room.tsx`.

### Removed
- Unused `HintRow` component (`src/components/hint-row.tsx`), left over from the starter template and no longer referenced after the home screen rewrite.

---

<!-- Add new entries above this line, newest first -->
