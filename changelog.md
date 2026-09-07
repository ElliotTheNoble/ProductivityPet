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

### Changed
- Replaced the default Expo starter content in `src/app/index.tsx` with the pet + task list screen.

### Fixed
- BUG-001: Tapping a task did not mark it complete. `toggleTask` in `src/app/index.tsx` was assigning `completed: task.completed` instead of `completed: !task.completed`, so the value never flipped. Restored the negation.

### Removed
- Unused `HintRow` component (`src/components/hint-row.tsx`), left over from the starter template and no longer referenced after the home screen rewrite.

---

<!-- Add new entries above this line, newest first -->
