# Features

Track planned and in-progress features here. Copy the template for each new feature.

## Template

### [FEATURE-ID] Short title

- **Status:** Idea | Planned | In Progress | Done | Dropped
- **Description:** What is this feature and why is it needed?
- **Notes:** Design decisions, open questions, dependencies on other features.

---

<!-- Add new features below this line -->

### [FEATURE-001] Pet placeholder on home screen

- **Status:** Done
- **Description:** Show a static pet placeholder on the home screen as a visual anchor for the app. No animation, stats, or growth logic yet.
- **Notes:** Implemented in `src/components/pet-placeholder.tsx`. Shown as an illustrated egg-in-nest image (see FEATURE-010), matching the Egg Stage of the long-term Tamagotchi-style vision. Placed inside the illustrated living-room scene from FEATURE-008. Future pet behavior (moods, growth stages, points/levels) is separate, later work. See FEATURE-005 for the task-completion reaction.

### [FEATURE-002] Basic task list

- **Status:** Done
- **Description:** Show the current list of tasks on the home screen, with an empty-state message when there are none.
- **Notes:** Task state lives in-memory in `src/app/index.tsx` (`useState`). No persistence — the list resets on reload/restart.

### [FEATURE-003] Add a task

- **Status:** Done
- **Description:** Type a task into a text field and add it to the list.
- **Notes:** Blank/whitespace-only input is ignored. Submitting via the keyboard's "done" action also adds the task.

### [FEATURE-004] Mark a task complete

- **Status:** Done
- **Description:** Tap a task to toggle it complete/incomplete, with a visual change (checkbox glyph + strikethrough text) showing its state.
- **Notes:** Tapping again un-completes it (toggle, not one-way).

### [FEATURE-005] Pet reacts to task completion

- **Status:** Done
- **Description:** When a task is marked complete, show a simple positive message near the pet.
- **Notes:** Implemented as a `message` prop on `PetPlaceholder` (`src/components/pet-placeholder.tsx`), driven by a `petMessage` state in `src/app/index.tsx`. The message cycles in order through "Yippee!", "Yay!", "Woohoo!", and "I knew you could do it!" each time a task is completed, and is cleared when a task is un-completed. No points, levels, animations, or persistence — just the message.

### [FEATURE-006] Pastel dashboard visual redesign

- **Status:** Done
- **Description:** Replace the dark/black Expo-starter look with a soft pastel dashboard aesthetic (cream, blush pink, lavender, mint, peach), as the visual foundation for the long-term Tamagotchi-style Productivity Pet vision.
- **Notes:** Updated the color palette in `src/constants/theme.ts` (added `accent`, `mint`, `peach` tokens; light and dark modes both use the same pastel palette — no more black background). Home screen (`src/app/index.tsx`) now has a "Productivity Pet" header/tagline, a pastel pet card, a new static "Egg Stage — 0 / 5 tasks to hatch" progress card (`src/components/pet-progress.tsx`), and restyled task rows with a custom checkbox and an accent-colored Add button. The progress card is a visual placeholder only — it is not wired to the real task count, and no growth/leveling logic exists yet. The plain pet card was later replaced by the living-room scene in FEATURE-007. Multiple rooms, pet movement/animation, and shop/accounts are still future work.

### [FEATURE-007] Cozy living-room pet scene

- **Status:** Done
- **Description:** Give the pet area a cozy living-room scene instead of a plain card, so it feels like part of a game rather than a form panel.
- **Notes:** First implemented with plain React Native `View` shapes (wall/floor/couch/window/etc.), then replaced with a real illustrated background image — see FEATURE-008. `src/app/index.tsx` renders `PetRoom` in place of the bare `PetPlaceholder`.

### [FEATURE-008] Illustrated living-room background image

- **Status:** Done
- **Description:** Replace the flat, shape-built living room with a real illustrated background image so the pet area looks like actual game art instead of geometric placeholder shapes.
- **Notes:** `src/components/pet-room.tsx` now renders `assets/images/rooms/living-room.png` (1536x1024) via `expo-image`, sized with a fixed `aspectRatio` matching the image's exact pixel ratio and `contentFit="contain"`, so it always displays fully and never stretches or crops regardless of screen size. The egg (`PetPlaceholder`) and its reaction message are layered on top via a `pointerEvents="none"` overlay, positioned roughly on the rug using flex-grow spacers (so it stays proportionally placed across screen sizes rather than a fixed pixel offset). No furniture is drawn in code anymore. This is a background-only step — no illustrated egg/pet sprite, animation, or additional rooms yet. See FEATURE-009 for refining how the egg itself sits in the scene.

### [FEATURE-009] Egg sits naturally in the room (no floating circle)

- **Status:** Done
- **Description:** Remove the large flat pink circle behind the egg so it doesn't look like it's floating on top of the room image, make the egg bigger, and add a simple nest underneath so it reads as part of the scene.
- **Notes:** First implemented with a coded emoji egg + a basic-`View`-shape nest underneath. Both were replaced by a real illustrated asset — see FEATURE-010.

### [FEATURE-010] Illustrated egg/nest image + double-tap hatching placeholder

- **Status:** Done
- **Description:** Replace the coded emoji egg and shape-built nest with a real illustrated egg-in-nest image asset, sized/positioned to sit naturally on the living-room rug without stretching. Make it interactive: double-tapping it shows a "hatching" visual state, as a first step toward a future real hatching feature.
- **Notes:** `src/components/pet-placeholder.tsx` now renders `assets/images/pets/egg_nest.png` (1536x1024, transparent background) via `expo-image` with `contentFit="contain"` and an `aspectRatio` matching the asset's real pixel ratio, sized as a responsive percentage width (`46%`, clamped between 150–260px) so it scales with the room rather than using a fixed pixel size. It's wrapped in a `Pressable`; a manual double-tap check (two taps within 300ms, via a timestamp ref — no gesture library needed) triggers the hatched state. Once hatched, the dimmed egg image + pet overlay stay that way permanently (in memory — resets on page refresh; no persistence yet). See FEATURE-011 for the current hatched-state visual and behavior, which was refined after this was first built. `src/components/pet-room.tsx`'s overlay pointer events were changed from `none` to `box-none` so taps can reach the egg while the rest of the overlay stays passthrough.

### [FEATURE-011] Hatching is permanent; kitten placeholder replaces the chick

- **Status:** Done
- **Description:** Once the egg is double-tapped, the hatched state should stay (not revert back to the egg after a few seconds), and the placeholder shown should be a kitten (the pet species for this app) instead of a chick.
- **Notes:** In `src/components/pet-placeholder.tsx`, `hasHatched` is now a one-way state — double-tapping sets it true and it is never reset (no timeout reverts it), so the pet stays hatched until the page is refreshed (no persistence yet, per instructions). Once hatched, further taps are ignored (`handlePress` returns early). First implemented as a "🐱" emoji overlay on the dimmed egg art (no kitten asset yet); replaced by real illustrated art in FEATURE-012. The "Crack!" message bubble is a separate, still-temporary flash (`showCrackMessage`, reverts after 1.8s) so it doesn't block real task-completion messages (FEATURE-005) from showing again after hatching.

### [FEATURE-012] Illustrated kitten replaces the emoji placeholder on hatch

- **Status:** Done
- **Description:** Once hatched, show the real illustrated `kitten_nest.png` artwork instead of the emoji-over-dimmed-egg placeholder, sized/positioned to sit naturally on the rug without stretching, same as the egg before it.
- **Notes:** `src/components/pet-placeholder.tsx` now swaps its `expo-image` source between `assets/images/pets/egg_nest.png` (before hatching) and `assets/images/pets/kitten_nest.png` (after) based on `hasHatched`, both with `contentFit="contain"`. The two source images have different pixel aspect ratios (egg: 1536x1024; kitten: 1381x1139), so the container's `aspectRatio` now switches along with the source to match whichever image is showing — this is what prevents stretching for both states. The kitten asset needed a re-export from the person providing it: the first version had no alpha channel and baked a visible gray checkerboard into the pixels instead of real transparency; the corrected version was verified (alpha channel present, corners fully transparent) before wiring it in. No animation or growth-stage logic beyond this one-time swap yet.
