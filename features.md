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
- **Notes:** Task state (`tasks`, `useState`) lives in `src/app/index.tsx`; the list UI itself is rendered by `src/components/task-card.tsx` (see FEATURE-014). Now persisted locally — see FEATURE-016 — so it survives a refresh/reload.

### [FEATURE-003] Add a task

- **Status:** Done
- **Description:** Type a task into a text field and add it to the list.
- **Notes:** Blank/whitespace-only input is ignored. Submitting via the keyboard's "done" action also adds the task. The input is now revealed by a "+ Add Task" button rather than always visible — see FEATURE-014.

### [FEATURE-004] Mark a task complete

- **Status:** Done
- **Description:** Tap a task to toggle it complete/incomplete, with a visual change (checkbox + strikethrough text) showing its state.
- **Notes:** Tapping again un-completes it (toggle, not one-way). The checkbox is now a square box that fills mint-green with a checkmark when completed (was a ☐/☑ text glyph before FEATURE-014).

### [FEATURE-005] Pet reacts to task completion

- **Status:** Done
- **Description:** When a task is marked complete, show a simple positive message near the pet.
- **Notes:** Implemented as a `message` prop on `PetPlaceholder` (`src/components/pet-placeholder.tsx`), driven by a `petMessage` state in `src/app/index.tsx`. The message cycles in order through "Yippee!", "Yay!", "Woohoo!", and "I knew you could do it!" each time a task is completed, and is cleared when a task is un-completed. No points, levels, animations, or persistence — just the message.

### [FEATURE-006] Pastel dashboard visual redesign

- **Status:** Done
- **Description:** Replace the dark/black Expo-starter look with a soft pastel dashboard aesthetic (cream, blush pink, lavender, mint, peach), as the visual foundation for the long-term Tamagotchi-style Productivity Pet vision.
- **Notes:** Updated the color palette in `src/constants/theme.ts` (added `accent`, `mint`, `peach` tokens; light and dark modes both use the same pastel palette — no more black background). Home screen (`src/app/index.tsx`) originally had its own "Productivity Pet" header/tagline (later moved into the global `AppHeader`, see FEATURE-013), a pastel pet card, a new static "Egg Stage — 0 / 5 tasks to hatch" progress card (`src/components/pet-progress.tsx`), and restyled task rows with a custom checkbox and an accent-colored Add button. The progress card is a visual placeholder only — it is not wired to the real task count, and no growth/leveling logic exists yet. The plain pet card was later replaced by the living-room scene in FEATURE-007. Multiple rooms, pet movement/animation, and shop/accounts are still future work.

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

### [FEATURE-013] Global header with Home/Tasks/Rooms/Shop/Stats navigation

- **Status:** Done
- **Description:** Replace the leftover Expo-starter bottom tab bar (Home/Explore) with a top header matching the Productivity Pet reference design: paw icon + "Productivity Pet" title + "Small steps. A happier you." tagline on the left, rounded pastel nav buttons (Home, Tasks, Rooms, Shop, Stats) on the right. Home shows the real home screen; Tasks/Rooms/Shop/Stats are placeholder screens for now.
- **Notes:** This replaced the app's navigation architecture, not just its look. `src/app/_layout.tsx` no longer renders `NativeTabs`-based `AppTabs`; it now renders the new `src/components/app-header.tsx` above `expo-router`'s `<Slot />`, so the header sits in normal document flow (never overlapping content) and whichever top-level route is active renders below it. `AppHeader` uses `useRouter()`/`usePathname()` to highlight the active nav pill (filled with the new `purple` theme token, white text) and navigate via `router.replace()` (chosen over `push` so repeated nav clicks don't pile up back-stack history, since these behave like tabs). The header row uses `flexWrap` on both the outer row and the nav-pill row so it reflows onto extra lines on narrow phone screens instead of squeezing or overlapping, while staying a single row on wider/web viewports (`maxWidth`-capped and centered like the rest of the app).
  Added four placeholder routes — `src/app/tasks.tsx`, `rooms.tsx`, `shop.tsx`, `stats.tsx` — all rendering a shared `src/components/coming-soon-screen.tsx` ("{title}" + "Coming soon").
  Removed the now-unreachable Expo-starter leftovers this replaced: `src/app/explore.tsx`, `src/components/app-tabs.tsx` / `app-tabs.web.tsx`, and the components only `explore.tsx` used (`external-link.tsx`, `web-badge.tsx`, `ui/collapsible.tsx`) — this is what "Remove all visible Expo Starter branding" meant in practice, since that screen was the last remaining source of it. The living room, egg/kitten hatching, task list, progress card, and completion messages are all unchanged and still live on the Home screen.

### [FEATURE-014] "Today's Tasks" card redesign

- **Status:** Done
- **Description:** Restyle the task list to match the Productivity Pet reference design: one rounded pastel card titled "Today's Tasks" with a pink "+ Add Task" button, each task shown as a row with a square checkbox, a category emoji icon, a category label under the task name, and a decorative three-dot menu icon.
- **Notes:** Extracted into a new `src/components/task-card.tsx` (`TaskCard`), which owns its own local "is the add-task field open" state while `src/app/index.tsx` keeps owning the actual `tasks` array and the pet-reaction logic (passed down as `onAddTask`/`onToggleTask` callbacks) — same pattern as `PetRoom`/`PetProgress`.
  - The always-visible input row is gone; tapping "+ Add Task" toggles a compose row (text input + small "Add" confirm button) open/closed. Submitting via the confirm button or the keyboard's "done" action still adds the task and keeps existing add-task behavior (blank input ignored).
  - Added a `category` field to the `Task` type (originally a free-form `string` defaulting to `"Personal"`; now a `TaskCategory` union, auto-assigned by keyword — see FEATURE-017).
  - Each row originally showed a category emoji (Study 📚, Exercise 👟, Clean 🧹, Personal 📖, Health 💧); replaced by cropped illustrated icons in FEATURE-017.
  - The completed-checkbox fill and the three-dot menu (`⋮`, decorative only at the time — made functional in FEATURE-020) use the app's existing `mint`/`textSecondary` theme tokens — no new colors introduced.
  - Rows are separated by a thin bottom border instead of each row being its own separate rounded chip, matching the reference's single continuous card look.
  - The task list starts empty, as before (FEATURE-002) — the reference's example tasks (Finish homework, Go for a walk, etc.) were not seeded as mock data, only used as the visual/structural target.
  - Pet Progress, Today's Mood (not yet built), the living room, egg/kitten hatching, completion messages, and the header/navigation were all left untouched.

### [FEATURE-015] Two-column dashboard layout (Today's Tasks beside the living room)

- **Status:** In Progress
- **Description:** On wider/web screens, show Today's Tasks and the living room side by side (tasks on the left, room on the right) instead of stacked, matching the reference dashboard layout. On narrow/mobile screens, keep everything stacked in a single column.
- **Notes:** In `src/app/index.tsx`, `useWindowDimensions()` picks between two layouts at a `700`px window-width breakpoint (`WIDE_LAYOUT_BREAKPOINT`) — a simple width check, no new responsive-design library. Below the breakpoint, rendering is unchanged from before (`PetRoom` → `PetProgress` → `TaskCard`, stacked). At/above it, `TaskCard` and `PetRoom` render side by side in a `dashboardRow` (left column ~40% width via `flexGrow`, right column ~60%, both with a `minWidth` floor), with `PetProgress` full-width underneath the row. `TaskCard` itself was not changed — same component, same styling, just placed in a different container. This step only repositions the task card; **Pet Progress and Today's Mood are not yet redesigned or moved into a left-column layout** — Pet Progress currently just renders below the row on both wide and narrow layouts, and Today's Mood doesn't exist yet.
  - Follow-up: the Home screen initially reused the shared `MaxContentWidth` (800px), which left large empty margins on wide/web screens. `src/app/index.tsx` now defines its own `HOME_MAX_WIDTH` (1400px) used only for Home's `safeArea`, so the dashboard fills most of the browser width there while the header and other screens (which still use the shared `MaxContentWidth`) are unaffected. The two columns automatically get proportionally larger since they're `flexGrow`-based percentages of the row's width; their `minWidth` floors were also bumped (240→320 left, 280→380 right) and the gap between them widened (`Spacing.four`→`Spacing.five`) now that there's more room to work with. The horizontal page margin (`Spacing.four`, 24px) was intentionally left unchanged as the "small comfortable margin" around the wider content.

### [FEATURE-016] Local task persistence

- **Status:** Done
- **Description:** Tasks should survive a browser refresh or app reload instead of disappearing, without adding accounts, a backend, or cloud sync.
- **Notes:** Added `@react-native-async-storage/async-storage` (installed via `npx expo install`, the SDK-compatible version) — a local on-device key/value store, not a server. It works the same way on native (iOS/Android) and web (backed by `localStorage` under the hood there), so no platform-specific code was needed.
  - `src/app/index.tsx` loads any saved tasks once on mount (`AsyncStorage.getItem`), then saves the full `tasks` array (`AsyncStorage.setItem`, JSON-encoded) every time it changes. An `isHydrated` flag guards the save effect so the initial empty `tasks` array can't run first and overwrite previously saved data before the load finishes.
  - Corrupted or unreadable stored data is caught and ignored (falls back to an empty list) rather than crashing the app.
  - This only persists the task list. Pet Progress, hatching state, categories/icons, and everything else remain in-memory only, as instructed — not part of this step.
  - Task add/check-off behavior, `TaskCard`'s styling, and the rest of the dashboard were not touched.

### [FEATURE-017] Automatic keyword-based task categories + illustrated icons

- **Status:** Done
- **Description:** Automatically assign a task's category based on keywords in its name, and show the matching illustrated icon next to each task instead of an emoji.
- **Notes:** New `src/utils/categorize-task.ts` exports `TaskCategory` and `categorizeTask(text)`, which checks the task text against per-category keyword lists (exactly as specified — including multi-word phrases like "study guide") using whole-word/phrase regex matching (first match wins; no match falls back to "Personal"). `src/app/index.tsx`'s `addTask` calls this instead of hardcoding a category.
  - New `src/components/task-icon.tsx` (`TaskIcon`) displays the correct icon. `task-card.tsx` renders `<TaskIcon category={task.category} />` in place of the old emoji lookup.
  - Originally 4 categories (Study, Exercise, Clean, Personal) using a single sprite-sheet image; a 5th category (Health) was added in FEATURE-018 with its own separate icon image.
  - Task persistence, adding/completing tasks, the task-card layout, the three-dot menu, header, living room, Pet Progress, and hatching were all left untouched.

### [FEATURE-018] Health category (5th category + its own icon)

- **Status:** Done
- **Description:** Add a 5th task category, Health, with its own keyword list and illustrated icon, alongside the existing Study/Exercise/Clean/Personal categories. Pet stats are explicitly **not** affected by category yet — that's planned future work, not part of this step.
- **Notes:** `src/utils/categorize-task.ts`: `TaskCategory` is now `'Study' | 'Exercise' | 'Clean' | 'Health' | 'Personal'`, checked in that order (first match wins, no match falls back to Personal). The Study and Exercise keyword lists were updated to drop the ambiguous `"practice"` / `"practice problems"` entries that used to make those two categories overlap (e.g. "Piano practice" now correctly falls through to Personal instead of Exercise). The Health keyword list was substantially expanded in FEATURE-019, including many phrase variants (see that entry) — the original short list here was superseded.
  - `src/components/task-icon.tsx`: Health renders `assets/images/task_icons/health_icon.png` directly (it's a single icon, same aspect ratio as the sprite sheet, so no cropping needed) instead of being cropped from the 2x2 sprite; Study/Exercise/Clean/Personal are unchanged, still cropped from `task_icons.png`.
  - Persisted tasks are unaffected. Task persistence, adding/completing tasks, the task-card layout, three-dot menu, header, living room, Pet Progress, and hatching were all left untouched.

### [FEATURE-019] Expanded Health keywords + "app" false-positive guard

- **Status:** Done
- **Description:** Expand the Health keyword list with many real-world phrasings (doctor/dentist/chiro/PT appointment variants, checkups, self-care, etc.), add `"studying"` to Study and `"organizing"` to Clean, and make keyword matching case-insensitive (already was). Critically: `"app"` must never match by itself — only as part of a specific phrase like `"doctor app"` or `"chiro app"` — so a task like "work on my app" is never miscategorized as Health.
- **Notes:** `src/utils/categorize-task.ts`'s `HEALTH_KEYWORDS` now includes the full set of phrase variants exactly as specified: `doctor's/doctors/doctor appointment`, `doctor/doctors/doc app`, `doc appointment`, `dentist appointment`/`dentist app`/`dental appointment`, `chiropractor`/`chiropractor appointment`/`chiropractor app`/`chiro`/`chiro appointment`/`chiro app`, `therapy appointment`, `physical therapy`, `PT appointment`, `checkup`/`check-up`/`annual checkup`, `physical`, plus the existing water/hydration/medicine/sleep/meditation/self-care/nutrition-related terms. The old bare `"appointment"` keyword was removed (it's no longer part of the spec — only the compound phrases are). There is intentionally no standalone `"app"` entry anywhere in the list.
  - Matching is unchanged structurally (whole-word/phrase, case-insensitive `RegExp` with the `i` flag) — the fix here is purely in *which* keywords are listed, not the matching mechanism, since `"app"` was simply never added as its own keyword.
  - Verified with 17 test cases covering every category and the specific "app" edge cases before wiring it in: e.g. `"work on my app"` → Personal, `"Doctor app tomorrow"` → Health, `"Chiro app"` → Health, `"app development sprint"` → Personal, `"Physical education class"` → Study (a "physical"/"class" cross-category case — Study wins since it's checked first, unchanged priority order), `"Get a physical"` → Health.
  - No icon or UI changes this step — `TaskIcon`, the task-card layout, persistence, header, living room, Pet Progress, and hatching are all untouched.

### [FEATURE-020] Functional three-dot task menu (Mark Important / Delete Task)

- **Status:** Done
- **Description:** Make the three-dot icon on each task row open a small popover menu with two actions: toggle "Mark as Important" / "Remove Important" (shows a ⭐ next to the task name when set), and "Delete Task" (removes just that task). Clicking outside the menu closes it. Both actions persist like the rest of the task list.
- **Notes:** Added an `important: boolean` field to the `Task` type (`src/components/task-card.tsx`); new tasks default to `important: false` (`src/app/index.tsx`'s `addTask`). Two new callbacks, `onToggleImportant` and `onDeleteTask`, were added alongside the existing `onAddTask`/`onToggleTask` — `index.tsx` still owns the `tasks` array and implements them as plain `setTasks` updates (`toggleImportant` flips the flag by id; `deleteTask` filters the task out). Because both go through the same `tasks` state that's already wired to `AsyncStorage` (FEATURE-016), **no new persistence code was needed** — marking important and deleting both survive a refresh automatically, the same way adding/completing tasks already did.
  - The popover itself is a `Modal` (`transparent`, `animationType="fade"`) containing a full-screen backdrop `Pressable` (tapping it calls `onRequestClose`-equivalent close logic — this is what makes "click outside closes the menu" work) and a small rounded pastel menu box positioned near the tapped three-dot icon (using the tap's `pageX`/`pageY`, clamped so it doesn't go off the left edge). Only one task's menu can be open at a time (`openMenu: { taskId, x, y } | null` state in `TaskCard`).
  - The three-dot icon is now its own nested `Pressable` (previously just static text) with `event.stopPropagation()` so tapping it opens the menu instead of also toggling the task complete via the row's own `Pressable`.
  - The star indicator was originally a "⭐ " prefix on the task's title text; moved to its own element on the right side of the row (near the three-dot menu) shortly after, per feedback — same underlying `task.important` state, no behavior change. The menu box uses the app's existing pastel palette (`background`/`backgroundSelected` for the box and divider, `accent` for the Delete label) — no new colors.
  - Adding tasks, completing tasks, task persistence, automatic categorization, category icons, the header, living room, Pet Progress, hatching, and task category logic were all left untouched.

### [FEATURE-021] Task completion tracker

- **Status:** Done
- **Description:** Show a "X% complete" label and a pastel progress bar near the top of the Today's Tasks card (below the heading/Add Task row, above the task list), calculated as `completed ÷ total × 100`, with no cap on task count. Updates immediately on add/complete/uncomplete/delete, survives a refresh, and shows "0% complete" with an empty bar when there are no tasks.
- **Notes:** Implemented entirely in `src/components/task-card.tsx` as derived values (`completedCount`, `completionPercent = tasks.length === 0 ? 0 : Math.round((completedCount / tasks.length) * 100)`) computed fresh on every render from the `tasks` prop — no new state, and no new persistence code was needed, since it just reads the same `tasks` array that `src/app/index.tsx` already persists via `AsyncStorage` (FEATURE-016). This is also why it updates immediately for every listed action (add/complete/uncomplete/delete): all four already go through `setTasks`, which re-renders `TaskCard` with fresh numbers.
  - The progress bar avoids percentage-string width values (which don't type-check cleanly against React Native's `DimensionValue` in this project) by using two sibling `View`s with numeric `flex: completionPercent` / `flex: 100 - completionPercent` inside an `overflow: 'hidden'` rounded track — a fill percentage without needing to measure pixel widths.
  - Colors are the existing `mint` (fill) and `backgroundSelected` (track) tokens — no new colors.
  - No confetti or celebration initially — added in FEATURE-022.
  - Adding tasks, completing/uncompleting, persistence, categories, icons, Mark as Important, the important star, the three-dot menu, deleting, header, living room, Pet Progress, hatching, and category logic were all left untouched.

### [FEATURE-022] 100% completion celebration (confetti + message)

- **Status:** Done
- **Description:** When the user completes the task that brings them to 100%, briefly show a confetti burst and the message "All tasks complete! Amazing job! 🎉" over the Today's Tasks card. Must trigger only from the user actually completing the final task — never from a page refresh where all tasks are already done, never repeatedly while sitting at 100%, but okay to fire again if the user unchecks a task and later re-completes everything.
- **Notes:** The trigger logic lives in `src/app/index.tsx`'s `toggleTask`, not as a generic "watch the percentage" effect — this is deliberate. After computing the updated tasks array, it checks `completed && updatedTasks.length > 0 && updatedTasks.every(t => t.completed)`: only true when (a) this specific action just *set* a task to completed (not uncompleted), and (b) that action happened to make every task complete. This precisely satisfies all the required behavior for free:
  - **Never on refresh**, because `toggleTask` only runs from a user tap — hydrating persisted tasks on load never calls it.
  - **Never repeatedly at 100%**, because the condition requires `completed === true` for *this* toggle — once everything is done, the only tasks left to tap are already-complete ones, and unchecking one sets `completed = false`, which fails the guard.
  - **Never from deleting the last open task**, because `deleteTask` is a separate function with no celebration logic at all — only completing a task can trigger it.
  - **Fires again after uncheck → recomplete**, because it's re-evaluated fresh on every `toggleTask` call with no "already celebrated" flag to block it.
  - On trigger, `isCelebrating` is set true for `CELEBRATION_DURATION_MS` (2200ms, via a `setTimeout` tracked in a ref and cleared on unmount/retrigger) then automatically reset — passed down to `TaskCard` as a prop, which renders the confetti + message overlay conditionally.
  - New `src/components/confetti-burst.tsx` (`ConfettiBurst`) implements the confetti using only React Native's core `Animated` API (`Animated.Value`, `Animated.timing`, `Easing`) — **no new dependency**, since a third-party confetti library risked incompatibility with this project's bleeding-edge Expo SDK (per the "Expo HAS CHANGED" guidance already encountered a few times this project). ~16 small pastel squares (colors drawn from the existing `accent`/`mint`/`peach`/`purple`/`backgroundSelected` tokens) are laid out as plain flex children in a row (not absolutely-positioned percentage coordinates, which don't type-check cleanly against `DimensionValue` in this project) and animate falling/drifting/rotating/fading via `transform`/`opacity` only.
  - The message renders as a pastel `accent`-colored pill centered over the card. Both the confetti and message overlay are `pointerEvents="none"` so they never block taps, and `TaskCard`'s outer card gained `overflow: 'hidden'` so the effect stays visually contained within the card rather than bleeding onto Pet Progress/the living room below — this does not affect the three-dot menu popover, which is confirmed to render via `Modal`'s portal (`createPortal`, verified in `react-native-web`'s source) outside the card's DOM/view hierarchy entirely.
  - Adding tasks, completing/uncompleting, persistence, the tracker/progress bar, categories, icons, Mark as Important, the important star, the three-dot menu, deleting, header, living room, Pet Progress, and hatching were all left untouched. The pet reaction for unchecking a completed task was explicitly not added — deferred per instructions.
