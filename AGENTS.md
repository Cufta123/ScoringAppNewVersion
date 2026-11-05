# AGENTS.md

This file is the project memory and operating guide for coding agents (GPT and Claude).
Use this document first. Only search the repo when this file does not answer the question.

## 1. Mission And Product

- Product: IOM Regatta Manager desktop app.
- Domain: event setup, sailor/boat management, heat/race scoring, leaderboards, final series handling.
- Stack: Electron (main), React (renderer), TypeScript + JavaScript, SQLite via better-sqlite3.
- **The rules live in `packages/regatta-core`; the app must not implement
  SHRS / RRS scoring.** Every rule of SHRS 2026-1 and RRS 2025-2028
  Appendix A (points, codes and their order, penalties, redress, discards,
  ties, what a correction does to a race, heat counts and sizes, seeding and
  recording order, fleet names, next step) is the library's, imported from
  `regatta-core` by the main process, the renderer and the tests alike. The
  app keeps storage, the projection, the conversion of old records
  (`eventLog.ts`, `raceSheet.ts`), checks of what was typed (a place
  1..boats in the race, a known code, committee points > 0 and <= 99),
  display and IPC. A rule the library lacks is added to the library, with
  tests, not written in `src/`. ESLint enforces it: `src/` cannot import the
  removed rule modules (`raceColumnEdit`, `scoringPenalty`, `statusPoints`,
  `scoring/discards`, `redress`, `sailOrder`, `fleetNames`, `heatSizing`,
  `points`, `penaltyOrder`, `raceSeeding`) nor declare a function under
  their old rule names (`REMOVED_RULE_MODULES` / `REIMPLEMENTED_RULES` in
  `.eslintrc.js`).

## 2. First Places To Look

- Main process bootstrap: `src/main/main.ts`
- IPC registration: `main.ts` imports each handler module for its side effects
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
  - `src/main/ipcHandlers/ProblemReportHandler.ts` — Help > Report a problem
    (see "Problem reports" in §10)
  - `src/main/ipcHandlers/ExportHandler.ts` — saving and printing the exported
    documents (see "Exported documents" in §10)
- **The scoring rules live in `packages/regatta-core`** (SHRS 2026-1 + RRS
  2025-2028 Appendix A): a log of decisions in, heats, scores, standings and
  explanations out; no database, no UI. The app stores each event's log and
  asks the library for everything else (§4, "The event is its decision
  log"). Its own README, tests (`cd packages/regatta-core && npx jest`) and
  rule decisions (`docs/parity/`); how the app was switched to it:
  `docs/regatta-core-switch.md`.
- Pure/domain logic (extracted out of the handlers): `src/main/functions/`
  (see §5 for the full module map).
- Cross-process helpers: `src/shared/`. Code in `src/shared` takes data and returns results: it must
  not import main-process, renderer, database, Electron, React or Node code
  (an ESLint rule enforces this), so any future viewer can run it unchanged.
- IPC contract (every channel's arguments and result): `src/shared/ipc.ts`
- Preload bridge and exposed API: `src/main/preload.ts`
- Renderer DB access wrapper: `src/renderer/api/db` (re-exports `eventDB`,
  `heatRaceDB`, etc. over `window.electron.sqlite.*`).
- Renderer server state (TanStack Query, "the one refresh rule", §3):
  `src/renderer/api/queryClient.ts` (defaults), `queryKeys.ts` (every key),
  `queries.ts` (every read as query options), `writes.ts` (`useWrite`: every
  write, and what it invalidates).
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
- Imports all handler modules for side-effect registration.

### Renderer process

- Uses `HashRouter` with these routes:
  - `/`
  - `/event/:name`
  - `/event/:eventName/heat-race`
  - `/event/:eventName/leaderboard`
- Uses `window.electron` API from preload (via the `src/renderer/api/db` wrapper).

### Renderer data: the one refresh rule (TanStack Query)

- **One `QueryClient`** (`api/queryClient.ts`), provided at the app root
  (`App.tsx`). Defaults for local data only this window writes:
  `staleTime: Infinity` (an answer is fresh until a write says otherwise;
  nothing is read again because a page mounted or the window got focus, which
  would fight an edit), `retry: false` for queries and mutations (a failure is
  told in words — `useReportQueryError` → `reportError`, or the screen's own
  error state — never retried silently), and `networkMode: 'always'` (the
  default pauses everything while the browser says it is offline: a race
  officer at sea has no internet).
- **Keys in one place**, `api/queryKeys.ts`. Everything about an event is
  under `['event', eventId, …]` (entries, heats, the heat list with boats and
  race counts, a heat's boats / races, the three standings, max heat sizes,
  eligibility, explanations, tie-breaks, history, conversion report, export
  logo), so one invalidation of `queryKeys.event(id)` refreshes all of it.
  Global: `['events']` (its rows carry flags worked out from the races) and
  `['onFile', …]` (boats, clubs, categories on file).
- **Every read** is a `useQuery` with the options in `api/queries.ts` (the IPC
  call typed by the contract). A check made just before a write (a name taken,
  races already sailed, Final Series eligibility) uses `useReadNow` (a fetch
  with `staleTime: 0` through the same key).
- **Every write** goes through `useWrite(write, affected)` (`api/writes.ts`, a
  `useMutation`): once it succeeds it invalidates what it affected and resolves
  only after the screens' queries were read again. `{ eventId }` = the event +
  the events list (every heat, scoring, leaderboard, entry and history write);
  `{ eventId, onFile: true }` = also the boats/clubs on file (entering a
  sailor); `'events'` (a new event); `'everything'` (import of an event, restore
  from a file, a sailor's details, a CSV import). Deleting an event removes its
  queries. Undo / go back in the history are writes like any other. Never
  reload a screen by hand, never add a window event or a refresh token: say
  what the write affected.
- **Editing is never overwritten**: the leaderboard shows the saved standings
  outside edit mode and its draft inside. If the saved standings change while
  editing and not by our own Save (an undo / go-back), the draft stays,
  `editIsStaleRef` is set with a "Results changed" warning, and Save is refused
  until Cancel Editing. An unchanged re-read (structural sharing keeps the same
  rows) does not count. The standings change only once all their reads are back
  (no qualifying rows next to final fleets of before). The scoring page closes
  the scoring view if the heat list read again says its heat is gone or was
  raced (not while our own submit runs).
- **The leaderboard preview** (`previewLeaderboardEdit`) is a `useMutation`
  that invalidates nothing (the main process rolls it back); TanStack calls a
  `mutate`'s own `onSuccess` for the newest call only, so an older answer never
  overwrites a newer edit, and `reset()` on leaving edit mode / Save / a stale
  edit drops the one on its way.
- Not data writes, so direct IPC calls: exporting documents, printing, saving a
  backup file, the problem report, `previewSailorImport` (a dry run).
- Tests render through `src/__tests__/helpers/renderWithQuery` (re-exports
  @testing-library/react; `render` / `renderHook` wrap a NEW client per call
  with the app's defaults and return it as `queryClient`). To simulate a change
  from elsewhere (the history), change the mock and
  `queryClient.invalidateQueries({ queryKey: queryKeys.event(id) })`. Writes
  start their IPC call a microtask after the click: `waitFor` the mock call.

### Preload contract

- **One typed contract: `src/shared/ipc.ts`.** `IpcContract` maps every invoke
  channel, grouped as the renderer uses them (`sailorDB`, `eventDB`,
  `heatRaceDB`, `exportDB`, `problemReportDB`), to its arguments and its
  result, written as a function type
  (`readBoatsByEvent(eventId: number): EventBoatRow[]`). The rows and results
  it names live in `src/shared/rows.ts` (rows straight from SQL describe the
  columns the handler selects, with LEFT JOIN columns nullable) and the other
  `src/shared` modules; `renderer/types.ts` re-exports them under the old names.
  `WindowToMainMessages` / `MainToWindowMessages` type the one-way messages
  (`app:logError`, `app:backupStatus`, `app:openProblemReport`).
- Main: `handle(channel, listener)` is generic over the contract: a channel
  name not in it, a listener whose parameters do not take the channel's
  arguments, or a result of the wrong shape does not compile. The arguments
  are still untrusted at runtime (convert and check them). `db` is untyped
  JavaScript, so a raw SQL row is not checked against its row type; the
  contract is what the SQL promises.
- Preload: `src/main/preload.ts` exposes the groups under
  `window.electron.sqlite.*`, built from the runtime list `SQLITE_CHANNELS`. A
  compile-time check (`_ChannelListCheck`) makes that list name exactly the
  contract's channels, group by group; `preload.contract.test.ts` checks at
  runtime that every exposed channel has a `handle()` registration and the
  reverse. `window.electron.sqlite` is typed `IpcApi` (every channel as an
  async method).
- Wrapper throws on `false` return values, so renderer callers should expect exceptions.
  `importSailors` instead resolves `{ imported: 0, skipped: 0, errors }`
  (`ImportSailorsFailure`, part of its contract result).
- Renderer: `src/renderer/api/db.ts` derives every group (`eventDB`,
  `heatRaceDB`, …) from the contract; it declares no method by hand.
- `window.electron.appEvents` (not a sqlite group): `logError` sends a window
  error to the error log; `onBackupStatus` reports automatic-backup failures.

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
- `Decisions` (the event's decision log) and `EventLogs` (migration 9)
- `Heats`, `Races`, `Scores`, `Heat_Boat` (the projection of the log)
- No standings tables: `Leaderboard` and `FinalLeaderboard` were dropped in
  migration 10, `GlobalLeaderboard` in 12. Standings are worked out on every
  read, never stored.
- `RaceAssignmentSnapshots` (SHRS 3.1(5): a race's sheet as it was before the
  committee's decisions, written by the projection)

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
  is not logged. The decision log is not journalled: it is its own history.
  Deleting
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
  guards. An action that made decisions is undone on the log
  (`logHistory.undoActionOnLog`): its decisions are withdrawn and the ones it
  withdrew come back, refused if a later action changed the same race (the
  error names that action). An action from before the event's log was
  converted is undone row by row (rules in `shared/history/revert.ts`: every
  row put back as it was, only if no later action changed it), then the
  tables are converted to the log again. The undo is recorded
  with `ChangeActions.reverts_action_id`, so it can be undone too. The undo is
  a `useWrite` on the event, so every screen showing it reads it again (§3,
  the one refresh rule); an edit in progress on the leaderboard keeps its draft
  and refuses Save.
  Covered by `changeJournal.integration.test.ts` (real migrations and
  handlers; an undo restores results, SHRS 3.1.5 rows and standings exactly),
  `historyDescribe.test.ts`, `historyRevert.test.ts` and
  `EventHistoryDialog.test.jsx`.

- Migration 5 adds the **`CountedRaces` view** (`public/Database/views.js`):
  a qualifying race counts once EVERY heat of its round has sailed it (SHRS
  1.1). The standings no longer read it (regatta-core counts a round the same
  way and returns the round still being sailed as `pending_races`, shown
  greyed "Q3\*" outside every total); the DNC completion of the tables
  (`ensureDncScoresForMissedQualifyingRaces`, run before an event's tables
  are converted to a log) still joins it. Tests that build their own schema
  must add `COUNTED_RACES_VIEW` (`eventLifecycleSchema.ts` does).
- **The event is its decision log** (`docs/regatta-core-switch.md`).
  Every write is a decision: a handler builds it, `libraryWrite.applyToEvent`
  replays the stored log with it (regatta-core refuses, in words, what the
  rules do not allow), stores it (`decisionStore.saveLog`) and writes the
  new state into `Heats` / `Races` / `Scores` / `Heat_Boat` / the Events
  settings (`projectEvent`), all in one transaction. The tables are a
  projection the screens and exports read; `projectEvent.roundtrip.test.ts`
  checks that they convert back to the same event. An event made before
  this version is converted from its tables when the app starts, after the
  start-up backup (`startupConversion.ts`; one `convertEventLog` history
  action per event, "Moved to the new scoring", not undoable; an event that
  fails is logged and tried again on use). `eventLog.eventToLog` converts;
  `EventLogs` keeps what it assumed (notes), what it could not express
  (anomalies, worded with sail numbers) and, migration 11, every result
  the rules score differently from what the old app stored (`changes`,
  from `logDifferences`). The leaderboard shows that report
  (`ConversionNotice`, IPC `readConversionReport`) until the race officer
  confirms it (`markConversionReportSeen`, `report_seen_at`). A decision is never deleted: taking it back marks
  it `withdrawn_by` the action that did; decisions are tagged with the
  `ChangeActions` row of the call that made them.
  Reads: `readLeaderboard`, `readFinalLeaderboard`, `readOverallLeaderboard`
  (`libraryStandings`: the library's places, totals, race points and
  `race_excluded`, in the old row shapes; the place, status and kept place
  shown in each race are the projected ones), `explainBoatScore` /
  `explainTieBreak` (`libraryExplain`), `getFinalSeriesEligibility`
  (`libraryEvent`). Undo from the history and "go back to a point" work on
  the log (`logHistory`); a point before the event's conversion uses the
  row-based journal and converts again. A backup file carries the log
  (§5, `eventSnapshot.ts`): restoring it replaces the event's log (one
  action, nothing converted), importing it renames its boats
  (regatta-core `renameBoats`); only a version 2 file (no log) is
  converted from its tables. Tests that mock the database for a read mock
  `functions/libraryStandings` too.

DB file paths:

- Packaged: under `app.getPath('userData')/scoring_app.db`, where userData is
  `<appData>/IOM Regatta Manager` (productName in `release/app/package.json`).
  Builds before Nov 2026 used the template's name; `public/Database/dataLocation.js`
  keeps a computer on `<appData>/electron-react-boilerplate` when its database
  is there (and points userData at it), so a renamed build never looks empty.
- Dev: from `public/Database/data/scoring_app.db`

## 5. Domain Rules And Scoring Notes

The handlers (`ipcHandlers/`) only wire IPC: turn the request into decisions
and hand them to `applyToEvent`. What the rules say is regatta-core's; the
modules under `src/main/functions/` connect it to the database. Map of that
directory:

- The library and its log: `decisionStore.ts` (the `Decisions` table:
  load, save, replace with a backup's (`replaceLog`), withdraw, tag,
  convert), `eventLog.ts` (tables to log, the
  conversion of older events; `coreHeatId`), `raceSheet.ts` (a race's
  sheet from stored rows), `libraryWrite.ts` (`currentEvent`,
  `applyToEvent`, `previewOnEvent`: a write applied, read and rolled back;
  `replaceEventLog`: a backup's whole log replayed, stored and projected),
  `projectEvent.ts` (state to tables), `libraryStandings.ts` (the three
  standings reads; `replayEvent`), `libraryExplain.ts` (score and tie-break
  explanations), `libraryEvent.ts` (Final Series eligibility, largest heat),
  `libraryCorrection.ts` (a leaderboard Save as `raceCorrected` /
  `protestDecided` decisions; SHRS 3.1(5): who decided), `logHistory.ts`
  (undo and go back on the log).
- `revertHistoryAction.ts` / `restoreToHistoryPoint.ts` — undo and go back:
  on the log, or row-based for actions before the event's conversion.
- `changeJournal.ts` — the change journal's grouping per IPC call (§4).
- `raceScoring.ts` — `checkedRaceColumn` (the edit screen's whole race,
  its input checked — each boat once, places 1..boats in the race, known
  codes, committee points > 0 and <= 99 — and scored with regatta-core's
  `scoreRaceColumn`: what a Save sends to the library), `getMaxHeatSize`,
  `ensureCompleteRaceScoresForEvent` (DNS / DNC rows older write paths left
  out, completed before a conversion; RRS A5.1), `rescoreRace` (row-based
  undo, scored by the library's `scoreRaceColumn`).
- `creatingNewHeatsUtls.ts` — finding the current round's heats
  (`findLatestHeatsBySuffix`, `checkRaceCountForLatestHeats`); the seeding
  and the Heat Movement Tables are the library's. Filename typo intentional
  (§10).
- `heatQueries.ts`, `seriesGuards.ts` — shared reads and the guards on
  closed qualifying heats.
- `discardConfig.ts` — re-exports `shared/discardProfile.ts` (the stored
  discard setting and `toDiscardProfile`) for the main process.
- `scoreStatus.ts` — `normalizeScoreStatus`: a sent or stored status read
  into the library's vocabulary (`RESULT_CODES`; RAF read as RET; an unknown
  code refused in words). Nothing else: what a code scores and the 5.3
  order are the library's.
- `eventSettings.ts` — per-event SHRS configuration on the Events row:
  qualifying assignment mode (3.1/3.2), heat overflow policy (2.3; the cap
  is the library's `MAX_HEAT_SIZE`), and the discard-profile lock (5.4). The
  allowed values (`QualifyingAssignmentMode`, `HeatOverflowPolicy`) and their
  one normalizer are in `shared/eventSettings.ts`. `readAllEvents` works the
  locks out from the races (parity R11).
- `labels.ts` — heats, races and boats named as the screen names them.
- `validation.ts` — input sanitising for the handlers.
- `retryWhenBusy.ts` — retry a write a few times while SQLite reports
  `SQLITE_BUSY` (insertSailor, insertEvent).
- `sailorEntry.ts` — THE rule for entering a sailor and boat, used by the add
  form (`enterSailorInEvent`, one IPC call, one transaction), the CSV import
  and `importEventSnapshot`: a boat is letters + sail number (reused with her
  sailor; someone else's boat answers `ownerConflict` and writes nothing until
  called again with `useRegisteredSailor`), a sailor is name + club (+ birthday
  when both have one), a club is name + country. The form used to make six
  calls (insertClub/insertSailor/insertBoat/associate…): a Cancel on the
  owner question left a sailor with no boat, and a second "Ivan Horvat" got the
  first one's club and subgroup. Those channels are removed. The import asks
  first (`previewSailorImport` lists the rows whose boat is someone else's;
  `importSailors(rows, { ownerConflicts: 'skip' | 'use-registered' })`), and a
  row without club or subgroup leaves a known sailor's as they were.
- `eventSnapshot.ts` — the backup file: export, restore into the same
  event, import as a new event (format and type: `shared/eventSnapshot.ts`).
  **An event's data is its decision log plus its Events row** (name, place,
  dates, SHRS version, logo); the boats, sailors, clubs and categories it
  names travel beside it as `people`. A file is `schemaVersion: 3`:
  `{ schemaVersion, exportedAt, event_id, log, people, tables }`, where
  `log` is the event's decisions in force in order (exactly `loadLog`; boat
  ids are this database's `boat_id`s as text) and `people` holds every boat
  the log names (removed boats included) with her sailor and club, plus
  every category name. `tables` (Events, Boat_Event, Heats, Races, Scores,
  RaceAssignmentSnapshots, Heat_Boat) is still written, for a person
  reading the file and for an older app version; a v3 reader takes only
  `tables.Events` (the event's own row) from it. An event whose stored log
  cannot be read or replayed is written as version 2 (no `log`), so its
  backup still restores. Restore (`restoreEventSnapshot`, History and
  backups → Restore from file…; the file must be of this event, and its
  log's boats on this computer) withdraws the decisions in force and
  appends the file's (`libraryWrite.replaceEventLog` → `replaceLog`:
  replayed, refused in words if the library refuses it, stored and
  projected), and writes the Events row's own fields, all in one action
  that can be gone back from; nothing is converted and EventLogs is not
  touched. Import (`importEventSnapshot`, landing page "Import from
  backup…", IPC `importEventSnapshotFromFile`) matches or creates each boat
  of the log by letters + sail number through `sailorEntry` (stored, not
  entered: the log enters them), renames the log's boats to them with
  regatta-core's `renameBoats` (refused if two file boats are one boat
  here), replays and projects it, and records an EventLogs row "came from a
  backup file" (no anomalies; the start-up conversion leaves it alone); a
  taken name gets " (imported)". A **version 2** file (no `log`: older
  backups and problem reports) works as before: restore writes the tables
  back and converts them (`reconvertEventLog`); import copies them with
  every id remapped (RDG2 `rdg_race_ids` included) and converts. A version
  1 file (no `people`) is refused by import in words; a newer version than
  3 is refused by both. Standings are never read from a file (older files
  carry `Leaderboard` / `FinalLeaderboard`; they are ignored). The original
  history is not carried. This is also how a problem report's
  `event-snapshot.json` is opened, and how an event deleted after "Back up,
  then delete" comes back (the restore only works on an event that still
  exists). A new event-scoped table that is not a projection of the log
  goes into the file, the v3 restore and the import together (and, for
  version 2 files, the restore's delete and reinsert). Covered by
  `eventSnapshot.log.integration.test.ts` (round trip, import, refusals, a
  version 2 file) and `eventLifecycle.integration.test.ts` (version 2).
- `RaceAssignmentSnapshots` (SHRS 3.1(5)): `projectEvent` writes a
  whole-race freeze for every race with a committee decision, and the
  conversion (`raceSheet.sheetFromFrozen`) reads it back. No module caches it.

Shared (renderer + main) — plain TypeScript both processes run; no rules
(those are regatta-core's, §1):

- `subgroups.ts`.
- `eventSettings.ts` — `QualifyingAssignmentMode`, `HeatOverflowPolicy` and
  their normalizers (the vocabulary of an event's SHRS settings).
- The IPC contract (`ipc.ts`) and the types it names, one definition for both
  processes: `rows.ts` (table rows, joined reads, leaderboard rows, write
  payloads), `scoring/tieBreakTypes.ts` (the tie-break explanation),
  `finalSeriesEligibility.ts`, `importSailors.ts`, `scoring/explain.ts`
  (`BoatScoreExplanation`), `exportTypes.ts`, `problemReport.ts`,
  `conversionReport.ts`, `history/describe.ts`, `eventSnapshot.ts` (the
  backup file's format, `EventSnapshotFile`). The renderer's names for them
  in `renderer/types.ts` are aliases; where the renderer must tolerate partial
  rows (test fixtures) it keeps a looser type the real row is assignable to
  (`RawLeaderboardEntry`, `OverallLeaderboardEntry`). When a handler returns a
  new shape, define it in `src/shared` and name it in the contract.
- `discardProfile.ts` — the stored SHRS 5.4 setting: parsing, normalising
  (what the event form typed) and `toDiscardProfile` (the library's
  `DiscardProfile`). The count is the library's `discardCount`.
- `boatKeys.ts` — how a race officer names a boat when entering a finish.

What the app imports from `regatta-core` instead of keeping its own copy
(each was an app module until the library took it over):

- **Correcting a result in place** — `applyRaceColumnEdit`,
  `scoreRaceColumn`, `holdsPlace`, `keepsProvidedPoints`, `slotOf`
  (`packages/regatta-core/src/rules/correction.ts`, tests in
  `test/correction.test.ts`). A correction gives the race the result it
  would have had if the corrected finish had been entered on the scoring
  screen: a new place MOVES the boat (the boats in between make room; two
  moves swap two boats); a code with no finishing place (DNF, OCS, BFD, UFD,
  DSQ, RET, …) on a boat that had one moves every boat behind her up (RRS
  A6.1, and the same for every other no-place code); a place for a boat that
  had none pushes the boats from that place down; RDG/DPI change no other
  boat and keep her place in the order (A6.2, A10); ZFP/SCP/T1 keep the
  place. `scoreRaceColumn` scores a column from places and codes (A7
  averages, 44.3(c), SHRS 5.2) and never compacts a gap that fits. The
  leaderboard's Save sends every touched race WHOLE (`{ raceId, cells }`);
  the main process checks the input and scores it again
  (`raceScoring.checkedRaceColumn`) and turns it into decisions for the
  library (`libraryCorrection`): what is shown is what is saved.
  `saveLeaderboardRaceResultsAtomic` takes `(event_id, operations,
updateFinalLeaderboard)` and accepts nothing but whole races. There is no
  "Shift other boats" toggle and no duplicate-place dialog.
- **The edit draft** (`renderer/utils/leaderboardEdit.ts`) only re-ranks the
  edited race's column with `applyRaceColumnEdit`. It works out no totals,
  discards or redress averages: after every edit the hook sends the touched
  races to `previewLeaderboardEdit`, which saves them exactly as Save does,
  reads the three standings back and rolls back
  (`libraryWrite.previewOnEvent`); those rows replace the draft, so totals,
  discards, redress averages and places on screen are regatta-core's. Until
  the answer arrives the other columns and the totals show what they showed
  before the edit. An RDG1 / RDG2 cell keeps the boat's current points in
  that race until then (a value Save accepts: above 0, at most 99; the
  library ignores it and averages from the races, RRS A9). A change the rules
  refuse comes back as `{ ok: false, reason }` and is shown as a warning.
  Reads carry `race_excluded` (1 per excluded score); `processLeaderboardEntry`
  brackets those and takes the library's total. Nothing in the renderer
  works discards out.
- **Points** — `noPlacePoints` (SHRS 5.2), `penaltyPoints` (RRS 44.3(c) /
  T1), `toTenth`, `redressAverage` (A9), `sumPoints` / `exactPoints` (totals
  without float noise).
- **Codes** — `NO_PLACE_CODES` (SHRS 5.3 order), `PENALTY_CODES` (ZFP, SCP,
  T1), `COMMITTEE_CODES` / `REDRESS_CODES`, `RESULT_CODES` (all of them, in
  that order: the leaderboard's code menu, the exports' legend,
  `normalizeScoreStatus`), `FINISHED`. Labels stay in
  `renderer/constants/penaltyLabels.ts` (display only).
- **Discards** — `discardCount`, `excludedScores`, `NOT_EXCLUDABLE`.
- **Order** — `compareBoats` (SHRS 3 / 3.1(iv) / 5.3), `inRecordingOrder` and
  `codeRank` (5.3 recording order of the scoring screen's finish list).
- **Heats and fleets** — `MAX_HEAT_SIZE` (2.3), `MAX_HEATS`, `fewestHeats`
  (2.1 / 2.3: the heat-count default), `movementImbalanceExpected` (the note
  under the Heat Movement Tables: the next-round advisory), `fleetName` /
  `fleetIndex` (4.1 names, 5.5 precedence).
- **What next** — `nextInRound` (the round bar's next heat, from the screen's
  heats; `nextStep` uses it on an event).

When extending the handler, keep this pattern: pure logic goes in a
`functions/` module (so it is unit-testable), the handler only wires IPC.

Observed rule implementation details (all in regatta-core):

- Supported statuses: `FINISHED` and `RESULT_CODES` — penalties that keep the
  place (`ZFP`, `SCP`, `T1`), no-place codes (`DNF`, `RET`, `NSC`, `OCS`,
  `DNS`, `DNC`, `WTH`, `UFD`, `BFD`, `DSQ`, `DNE`, `DGM`), and the committee's
  (`DPI`, `RDG1`, `RDG2`, `RDG3`). Stored `RAF` is read as `RET`.
- Exclusion count logic (`discardCount`, standard profile):
  - `<4` races: 0 exclusions
  - `4-7`: 1 exclusion
  - `>=8`: `2 + floor((races - 8) / 8)`
- Some statuses are non-excludable (`NOT_EXCLUDABLE`: `DNE`, `DGM`).
- Tie-break logic has dedicated handling for shared-race and multi-heat scenarios.

When changing scoring logic, change it in `packages/regatta-core` and update
or add its tests first.

### Full rule reference (SHRS 2026-1 + RRS Appendix A)

This is the source-of-truth summary of the scoring spec the app implements.
Rule numbers are SHRS unless prefixed `RRS`. The rules are implemented in
`packages/regatta-core/src` (`rules/`: points, discards, seeding, fleets,
ranking; `standings/`: series, qualifying, final, ties; `event/`: replay,
race scoring), where the file named below is not an app module.

General / series structure

- 1.1 — Two or more heats per race ⇒ event has a **Qualifying Series** then a
  **Final Series**. A single heat ⇒ the event is sailed as one fleet, scored
  like a Qualifying Series, and sections 2–4 do not apply. (Final-series start is
  gated by `getFinalSeriesEligibility`; `SINGLE_FLEET` when `< 2` heat groups.)
- 1.5 — If **no Final Series races are completed**, boats are ranked by their
  Qualifying Series score (`standings/final.ts`; `readOverallLeaderboard`
  returns the qualifying standings until a final race is sailed).
- 1.6 — RRS T1 (post-race penalties) applies; modelled by the `T1` status.

Number/size of heats

- 2.1–2.2 — As few heats as possible; sizes as equal as possible.
- 2.3 — **Max 20 boats per heat** (`MAX_HEAT_SIZE` in `rules/fleets.ts`;
  `fewestHeats` in `rules/heats.ts` is the heat-count default; overflow
  governed by `shrs_heat_overflow_policy`).

Qualifying assignment (`rules/seeding.ts`)

- 3.1 — **Progressive**: Race 1 seeds top-down `1,2,3,4,5,5,4,3,2,1`
  (`serpentine`); later races use the Heat Movement Table (`nextHeat`). Non-finishers ordered
  `DNF, RET, NSC, OCS, DNS, DNC, UFD, BFD, (DSQ)`; ties by alphanumeric
  national-letter + sail number (`compareBoats`; the scoring screen's
  finish list uses `inRecordingOrder`).
- 2.2 — heats "as equal as possible" means within one boat, and **nothing pins
  the extra boat to Heat A**. The 3.1(1) walk drops it wherever it stops (10
  boats / 3 heats → A=3, B=3, C=4), and the movement table then rotates the odd
  heat between rounds. The PDF says so itself, above the Heat Movement Tables:
  "the largest heat size could move from one heat to another". Only 4.1 orders
  group sizes, and only for final fleets (Silver ≤ Gold ≤ …), which
  `startFinalSeriesAtomic` implements by handing the remainder to the earliest
  fleets. Do not "fix" qualifying to match it.
- The next round (`roundCreated`) is built only from a round every heat has
  sailed; the library refuses otherwise. (The app once fell back to a
  re-seeded draw, a fabricated draw published as if it were sailed.)
- 3.1.5 — **Only protest-committee decisions** leave heat assignments as
  they were: the next round reads the race office's sheet, not the
  committee's `protestDecided`. An ordinary race-office correction
  (`raceCorrected`) does change them. The leaderboard save marks each cell
  the user typed in (`edited`); `libraryCorrection` decides from it which
  changes are the committee's (RDG, DPI always; DSQ / DNE / DGM when typed
  or already the committee's) and which the race office's.
- 3.2 — **Pre-assignment**: equal size/ability, published before racing.
  (`shrs_qualifying_assignment_mode` = `progressive` | `pre-assigned`.)
  The app's pre-assignment keeps every boat in her round-1 heat for the whole
  qualifying series; there is no import of a rotating published schedule.
- The assignment mode is fixed once the qualifying series has begun (a
  qualifying race scored, or the qualifying discard lock set), and
  `shrs_heat_overflow_policy` once the Final Series is split: `updateEvent`
  refuses a change, `readAllEvents` returns `qualifying_started` /
  `final_series_started` and the edit form disables the field with a note.
  The overflow policy (shown as "Final fleets over 20 boats") is used ONLY by
  the fleet split (`rules/fleets.ts`); qualifying heats are always capped at 20, so it matters
  only when boats were entered after the heats were made.
- 2.1 — The heat count defaults to the fewest the entry list allows; choosing
  more shows a warning under the control and asks before Create / Recreate
  (`useHeatManagement` `extraHeatsNote`).

Final Series (`rules/fleets.ts`, `standings/final.ts`)

- 4.1 — Fleet naming and precedence are `fleetName` / `fleetIndex`; fleets past
  Copper are named "Fleet 5"… and rank 5th… (never a shared catch-all rank).
- 4.1 — Same number of fleets as qualifying heats (may shrink if withdrawals
  allow). Fleets `Gold, Silver, Bronze, Copper`; sizes as equal as possible with
  `Gold >= Silver >= Bronze >= Copper`.
- 4.2 — Fleet assignment by qualifying ranking (best ⇒ Gold); withdrawn boats go
  to the lowest fleet.
  Boats that share a qualifying place (no rule separates them) are split in
  SHRS's own tie order, national letters then sail number (3, 3.1(iv), 5.3),
  not by boat_id. The rankings use the same order wherever no rule decides
  (shared places, a 5.7 circle that plain A8 cannot settle). Decided Nov
  2026 (parity R6), see
  `packages/regatta-core/docs/parity/README.md`.
- 4.3 — If the Qualifying Series has **>5 and <8 completed races (6 or 7)**, a
  boat's **second-worst** race is temporarily excluded **for fleet-assignment
  ranking only** (`rule43Applies` in `getFinalSeriesEligibility`; the
  split in `rules/fleets.ts`). Does not affect series scores.
- 4.4–4.5 — A final race = one heat per fleet; fleets may sail different numbers
  of races.

Scoring (`event/score.ts`, `rules/points.ts`, `standings/series.ts`)

- RRS A4 — Low Point: finishing place = points (1st⇒1, …).
- RRS A6.1 — A boat disqualified or retiring **after finishing** is removed from
  the finishing order and every boat behind her **moves up one place**. A
  correction to any other code with no finishing place does the same (see
  `rules/correction.ts`).
- RRS A7 — **Race ties**: tied places share the summed points equally. Enterable
  from the scoring screen via the per-row tie ("=") control, which submits a
  shared place (`tied` on the sheet line) for the library to average.
- RRS A5.1 / 5.3 — **Every entered boat is scored for every race in the
  series.** A boat who sailed in no heat for a round (added mid-event via
  `assignBoatToHeat`, or entered and never started) is scored **DNC** at
  (largest heat + 1), not left without a row
  (the library scores her DNC in every counted race of a round she had no
  heat in; the projection files that DNC under one of the round's races).
  A round counts once EVERY heat of it has sailed the race. Qualifying only:
  in the Final Series a boat races one fleet (4.1) and fleets may sail
  different numbers of races (4.5), so a Gold boat must not collect DNCs for
  Silver's races. Without this (in the old app) a boat with a short score
  vector could discard her only score and rank **first into Gold**.
- 5.2 (changes RRS A5.2) — A boat scored DNS/DNF/DSQ/etc. gets **(boats in the
  largest heat) + 1** points — NOT boats entered in the series.
- 5.3 — Recording order: finishers by place, then
  `DNF, RET, NSC, OCS, DNS, DNC, WTH, UFD, BFD, DSQ, DNE`; ties alphanumeric.
  Position-keeping penalties (`ZFP`, `SCP`, `T1`) keep the boat's finishing
  place (`compareRecorded`, `inRecordingOrder`, `PENALTY_CODES`).
- 5.4 — **Discards** (per series, Qualifying and Final counted independently):
  0 below 4 completed races, 1 at 4–7, 2 at 8–15, then +1 per additional 8.
  Non-excludable: `DNE`, `DGM` (RRS 90.3(b)). Configurable per event before the
  first warning signal (stored as `shared/discardProfile.ts` reads it); an explicitly **empty**
  threshold list means **never discard**. The count is series-wide — fleet-wide
  in the Final Series, since 5.1 scores each fleet separately.
  The library (`rules/discards.ts`) additionally caps it per boat so a boat
  always keeps one score. **That cap is an app-level guard, not rule text** — 5.4 says
  "excluding her worst score" with no exception for a boat who has only one.
  It is a backstop for a boat whose score vector is shorter than the series,
  which the DNC rule above prevents; if it ever fires, the missing
  scores are the bug. Use the same capped count for a boat's total AND her A8.1
  tie-break vector.
- 5.5 — Overall event score = Qualifying + Final series scores. Lowest in Gold
  wins; fleets rank `Gold > Silver > Bronze > Copper > Fleet 5 > …` regardless
  of raw points (`fleetIndex`).
- 5.6 — Redress averages computed separately per series: an RDG2 average covers
  ONLY races in the same series as the redressed cell — never a Q+F pool.
- RRS A9 (2025–2028) redress: RDG1 = average of all other races in the
  series, RDG2 = average of PC-chosen races (in the `protestDecided`
  decision; projected to `Scores.rdg_race_ids`), RDG3 = PC-set points (never
  recomputed). Averages include discarded races, EXCLUDE other RDG1/RDG2
  races, round to the tenth (0.05 up), and are LIVE: the library works them
  out on every replay; the leaderboard edit shows them from the library's
  preview (the renderer has no copy).
- Series ties that A8 cannot break (identical scores) SHARE the place
  (1, 2, 2, 4) — `rules/ranking.ts`, used by qualifying, final and overall
  standings: a boat shares a place only with boats no rule separates her
  from.
- 5.7 — **Event ties**:
  - (i) Single-heat events: RRS A8.1 then A8.2.
  - (ii) Multi-heat events: A8.1/A8.2 except — (1) only races where the tied
    boats were in the **same heat** count; (2) **excluded scores ARE used**
    (changes A8.1); (3) resolve the higher-placed tie before the lower; (4) if
    the tied boats never shared a heat, use plain RRS A8.1/A8.2.
  - "Single-heat" is an **event-level** property: true only when every boat
    raced the identical set of races.
  - (ii) is **not transitive** (each pair is compared on its own shared
    races), so A can beat B, B beat C and C beat A. The ranking gives each
    place to a boat no remaining tied boat beats, and settles a true circle
    by plain RRS A8.1/A8.2. (The old app sorted with the comparator, so the
    order followed the database rows; found by the regatta-core comparison,
    Nov 2026.)

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

The rules are tested in the library itself:
`packages/regatta-core/test` (`cd packages/regatta-core && npx jest`),
including `test/ported/`, the rule scenarios of the app's old scoring
tests, rebuilt on decision logs when that engine was removed.

High-signal tests in `src/__tests__` include:

The app on the library:

- `regattaCore.differential.integration.test.ts` (`DIFF_SEEDS`): random
  events through the real handlers, every step compared with the same
  event as a log replayed by the library.
- `chaos.integration.test.ts` (`CHAOS_SEEDS`): random sessions of every
  race-office action; after each step the tables convert back to a log
  that gives the same event (§10).
- `projectEvent.roundtrip.test.ts`: the projection converts back to the
  same event (1,000 seeds).
- `leaderboardEdit.wysiwyg.integration.test.jsx` (`EDIT_SEEDS`): Save
  stores exactly the race shown, and the whole draft (points, discards,
  totals, places, overall) is the leaderboard after Save.
- `scoringOracle.integration.test.ts` (`ORACLE_SEEDS`): random events
  scored from the rule text alone (§10).
- `libraryEvent.test.ts`, `libraryExplain.integration.test.ts`,
  `regattaCore.import.test.ts`.
- Published-results replays: `euroIom2025.published.test.ts` (the 2025
  European Championship sheet as a decision log: every race, discard, nett
  and the overall order, three differences pinned and explained),
  `euroIom2025.startingHeats.test.ts` (the library's Race 1 draw against
  the published one) and `iomWorlds2024.published.test.ts` (HMS event;
  checks the library's discards, totals and order only — its sheet has
  one documented nett error, ARG 63).

Handlers, history, renderer:

- `HeatRaceHandler.*` (create / recreate heats, next round, transfer,
  submit, undo and guards, Save, Final Series start),
  `eventSettings.locks.integration.test.ts`,
  `EventHandler.removeBoatFromEvent.integration.test.ts`,
  `leaderboardCorrection.rules.integration.test.ts` (what a leaderboard
  Save stores, per rule: RRS A6.1/A6.2/A7/A9/A10, SHRS 5.2, 44.3(c)/T1,
  every refusal),
  `restoreToHistoryPoint.integration.test.ts`,
  `changeJournal.integration.test.ts`,
  `eventSnapshot.log.integration.test.ts` (the backup file with the log:
  restore, import, refusals, version 2 files)
- `scoreStatus.test.ts`, `creatingNewHeatsUtils.test.ts` (note: tests the
  `...Utls.ts` source), `compareUtils.test.ts`,
  `leaderboardUtils.exclusions.test.ts` (the library's discards shown as
  sent), `roundStatus.test.ts`
- `DBManager.failStartup.test.ts` (startup advice per failure kind and
  `classifyDatabaseFailure`), `retryWhenBusy.test.ts`
- `ScoringInputComponent.test.jsx`, `useLeaderboard.scoring.test.jsx`,
  `ComparePanel.steps.test.tsx`

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
2. Update the contract first (`src/shared/ipc.ts`; the compiler then points at
   `preload.ts`, the handler and every renderer call site).
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
- `handle()` is generic over the channel: its listener's parameters are the
  contract's argument types (`shared/ipc.ts`) and its result must be the
  contract's. They come from the window and are not trusted at runtime, so
  still convert ids once at the top of the handler
  (`const event_id = Number(raw_event_id)`) and pass numbers on. Do not
  annotate a listener's parameters with a narrower local type, and do not
  reintroduce `any` in `src/main`.
- `functions/` modules import `db` directly from `DBManager` (not passed in),
  and only call `db.prepare` inside functions — never at module top level, so
  importing a module never touches the database.
- When adding a channel, write its shape in ONE place: `src/shared/ipc.ts`
  (arguments and result; a new row or result type goes in `shared/rows.ts` or
  its own `src/shared` module). Then the compiler asks for the rest: its name
  in `SQLITE_CHANNELS` (`preload.ts`, the runtime list the bridge is built
  from) and its `handle()` registration (`preload.contract.test.ts` fails
  without it). The renderer method appears in `api/db.ts` by itself. A
  renderer call site that does not match the contract is a compile error: fix
  the call site, not the contract, unless the handler really returns
  something else.
- The global leaderboard feature is removed from the UI (Sept 2026). The route,
  both nav entry points, the page, the component and the
  `readGlobalLeaderboard` / `updateGlobalLeaderboard` channels are gone; users
  could previously navigate to a page that existed only to say the feature was
  on hold. Its table was dropped in migration 12; a revived feature would
  work standings out from the event logs, as every other screen does.

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
- Point totals go through regatta-core's `sumPoints` / `exactPoints`. A
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
  of the event made after the chosen action: on the log, the log as it was
  in force right after that action (`logHistory.restoreLogToAction`; the
  event's own columns come back from the journal); before the event's log,
  row by row, newest first, then converted again. One transaction. Each row must
  be exactly as the change being put back left it, or nothing changes (a row
  altered outside the journal, or a boat since deleted from the app, is
  refused with a plain message). A `before-going-back-*` backup is written
  first (never pruned); if it fails nothing is changed. Going back is itself
  an action, undone by going back to the entry just before it ("Undo going
  back"). Not taken back: sailor/boat details (global by design).
  `shared/history/restore.ts` works out which entries are in effect
  (`undoneActions`, following undo chains and earlier go-backs) and what a
  go-back would take back and bring back (`restorePreview`), which the
  dialog lists before asking. Afterwards every screen showing the event reads
  it again (the one refresh rule, §3); a scoring view whose heat changed is
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
  that put a boat past the last place (redress gap; `applyRaceColumnEdit`
  now fills the nearest free slot), and an undo from the history that left two
  boats on one place unaveraged (the row-based undo calls `rescoreRace`).
  Since the switch it also converts the tables back to a log after every
  step and checks that it gives the same event.
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

- **The Navbar** (`components/Navbar.tsx`) has three levels, and new items
  go in the level they belong to, not as another equal button: the app name
  (home); inside an event, its sections Entries / Scoring / Leaderboard
  (`event` + `section` props; the open one is solid white with
  `aria-current="page"`); on the right, small and without a button shape,
  History and the Help menu (`HelpMenu.tsx`: help and glossary, Report a
  problem). Pages with unsaved work pass `guardNavigation`, and every
  navigation from the bar runs through it. A page's own next step is a button
  in the page (the event page's green "Go to Scoring"), not in the bar.
- **Every event page starts with `shared/EventHeader`** (the event's name,
  where · when, and the page's own action on the right) inside
  `.page-wrapper` (one width, 1400px, for all three, so switching sections
  does not move the content). There are no breadcrumbs: the Navbar's
  highlighted section says where you are, its brand goes home.
- **One home per feature.** The entries page is the entry list (add, import,
  edit, export the starting list) plus one line on where the racing stands
  (`heats/HeatsSummary`). The heats (`HeatComponent`: creating them, moving
  boats, the Final Series, "Export heats…") are on the Scoring page
  only; the event page used to show the whole component a second time.
- **Taking the event back is in one place**: the Navbar's History opens
  "History and backups" (`EventHistoryDialog`): the change history with
  Undo / Go back to here, and below it the backup file
  (`history/BackupFileSection`: Save backup file…, Restore from file…, the
  files saved recently). A restore invalidates everything (§3) and the
  pages, this dialog's history included, read it again. Starting the Final Series still offers to save a file first.
  Importing a backup as a NEW event is on the landing page.
- **Entries page adding** is one block, "Add Sailors", with three tabs: One
  sailor, Boats on file (boats from earlier events), CSV file. The list
  below shows its count; it no longer collapses.
- **Leaderboard toolbar** (`leaderboard/LeaderboardToolbar`, classes in
  LeaderboardPage.css, no inline styles): viewing has Edit Results, Compare,
  Export… (secondary); editing has only Cancel Editing and the green Save
  Changes (Compare and Export read saved results, so they are hidden).
- **A disabled button of any kind** (btn-success, btn-outline, …) is solid
  pale with dark text (App.css, after `.btn-ghost`); a variant must not keep
  its colour when disabled.
- **The landing page** is one column: "Events" with Import from backup… and
  New event on the right, then the events. The create form opens from New
  event (before the first event it is open, with "How it works"). Delete in
  an event row is a quiet red icon (`btn-icon-danger`), never a filled red
  button.
- **The Scoring page's round bar** (`heats/RoundBar`, status from
  `utils/roundStatus`, the next heat from regatta-core's `nextInRound`): "Qualifying · Round 4 · 1 of 3 heats scored" and
  ONE green button for the next step (Score the first heat still to sail; once
  a round of several heats is complete, Create Round N; in one fleet or the
  Final Series, the fleet that is behind). Export heats, Undo round (rounds
  built from results only) and Start Final Series sit beside it, quieter.
  Each heat card of the current round has its own Score race N / Undo race N
  (no select-then-act step); a scored heat of a several-heat qualifying round
  gets no Score (SHRS 3.2: redistribute first).

- **Outdoor readability is a requirement**: the app is used by race officers
  (often 60+) on cheap laptops in sunshine. Root font is 17px; secondary text
  and borders are dark tokens (`--text-secondary`, `--border-strong`); the
  window opens maximised. Every colour pair a judge must read is >= 4.5:1
  (white on `--teal` 5.3, on `--danger` 5.3; compute, do not eyeball). Do not
  reintroduce pale greys, small uppercase labels, half-transparent
  (`opacity`) disabled buttons, or top toasts. Toasts are 360px wide and
  bottom-LEFT on every screen except the scoring screen (`/heat-race`), where
  they are bottom-RIGHT: elsewhere result inputs and row buttons are right of
  the sail number and name, so the left covers only names and ranks (top and
  bottom-right covered the inputs); on the scoring screen the boat table fills
  the left and, with boats missing, is taller than the finish-order column, so
  a left toast covers the amber "Not scored" rows the judge must click next,
  while the lower right is free (its Submit bar is at the top). The position
  is chosen centrally per toast (`userFeedback.toastPosition`, from the route
  when the toast is shown); never pass `position` at a call site. Dark
  text, bold title over the body (`ToastMessage`), at most four at once, and an
  identical toast (same kind + title + body) is refreshed, not stacked
  (`userFeedback.showToast`). Errors, and warnings with no mark on the page,
  stay until dismissed; a warning whose problem is ALSO marked on the page
  (missing boats in the boat table, red leaderboard cells) is reported with
  `reportWarning(..., { inline: true })` and closes itself after 8 s (it
  pauses on hover and keyboard focus). Say `inline` explicitly; never guess.
  A Submit with boats missing marks them in the boat table ("Not scored",
  `useScoringInput` `isMissingSail`). Dates on screen go through
  `utils/formatDate.ts` (dd.mm.yyyy; `formatDateTime` for dd.mm.yyyy
  HH:mm:ss, 24 hour; never `toLocale*String`, which shows US format). Every
  dialog (AppModal, HelpModal, EventHistoryDialog, ScoreExplanationDialog,
  Rdg2Picker, SailorEditDialog) uses `hooks/useDialogFocus` for initial focus, the Tab trap,
  Escape (newest dialog only) and focus restore; a new dialog must too.
  Confirm buttons name the action ("Create heats", "Discard changes"), not
  "Confirm"/"OK", and the safe choice is the first button, focused by default.
  A leaderboard penalty cell shows code and points ("ZFP 5.2", "(DSQ 11)";
  the exported sheets show it too, unless "Show penalty points" is off).
  A sailor is edited in `SailorEditDialog` (opened by the pencil in the
  sailor list): labelled fields, country picked from the list with its flag,
  each problem shown under its field, a sail number + country already in the
  event refused, typed changes never closed away without "Discard changes".
  On the scoring screen Ctrl/Cmd+Enter
  submits the race (the Submit button's title says so).
  `UI_TOUR=1 npx playwright test e2e/ui-tour.spec.ts` seeds a 30-boat event
  and saves a screenshot of every screen (to `e2e-ui-tour/`) for review.
- **Exported documents** (results, starting list, heat lists / scoring
  sheets): one dialog (`components/export/`, opened by "Export…" on the
  leaderboard, "Export starting list…" on the event page, "Export heats…" on
  the Scoring page) with the options on the left and a live preview on the right (a
  sandboxed `<iframe srcdoc>` of the exact document, rebuilt 200 ms after the
  last change). `src/renderer/exports/` holds pure builders from plain data and
  options to one self-contained HTML string (`resultsDocument`, `startingList`,
  `heats`; shared `documentShell` header / print CSS / signatures; EN and HR
  wording in `i18n.ts`, codes and Q1/F1 labels never translated), the text
  formats (`resultsText`: TXT, Markdown, CSV) and the styled workbooks
  (`resultsExcel`, and the Excel writers inside `startingList` / `heats`, over
  `excelShared`). Every format of a document is drawn from one model
  (`resultsModel`), so they cannot disagree. All user text goes through
  `escapeHtml` (and `cssString` inside the page-footer CSS); no external
  resources. **PDF** = Electron renders that same HTML (`ExportHandler`:
  temp file, hidden window with `javascript:false`, sandbox, no preload, own
  session; `printToPDF` with the footer "Page x of y"; window and temp file
  removed in every outcome). **Print** loads the same page in the same kind of
  window and calls `webContents.print`. The page size and margins live in the
  document's CSS (`@page`); on screen / print / HTML file the page numbers are
  CSS margin boxes, for the PDF Electron's footer (`HtmlTarget`). Excel, HTML,
  CSV, TXT and Markdown go through the main process's save dialog too
  (`exportDocumentFile`). A cancelled dialog is `{ status: 'canceled' }`, not an
  error. Exports read the SAVED standings only (`ResultsExportDialog` gets
  `leaderboard` / `eventLeaderboard`, never `editableLeaderboard`; covered in
  `LeaderboardPage.test.jsx`). Options are remembered per event and document
  type in localStorage (`useExportOptions`, never required). The **event logo**
  is `Events.export_logo` (migration 7; a PNG/JPEG data URL shrunk to 600 px by
  `exports/logo.ts`, refused over 5 MB or if not a picture): kept out of
  `readAllEvents` (own channels `readEventExportLogo` / `saveEventExportLogo`),
  deliberately NOT in the change journal (the triggers were not reinstalled),
  carried by event snapshots and backups. Flags come offline from
  react-world-flags (`exports/flags.ts`), in the PDF / HTML only; Excel has the
  country code. jsPDF / jspdf-autotable / file-saver were removed (Nov 2026).
  **E2E hook**: with
  `SCORING_APP_EXPORT_DIR` set AND `SCORING_APP_HIDDEN=1` the handler writes
  into that directory under the suggested name without a dialog and Print does
  nothing; `e2e/ui-tour.spec.ts` uses it to save sample files.
- **Typed results are never corrected silently.** Leaderboard cells and the
  scoring page's place field are text inputs (a `type="number"` field changes
  on the mouse wheel / arrow keys). `utils/raceCellInput.ts` decides what is
  valid: a place is a whole number 1..boats in that race; RDG3/DPI points are

  > 0, <=99, one decimal, comma accepted. Invalid input stays red with the
  > range, is not applied, and Save refuses naming each cell
  > (`editValidity.tsx` context -> `useLeaderboard.invalidCells`). The main
  > process also refuses a place past the last boat of the race
  > (`raceScoring.checkedRaceColumn`).

- **Problem reports** (Help > Report a Problem… in the menu bar and in the
  Navbar's Help menu, and the crash screen's "Report this problem"):
  `ProblemReportHost` (mounted in `App.tsx`, outside the ErrorBoundary so it
  opens when a screen crashed) captures the window first
  (`captureProblemScreenshot`), then shows `ProblemReportDialog`: kind,
  area (preset from the route), when, what went wrong, what they were doing,
  what they expected, optional name and phone/e-mail, and four attachments the
  user can switch off (event data, history, error log, screenshot + computer
  details). The event comes from the Navbar (`setReportEventContext`). The form
  and its rules live in `shared/problemReport.ts`. The main process
  (`functions/problemReport.ts`) builds one payload: the event snapshot plus the
  boats, sailors and clubs it uses (logo left out), the history as text and
  JSON, the newest 512 KB of the error log, the JPEG. `problemReportOutbox.ts`
  writes it to `<data folder>/problem-reports/<id>.json.gz` BEFORE sending and
  deletes it only on a 2xx; no internet / 429 / 5xx keep it (retried 30 s after
  start and every 10 min, `startProblemReportOutbox`), any other 4xx moves it
  to `failed/`. The service is `report-worker/` (Cloudflare Worker + Resend,
  own README and `node --test` tests, excluded from the app's tsconfig and
  ESLint, deployed as `iom-report` on the developer's Cloudflare account;
  secrets APP_KEY, RESEND_API_KEY, TO_ADDRESS). The URL is in
  `functions/problemReportConfig.ts`; the key is NOT in the (public) repo: the
  prod webpack config puts it in from `IOM_REPORT_KEY` or the git-ignored
  `.report-key` file (CI: the `IOM_REPORT_KEY` repo secret), and a build
  without it keeps reports on the computer.
  `SCORING_APP_REPORT_URL` / `_KEY` override them; with `SCORING_APP_HIDDEN=1`
  (e2e) nothing is sent unless a URL is given. `e2e/problem-report.spec.ts`
  sends a real report to a stand-in server and checks what arrived.
- The main window refuses navigation away from the app page
  (`isSameAppPage` in `main/util.ts`): a file dropped on the window used to
  replace the app with that file, and the packaged menu has no Reload. Only
  http(s) links are opened in the browser (`isWebLink`).

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
