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
- **Description:** Show a static pet placeholder (emoji + label) on the home screen as a visual anchor for the app. No animation, stats, or reactions yet.
- **Notes:** Implemented in `src/components/pet-placeholder.tsx`. Future pet behavior (moods, growth, reacting to task completion) is separate, later work.

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
