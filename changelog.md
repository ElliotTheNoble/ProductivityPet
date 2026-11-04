# Changelog

Track notable changes to the project here. Newest entries at the top.

## [2026-11-04] — Authentication foundation: final verification pass (transactional setup and recovery)

### Changed
- **PIN setup is now two steps.** `beginPinSetup` writes only a pending record (nothing is protected, nobody is locked out); `confirmPinSetup` switches protection on only after the parent types back both the PIN and the recovery code (secure record first, marker second). The single-step `setupPin` was removed. Any interruption before the end leaves "no PIN"; a parent who lost the code simply starts again.
- **A new recovery code must be acknowledged.** Codes made by a recovery or by "new code" are "unconfirmed" until `confirmRecoveryCode`; `getRecoveryStatus()` exposes it (including after the app closed before the parent saw the code) so the future UI can force a new code. The UI contract is documented in `src/utils/parent-pin.ts` and features.md (FEATURE-088).

### Verified
- Interrupted setup and recovery scenarios (closed before confirming, while generating, between the two writes, after a recovery but before the new code is acknowledged, two recoveries at once, unavailable or failing storage) never enable an incomplete PIN, never unlock an existing family, never delete or change family data, and keep a recovery path.
- Independent salts and domains for the PIN and recovery verifiers, one shared persistent lockout counter in secure storage, and no logging or ordinary-storage copy of any PIN, code, hash or salt (tests spy on every console method). The scrypt settings are unchanged.
- 318 of 318 tests pass (102 for the authentication foundation); plain `npx tsc --noEmit` passes with no exclusions (BUG-076: the generated route-types file is rewritten by the running dev server whenever files are added; restart steps are in bugs.md). Dependencies unchanged since the authentication install: 4 packages added (expo-secure-store ~57.0.4, expo-crypto ~57.0.4, expo-local-authentication ~57.0.3, @noble/hashes 1.8.0), nothing changed or upgraded. Family mode is still off and the app behaves exactly as before for existing users (web run: Home, /parent, /welcome, Pet Care, registry and backup unchanged).

### Still required before authentication can be enabled
- Real Android and iPhone performance testing of scrypt (time and memory under Hermes), secure-storage persistence and backup exclusion, a real restore, a development build, and an app version bump before release (FEATURE-088, BUG-075). No setup screens, device-authentication adapter or family picker exist yet.

## [2026-11-03] — M2 Phase 2A-0b: Parent PIN and recovery-code authentication foundation (disabled)

### Added
- **PIN verification:** scrypt (`@noble/hashes` 1.8.0, N = 2^15, r = 8, p = 1) with a random per-record salt from the operating system (`expo-crypto`); the PIN and the recovery code are never stored; a PIN is 6-8 digits and not trivially guessable. Records live in native secure storage (`expo-secure-store`, "when unlocked, this device only"), together with the shared wrong-guess counter; ordinary storage holds only a small marker.
- **One-time recovery code** (120 random bits + check character): stored only as its own verifier, independent of the PIN, a correct code sets a new PIN and invalidates the old code (a new one is issued), a failed save changes nothing, and it never touches family data.
- **Restored or damaged data is never reset:** family data whose PIN record is missing (restore, new device, damage) keeps parent access LOCKED with a clear explanation; no new PIN can be created, and neither a recovery code nor the device passcode is a way in. Nothing is ever deleted; if the PIN and the code are both lost, parent access stays locked until guardian accounts exist.
- **Everything is behind `FAMILY_MODE_ENABLED` (false for all users):** with it off, no PIN checker is registered, the PIN module and native modules are not loaded, and the parent area is open from the very first frame exactly as before (the short blank first frame of `/parent` and `/welcome` from the previous phase is gone). Not supported on the web.
- 83 new tests (299 total, all passing). Breaking seven protections on purpose made the matching tests fail.
- **Dependencies (exact):** expo-secure-store ~57.0.4, expo-crypto ~57.0.4, expo-local-authentication ~57.0.3 (installed, not used yet), @noble/hashes 1.8.0. 4 packages added, none changed; `npm audit` still 48, none in the new packages. The `expo-secure-store` config plugin was added to `app.json` (Android backup exclusion rules, default Face ID string; needs a new native build).

### Changed
- A PIN must now be 6-8 digits (the gate, its screen text and its tests were 4-8). Guess counting moved into one shared limiter that can keep its counter in secure storage.

### Checked
- 299 of 299 tests pass; project code type-checks with 0 errors (plain `npx tsc --noEmit` currently stops inside the generated `.expo/types/router.d.ts` that the running dev server left half-written: BUG-076; restart the dev server to fix it). Web run (390x844 and 844x390) with the flag off: Home, `/parent`, `/welcome`, Pet Care and the profile registry and backup behave exactly as before, no errors.

### Not verified / outstanding
- No screen to create or change a PIN, no device-authentication adapter (next phase, not started). Real-device checks required before any use: scrypt timing and memory on low-end phones, secure-store persistence and backup exclusion, a real restore, secure random bytes, a development build with the new native modules, and an app version bump before release so no OTA update reaches builds without the native modules (FEATURE-088, BUG-075).

## [2026-11-03] — M2 Phase 2A-0: Parent Gate (access protection; no PIN yet)

### Added
- **Parent Gate:** the parent-only screens (`/parent`, `/welcome`) now render their content only when the parent area is open; otherwise a PIN screen (English and Spanish) is shown instead, so opening them by address cannot bypass it. Restarting the family set-up and the Family card's shortcuts are locked too. Guess limits (3 tries, then pauses of 30 s, 5 min, 15 min, 1 h) are saved BEFORE each check, so they survive restarts and mid-check kills, and fail closed. The open session locks on background/inactive, on a profile change, after 5 minutes unused, after 30 minutes in total and on a backwards clock.
- **No PIN exists yet:** checking a PIN goes through a small `PinVerifier` interface that nothing implements, so for every user the parent area stays open exactly as before. The PIN is NOT verified parental identity and NOT full security, and the screens say so. PIN storage and recovery are held back for a security decision (BUG-075); the family picker stays disabled and family mode stays unavailable to real users (BUG-072).
- 45 new tests (216 total, all passing), including screen tests with `@testing-library/react-native` (approved dev dependency: 19 packages added, none changed; `npm audit` 47 -> 48, one more low in test tooling). Breaking six protections on purpose made the matching tests fail.

### Changed
- `restartOnboarding()` does nothing while a PIN exists and the parent area is locked; the Family card shows only "Unlock parent area" in that state. Jest also runs `*.test.tsx` files and ignores `.css` imports.

### Checked
- `npx tsc --noEmit` clean; 216 of 216 tests pass. Web run with no PIN (390x844): Home, `/parent`, `/welcome` and Pet Care behave exactly as before, no errors.

### Not verified / outstanding
- The PIN screen on real phones, tablets and browsers; backgrounding behavior on iOS and Android; screen readers; browser password-manager prompts. PIN storage, PIN setup and recovery are not implemented (BUG-075).

## [2026-11-02] — M2 Stage 1 safety hardening (switch order, unknown task category, full storage, notification privacy)

### Fixed
- **Profile switch rollback (BUG-072 related):** the new active profile is now saved in the registry BEFORE anything changes in memory, then pending work is settled again, and only then are the profiles swapped in one step. A failed switch (registry cannot be saved, a save fails during the switch, a store cannot reset, a timeout) leaves the current profile fully active: nothing reset, no cache or timer touched, no notification cancelled, pending writes still saved, the registry back on the old id.
- **BUG-073:** Home no longer crashes on a saved task with an unknown or outdated category. It is shown as Personal (icon, label, Stats counts, Personal page) in English and Spanish; the saved task and its category are never rewritten; rewards and completion behavior are unchanged.
- **Notification privacy:** after a real switch every scheduled notification is cancelled and every shown one is cleared (it can carry a pet's name or a task title). This now lives in the profile layer, uses "cancel all" so it also covers reminders from earlier sessions, and never runs for a failed switch.

### Added
- **Backup limits:** after three unverifiable backup copies no more are attempted (nothing is ever deleted or overwritten) and the app stays in safe mode, Main only. Full-disk behavior is tested.
- Tests: 25 new (switch failures and interruption, notification privacy, full storage and backup failures, unknown category), 171 in total, all passing. Breaking the new safeguards on purpose (no second settle, no notification clean-up, the old swap-first order, no category fallback) made the matching tests fail.

### Checked
- `npx tsc --noEmit` clean; 171 of 171 tests pass. Web run, 390x844: Home, Tasks, Stats, a Stats category page and Rooms render in English and Español with a saved category "Home", no errors, no overflow, saved categories unchanged.

### Not tested / outstanding
- Notification cancel and clear on a real Android and iPhone development build (see FEATURE-086 for the steps). Full-device behavior (only simulated). Remaining risks are listed in BUG-074.
- Still Stage 1: no profile picker, no child creation UI, no cloud.

## [2026-11-02] — M2 Stage 1: profile-scoped local storage foundation (no visible change)

### Added
- A profile layer (`src/utils/profiles.ts`): every store's personal data is now stored per profile. The existing player is the **Main profile** and keeps the original storage keys untouched; child profiles (tests only for now) use `@ProductivityPet:p:<id>:<name>`, start with one new egg and nothing else, and can never read Main's data. The three-living-pet limit, wallet, tasks, rewards record, shop, mood, journal, mini-game limits, Pawadise mail and postcards, memorial state and alert settings are all per profile.
- A complete, read-back-verified pre-M2 backup of every existing key is written once before the registry is created; interrupted, repeated or failed starts are safe (failure = safe mode: Main only, exactly as before). The backup and the original keys are never changed or deleted by the app.
- Safe profile switching (no UI yet): waits for in-flight operations and writes, retries failed writes, refuses to switch (nothing changes) if something cannot be saved, swaps in one synchronous step, resets every store's caches and timers, and is undone if the registry cannot be saved. The app shell is keyed by the active profile so a later switch remounts every screen.
- Tests: 41 new profile tests (146 total, all passing); the 105 earlier tests pass unchanged. Breaking four safeguards on purpose made the matching tests fail.

### Changed
- Every store that read or wrote a fixed key now builds its key per profile and tracks its writes (pet family, tasks, Paw Token paid-record and history, shop, mood, journal, mini-game rewards, Pawadise mail and postcards, pet alerts, plus the Home mood and memorial toast). Reward amounts, pet rules, mortality, translations, artwork, animations, layouts and hover effects are unchanged.
- Test fixture: the hand-built old-save fixture now uses a real task category (BUG-073).

### Checked
- `npx tsc --noEmit` clean; 146 of 146 tests pass. Web run (Main profile, 390x844 and 844x390) with an old-style save: Home identical, registry and backup created once, original keys untouched, refresh keeps the same backup, no console errors.

### Known limitations (see features.md FEATURE-086, BUG-072, BUG-073)
- No profile picker, child creation, PIN or "move my data to a child" yet (Stage 2); nothing claims these exist. Household children are not yet linked to profiles; Parent Dashboard task records are untouched.
- Inactive profiles' pets still age and may get sick or die without reminders (phone alerts are for the active profile only). Not tested on a real device; switching inside the running app has not been exercised in a browser.

## [2026-11-02] — M1 hardening: reward-history safety (BUG-069) and npm audit review

### Fixed
- BUG-069: if the record of already-paid tasks is missing, unreadable or damaged, completed tasks are no longer paid again. A damaged original is copied aside first (`awardedTaskTokens.corrupt-<time>`), the record is rebuilt without paying anything, and if storage cannot be read or the copy cannot be written nothing is paid or overwritten and it retries. A new player is told apart from a returning player whose record vanished. Valid records, reward amounts and the wallet are unchanged. `paw-tokens.ts` also exposes `getRewardHistoryStatus()` / `subscribeToRewardHistoryStatus()`; no on-screen message was added.

### Tests
- 12 new regression tests (corrupt in five shapes, partial salvage, restart, backup failure, read failure, valid, empty list, missing for new and returning players, wallet untouched). 105 of 105 pass; the 12 new ones fail against the old code.

### npm audit (reviewed, nothing changed)
- 47 warnings: 1 critical, 9 high, 32 moderate, 5 low. Before Jest was added the same project had 25 (1 critical, 9 high, 13 moderate, 2 low), so Jest added 22 (19 moderate, 3 low) and no critical or high ones. Almost all are build or dev-server tooling. Full details are in BUG-070; no `npm audit fix` of any kind was run and no dependency was upgraded (the lockfile only gained the 249 test-tool packages; no existing version changed). Compatible security updates are a separate future milestone.

### Checked
- `npm test`: 105 of 105 pass. `npx tsc --noEmit`: 0 errors. It had briefly failed only on `.expo/types/router.d.ts`, a generated, git-ignored file the running dev server left half-written (BUG-071); the server rewrote it itself and nothing in the project was excluded or changed. A fresh generation in a scratch copy contained no `tests/` routes.

### Not tested
- A real device with damaged storage. The reward-history status is not shown on screen (a bilingual recovery notice is a future improvement). During a recovery from a damaged record, a task that was completed but not yet paid may not be rewarded (BUG-069).

## [2026-11-02] — Testing foundation (Family Cloud milestone M1)

### Added
- Automated tests: Jest 29 with the jest-expo preset (`npm test`), 93 tests in four suites covering pet needs, bedtime and closed-app catch-up, sickness / Critical / death timing, free recovery, resurrection, growth sharing, Paw Token rewards and duplicate-reward prevention, clock edge cases, deterministic event ids, and loading hand-built saved-data fixtures (a five-pet family and the original single-pet save). Tests use an in-memory AsyncStorage and a fixed time zone and never touch real saves.
- Dev dependencies: jest, jest-expo, @types/jest. `package.json` gets a "test" script and Jest settings; `tests/` holds the tests, helpers and fixtures.

### Unchanged
- No file under `src/` was changed. Pet mortality, rewards, saved data, artwork, animations, mini-games, layouts, translations and hover effects are exactly as before. No cloud, account, Supabase or profile-storage work was started (that is M2 and later).

### Checked
- `npx tsc --noEmit` is clean and all 93 tests pass (two consecutive runs). Temporarily breaking four rules made the matching tests fail, then the changes were reverted.

### Found
- BUG-069 (open): an unreadable "already paid" record would re-pay completed tasks. Not fixed.

### Not tested
- Screens and hooks, notification scheduling, shop purchases, mini-game reward caps, Pawadise timers, household/onboarding stores, and real devices.

## [2026-11-01] — Mailbox landscape fix

### Fixed
- The Home mailbox could rest so low in landscape (844x390) that its bubble and Open mail button were cut off (BUG-068). It now keeps them fully on screen using bounds computed from the Home area: in short areas the bubble and button sit beside the mailbox, and the mailbox is kept inside the screen after a resize or rotation. Size, artwork, hopping and the envelope and postcard flow are unchanged.

### Checked
- 360x800, 390x844, 844x390 and 1280x800 in English and Español: mailbox, bubble and button fully visible and not overlapping in 24 of 24 stops. Memory Match results checked in English and Español (round played by script). The Backgrounds tab has no purchasable items, so it has no insufficient-token message.

### Not tested
- Real phone notifications, vibration and flashlight; real finger taps on a phone; native-speaker review.

## [2026-11-01] — Spanish task categories, live temporary messages, remaining tests

### Fixed
- BUG-065: tasks typed in Spanish are now categorised (Estudio, Ejercicio, Limpieza, Salud, Personal) from Spanish keywords; English keywords work exactly as before, existing saved categories and all task text are untouched.
- Temporary messages (Pawadise notices and errors, Resurrect and adopt errors, Pet Care & Alerts messages, Parent Dashboard note, Welcome name error) now switch language immediately; their timing is unchanged.

### Checked
- Mini-Games and the Parent Dashboard in English; mailbox, envelope, postcard viewer, farewell and Resurrect dialog in landscape and desktop; English Shop insufficient-token messages; hover effects on seven screens unchanged; the type-check is clean.

### Not tested
- Memory Match results, the Backgrounds purchase message in English, real phone notifications, vibration and the flashlight, native-speaker review.

## [2026-11-01] — Final bilingual audit: remaining screens translated

### Translated
- Pet Album, Pet Pawadise (resort, confirmations, errors, the pet's page), postcards, the Home mailbox and envelope, the farewell, Resurrect (button, dialog, errors, hospital truck), the Pet Care & Alerts page, Mini-Games (hub, Kitty Catch, Memory Match, results and reward lines) and the "not found" pages.
- Phone notifications and reminders (pet sick/critical, test message, task/appointment/birthday) and Android channel names use the current language and are rebuilt when the language changes.

### Fixed
- The task category showed in English on the Home task card and appointment card; "tokens" / "Paw Tokens" in the adopt dialog and the Parent Dashboard now say "fichas de patita"; the date placeholder in the task edit window is translated (BUG-067).

### Checked
- English and Español at 360, 390, 844x390 and 1280 px: no overflow or clipped text on the screens listed; the language switch applies at once and is kept after a refresh; the type-check is clean.

### Not done / not verified
- Real phone notifications, vibration and the flashlight were not run (needs a phone build). No native-speaker review. Developer tools and artwork text are intentionally unchanged. Not committed.

## [2026-11-01] — Translation Batches 4-6: Rooms, Shop and Stats

### Translated
- Rooms: the hub, all six rooms, task panels, care/medicine/toy/shop hints, bathing and wipe instructions and Paw Token messages.
- Shop: tabs, items, descriptions, prices, Owned/Equipped, confirmations, errors and empty states (item ids and saved inventory unchanged).
- Stats: overview, category and lifetime pages, Mood Journey, Year in Review (including the written recap), Paw Token history and Streak history, with Spanish dates, month and weekday names and number formatting.
- Language changes apply immediately; English text is unchanged.

### Fixed
- The Mood Journey yearly legend showed English mood names in Spanish (BUG-066).

### Still English
- Pet Album page, Pet Care & Alerts page, Pawadise, farewell, mailbox/postcards, mini-games, notifications. The app is not fully Spanish yet.

## [2026-11-01] — Translation Batches 2 and 3: Home and Tasks

### Translated
- Home: care buttons, needs, health banners and countdown, every sick/critical/memorial/resurrection speech line, all mood names and messages, completion messages, the Pet Progress and Home Features panels (tasks, appointments, mood, rooms and toys cards).
- Tasks: the calendar (Spanish month and weekday names, Today button, legend), the add form, lists and empty states, categories, menus, the edit window, reminders, holidays and long dates.
- Still English: Rooms, mini-games, Shop, the Pet Care & Alerts page, Stats and history, Mood Journey, Year in Review, Pet Album, Pawadise, farewell, mailbox, postcards and notifications (later batches).

## [2026-11-01] — Translation Batch 1: app shell (English / Español)

### Added
- Translation system extended with parameters, plurals, a non-React helper and locale-aware dates; a Language card on the Pet Care & Alerts page. The language choice is saved and applies immediately.

### Translated (Batch 1 of 8)
- Header navigation and tagline, the pet selector and adopt dialog (pet names become "Gatito N"), shared dialog buttons and the Stats detail pages' Back button. Other screens are still English until their batches.

## [2026-11-01] — Parent Dashboard hover highlighting

### Changed
- Child Settings toggles, every dashboard and welcome button, and the choice cards (language, Gentle/Classic, mode) now highlight clearly on mouse hover with a pastel tint/deeper colour, a small lift and a smooth transition; disabled buttons stay inactive and hovering never changes a setting. A keyboard focus ring was added. Visual only: pet mortality, health and lifecycle behaviour are unchanged.

## [2026-11-01] — Onboarding and Parent / Guardian dashboard foundation

### Added
- First-launch welcome flow: language (English / Español), user mode (Parent / Guardian, Child, Independent 16+), and a local Parent profile. New installs go through it; existing players are never forced into it (and can start it from the Pet Care & Alerts page). Progress and language are saved, so a refresh resumes where you were.
- Parent Dashboard: parent profile, multiple child profiles (Add, Edit, Select) with permanent ids, per-child assigned / pending approval / completed tasks, Add Task, child settings (can create tasks, completion needs approval), Pet Safety (Gentle / Classic) and language settings.
- A small translation layer (English and Spanish) for the new screens only; the rest of the app is not translated.

### Not connected yet (placeholders)
- Child and Independent modes ("coming soon"), a child-facing screen, rewards on approval, Pet Safety enforcement, and separate pets per child. Pet, task, token, shop and Pawadise data are untouched.

## [2026-10-29] — Milestone: Pet Pawadise farewell experience

Summary of the approved farewell work (details in the entries below, features.md FEATURE-080 to FEATURE-082 and bugs.md BUG-063).

### Added
- **Farewell scene:** after a successful retirement a cat gets a full-screen farewell: the Pawadise entrance background with the separate transparent Kitty_farewell artwork centred in front, and three different random messages in a speech bubble beside her head.
- **Controls:** a "Tap to Continue" button (hover and pressed feedback, one message per press, "1 of 3" counter) and a larger Skip button; reduced-motion support.
- **Departure:** a gentle fade to the Kitty_leaves scene shown for about five seconds, then an automatic return to Pet Album -> Pet Pawadise. Portrait screens frame the departure picture farther left through their own setting.

### Changed
- Header tabs, the alerts bell, pet chips, "Adopt an egg", Shop category tabs and Feed/Play/Rest lift on mouse hover (selected ones don't).

### Fixed / clarified
- The missing hover seen in portrait mode was Chrome's mobile touch emulation, not an app layout defect (BUG-063).

## [2026-10-29] — Hover feedback and portrait departure framing

### Changed
- Header tabs, the alerts bell, pet chips, "Adopt an egg", Shop category tabs and Feed/Play/Rest now lift on mouse hover at every screen size (selected ones don't), matching the existing hover look. Existing hover effects were unchanged (BUG-063).
- On portrait screens the farewell's "Kitty leaves" picture is framed farther left (own setting `FAREWELL_DEPARTURE_FOCUS_X.portrait`, 33% -> 46%, about 109 px at 360 px wide); landscape and desktop are unchanged.

## [2026-10-29] — Farewell polish

### Changed
- The farewell kitty is centred on her visible artwork, the speech bubble sits beside her head, "Tap to Continue" is a real button (hover and pressed feedback, one message per press), the Skip button is bigger, and the departure scene lasts about five seconds.

## [2026-10-29] — Pet Pawadise farewell

### Added
- After a pet is sent to Pawadise, a full-screen farewell plays: the Pawadise entrance picture as the background with a separate transparent farewell kitty in front (lower left), three different random messages (tap to continue, Skip button), then a gentle fade to the "Kitty leaves" scene, then back to Pet Album -> Pet Pawadise. Only for cats; skipped if retirement fails; reduced motion supported. `Kitty_says_bye.png` is no longer used. The farewell kitty is the same for every cat.

## [2026-10-29] — Milestone: Pet Pawadise

Summary of Pet Pawadise as built and player-tested (details in the entries below, features.md FEATURE-077 to FEATURE-079 and bugs.md BUG-058 to BUG-062). It supersedes the earlier note that Pet Pawadise was a future feature.

### Added
- **Retirement and homecoming:** Healthy, hatched pets can retire (with confirmation), freeing an active slot; they keep their identity, species, name, stage, accessories, needs, growth and history, are frozen while away (no decay, growth, sickness or death) and come home for free when a slot is free.
- **Pet Album tab:** Pet Pawadise is its own tab beside Pet Memories, with the resort picture, the gallery of retired pets (Bring Home), "Send a pet to Pawadise" and empty states.
- **Pet scrapbooks:** each retired pet has its own Pawadise page with only its postcards; the scrapbook also appears on its Album profile and is kept forever, even after it comes home.
- **Postcard deliveries:** retired pets send surprise postcards every 2-5 days (saved schedule, checked at launch and resume, no backlog, ten cat designs without repeats until all are used); unopened mail is saved across restarts; opened postcards are stored permanently with no duplicates.
- **Hopping mailbox:** a mailbox about the size of the kitty hops around Home; tap to stop, double-tap to open.
- **Envelope and postcards:** a double-tap envelope reveals a two-sided postcard that flips by swipe or drag (or a Flip button); accessible Open/Later/Flip controls and reduced-motion handling; a developer button to deliver postcards on demand.

### Changed
- The mailbox was enlarged to match the kitty and changed from sliding to hopping.

### Fixed
- Mouse-swiping the postcard (BUG-058), the too-small mailbox (BUG-059), the sliding mailbox (BUG-060) and a nested button on the gallery cards (BUG-061).

### Known / open
- The Expo web `barcode-detector` error and 12000 ms timeout stopped after restarting Expo, but the cause was not established (BUG-062).

### Responsive layout
- The Pawadise tab, pet pages, mailbox and postcard viewer were checked at 360 px, landscape and desktop widths in a web run (the viewer places the card beside its buttons in a short landscape window).

## [2026-10-29] — Bigger, hopping Pawadise mailbox

### Changed
- The mailbox is about as big as the Home kitty (slightly bigger) and hops around (crouch, jump in an arc, landing bounce, short rest) instead of sliding. One tap stops it still; everything else about postcards is unchanged.

## [2026-10-29] — Surprise postcards from Pet Pawadise

### Added
- Retired pets send surprise postcards every 2-5 days (saved schedule, checked at launch/resume, no backlog after long absences, designs not repeated until all ten are used, per-species design lists).
- A mailbox (your `maill_box.png`) drifts around Home when mail arrives: tap to stop it, double-tap to open; then your envelope; double-tap (or Open) to reveal the postcard. Closing keeps the mail waiting; several postcards queue behind one mailbox.
- A two-sided postcard viewer (kitty_card_1-10): front first, swipe/drag or press Flip to see the back. Used from the mail and from each pet's Pawadise page and Pet Album scrapbook.
- Accessible Open / Later / Flip controls, reduced-motion handling, and a developer button to deliver postcards on demand.

### Fixed
- Mouse-dragging the postcard didn't flip it because the browser started dragging the picture (BUG-058).

## [2026-10-29] — Pawadise postcards organised per pet

### Changed
- Removed the shared "Postcards from Pawadise" list from the Pet Pawadise tab. Tapping a retired pet opens its own Pawadise page (picture, name, species, growth stage, its postcards, Back button); tapping a postcard opens a larger view.
- Each pet's Pet Album profile gets a "Pawadise scrapbook" with only that pet's postcards, kept forever, even after the pet comes home. Empty pets show "No postcards yet!".
- Bring Home is a separate button on the gallery card (no nested buttons).

## [2026-10-29] — Pet Album tabs: Pet Memories and Pet Pawadise

### Changed
- The Pet Album has two tabs inside it: Pet Memories (the existing album) and Pet Pawadise (resort picture, retired pets with Bring Home, Send a pet to Pawadise, Postcards from Pawadise). Pawadise no longer sits at the top of the album. No rule, data or artwork changes.

## [2026-10-29] — Pet Pawadise (retirement resort)

### Added
- Pet Pawadise section in the Pet Album: resort picture, a gallery of retired pets (name, species, artwork, growth stage, Bring Home), a "Send a pet to Pawadise" list with confirmation, and a "Postcards from Pawadise" collection.
- Healthy, hatched pets can retire; retired pets are frozen (needs, growth, health and timers paused), free one of the three pet slots and return home for free when a slot is free, resuming from where they left off.
- Permanent postcard data structure (unique id, pet id, image reference, title, message, received date); empty for now. No postcard scheduling or artwork yet.

## [2026-10-28] — Milestone: pet care, health, Shop and the full Cat Toys collection

Summary of the work finished and player-tested in this milestone (details are in the entries below, in features.md FEATURE-059 to FEATURE-076 and in bugs.md). Pet Pawadise is a separate future feature and is not part of it.

### Added
- **Cat Toys:** all 24 toys from `kitty_toys.png` in Shop -> Toys -> Cat Toys, bought with Paw Tokens into a persistent, single-use inventory; Buy (coin + price) and Play side by side on each card; a played toy adds its Happiness once and appears beside the kitty on Home for 60 seconds. Per-species structure ready for more toy types (none added yet).
- **Pet Care tab:** Gentle Washcloth and Pet Medicine with a persistent inventory; the Bathroom's Go to Shop opens it.
- **Pet health:** Sick, Critical, Deceased and paid resurrection (memorial notification and Stats memorial), Sick/Critical artwork across the app, the Gentle Wipe-Down mini-game.
- **Home:** two slide-out panels (Pet Progress, Home Features) and a cleaner living room; Developer Tools moved to the Alerts page, including Developer Health State.

### Changed
- Shop tabs: Pet Accessories, Toys, Pet Care, Backgrounds, with simple outline icons (Room Decor hidden, data kept). Sick and Critical pets see Toys and Pet Care; accessories stay paused.
- The Gentle Wipe-Down (and the washcloth prompt) appears only when Cleanliness is below 50; the health banner names the needs below 50.
- The free emergency washcloth was removed; Pet Care supplies and toys are bought with Paw Tokens earned from tasks.

### Fixed
- Buy/Play stacking in portrait, clipped Paw Token prices and clipped toy artwork; a toy that stayed on Home after its session; Shop layout problems on phones and landscape; duplicate or stuck memorial and health messages; Sick/Critical artwork positioning (including the "just bathed" Dry-pose priority bug).

### Responsive layout
- Shop, Rooms (Kitchen, Bathroom, Gym), Home and the header were adjusted for 360/390 px portrait, landscape and desktop widths.

## [2026-10-28] — All 24 Cat Toys

### Added
- All 24 toys from the sprite sheet are now in Shop -> Toys -> Cat Toys (names, prices and Happiness tiers in `toy-config.ts`; provisional). They use the same inventory, Happiness and 60-second Home toy system.

### Changed
- Toy purchase buttons show the Paw Token coin and price only (no "Buy" word) so prices never clip on narrow phones; the accessible label is unchanged.

## [2026-10-28] — Toy buttons stay side by side

### Fixed
- Buy and Play on toy cards no longer wrap onto separate lines on narrow portrait screens; the row doesn't wrap and the buttons shrink slightly if needed (BUG-056).

## [2026-10-28] — Buy and Play side by side on toy cards

### Changed
- Each toy card in the Shop shows Buy and Play on one row (more compact). Play is used from the Shop cards only.
- The Bathroom's Go to Shop opens the Shop's Pet Care tab directly.

### Removed
- The Home "Play with Toy" button (Home's care row is Feed, Play, Rest again) and its chooser. Home Features' Toys panel stays as inventory.

## [2026-10-28] — Play with Toy on Home, Pet Care tab, category icons

### Added
- "Play with Toy" button beside Play in Home's care controls (opens a toy chooser; same toy logic as before). The care row wraps on narrow screens.
- Shop "Pet Care" tab holding the Gentle Washcloth and Pet Medicine.

### Changed
- Shop category icons: sparkles, gamepad, heart-pulse, image (outline set, no emoji).
- Home Features' Toys card shows inventory only; play controls live under the kitty.

## [2026-10-28] — Toys polish

### Changed
- Removed the repeated "Single Use" text from toy cards; one note at the top of Cat Toys explains toys are used up after playtime.
- Toys stay in the Home living room for 60 seconds (was 30); configurable via `TOY_SESSION_MS`.
- Shop category buttons use simple outline icons instead of emoji.

### Fixed
- Toy artwork was clipped at the bottom in the Shop (BUG-055); every toy now uses its real bounding box.

## [2026-10-28] — Toys, per-species Shop structure, Gentle Wipe-Down only when needed

### Added
- Shop "Toys" tab (replaces the visible Room Decor tab; Room Decor data kept) with a "Cat Toys" section using the player's own `kitty_toys.png` artwork; a per-species toy structure in `src/utils/toys/` ready for Dog/Frog/Fancy Rat toys. Starter set: 3 toys with PROVISIONAL prices/rewards in `toy-config.ts`.
- Toy purchasing, a persistent single-use toy inventory, and a Toys card in Home Features. Playing a toy gives Happiness once and shows the toy beside the kitty on Home for about 30 seconds (temporary, one per pet).
- Sick/Critical pets can buy and play toys (only the Toys tab and care supplies are shown for them).

### Changed
- The Bathroom Gentle Wipe-Down / washcloth prompt appears only when Cleanliness is below 50; otherwise "Your kitty doesn't need a gentle bath right now." (no washcloth used).

## [2026-10-28] — Health warning names the needs to check

### Changed
- The Sick/Critical banner now lists which of Hunger, Cleanliness and Happiness are below 50 ("Check Hunger and Cleanliness.") instead of generic text, and the duplicate washcloth/Shop wording was removed from it (the lower Bathroom washcloth card and Go to Shop button remain). Hidden when all three are 50+. Energy is not listed.

## [2026-10-28] — Temporary memorial notification, Stats memorial, button polish

### Changed
- The "journey has come to an end" message is now a ~5-second tappable notification with a small heart, shown once per death; a permanent memorial card with the Resurrect button (500 Paw Tokens, existing flow) lives in Stats.
- Bathroom washcloth notice shortened; Go to Shop, Buy Gentle Washcloth, Buy Pet Medicine, Give Medicine and Resurrect highlight on hover (enabled buttons only) with pressed feedback.

## [2026-10-28] — Shop hides accessories for unwell pets; sticky preview; tighter phone header

### Changed
- Sick/Critical pets see only Pet Care Supplies and a friendly message (accessory catalog, categories and preview hidden); Deceased pets see only the memorial/resurrection message. Healthy pets keep everything.
- Phone Shop: the Kitty Preview button stays visible while scrolling.
- Phone header: smaller gap between the navigation and the pet chips on all tabs.

## [2026-10-28] — Shop layout fixes and supply-card hover

### Fixed
- Shop, narrow portrait: the whole page now scrolls, so both Pet Care Supplies cards, counts, prices, buttons and messages are reachable (cards stack on a phone, two columns when there is room).
- Shop, landscape: in a short wide window the kitty now stays visible on the right (sticky, sized to the window) instead of being pushed off the bottom; on a normal desktop window she shrinks to fit her panel.
- The "free emergency washcloth" text seen in a screenshot was an outdated running bundle (the code was already removed); restart the dev server with a cleared cache.

### Added
- Supply cards get the same gentle hover lift/highlight as other Shop items, and pressed feedback on touch.

## [2026-10-28] — Free emergency washcloth removed

### Removed
- The free emergency washcloth (Shop card, Bathroom button and store functions). Gentle Washcloths (10 Paw Tokens) are bought with tokens earned from tasks; one is used only when a wipe-down is completed. Too few tokens now shows a friendly "complete your tasks to earn more Paw Tokens" message in the Shop and the Bathroom. Tasks, task rewards, health countdowns and recovery rules are unchanged.

## [2026-10-28] — Pet Care Supplies, deceased pet across the app, larger tombstone, plain speech bubbles

### Added
- Shop -> **Pet Care Supplies**: Gentle Washcloth (10 Paw Tokens; one is used up by each completed Gentle Wipe-Down) and Pet Medicine (50 Paw Tokens; +25 Hunger and +25 Happiness for a Sick or Critical pet, no direct cure). Persistent inventory, "You own: N". Bathroom shows "Gentle Washcloth needed" instead of the mini-game when there is none.
- Accessories are browse-only for Sick/Critical pets (supplies still usable); a deceased pet can't buy, equip or use anything.

### Changed
- A deceased pet is the memorial tombstone in every Room, the Shop preview, Stats and the pet chips (not just Home), with no Room care tools; the Home tombstone is about twice as large.
- Speech bubbles show plain words (decorative emoji removed from the bubble only).

## [2026-10-28] — Developer Health State; single memorial message

### Added
- Alerts -> Developer Tools -> Health and Lifecycle Testing -> **Developer Health State**: pick Healthy / Sick / Critical / Deceased and press "Apply State" to set the selected pet's real, saved state in any direction (including Deceased -> Sick/Critical/Healthy). No Paw Tokens, no resurrection animation, no alerts; normal illness and paid-resurrection rules unchanged; development builds only. The illness-timer buttons remain.

### Fixed
- The memorial sentence was shown twice on Home (memorial card and the speech bubble above the tombstone); the bubble is now hidden for a passed-away pet, the card (with the resurrection button) stays.

## [2026-10-27] — Gym kitty size on phones

### Fixed
- On narrow portrait screens (under 700 px) the Gym kitty looked smaller than in the other rooms because the Gym was the only room without a size boost. It now gets the same 1.2 scale as the Study Room on phones only (`phoneScale` in `room-pet-placement.ts`); the Egg, landscape/desktop and all other rooms are unchanged.

## [2026-10-27] — Home redesign: two slide-out panels, developer tools moved to Alerts

### Added
- Home now centres on the kitty. Two labelled edge tabs open gentle slide-out panels: **Pet Progress** (left, lavender) and **Home Features** (right, pastel pink: tasks, appointments, mood and, in landscape, the Rooms shortcut). Tap, drag or edge-swipe to open; Close button, tap outside or swipe to close; one panel at a time; the panel scrolls independently and the room behind doesn't (`slide-out-panel.tsx`, `index.tsx`).

### Changed
- Portrait Home no longer shows the duplicate Rooms card (the Rooms tab in the top navigation is unchanged); landscape keeps it inside Home Features.
- The development-only controls moved from Home to Alerts -> Developer Tools, in collapsible sections (Pet Needs, Pet Growth and Stages, Health and Lifecycle Testing, Poop and Bath Testing, Paw Token Testing, Hatching and Animation Testing). Still development builds only and still selected-pet only; the display-only Pet Stage Preview is on the Pet Progress panel's stage icons.
- Portrait/landscape switching is unchanged; the pet group scales down in a very short landscape window instead of being cut off.

## [2026-10-27] — Bathroom: one combined message on phones; Kitchen phone framing

### Changed
- Bathroom (Sick/Critical pet only): the urgent-care banner now says "Too sick for a bath — gently drag the washcloth over her to freshen her up." and the separate instruction message is hidden on phone widths, so nothing overlaps. Other rooms keep the normal banner text; Healthy pets unchanged.
- Kitchen on phones: the background is framed toward the right so more of the rug/floor shows, and the kitty rests on the rug, higher than before; the desktop-only "down" nudge for the Baby picture is ignored on phones. Desktop Kitchen and all other rooms unchanged.

## [2026-10-27] — Phone-width Rooms fixes; Gentle Wipe-Down only in the Bathroom

### Fixed
- **Gentle Wipe-Down is now Bathroom-only (BUG-042):** the washcloth, progress bar and wiping no longer appear (or award Cleanliness) in the Kitchen, Gym, Bedroom, Study Room or any other room. The session is tied to the room and pet it started with. Mechanics, 1800 px requirement and +25 reward unchanged.
- **Kitchen on phones:** the kitty was pushed off the right edge by desktop-sized pixel shifts; on narrow screens the shift is capped so she is fully visible (desktop unchanged).
- **Task pill covering the pet chips on phones:** the collapsed room-task pill now sits in the bottom row; extra spacing above the health banner on phones.

### Changed
- "Back to Rooms" is smaller on phone widths and sits in the bottom-left corner (desktop unchanged).

## [2026-10-27] — Sick Baby shows in the Bathroom; Sick Young lower in the Bathroom; no sideways scroll on phones

### Fixed
- **Bathroom Sick/Critical artwork (BUG-041):** the Bathroom skipped the Sick/Critical picture when a bathing frame or the freshly bathed Dry pose was active, so Sick Baby's Bathroom offsets never showed. Sick/Critical artwork now always wins in the Bathroom (`room-pet.tsx`).
- **Phone-width page scrolled sideways:** the header nav now wraps onto a second row instead of overflowing (`app-header.tsx`); no horizontal scroll at 390 px and 360 px.

### Changed
- Sick Young is another 20 px lower in the Bathroom only (`SICK_YOUNG_BATHROOM_OFFSET_Y_PX` 10 -> 30).

## [2026-10-27] — Sick Baby lower in the Bathroom; phone-width Home spacing; Dry pose fix documented

### Fixed
- **Dry pose vs Sick/Critical artwork (BUG-039):** after a bath the kitty shows a freshly bathed Dry pose for 30 minutes. That Dry pose was being prioritized over the Sick/Critical artwork on Home, which made it look as though our health artwork positioning changes weren't working. Sick/Critical artwork now takes priority over the Dry pose (`pet-placeholder.tsx`, with an explanatory comment). Healthy pets still keep their normal 30-minute Dry pose.
- On the narrow (phone) Home layout, a lowered Sick Young kitty no longer overlaps the needs bars: real space is reserved under the pet box (`reserveHealthSpace`); desktop layout unchanged.

### Changed
- Sick Baby is 15 px lower in the Bathroom only (`SICK_BABY_BATHROOM_OFFSET_Y_PX`).

### Removed
- The temporary red outline and DEBUG label used to find the Dry pose bug.

## [2026-10-27] — Sick Young kitty lower on Home (offset 100), bars moved clear

### Changed
- `SICK_YOUNG_HOME_OFFSET_Y_PX` 40 -> 100: Sick Young is another 60 px lower on Home, hats/bows following.
- The needs bars and Feed/Play/Rest row are shifted down 45 px (visual only) while a Sick/Critical pet's Home offset exceeds 55 px, so the lower kitty does not overlap the bars. No changes to needs values, other stages/states, Bathroom/Rooms, Gentle Wipe-Down or health rules.

## [2026-10-27] — Sick Young Home position investigated; dev-only offset readout

### Added
- Development-only readout under the Home pet while Sick/Critical showing the final vertical offset in effect (`pet-placeholder.tsx`); never shown in production builds.

### Notes
- Traced the Sick Young Home position: `SICK_YOUNG_HOME_OFFSET_Y_PX` is used and moves the final render 1:1 (verified in a web run); earlier edits most likely weren't seen because of a stale dev bundle. Offset stays 40. Restart with `npx expo start -c` to see it.

## [2026-10-27] — Sick Young kitty lower on Home

### Changed
- Sick Young artwork is another 30 px lower on Home (`SICK_YOUNG_HOME_OFFSET_Y_PX` 10 -> 40); hats and bows move with it. Bathroom, other rooms, stages and states, Gentle Wipe-Down and health rules unchanged.

## [2026-10-27] — Sick Young kitty lower; longer Gentle Wipe-Down

### Changed
- Sick Young artwork is 10 px lower on Home (accessories follow) and in the Bathroom only; other rooms, stages and states unchanged (`pet-health-art.ts`, `room-pet.tsx`).
- Gentle Wipe-Down needs about 50% more valid dragging per session (`WIPE_PATH_PX` 1200 -> 1800); all other mechanics and the +25 Cleanliness reward are unchanged.

## [2026-10-27] — Gentle Wipe-Down mini-game, Sick/Critical art in Shop and Stats, browse-only Shop

### Added
- Gentle Wipe-Down mini-game in the Bathroom for Sick / Critical pets: drag a pastel washcloth over the kitty (mouse or touch), a small bar fills, and a finished session gives exactly +25 Cleanliness, free (BUG-034). Not yet manually verified.

### Changed
- Sick / Critical artwork now also shows in the Shop preview, Stats and the pet-switching chips, per pet.
- While Sick or Critical a pet can browse the Shop but cannot buy or change accessories, with a friendly "needs some rest" note.
- The Sick Baby kitty is another 10 px lower (Rooms and Bathroom 20 px in total, Home 10 px).

## [2026-10-27] — No poop or bathing while Sick or Critical; Sick Baby lower in the Rooms

### Changed
- A Sick or Critical pet makes no new poop and cannot start the bathing mini-game or clean piles (that pet only); existing piles and all saved data are kept, and everything resumes on recovery. A free Gentle Wipe-Down (+25 Cleanliness) in the Bathroom lets an unwell pet still reach Cleanliness 50 without tokens or developer tools. Health timers, recovery thresholds and resurrection are unchanged (BUG-033). Not yet manually verified.
- The Sick picture at the Baby stage is moved 10 px lower in all rooms and the bathroom only.

## [2026-10-27] — Sick and Critical kitty artwork connected

### Changed
- Critical kitties (intentionally lying down) now rest on the floor line at their own scale instead of floating at head height; worn hats/bows follow the lower head through an extra transform, with saved placements untouched. Sick kitties keep their head-aligned sitting poses, so Sick and Critical look clearly different. Not yet manually verified.

### Added
- The supplied Sick and Critical four-kitty sheets (`assets/images/pets/Sick/`, untouched) were cropped into 8 standalone transparent PNGs in `assets/images/pets/health/` and connected through `src/utils/pet-health-art.ts`. A Sick or Critical pet now shows its Sick / Critical picture on Home and in every Room, and returns to its normal picture on recovery. Eggs never use it; the Hatchling/Baby swap is respected. Saved accessory offsets were not changed: each picture is scaled and positioned so its head lines up with the healthy picture's head (estimated; see BUG-032). Not yet manually verified.

## [2026-10-26] — Compact health banner, Happiness dev controls, health artwork structure

### Changed
- The Sick / Critical banner is now a compact pastel row (heart-pulse icon, the pet's name, one help line, clock + live countdown) and no longer repeats the speech bubble. Timer and health rules unchanged.

### Added
- Developer Tools: Dev: Set Happiness to 0% / 25% / 50% / Restore to 100% (selected pet only).
- Health-state artwork structure (`src/utils/pet-health-art.ts`, `healthState` prop). Until the Sick / Critical PNGs are supplied (BUG-032) the normal picture is used. No existing artwork or accessory placement changed.

## [2026-10-26] — Dev: Set Actual Stage

### Added
- Developer-only "Dev: Set Actual Stage" (Egg / Hatchling / Baby / Young / Adult) on Pet Care & Alerts > Developer Tools, with a save confirmation. It changes the selected pet's real growth stage through the normal growth rules (no tokens or tasks awarded) and clears that pet's visual preview. The Pet Stage Preview stays display-only (BUG-031). Not yet manually verified.

## [2026-10-26] — Per-pet Pet Stage Preview and developer controls

### Fixed
- Pet Stage Preview is now per pet and development-only, so each adopted pet previews its own stage and "Reset to Actual Stage" only affects the selected pet (BUG-030). Not yet manually verified.
- The Hatching replay is cancelled when switching pets; saving a profile that was read for another pet can no longer overwrite the selected pet.

### Added
- Developer-only "+10 growth tasks" button (Pet Care & Alerts > Developer Tools) that adds real growth to the selected pet only.

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

## [2026-10-26] — Pet family, health, death and resurrection

Documented in `features.md` (FEATURE-059 to FEATURE-063). Still uncommitted when written; not yet tested in the running app.

### Added
- **Pet family:** up to 3 living pets at once (configurable), each with its own needs, growth, stage, level, accessories, birthday, health timers and history. Adopt an egg with a confirmation; switch pets from a pastel bar under the header on Home, Rooms, Shop and Stats. Existing players keep their kitty (same album id), progress, accessories and tokens; the old saved values are left untouched.
- **Shared wallet and growth split:** Paw Tokens belong to the player; task rewards are 10/15, 20/30 or 30/45 for 1, 2 or 3 living pets. Each completed task's growth is split exactly (whole growth units, no rounding loss) between the living pets; sick, critical and deceased pets get none.
- **Health:** Healthy → Sick (a need hits 0) → Critical (24h) → passes away (96h total), per pet, from saved timestamps so it keeps running with the app closed; free recovery when Hunger, Cleanliness and Happiness are all 50+; Energy 0 only puts the pet to sleep from exhaustion. Gentle speech-bubble messages and a warning panel with a countdown.
- **Death and resurrection:** a memorial message, the Pet Album keeps the pet and its history, and a pet can be resurrected at any time for exactly 500 Paw Tokens (atomic, charged once, same pet back with needs at 75) with a pastel hospital-truck animation (now using the provided `ambulance.png`; Skip and reduced-motion supported), and a passed-away pet is shown as the provided memorial tombstone on Home.
- **Health alerts:** opt-in phone notifications (gentle for Sick, emergency for Critical, scheduled ahead and cancelled when no longer needed), vibration, an opt-in three-flash flashlight alert while the app is open, Samsung Camera Flash Notification guidance, and a non-flashing warning panel. New `/pet-alerts` page with developer lifecycle test buttons.
- The Alerts page was redesigned as "Pet Care & Alerts" — simple and friendly, with the grown-up detail in collapsed sections and the developer buttons shown only in development builds. The saved alert settings and all alert logic are unchanged.
- The Pet Care & Alerts page was then made compact and chibi-style: a narrow centred column, pastel pink / lavender / mint cards with soft shadows and tiny paw/heart/sparkle accents, simple line icons (utensils, water drops, game controller, crescent moon) in white circles, and small mint/gray switches. Added the `@expo/vector-icons` dependency (JS and font files only, no native change) for those icons. Visual only.
- The Pet Care & Alerts page now has its own icon-only bell tab at the far right of the navigation bar (Home, Tasks, Rooms, Shop, Stats, bell), with an accessible "Pet Care & Alerts" label and a desktop tooltip; the separate Alerts button was removed from the pet family bar.
- New dependency `expo-camera` (torch control) and its `app.json` plugin: a new development build is required for the flashlight and for notification testing.

### Improved
- The Pet Album now lists living and passed-away pets from the family store, with Born On, status, a history timeline, Switch and Resurrect.
- Year in Review pet milestones now come from every pet's recorded events (egg arrival, hatching, passing away, coming back).
- Egg-stage pets no longer lose needs or get sick.
- Saving only a Paw Token change no longer resets a pet's need-decay clock.
- `pet-profile.ts` and `pet-needs.ts` were split into model/core files plus thin layers, so no existing import changed.

### Changed
- Un-checking a task no longer lowers a pet's progress (growth is now a ledger like tokens).
- Home hatch recording and the earlier `pet-lifecycle.ts` were replaced by the shared growth award in `pet-family.ts`.

### Known issues (documented, not fixed)
- BUG-028 and BUG-029 in `bugs.md`: care tools still visible in Rooms for a deceased pet; notifications, flashlight and the new artwork untested on a device (BUG-027, the truck artwork, is now fixed in code).

---

## [2026-10-26]

Covers the work done between 2026-10-24 and 2026-10-26 (all still uncommitted when this entry was written). Features are described in `features.md` (FEATURE-043 to FEATURE-058).

### Added
- **Independent hat and bow slots.** The kitty can wear one hat and one bow at the same time; each is equipped, replaced and removed on its own (`src/utils/pet-equipment.ts`). The old single saved selection is migrated automatically. Home, the Shop preview, Stats and the Pet Album draw both.
- **Adult kitty accessories.** Individually tuned Adult placements for all hats and a shared Adult bow placement. Young kitty hat adjustments were finished and finalized.
- **Stats: Completed by Category pages.** Each category card is clickable (hover lift, pointer cursor, press feedback) and opens `/stats/<category>` with totals, a 7-day pastel chart and the completed-task list. Tasks now record optional completion timestamps (`completedAt`, `completedAtByDate`) so dates are real; older tasks show "Date not recorded".
- **Stats: Lifetime Stats pages.** Interactive rows for Tasks Completed, Important Tasks Completed, Pet Album, Paw Tokens Earned and Day Streak, each opening its own detail page, with shared detail-page components (`src/components/detail-page-parts.tsx`).
- **Pet Album and pet history.** Cards for every kitty with highest stage and level, current vs. previous pet, and detail pages with a memory message; a saved record of peak stage/level and an `archivePet()` function ready for a future death / new-pet flow (`src/utils/pet-album.ts`).
- **Kitty birthday ("Born On").** The hatch moment is recorded when the egg becomes a Hatchling and shown in the Pet Album; unrecorded dates say "Birth date unknown".
- **Mood history and My Mood Journey.** Home mood picks are saved with timestamps; new daily, monthly and yearly views with a 365/366-day calendar, pie charts (drawn without an SVG library) and bar charts. Missing days are never treated as a mood.
- **Daily journal reflections.** Optional short notes per day (save, update, delete, history list), stored only on the device.
- **Your Year So Far / Year in Review.** A recap page for any year with a locally written summary; the current year covers January 1 through today.
- **Paw Token earnings history.** Every earning (tasks, appointments, Kitty Catch, Memory Match) is logged with date and source; new Token Earnings page with weekly/monthly/yearly charts, kept separate from the balance.
- **Task streaks.** Current and longest streak, active-day calendar, per-month chart and previous streaks; yearly streak facts and milestones in the Year in Review.
- Documentation: `features.md` (FEATURE-043 to FEATURE-058, FEATURE-040 marked finished) and `bugs.md` (a 2026-10-26 review section and BUG-022 to BUG-026).

### Improved
- **Stats Pet Progress** now draws the same kitty as Home and the Shop (shared `PetAvatar`: same artwork, stage and equipped hat and bow), follows the Pet Stage Preview, updates when the pet profile changes, and sits 20px lower in its card.
- **Hatch recording** moved from the Home screen into the shared task-saving code (`src/utils/pet-lifecycle.ts`), so it works from any page.
- **Hatchling and Baby kitty artwork swapped everywhere** through one shared mapping, `getArtworkStage()` (`src/utils/pet-stage.ts`): the shared kitty image and Dirty art (Home, Shop, Stats, Pet Album, Bathroom), the Study Room, Gym, Bedroom and Kitchen sprites, the bathing/washing frames and the Pet Progress icons. Accessory placements and per-room pet placement follow the artwork instead of being rewritten (BUG-023).
- Stats gained a "Reflect" panel linking to My Mood Journey and My Year in Review; the header keeps "Stats" highlighted on its sub-pages.
- The Shop's try-on preview replaces only the previewed item's slot (hat or bow).

### Fixed
- The Stats kitty no longer ignores a Pet Stage Preview or stale profile data and no longer lacks accessories (see the cause in `features.md`, FEATURE-047).
- Hat/bow placements on the swapped Hatchling and Baby artwork (hats were floating too high after the swap).
- BUG-020 and BUG-021 remain "fixed in code, not yet manually verified" (see `bugs.md`).
- BUG-022: Year in Review now groups pet milestones by the player's local calendar date instead of the UTC date in the stored timestamp (`src/components/year-review-screen.tsx`); stored timestamps are unchanged. Not yet manually verified.
- BUG-025: the daily reflection "Saved ✓" message was wiped by an effect right after saving. The status is now cleared only when the day changes, and `saveReflection` / `deleteReflection` (`src/utils/journal.ts`) report whether the write to storage succeeded, so the message appears only after a real save and a failure shows a "Couldn't save" notice (`src/components/mood-journey-screen.tsx`). Not yet manually verified.

### Known issues (documented, not fixed)
- BUG-023 (Room and bathing sprites not swapped) is now fixed in code but not yet manually verified.
- BUG-024: unverified cosmetic issue (accessory position during the temporary hatch picture).
- BUG-026: developer test flags in `src/utils/dev-flags.ts` are still on.

---

## [2026-10-23]

### Added
- Code comments throughout `src/components/shop-screen.tsx` and `src/components/pet-avatar.tsx` explaining how the Shop background/banner render, the live balance overlay, the Kitty preview (including growth-stage sync and accessory try-on), its sticky right-side positioning, and the 3-column accessory grid — see FEATURE-042 in `features.md` for the full write-up.
- BUG-018 and BUG-019 documented in `bugs.md` (BUG-019's fix actually landed the previous day, alongside the rest of the Shop redesign, but was undocumented until now).

### Changed
- The Kitty preview is now noticeably larger — about 75% bigger (`PREVIEW_KITTY_SIZE` 180 → 315px) — with its vertical position adjusted so her paws stay anchored on the pink rug instead of sinking as she grew, and the sidebar widened (`PREVIEW_PANEL_WIDTH` 280 → 340px) so the larger Kitty no longer spills past her column.
- The Kitty preview moved further down the page (`previewPanel`'s `marginTop` 500 → 365, adjusted alongside the size change above) so she sits on the rug near the bottom of the Shop background rather than near the top.
- The Pet Accessories grid now shows 4 columns (up from 2 earlier the same day, by way of 3) at typical desktop widths — `CARD_WIDTH` went 246 → 228 → 190 → 178 across several rounds, alongside narrower card/grid gaps, so more cards fit per row while staying readable; a narrow desktop window reflows down to fewer columns, the same responsive wrapping every grid in the app already does.
- Restructured the Shop page's layout so the banner, category buttons, and Kitty preview are genuinely stationary while only the item grid scrolls (`stationaryHeader` + `bodyRow`/`gridScroll`, in place of one shared `ScrollView` around everything). The previous approach relied on CSS `position: 'sticky'` for the Kitty preview, which turned out not to actually engage (its static position never crossed the sticky threshold), so she was scrolling out of view along with the rest of the page — this is now a structural fixed-header/scrollable-body split instead, which works the same way on web and Android.
- The Shop banner moved closer to the navigation header, and the category buttons closer to the banner, by trimming more of `Shop_Banner.png`'s own built-in transparent padding (`bannerCropWrap`, `BANNER_TOP_TRIM_FRACTION`/`BANNER_BOTTOM_TRIM_FRACTION`) rather than cropping any of the banner's actual visible artwork.
- The live Paw Token number on the banner now shrinks its font size for longer balances (4+ digits) instead of a flat size, so it no longer visually overlaps the banner's decorative sparkle for a typical 4-digit balance; the overlay box also gained `overflow: 'hidden'` as a hard backstop.

### Fixed
- BUG-018: the Shop's Kitty preview always showed the pet's real saved growth stage, ignoring an active Pet Stage Preview set from Home. `src/components/shop-screen.tsx` now subscribes to the same shared `@/utils/dev-stage-preview` module Home reads from, instead of computing its own real-stage-only value.
- BUG-020: a manually selected Pet Stage Preview (e.g. Baby) didn't survive a page refresh, always reverting to the pet's real saved stage. `@/utils/dev-stage-preview.ts` was deliberately in-memory-only; it now persists the selection to `AsyncStorage` and re-hydrates it on load, with no changes needed to any of the screens that read it (Home, every Room, Shop) since they already shared this one module.
- BUG-021: the Shop's Kitty preview showed Young-stage accessories (e.g. the White Cat-Ear Beanie) misaligned/clipped at the top, even though the same accessory on the same stage was correctly positioned on Home. `src/components/pet-avatar.tsx` was never applying Home's `YOUNG_SCALE` (1.21x) body enlargement, even though the shared accessory placement data it already reused was tuned against that enlarged body — now imports and applies the same `YOUNG_SCALE` (exported from `pet-placeholder.tsx` rather than duplicated) and no longer clips its own box (`overflow: 'hidden'` removed), matching Home exactly. As a direct, unavoidable consequence, the Shop's Young-stage Kitty now renders about 21% larger than she did immediately before this fix — Baby and Adult are unaffected.

---

## [2026-10-22]

### Added
- **Summary:** redesigned the Shop page — a custom pastel background and illustrated banner, a live Kitty preview with accessory try-on, and a redesigned "Your Balance" display. See FEATURE-042 in `features.md`, and BUG-019 below for a bug found and fixed along the way.
- `assets/images/shop/shop_background.png`, displayed full-bleed behind the Shop page the same way Home/Tasks/Stats/Mini-Games already display their own backgrounds (`src/app/_layout.tsx`, `src/components/app-header.tsx`'s `isImmersiveRoute`).
- A new reusable `src/components/pet-avatar.tsx` (`PetAvatar`) — a small, display-only portrait of the player's real pet, reusing Home's own body-art lookup (`getStageImage`) and equipped-accessory data (`PET_ACCESSORY_ART`, `getAccessoryPlacement`) rather than a separate copy of either. Originally used to replace the Shop header's cat emoji with the real Kitty; later became the basis for the larger Kitty preview below.
- `assets/images/shop/Shop_Banner.png` now replaces the old plain pastel hero banner entirely (title, subtitle, and the "Your Balance" card are all painted into the image) — `src/components/shop-screen.tsx`'s `bannerWrap`/`bannerImage`, sized via `width: '100%'` plus the image's real aspect ratio so it's never cropped or distorted.
- A live Paw Token number overlaid on the banner's "Your Balance" card, positioned/sized as fractions of the banner's own measured width so it tracks correctly at any screen size, reading from the same `pawTokens` state (`subscribeToPetProfile`) the rest of the app already uses.
- A Kitty preview on the right side of the Shop — a large (`PetAvatar`), transparent-background rendering of the player's real Kitty, at her real growth stage with her real equipped accessories. Desktop: a sticky sidebar next to the item grid. Mobile/narrow: a collapsible "🐾 Kitty Preview" section so it never covers the product grid.
- Accessory try-on: tapping an item's artwork in the grid temporarily previews it on the Kitty preview (`previewAccessoryId`, local-only — never equips or purchases anything); tapping the Kitty again clears the preview back to whatever's actually equipped.
- The Pet Accessories grid now shows real artwork (via the existing `PET_ACCESSORY_ART`/`SpriteCrop`) for every bow and hat instead of emoji placeholders, with working Buy/Equip controls.

### Changed
- The Shop header's "Your Balance" card moved from the left (next to the old mascot circle) to the right side of the banner area, with a darker-pink heading pill behind the label and a larger Paw Token icon — later superseded by the illustrated banner above, which paints "Your Balance" directly into the art.
- `grid`'s card width (`CARD_WIDTH`) was later narrowed to fit the Kitty preview sidebar alongside the item grid without the two overlapping.

### Fixed
- BUG-017: the Home screen's Play button (and, sharing the exact same guard, Feed/Rest/Clean Up) stopped responding on an already-hatched pet — confirmed on a Young-stage pet. Root cause: `isRealEgg` read the pet's stage before `tasks`/`petProfile` had actually finished loading, and those "not loaded yet" defaults were mathematically indistinguishable from a genuine Egg. `src/app/index.tsx`'s `isRealEgg` now also requires `isHydrated && petProfile !== null` (real, loaded data) and is additionally floored permanently false once `petProfile.hatchedAt` is ever set, mirroring the existing `paidStageIndex` floor for Young/Adult. A genuinely unhatched Egg is unaffected.
- Related defensive hardening found while investigating (not the actual cause, but a real gap): `src/components/pet-placeholder.tsx`'s own pet picture is now wrapped in a plain `View` with `pointerEvents="none"` instead of passing that prop straight to `expo-image`'s `<Image>`, which silently ignores it; `petWrap` now has `pointerEvents="box-none"`; the Feed/Play/Rest row was moved 40px lower with an explicit `zIndex` so it reliably paints/hit-tests above anything that might ever overlap it.
- BUG-019: the Shop banner's left edge (including Kitty's own art painted into it) got cropped during an attempt to enlarge it via a negative `marginLeft` bleed, because the Shop's `ScrollView` clips horizontal overflow. Reverted to a plain `width: '100%'` banner, which can't overflow its container at all.

### Removed
- The temporary `console.log` debug statements (and their accompanying debugging comments) added to `handlePlay()` while diagnosing BUG-017, now that the fix is confirmed.
- The Kitty preview's purple/lavender card background, border, "✨ Try It On! ✨" title, and "Tap an accessory below to try it on!" hint text — now just the Kitty sprite itself, per direct player feedback.

---

## [2026-10-21]

### Added
- **Summary:** replaced the placeholder "Wash Kitty" button with a real interactive bathing mini-game — Soap, Rinse, and Blow Dry, each with 5 circles the player hovers-and-holds (or clicks/taps) in order, using the real existing sprite art for every growth stage. A completed bath now actually restores Cleanliness and clears `needsBath`, holds Kitty's final Dry pose for 30 minutes, and the player can bathe again at any time. See FEATURE-041 in `features.md`, and BUG-012 through BUG-016 in `bugs.md` for the bugs found and fixed along the way.
- New `src/components/bathing-mini-game.tsx`: the interactive circle mechanic shared by all three phases. Each of the 5 circles fills over a 2-second hover-and-hold, with a pulsing glow on the one active circle, a phase-specific pastel color (pink for Soap, light blue for Rinse, soft yellow for Blow Dry), a brief checkmark celebration on completion, and a subtle water/warm-air effect while actively rinsing/drying. A single click (web) or tap (mobile) also completes the active circle instantly, as an alternative to the hold — both methods share the same completion path, so a circle can only ever be completed once per attempt.
- Mouse and touch controls: on web, the selected tool's icon follows the mouse continuously (hover tracked via `onMouseMove`, independent of whether any button is pressed) and the real OS cursor is hidden over the play area. On Android/iOS, the tool icon follows the player's finger while touching (React Native's own `PanResponder` — no new gesture library added).
- An instruction banner above the tool buttons ("🧼 Hover over the glowing circle to soap your kitty!" etc.) that changes wording per selected tool.
- New `src/utils/bathing-soap.ts`: a small `SoapItem` data model (id/name/icon/price) with one free default soap, structured so a future Shop update can add real purchasable soaps without changing the mini-game itself.
- `completeBathing()` in `src/utils/pet-bathing.ts` — the real "a bath just finished" event: restores Cleanliness to 100, clears `needsBath`, and stamps a new `PetProfile.lastBathCompletedAt` timestamp. Only ever fires once all three phases (Soap, Rinse, Blow Dry) reach 100%.
- New `PetProfile.lastBathCompletedAt` field (`src/utils/pet-profile.ts`) and `BATH_DRY_HOLD_MS`/`isShowingBathDryHold()` (`src/utils/pet-bathing.ts`) — Kitty's final Dry sprite now stays visible for 30 minutes after a completed bath, on both Home and the Bathroom, surviving tab/room navigation and a full app restart.
- Home (`src/app/index.tsx`) now subscribes to `subscribeToPetProfile` so a bath completed in the Bathroom is reflected on Home immediately, without needing a reload.

### Changed
- The old single-press "Wash Kitty" button and its static soapy picture are gone, replaced entirely by the tool-select row (Soap bar, Shower Hose, Blow Dryer) and the mini-game above.
- The Bathroom's tool-select row is now always available — starting a new bath no longer depends on Cleanliness, `needsBath`, or whether the previous bath's Dry-pose hold is still active (see BUG-013).
- `src/components/room-pet.tsx` and `src/components/pet-placeholder.tsx`: the Dry-pose hold now only yields to Kitty's Dirty appearance when `needsBath` is specifically true (a genuinely new poop event), rather than the broader `isDirty` check, which could also be true because of an old, already-cleaned-up-unrelated poop pile still sitting on the floor (see BUG-015/BUG-016).
- Soap/Rinse/Blow Dry progress no longer resets automatically the instant a bath completes — all three stay visibly at 100% until the player explicitly reselects Soap to start a new bath (see BUG-015).

### Fixed
- BUG-012: Cleanliness/`needsBath` never actually updated after "washing" Kitty, since no real completion step existed yet.
- BUG-013: no way to bathe Kitty a second time, since the tool row was hidden for the entire post-bath Dry-pose hold.
- BUG-014: Kitty's sprite briefly reverted to Dirty between bathing phases instead of holding the last completed phase's pose.
- BUG-015: Kitty could revert to Dirty immediately after a successful bath (stale floor poop overriding the Dry pose) and the progress bars reset on their own, reading as an unprompted restart.
- BUG-016: a new poop accident during the 30-minute Dry-pose hold didn't switch Kitty back to Dirty.

### Removed
- The developer-only "🧪 Dev: Bathing Art Preview" button and its `DEV_ENABLE_BATHING_ART_PREVIEW` flag, plus `src/components/dev-bathing-art-preview.tsx` — no longer needed now that the real interactive mini-game exercises all 14 bathing sprite sheets directly. The sprite data and artwork it used to spot-check (`src/utils/bathing-stage-art.ts`, `assets/images/pets/bathing/`) are untouched and still fully in use by the real mini-game.

---

## [2026-10-15]

### Added
- **Summary:** gave Hatchling Kitty her own Shop accessory placements — the shared bow spot plus all 15 currently-purchasable hats — each tuned through direct visual feedback on the real Home pet, independently of Baby's existing (untouched) placements. Added a new `scaleY` capability along the way so a hat's width and height can be stretched/squashed independently when needed. See FEATURE-040 in `features.md`.
- Hatchling placement for the shared bow (`neckCollar`, used by all 26 bows) in `src/utils/pet-accessory-placement.ts`: finalized at `{ width: '22%', marginTop: '70%' }`, replacing the old copied-from-Baby placeholder.
- Hatchling placements added for all 15 currently-purchasable hats in `src/utils/pet-accessories.ts`: White Cat-Ear Beanie, Black Cat-Ear Beanie, Bunny Hat, Bear Hat, Frog Hat, Duck Hat, Strawberry Hat, Bee Hat, Mushroom Hat, Witch Hat, Wizard Hat, Rainbow Party Hat, Pumpkin Hat, Reindeer Hat, and Santa Hat — each created from that hat's own Baby placement as a starting point, then independently tuned (width, horizontal/vertical position, and for some, horizontal- or vertical-only stretch).
- New `scaleY` field on `AccessoryPlacement` (`src/utils/pet-accessory-placement.ts`), mirroring the existing `scaleX` — wired into the accessory transform array in `src/components/pet-placeholder.tsx`. Lets a hat's height be adjusted independently of its width (and vice versa via `scaleX`), on top of `width` alone (which always scales both together via the hat's own crop aspect ratio). Used by the Bear Hat and Duck Hat's Hatchling placements.

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
