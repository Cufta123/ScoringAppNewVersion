# AGENTS.md

This file is the project memory and operating guide for coding agents (GPT and Claude).
Use this document first. Only search the repo when this file does not answer the question.

## 1. Mission And Product

- Product: IOM Regatta Manager desktop app.
- Domain: event setup, sailor/boat management, heat/race scoring, leaderboards, final series handling.
- Stack: Electron (main), React (renderer), TypeScript + JavaScript, SQLite via better-sqlite3.

## 2. First Places To Look

- Main process bootstrap: `src/main/main.ts`
- IPC registration side effects: `src/main/ipcHandlers/index.ts`
- IPC handlers (registered via `handle()` in `src/main/ipcHandlers/handle.ts`):
  - `src/main/ipcHandlers/SailorHandler.ts`
  - `src/main/ipcHandlers/EventHandler.ts`
  - `src/main/ipcHandlers/HeatRaceHandler.ts` — only imports the five files
    below (kept so `main.ts` and the tests have one import for the heat/race
    channels):
    - `HeatHandler.ts` — heats, initial heats and "recreate", boats in heats,
      transfer, next round, undo redistribution
    - `ScoringHandler.ts` — submit a race, undo a race, leaderboard result
      edits (`saveLeaderboardRaceResultsAtomic`)
    - `StandingsHandler.ts` — leaderboard reads (qualifying, final, overall),
      explain score / tie-break, Final Series eligibility, max heat size
    - `FinalSeriesHandler.ts` — `startFinalSeriesAtomic`
    - `SnapshotHandler.ts` — event snapshot export / restore (file dialogs)
- Pure/domain logic (extracted out of the handlers): `src/main/functions/`
  (see §5 for the full module map).
- Scoring core and cross-process helpers: `src/shared/`. The series scoring
  rules live in `src/shared/scoring/` (`series.ts`: discards, SHRS 5.7
  tie-break and places for qualifying and final series; `overall.ts`: SHRS
  5.5 overall standings, fleet order and the tie-break across both series;
  `discards.ts`; `ranking.ts`). Code in `src/shared` takes data and returns results: it must
  not import main-process, renderer, database, Electron, React or Node code
  (an ESLint rule enforces this), so any future viewer can run it unchanged.
- Preload bridge and exposed API: `src/main/preload.ts`
- Renderer DB access wrapper: `src/renderer/api/db` (re-exports `eventDB`,
  `heatRaceDB`, etc. over `window.electron.sqlite.*`).
- Renderer routes: `src/renderer/App.tsx`
- Database open + startup: `public/Database/DBManager.js` (its startup dialog
  words its own advice but recognises damaged / busy / full / read-only files
  with `classifyDatabaseFailure` from `shared/errors/explainError.ts`); versioned schema
  migrations: `public/Database/schema.js`; automatic backups:
  `public/Database/backup.js`
- App menu: `src/main/menu.ts`
- Unit test config: `jest.unit.config.ts`

## 3. Runtime Architecture

### Main process

- Creates `BrowserWindow` and loads renderer via `resolveHtmlPath('index.html')`.
- Enables `contextIsolation: true` and uses preload bridge.
- Registers `dialog:openFile` IPC handler in `src/main/main.ts`.
- Imports all handler modules for side-effect registration.

### Renderer process

- Uses `HashRouter` with these routes:
  - `/`
  - `/event/:name`
  - `/event/:eventName/heat-race`
  - `/event/:eventName/leaderboard`
- Uses `window.electron` API from preload (via the `src/renderer/api/db` wrapper).

### Preload contract

- `src/main/preload.ts` exposes grouped sqlite APIs under `window.electron.sqlite.*`.
- Wrapper throws on `false` return values, so renderer callers should expect exceptions.
- `window.electron.appEvents` (not a sqlite group): `logError` sends a window
  error to the error log; `onBackupStatus` reports automatic-backup failures.
- Channel names live once in `SQLITE_CHANNELS`, grouped as the renderer consumes
  them; `type Channels` and the invoker map are derived from that list.

## 4. Database Model (SQLite)

The schema is built by numbered migrations in `public/Database/schema.js`.
`PRAGMA user_version` records how far a database has been migrated; on open,
every newer migration runs once, in order. To change the schema, APPEND a
migration — never edit a shipped one. `DBManager.js` takes a
`pre-migration-*` backup before any pending migration, and refuses to start
(error dialog, exit) if a migration fails or the database comes from a newer
app version, rather than running on a half-migrated file.
`schema.migrations.test.ts` runs the real migrations against node:sqlite.

Backups (`backup.js`) go to `<db folder>/backups`: on start-up, every 5 min
while data changes, and on quit, via `VACUUM INTO`. The newest 24 `auto-*`
copies are kept plus the last one of each earlier day; `pre-migration-*` are
never pruned. Help → Open Backups Folder opens the folder. To restore: quit,
copy a backup over `scoring_app.db`.

Key tables:

- `Events`
- `Sailors`
- `Boats`
- `Clubs`
- `Categories` (seeded with KADET/JUNIOR/SENIOR/VETERAN/MASTER)
- `Boat_Event` (boat-event association)
- `Heats`, `Races`, `Scores`, `Heat_Boat`
- `Leaderboard`, `FinalLeaderboard`
- `GlobalLeaderboard` (retained but unused; see §10)
- `RaceAssignmentSnapshots` (SHRS 3.1.5 pre-protest assignment order, persisted
  so the in-memory cache in `raceAssignmentSnapshot.ts` survives restarts)

Important migration details:

- `Boats.sail_number` used to have a UNIQUE constraint. `DBManager.js` migrates
  it away by rebuilding the table (note the transient `Boats_tmp` table).
- `Scores` has a unique index covered by `Scores.uniqueIndex.migration.test.ts`.
- Code that touches the DB must tolerate older databases missing newer
  tables/columns (e.g. `RaceAssignmentSnapshots` reads are wrapped in try/catch).
- **Foreign keys are ENFORCED** (better-sqlite3 is built with
  `SQLITE_DEFAULT_FOREIGN_KEYS=1`) and **no table declares ON DELETE CASCADE**,
  so every delete cascades by hand. A missed referencing table does not orphan
  a row — it aborts the whole operation with "FOREIGN KEY constraint failed".
  Anything that deletes an event's races must clear `RaceAssignmentSnapshots`
  first; `deleteEvent` and `restoreEventSnapshot` both missed it and made any
  event with a protest decision undeletable. Covered by
  `eventLifecycle.integration.test.ts`, which asserts `PRAGMA foreign_key_check`
  is clean afterwards.
- Migration 2 makes `Boat_Event (boat_id, event_id)` unique;
  `associateBoatWithEvent` is `INSERT OR IGNORE`.
- Migration 1 adds `idx_races_heat_id` and `idx_heats_event_id`
  (298 ms -> 3 ms for the DNC backfill probe on a four-season database).
  `Scores(boat_id)` and `ANALYZE` are deliberately excluded — both help one
  query on the leaderboard click and hurt the other more. Re-measure before
  adding either; `DBManager.performanceIndexes.test.ts` records the numbers.
- Migration 4 adds the **change journal** (`public/Database/journal.js`):
  SQLite triggers on `Events`, `Boat_Event`, `Heats`, `Heat_Boat`, `Races` and
  `Scores` (and `RaceAssignmentSnapshots`, hidden in the history) append one
  `ChangeLog` row per inserted/updated/deleted row (whole row before and after
  as JSON, plus readable labels in `context`). An update that changes nothing
  is not logged. The standings (`Leaderboard`, `FinalLeaderboard`) are not
  journalled. Deleting
  an event deletes its history. The triggers list the columns as they were
  when installed: a migration that adds a column to a journalled table must
  call `installJournalTriggers(db)` again. The IPC wrapper (`handle.ts`) groups
  what one call wrote under a `ChangeActions` row via the observer that
  `main.ts` installs (`changeJournal.ts`); tests leave it unset unless they
  test the journal. `readEventHistory` serves it; `shared/history/describe.ts`
  turns rows into sentences and nets out a row written several times by one
  action (scoring first enters DNS for every boat). The Navbar's History button
  (`EventHistoryDialog`) shows it on the event, scoring and leaderboard pages.
  **Undo from the history** (`revertHistoryAction`, IPC of the same name):
  only result changes (leaderboard edits, an earlier undo, and the removed
  `updateRaceResult` / `updateScore` / `insertScore` / `deleteScore` channels,
  whose history rows stay in existing databases) — scoring a race, heats
  and entries feed later heats and keep their scoring-page Undo with its
  guards. Rules in `shared/history/revert.ts`: every row the action changed is
  put back as it was, in one transaction with the standings rebuild, and only
  if no later action changed it (else the error names that action). Points the
  rebuild re-derives (RDG1/RDG2 averages, non-finisher and 44.3(c) points) are
  neither checked nor restored; discard locks stay set. The undo is recorded
  with `ChangeActions.reverts_action_id`, so it can be undone too. After an
  undo the dialog fires `notifyEventDataChanged`; the leaderboard (unless
  editing) and scoring pages reload via `useEventDataChanged`.
  Covered by `changeJournal.integration.test.ts` (real migrations and
  handlers; an undo restores results, SHRS 3.1.5 rows and standings exactly),
  `historyDescribe.test.ts`, `historyRevert.test.ts` and
  `EventHistoryDialog.test.jsx`.

- Migration 5 adds the **`CountedRaces` view** (`public/Database/views.js`),
  the one definition of which races count in the standings: every final race,
  and a qualifying race once EVERY heat of its round (with boats) has sailed
  it — SHRS 1.1, "each race will consist of two or more heats". Everything
  that scores the qualifying series joins it: the rebuild
  (`recomputeEventLeaderboard`, redress averages), `calculateBoatScores`,
  `getSeriesDiscardRaceCount`, the tie-breaks, `explainScore`, the fleet
  split, the DNC backfill and `readLeaderboard`. A round still being sailed
  leaves the standings exactly as after the last full round; its results come
  back separately as `pending_races` and show greyed ("Q3\*") on the
  leaderboard, outside every total. Tests that build their own schema must
  add `COUNTED_RACES_VIEW` (`eventLifecycleSchema.ts` does).
- **`Leaderboard` / `FinalLeaderboard` are a cache.** Every read for a user
  (`readLeaderboard`, `readFinalLeaderboard`, `readOverallLeaderboard`,
  `explainBoatScore`, the fleet split in `startFinalSeriesAtomic`) rebuilds
  them from the scores first (`functions/standings.ts` `refreshStandings`,
  ~20 ms for 80 boats × 15 rounds), so a stale table cannot reach the screen.
  Writes still rebuild inside their own transaction as before; scoring a
  qualifying heat now always rebuilds (it used to skip unless every heat had
  the same race count). Tests that feed fixed standings through a mocked
  database mock `functions/standings` instead.

DB file paths:

- Packaged: under `app.getPath('userData')/scoring_app.db`
- Dev: from `public/Database/data/scoring_app.db`

## 5. Domain Rules And Scoring Notes

The handlers (`ipcHandlers/`) only wire IPC: read, call a pure planner, write
in one transaction. The logic lives in focused modules under
`src/main/functions/`. Map of that directory:

- `calculateBoatScores.ts` / `calculateFinalBoatScores.ts` — load a series'
  scores and hand them to the scoring core (`shared/scoring/series.ts`), which
  holds the rules. `calculateBoatScores.ts` also wraps the core's qualifying
  tie-break for the explain panel, so the panel and the ranking cannot differ.
- `explainScore.ts` — "how was this score calculated?" for one boat (IPC
  `explainBoatScore`): loads her races and hands them to
  `shared/scoring/explain.ts`, which states every race's points with the rule
  behind them (RRS A4/A7, SHRS 5.2, RRS 44.3(c)/30.2/T1, A9 redress with the
  races averaged), the SHRS 5.4 discards, the sum, and ties (via
  `explainTieBreak`). It uses the same discard choice and status-points rules
  as the ranking (`shared/scoring/statusPoints.ts`), and
  `explainBoatScore.integration.test.ts` checks its totals against the stored
  leaderboard for every boat of 150 random events. The leaderboard's Overall
  number opens it (`ScoreExplanationDialog.tsx`), except in edit/compare mode.
- `creatingNewHeatsUtls.ts` — Race 1 serpentine seeding + Heat Movement Tables
  (filename typo `Utls` is intentional, see §10).
- `discardConfig.ts` — per-event discard profile lookup. The pure parsing/count
  logic lives in `src/shared/discardProfile.ts` and is re-exported here, so the
  renderer preview and the backend compute discards from one implementation.
- `finalLeaderboardOrder.ts` — final-leaderboard ordering: SHRS 5.5 fleet
  precedence + the SHRS 1.5 qualifying-score fallback.
- `scoreStatus.ts` — status vocabulary, `normalizeScoreStatus`,
  `getScoringPenaltyPoints` (RRS 44.3c/T1), `compareSeededRows` (SHRS 5.3 order).
- `overallTieBreak.ts` — loads one boat's qualifying and final scores for the
  overall tie-break; the rules and the overall ranking (`rankOverallStandings`,
  used by `readOverallLeaderboard`) are in `shared/scoring/overall.ts`.
- `explainTieBreak.ts` — human-readable tie-break explanations.
- `finalSeriesEligibility.ts` — `getFinalSeriesEligibility` (whether the Final
  Series can start; rule 4.3 window detection).
- `leaderboardRecompute.ts` — rebuilds `Leaderboard` / `FinalLeaderboard` from
  raw `Scores`.
- `heatQueries.ts` — shared reads (`getLatestQualifyingHeats`,
  `getRaceCountForHeat`).
- `eventSettings.ts` — per-event SHRS configuration on the Events row:
  qualifying assignment mode (3.1/3.2), heat overflow policy and
  `SHRS_MAX_BOATS_PER_HEAT` (2.3), and the discard-profile lock (5.4). The
  allowed values (`QualifyingAssignmentMode`, `HeatOverflowPolicy`) and their
  one normalizer are in `shared/eventSettings.ts`; the event writes and these
  reads both use it.
- `finalFleetPlan.ts` — `planFinalFleets`: the Final Series fleet split (SHRS
  4.1/4.2/2.3: withdrawn boats last, overflow policy, never more fleets than
  boats, sizes as equal as possible with the earlier fleets taking the
  remainder) from the qualifying ranking, as boat ids per fleet or a plain
  refusal. `startFinalSeriesAtomic` reads, plans and writes.
- `nextRoundPlan.ts` — `planNextRound`: round number, heat names and every
  boat's heat for the next qualifying round (Heat Movement Table for
  progressive events, carry-forward for pre-assigned ones), or the refusal when
  nothing could be assigned. `createNewHeatsBasedOnLeaderboard` reads, plans
  and writes.
- `submittedRaceScore.ts` — `scoreSubmittedBoat`: one scoring-screen entry to
  position / points / status (FINISHED keeps its place; ZFP/SCP/T1 keep the
  place and add the penalty; every other code takes largest heat + 1, SHRS
  5.2). `submitHeatRaceScoresAtomic` works every boat out before it opens the
  transaction.
- `heatWriters.ts` — the two prepared INSERTs every heat builder uses.
- `retryWhenBusy.ts` — retry a write a few times while SQLite reports
  `SQLITE_BUSY` (insertSailor, insertEvent).
- `raceScoring.ts` — every write to `Scores` for a single race:
  `applyRaceColumnState` (stores a whole corrected race from the leaderboard's
  Save, RRS A6.1/A6.2/A7, SHRS 5.2, 3.1.5), `applyRaceTieScoring` (RRS A7),
  `getMaxHeatSize`, `seedRaceWithDefaultDnsScores`,
  `ensureCompleteRaceScoresForEvent` (DNS repair +
  `ensureDncScoresForMissedQualifyingRaces`, RRS A5.1), `rescoreRace`.
- `raceSeeding.ts` — reading a race's results back in SHRS 5.3 recording order
  for the next round's heat movement (`getRankedBoatsInHeatForRace`,
  `getLatestRaceRowsForHeats`, `getOddEvenMovementAdvisory`).
- `assignmentShield.ts` — SHRS 3.1.5 per-boat freeze of the pre-protest
  finishing order (`captureRaceAssignmentSnapshotIfMissing`,
  `getAssignmentRowsForHeatRace`); persistence lives in
  `raceAssignmentSnapshot.ts`.
- `fleetTotals.ts` — `buildAdjustedFleetLeaderboard`, the SHRS 4.3
  fleet-assignment ranking adapter over `shared/fleetAssignment.ts`.
- `eventSnapshot.ts` — full per-event export/restore. The table list here is
  the definition of "an event's data"; add new event-scoped tables to the
  export, the restore's delete, and the restore's reinsert together.
- `raceAssignmentSnapshot.ts` — SHRS 3.1.5 pre-protest assignment cache +
  persistence. The in-memory map is read BEFORE the table, so anything that
  rewrites the table behind it must call `invalidateAssignmentSnapshotCache()`
  or the stale shields keep winning (restoring a backup did exactly that).

Shared (renderer + main) — one definition per rule, imported by both processes:

- `fleetAssignment.ts` — `computeAdjustedFleetTotals` (rule 4.3).
- `subgroups.ts`.
- `eventSettings.ts` — `QualifyingAssignmentMode`, `HeatOverflowPolicy` and
  their normalizers (the vocabulary of an event's SHRS settings).
- IPC result types, one definition for both processes: `scoring/tieBreakTypes.ts`
  (the tie-break explanation), `finalSeriesEligibility.ts`, `importSailors.ts`,
  `scoring/explain.ts` (`BoatScoreExplanation`). The renderer's names for them
  in `renderer/types.ts` are aliases; where the renderer must tolerate partial
  results it derives a looser type from the shared one. When a handler returns
  a new shape, define it in `src/shared` and import it on both sides.
- `scoringPenalty.ts` — RRS 44.3(c)/T1 points (20% / 30% of the DNF score, to
  the nearest tenth as in RRS 2025–2028, capped at the DNF score),
  and `scoringPenaltyStatuses`.
- `discardProfile.ts` — SHRS 5.4 profile parsing + exclusion count.
- `fleetNames.ts` — SHRS 4.1 fleet naming and 5.5 precedence (`fleetRank`
  orders "Fleet 5"+ too, not just Gold/Silver/Bronze/Copper).
- `sailOrder.ts` — SHRS 5.3 / 3.1(iv) tie order: national letter then numeric
  sail number.
- `raceTieScoring.ts` — the RRS A7 place walk: tied boats share the averaged
  points of the places they occupy, position-keeping penalties consume a slot
  without being re-scored.
- `raceColumnEdit.ts` — what one result correction does to a whole race. A
  correction gives the race the result it would have had if the corrected
  finish had been entered on the scoring screen: a new place MOVES the boat
  (the boats in between make room; two moves swap two boats); a code with no
  finishing place (DNF, OCS, BFD, UFD, DSQ, RET, …) on a boat that had one
  moves every boat behind her up (RRS A6.1, and the same for every other
  no-place code); a place for a boat that had none pushes the boats from that
  place down; RDG/DPI change no other boat (A6.2, A10); ZFP/SCP/T1 keep the
  place. `scoreRaceColumn` scores a column from places and codes (A7 averages,
  44.3(c), SHRS 5.2) and never compacts a gap. There is no "Shift other boats"
  toggle any more and no duplicate-place dialog: off, the toggle left
  duplicates/gaps, BFD/OCS left the boats behind a place too low, and Save
  replayed edits in a different order from the screen, so the saved race
  could differ from the one shown. The leaderboard's Save now sends every
  touched race WHOLE (`{ raceId, cells }`) and the main process stores it via
  `applyRaceColumnState`, re-scoring it with `scoreRaceColumn`: what is shown
  is what is saved. `saveLeaderboardRaceResultsAtomic` takes
  `(event_id, operations, updateFinalLeaderboard)` and accepts nothing but
  whole races (an operation without `cells` is refused); the old per-boat
  `updateRaceResult` / `applyRaceResultUpdate` path and its `shift_positions`
  flag are gone. The preview (`handleRaceChange`) and the main process both
  call this module; do not reintroduce a local copy.

When extending the handler, keep this pattern: pure logic goes in a
`functions/` module (so it is unit-testable), the handler only wires IPC.

Observed rule implementation details:

- Supported statuses include `FINISHED`, penalties (`DNF`, `DNS`, `DSQ`, `OCS`, `ZFP`, `RET`, `SCP`, `BFD`, `UFD`, `DNC`, `NSC`, `WTH`, `DNE`, `DGM`, `DPI`) and redress variants (`RDG1`, `RDG2`, `RDG3`).
- Exclusion count logic:
  - `<4` races: 0 exclusions
  - `4-7`: 1 exclusion
  - `>=8`: `2 + floor((races - 8) / 8)`
- Some statuses are non-excludable (for example `DNE`, `DGM`).
- Tie-break logic has dedicated handling for shared-race and multi-heat scenarios.

When changing scoring logic, update or add tests first.

### Full rule reference (SHRS 2026-1 + RRS Appendix A)

This is the source-of-truth summary of the scoring spec the app implements.
Rule numbers are SHRS unless prefixed `RRS`.

General / series structure

- 1.1 — Two or more heats per race ⇒ event has a **Qualifying Series** then a
  **Final Series**. A single heat ⇒ the event is sailed as one fleet, scored
  like a Qualifying Series, and sections 2–4 do not apply. (Final-series start is
  gated by `getFinalSeriesEligibility`; `SINGLE_FLEET` when `< 2` heat groups.)
- 1.5 — If **no Final Series races are completed**, boats are ranked by their
  Qualifying Series score. Enforced in `finalLeaderboardOrder.ts`: with no final
  race sailed every `total_points_final` is 0, so the sort key switches to the
  qualifying score.
- 1.6 — RRS T1 (post-race penalties) applies; modelled by the `T1` status.

Number/size of heats

- 2.1–2.2 — As few heats as possible; sizes as equal as possible.
- 2.3 — **Max 20 boats per heat** (`SHRS_MAX_BOATS_PER_HEAT` in
  `shared/heatSizing.ts`; overflow governed by `shrs_heat_overflow_policy`).

Qualifying assignment (`creatingNewHeatsUtls.ts`)

- 3.1 — **Progressive**: Race 1 seeds top-down `1,2,3,4,5,5,4,3,2,1`
  (`assignBoatsToInitialHeatsSerpentine`); later races use the Heat Movement
  Table (`getNextHeatIndexByMovementTable`). Non-finishers ordered
  `DNF, RET, NSC, OCS, DNS, DNC, UFD, BFD, (DSQ)`; ties by alphanumeric
  national-letter + sail number (`shared/sailOrder.ts`).
- 2.2 — heats "as equal as possible" means within one boat, and **nothing pins
  the extra boat to Heat A**. The 3.1(1) walk drops it wherever it stops (10
  boats / 3 heats → A=3, B=3, C=4), and the movement table then rotates the odd
  heat between rounds. The PDF says so itself, above the Heat Movement Tables:
  "the largest heat size could move from one heat to another". Only 4.1 orders
  group sizes, and only for final fleets (Silver ≤ Gold ≤ …), which
  `startFinalSeriesAtomic` implements by handing the remainder to the earliest
  fleets. Do not "fix" qualifying to match it.
- `createNewHeatsBasedOnLeaderboard` **throws** when a round yields no
  assignments. It used to fall back to `assignBoatsToNewHeatsZigZag`, which
  re-seeded the fleet from scratch and so discarded the finishing positions
  3.1(2) requires — a fabricated draw published as if it were sailed. Removed;
  an empty assignment set is a data fault and must surface as one.
- 3.1.5 — **Only protest-committee decisions** are shielded from changing heat
  assignments (`protestCommitteeStatuses` in `scoreStatus.ts`). An ordinary
  race-office correction may change them, and a boat transfer invalidates the
  affected heats' snapshots (`clearAssignmentSnapshotsForHeat`).
  The leaderboard save marks each cell the user typed in (`edited`); only
  those are decisions or corrections (`decideAssignmentShields` in
  `raceScoring.ts`). A decision freezes the pre-save place of every boat that
  moved with it (a DSQ promotes the boats behind her, RRS A6.1); a correction
  un-shields only the edited boat.
- 3.2 — **Pre-assignment**: equal size/ability, published before racing.
  (`shrs_qualifying_assignment_mode` = `progressive` | `pre-assigned`.)

Final Series (`calculateFinalBoatScores.ts`, `shared/fleetAssignment.ts`)

- 4.1 — Fleet naming and precedence live in `shared/fleetNames.ts`; fleets past
  Copper are named "Fleet 5"… and rank 5th… (never a shared catch-all rank).
- 4.1 — Same number of fleets as qualifying heats (may shrink if withdrawals
  allow). Fleets `Gold, Silver, Bronze, Copper`; sizes as equal as possible with
  `Gold >= Silver >= Bronze >= Copper`.
- 4.2 — Fleet assignment by qualifying ranking (best ⇒ Gold); withdrawn boats go
  to the lowest fleet.
- 4.3 — If the Qualifying Series has **>5 and <8 completed races (6 or 7)**, a
  boat's **second-worst** race is temporarily excluded **for fleet-assignment
  ranking only** (`rule43Applies` in `getFinalSeriesEligibility`;
  `computeAdjustedFleetTotals`). Does not affect series scores.
- 4.4–4.5 — A final race = one heat per fleet; fleets may sail different numbers
  of races.

Scoring (`calculateBoatScores.ts`, `scoreStatus.ts`)

- RRS A4 — Low Point: finishing place = points (1st⇒1, …).
- RRS A6.1 — A boat disqualified or retiring **after finishing** is removed from
  the finishing order and every boat behind her **moves up one place**. A
  correction to any other code with no finishing place does the same (see
  `raceColumnEdit.ts`).
- RRS A7 — **Race ties**: tied places share the summed points equally. Enterable
  from the scoring screen via the per-row tie ("=") control, which submits a
  shared place for `applyRaceTieScoring` to average.
- RRS A5.1 / 5.3 — **Every entered boat is scored for every race in the
  series.** A boat who sailed in no heat for a round (added mid-event via
  `assignBoatToHeat`, or entered and never started) is scored **DNC** at
  (largest heat + 1), not left without a row
  (`ensureDncScoresForMissedQualifyingRaces` in `raceScoring.ts`, run as part of
  `ensureCompleteRaceScoresForEvent`, and on round completion inside
  `submitHeatRaceScoresAtomic`). A series race is keyed by (heat round from the
  name suffix, `race_number`), and only backfilled once EVERY heat of that
  round has sailed it. Qualifying only: in the Final Series a
  boat races one fleet (4.1) and fleets may sail different numbers of races
  (4.5), so a Gold boat must not collect DNCs for Silver's races. Without this,
  a short score vector makes `calculateBoatScores` (capped) and
  `computeAdjustedFleetTotals` (uncapped) disagree about the same boat, and the
  uncapped one discards her only score and ranks her **first into Gold**.
- 5.2 (changes RRS A5.2) — A boat scored DNS/DNF/DSQ/etc. gets **(boats in the
  largest heat) + 1** points — NOT boats entered in the series.
- 5.3 — Recording order: finishers by place, then
  `DNF, RET, NSC, OCS, DNS, DNC, WTH, UFD, BFD, DSQ, DNE`; ties alphanumeric.
  Position-keeping penalties (`ZFP`, `SCP`, `T1`) keep the boat's finishing
  place (`compareSeededRows`, `scoringPenaltyStatuses`).
- 5.4 — **Discards** (per series, Qualifying and Final counted independently):
  0 below 4 completed races, 1 at 4–7, 2 at 8–15, then +1 per additional 8.
  Non-excludable: `DNE`, `DGM` (RRS 90.3(b)). Configurable per event before the
  first warning signal (`shared/discardProfile.ts`); an explicitly **empty**
  threshold list means **never discard**. The count is series-wide — fleet-wide
  in the Final Series, since 5.1 scores each fleet separately.
  `capExcludeCountForBoat` additionally caps it per boat so a boat always keeps
  one score. **That cap is an app-level guard, not rule text** — 5.4 says
  "excluding her worst score" with no exception for a boat who has only one.
  It is a backstop for a boat whose score vector is shorter than the series,
  which the DNC backfill below should now prevent; if it ever fires, the missing
  scores are the bug. Use the same capped count for a boat's total AND her A8.1
  tie-break vector.
- 5.5 — Overall event score = Qualifying + Final series scores. Lowest in Gold
  wins; fleets rank `Gold > Silver > Bronze > Copper > Fleet 5 > …` regardless
  of raw points (`fleetRank`).
- 5.6 — Redress averages computed separately per series: an RDG2 average covers
  ONLY races in the same series as the redressed cell — never a Q+F pool.
- RRS A9 (2025–2028) redress, `shared/redress.ts`: RDG1 = average of all
  other races in the series, RDG2 = average of PC-chosen races (stored in
  `Scores.rdg_race_ids`, schema migration 3), RDG3 = PC-set points (never
  recomputed). Averages include discarded races, EXCLUDE other RDG1/RDG2
  races, round to the tenth (0.05 up), and are LIVE: every leaderboard
  recompute re-derives them (`refreshRedressAverages`). The renderer preview
  uses the same function.
- Series ties that A8 cannot break (identical scores) SHARE the place
  (1, 2, 2, 4) — `findUnbrokenTies` + `assignPlaces` in `shared/scoring/ranking.ts`,
  used by qualifying, final and overall standings.
- 5.7 — **Event ties**:
  - (i) Single-heat events: RRS A8.1 then A8.2.
  - (ii) Multi-heat events: A8.1/A8.2 except — (1) only races where the tied
    boats were in the **same heat** count; (2) **excluded scores ARE used**
    (changes A8.1); (3) resolve the higher-placed tie before the lower; (4) if
    the tied boats never shared a heat, use plain RRS A8.1/A8.2.
  - "Single-heat" is an **event-level** property: true only when every boat
    raced the identical set of races (`detectSingleHeatEvent`).

RRS A8 detail (tie-break primitives)

- A8.1 — Compare each boat's scores best→worst; first difference wins; excluded
  scores NOT used.
- A8.2 — If still tied, compare last race backward; excluded scores ARE used.

## 6. Event Locking (Removed)

Event locking was removed entirely (June 2026):

- No `lockEvent`/`unlockEvent` IPC handlers, no lock checks in mutating handlers, no lock UI.
- New databases no longer create `Events.is_locked`; older databases may still
  carry the column, but nothing reads or writes it.
- Do not reintroduce lock checks. (The separate discard-profile locks,
  `shrs_discard_locked_*`, still exist and are unrelated.)

## 7. Commands Agents Should Use

Run from repo root.

- Install deps: `npm install`
- Dev app: `npm start`
- Build/package Windows: `npm run package`
- Lint: `npm run lint`
- Lint fix: `npm run lint:fix`
- Unit tests: `npm run test:unit` (curated subset in `jest.unit.config.ts`)
- Full tests: `npm run test:full` (auto-discovers every `*.test.*`)

If native module issues occur after dependency changes:

- `npm run rebuild`

Tooling notes:

- A **pre-commit hook** (husky + lint-staged) runs `eslint --fix` on staged
  JS/TS and `prettier --write` on staged json/css/md. It blocks commits on lint
  **errors** but not on the existing `no-console` warnings. Installed via the
  `prepare` script on `npm install`; hook lives in `.husky/pre-commit`.
- DB-migration safety tests (`Scores.uniqueIndex.migration.test.ts`,
  `Heat_Boat.uniqueIndex.migration.test.ts`) run the migration SQL against a
  real in-memory SQLite via the built-in `node:sqlite` module — no `python` and
  no native `better-sqlite3` build. (The Scores test previously shelled out to
  `python` and failed without it on PATH; that dependency has been removed.)

## 8. Test Map

High-signal tests in `src/__tests__` include:

Scoring engine / rules:

- `scoringCore.series.test.ts` (the core on plain data, and the leaderboard
  screen agreeing with it on 2,000 random boats)
- `scoringCore.characterisation.test.ts` (150 seeded random events through
  real SQLite; its snapshot pins results, so a refactor must leave it unchanged
  and a rule fix updates it in its own commit, with the reason);
  `scoringCore.overall.characterisation.test.ts` does the same for the overall
  standings, and `scoringCore.overall.test.ts` tests that core on plain data
- `calculateBoatScores.test.ts`, `calculateFinalBoatScores.test.ts` (their
  mocks describe each boat as ONE list of races —
  `fixtures/scoresTableMock.ts` — as the database does)
- `SHRS_comprehensive.test.ts` (exhaustive rule walk-through)
- `scoreStatus.test.ts` (status normalization, penalty math, 5.3 order)
- `leaderboardRecompute.test.ts` (recompute glue: query/persist/transaction)
- `leaderboardStatusCodes.test.ts`, `penaltyOrder.test.ts`
- `creatingNewHeatsUtils.test.ts` (note: tests the `...Utls.ts` source)

Handler / integration:

- `finalFleetPlan.test.ts` (the fleet split: withdrawn last, odd sizes, more
  fleets than boats, oversize with and without confirmation),
  `nextRoundPlan.test.ts` (movement table, pre-assigned, refusals),
  `submittedRaceScore.test.ts` (place / points / status per code),
  `eventSettings.test.ts`, `retryWhenBusy.test.ts`,
  `DBManager.failStartup.test.ts` (startup advice per failure kind and
  `classifyDatabaseFailure`)
- `HeatRaceHandler.createNewHeats.test.ts`,
  `HeatRaceHandler.overallTieBreak.test.ts`,
  `HeatRaceHandler.submitScoresAtomic.test.ts`,
  `HeatRaceHandler.saveLeaderboard.integration.test.ts` (the leaderboard Save
  through the real handler: SHRS 3.1.5 shields, cache rollback, atomicity),
  `applyRaceColumnState.integration.test.ts` (what Save stores, per rule),
  `HeatRaceHandler.startFinalSeriesAtomic.test.ts`,
  `HeatRaceHandler.finalSeriesEligibility.test.ts`
- `explainTieBreak.test.ts`, `compareUtils.test.ts`
- Published-results replays: `euroIom2025.published.test.ts` (SHRS) and
  `iomWorlds2024.published.test.ts` (HMS event; checks discards, totals and
  order only — its sheet has one documented nett error, ARG 63).
- `ScoringInputComponent.test.jsx`, `useLeaderboard.scoring.test.jsx`

`npm run test:unit` runs every `src/__tests__/**/*.test.*` except the
template's `App.test.tsx` (needs a build). CI runs typecheck, lint and
`test:unit` on Node 22 and will not publish a release if they fail. Tests avoid
the native `better-sqlite3` build. Prefer real SQLite via node:sqlite
(Node >= 22.5) and `createSqliteDbMock` in `fixtures/eventLifecycleSchema.ts`
over SQL-sniffing mocks: a hand-built fixture whose shape production never
writes (race_number = round) hid the DNC backfill bug for a release.

## 9. Fast Change Workflow

For most feature/fix requests, do this in order:

1. Identify if change touches renderer UI, IPC contract, handler logic, or DB schema.
2. Update types/contracts first (`preload.ts`, renderer usage, handler signatures).
3. Implement logic change in handler/functions.
4. Add or update tests in `src/__tests__`.
5. Run targeted tests, then broader test set.
6. Run lint when touching multiple files.

## 10. Known Quirks To Avoid Mistakes

- File name typo is intentional in codebase: `creatingNewHeatsUtls.ts` (not
  `Utils`). Its test file IS spelled `creatingNewHeatsUtils.test.ts`.
- Handlers are registered by import side effects; deleting imports can silently break IPC.
- Register IPC handlers with `handle()` from `ipcHandlers/handle.ts`, not
  `ipcMain.handle` directly. It logs the channel name and rethrows, so a
  handler body needs no try/catch just to report a failure. Keep an inner
  try/catch only when the catch does real work (SQLITE_BUSY retry, snapshot
  rollback, per-row error collection).
- Returning `false` from preload methods is converted to thrown errors by wrapper.
- App uses hash routing, so route handling assumptions must match `HashRouter`.
- Destructive work belongs in ONE handler, not a renderer sequence. "Recreate
  Heats" was a delete-heats call then `createInitialHeatsAtomic`; the
  destructive half ran first, so a rejected create left the event with no heats.
  `recreateInitialHeatsAtomic` plans before it wipes, in one transaction.
  `planInitialHeats` / `insertPlannedInitialHeats` exist for exactly this split.
- Renderer `raceHappened`-style state can be stale — never let it be the only
  guard on a destructive channel. `removeBoatFromEvent` and
  `recreateInitialHeatsAtomic` re-check server-side.
- Dead channels were removed (`insertHeat`, `insertRace`, `insertScore`,
  `updateScore`, `deleteScore`, `readAllScores`, `deleteHeatsByEvent`,
  `undoLastScoredRace`, `updateRaceResult`, `updateEventLeaderboard`,
  `updateFinalLeaderboard`): the app never called them and several wrote scores
  without checking whether the heat was closed. The history labels in
  `shared/history/describe.ts` and the revertable list in
  `shared/history/revert.ts` still name them, because existing databases hold
  `ChangeActions` rows recorded under those channels. Do not re-add a score
  write path outside `submitHeatRaceScoresAtomic` and
  `saveLeaderboardRaceResultsAtomic`.
- Async actions that mutate rounds go through `useExclusiveAction` (renderer
  hook). The ref inside it is load-bearing: two clicks in the same tick both
  read `busy === false` from state. `busy` only drives `disabled`.
- The handlers are intentionally thin wiring: the logic lives in
  `src/main/functions/`. Add new pure logic there, not inline in the handler.
  This had drifted twice — 718 lines of domain helpers had accumulated back in
  the handler (moved out in Sept 2026), and later the fleet split, the
  next-round assignment and the per-boat score were inline in their handlers
  (now `planFinalFleets`, `planNextRound`, `scoreSubmittedBoat`). The heat/race
  channels are split by area (`HeatHandler`, `ScoringHandler`,
  `StandingsHandler`, `FinalSeriesHandler`, `SnapshotHandler`); a helper two of
  them need goes to `functions/`, never copied.
- `handle()` is generic over the listener's parameters: an unannotated
  parameter arrives as `unknown`, so convert ids once at the top of the handler
  (`const event_id = Number(raw_event_id)`) and pass numbers on. Do not
  reintroduce `any` in `src/main`.
- `functions/` modules import `db` directly from `DBManager` (not passed in),
  and only call `db.prepare` inside functions — never at module top level, so
  importing a module never touches the database.
- When adding a preload channel, update three places: the `SQLITE_CHANNELS`
  list in `preload.ts` (the `Channels` union and the invoker map are both
  derived from it, so they cannot disagree), the handler's `handle()`
  registration, and the renderer `api/db` wrapper. The wrapper is not
  duplication — preload types every method as `Promise<any>`, and `api/db.ts`
  is where the real return types live.
- The global leaderboard feature is removed from the UI (Sept 2026). The route,
  both nav entry points, the page, the component and the
  `readGlobalLeaderboard` / `updateGlobalLeaderboard` channels are gone; users
  could previously navigate to a page that existed only to say the feature was
  on hold. The `GlobalLeaderboard` table is deliberately KEPT in `DBManager.js`,
  and `deleteEvent` still clears its rows, so reviving the feature needs no
  migration.

- `Races.race_number` counts races WITHIN one heat, so nearly every
  qualifying race is `race_number = 1` (each round is a new set of heats).
  Never group qualifying races by `race_number` alone; the round is the heat
  name suffix (`getHeatRoundFromName`, "Heat B3" -> 3).
- Qualifying writes are guarded server-side (`functions/seriesGuards.ts`): no
  scoring or undoing a qualifying heat once the Final Series has started, or
  once the next round was built from it (undo the redistribution first).
- Undo deletes a race's `RaceAssignmentSnapshots` rows INSIDE its transaction,
  before the race (FKs enforced, no cascade).
- Late entries: a boat entered after heats exist is in no heat. The heats view
  shows `UnassignedEntriesNotice`; `insertHeatBoat` only accepts an entered
  boat into a current-round qualifying heat that has not raced.
- Sailor/boat edits intentionally apply everywhere, past events included
  (one record per sailor/boat). Do not add per-event entry snapshots.
- Point totals go through `sumPoints`/`roundPoints` (`shared/points.ts`). A
  plain sum of tenth-point RDG scores carries float noise, equal totals stop
  comparing equal, and the SHRS 5.7 tie-break is skipped.

- **Independent oracle tests** (`scoringOracle.integration.test.ts`,
  `leaderboardEdit.wysiwyg.integration.test.jsx`, rules in
  `fixtures/scoringOracle.ts`) score random events from the rule text alone,
  sharing no scoring code with the app, and compare after every round: race
  points (A4/A7, 44.3(c) to the tenth, SHRS 5.2), discards (5.4), places and
  two-boat ties (5.7), race-1 seeding and the Heat Movement Tables (3.1, mixed
  nations), undo/re-score, the fleet split (4.1/4.2/4.3), final scoring per
  fleet and the overall (5.5); and that a leaderboard correction saves exactly
  what was shown and equals entering the corrected finish. `ORACLE_SEEDS` /
  `EDIT_SEEDS` raise the number of random events (default 40 / 30).
- **Go back to a point in the history** (`restoreEventToHistoryPoint`,
  `functions/restoreToHistoryPoint.ts`, migration 6 adds
  `ChangeActions.restores_to_action_id`): puts back every journalled change
  of the event made after the chosen action, newest first, in one
  transaction, then rebuilds the standings (both caches are cleared, so going
  back past the final series start leaves no final standings). Each row must
  be exactly as the change being put back left it, or nothing changes (a row
  altered outside the journal, or a boat since deleted from the app, is
  refused with a plain message). A `before-going-back-*` backup is written
  first (never pruned); if it fails nothing is changed. Going back is itself
  an action, undone by going back to the entry just before it ("Undo going
  back"). Not taken back: sailor/boat details (global by design).
  `shared/history/restore.ts` works out which entries are in effect
  (`undoneActions`, following undo chains and earlier go-backs) and what a
  go-back would take back and bring back (`restorePreview`), which the
  dialog lists before asking. Afterwards the event, scoring and leaderboard
  pages reload (`useEventDataChanged`); a scoring view whose heat changed is
  closed, and a leaderboard edit started before is refused on Save.
  `restoreToHistoryPoint.integration.test.ts` checks, over random sessions,
  that going back to any earlier entry gives exactly the state recorded then,
  that another event is untouched, and that "Undo going back" returns.

- **Shared sail numbers** (`shared/boatKeys.ts`): sail numbers are national,
  so ITA 12 and CRO 12 can both race. Heats are built by boat_id; in scoring a
  boat is named by her sail number where it is unique in the heat, else by
  national letters + number ("ITA 12"; "ita12" is accepted). Only the same
  letters AND number twice (or two blank sail numbers) is refused — at entry
  (`associateBoatWithEvent`), heat creation and scoring. Earlier any repeated
  number refused to create heats or score the heat.
- **Chaos test** (`chaos.integration.test.ts`, `CHAOS_SEEDS`, default 25):
  random sessions of every race-office action through the real handlers.
  Only the guards listed in it may refuse; after each step foreign keys,
  one score per boat per race, places inside the race, every race scored by
  `scoreRaceColumn`, and every total vs its races and discards must hold. It
  found: moving a boat out of a heat that had raced (she sailed the round
  twice; `transferBoatBetweenHeats` now refuses raced heats), a correction
  that put a boat past the last place (redress gap; `raceColumnEdit` now
  fills the nearest free slot), and an undo from the history that left two
  boats on one place unaveraged (`revertHistoryAction` now calls
  `rescoreRace`).
- **Every failure reaches the user in words they can act on.** The rule:
  - Main process: `handle()` (`src/main/ipcHandlers/handle.ts`) passes every
    error through `explainError` (`src/shared/errors/explainError.ts`):
    the app's own refusals (plain `new Error('…')`) go through unchanged;
    SQLite failures (busy, disk full, read-only, I/O, damaged file, foreign
    key, unique, not null) become plain sentences; anything else (TypeError,
    a technical message) becomes "unexpected problem … note the code XXXX".
  - Write refusals for the race officer: say what did not happen, why, and
    what to do. Name heats, races and boats as the screen does (`raceLabel`,
    `boatLabel` in `src/main/functions/labels.ts`), never by database id.
    `isTechnicalText` lists what must never appear (ids, null/undefined,
    SQLITE, stack frames).
  - Every error, with its code, goes to `logs/errors.log` next to the data
    file (`src/main/errorLog.ts`, capped at 1 MB, previous kept as
    `errors.1.log`); Help menu > Open Error Log opens it. Window errors are
    sent there over `app:logError`.
  - Renderer: `reportError(title, error)` shows the title plus the reason
    (`describeError`); use `getErrorMessage(error)` (strips Electron's
    "Error invoking remote method" wrapping) whenever a message is matched
    or shown, never `error.message` directly.
  - Automatic-backup failures are told to the window (`app:backupStatus`)
    and stay on screen until backups work again.
  - Only one copy of the app runs at a time (`requestSingleInstanceLock`;
    skipped when `SCORING_APP_DB_PATH` is set, as in the e2e tests).
  - Tests: `staleScreen.errors.integration.test.ts` calls every channel with
    ids that no longer exist and fails on any technical or "unexpected"
    answer; the chaos test fails on a refusal worded technically.
- The main process logs uncaught errors instead of dying, and reloads the
  window if the page process dies.

- **Outdoor readability is a requirement**: the app is used by race officers
  (often 60+) on cheap laptops in sunshine. Root font is 17px; secondary text
  and borders are dark tokens (`--text-secondary`, `--border-strong`); toasts
  are top-centre with dark text; the window opens maximised. Do not
  reintroduce pale greys, small uppercase labels or bottom-right toasts.
  `UI_TOUR=1 npx playwright test e2e/ui-tour.spec.ts` seeds a 30-boat event
  and saves a screenshot of every screen (to `e2e-ui-tour/`) for review.
- **Typed results are never corrected silently.** Leaderboard cells and the
  scoring page's place field are text inputs (a `type="number"` field changes
  on the mouse wheel / arrow keys). `utils/raceCellInput.ts` decides what is
  valid: a place is a whole number 1..boats in that race; RDG3/DPI points are
  > 0, <=99, one decimal, comma accepted. Invalid input stays red with the
  > range, is not applied, and Save refuses naming each cell
  > (`editValidity.tsx` context -> `useLeaderboard.invalidCells`). The main
  > process also refuses a place past the last boat of the race
  > (`applyRaceColumnState`).

## 11. What To Search Only If Needed

Only run repo-wide search if needed after using this file.

- IPC channel usage: search by channel name string.
- SQL writes: search for `.run(` in `src/main/ipcHandlers`.
- Score status handling: search `status`, `penalty`, `RDG`, `exclude` in `ScoringHandler.ts` and `functions/scoreStatus.ts`.

## 12. Definition Of Done For Agent Changes

A change is complete when all are true:

- Behavior change implemented in the correct layer.
- Related tests added or updated.
- Affected tests pass.
- No new lint/type issues introduced by the change.
- IPC and preload contracts remain consistent across main and renderer.

## 13. Claude Compatibility

This file is the single source of truth for all coding agents (Claude and GPT).
There is no separate `CLAUDE.md`; Claude reads `AGENTS.md` directly.
