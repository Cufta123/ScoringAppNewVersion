# Switching the app to regatta-core

Goal: the app scores only through `packages/regatta-core`. The event is its
decision log, stored in the database; heats, results, standings and
explanations are worked out from it by the library; nothing derived is
stored except as a rebuildable projection while the screens still read it.

Started 2026-11-05 on `core/scoring-library`. Each phase ends with the full
suite green (`npm run test:unit`), typecheck and lint clean, and its own
commits. The comparison test (`regattaCore.differential`) runs throughout.

## End state

- `Decisions` table: one row per decision, in order, per event. The only
  scoring data that is written.
- Every handler that changes an event turns the request into a decision,
  replays the log with it (the library refuses in words what the rules do
  not allow), and appends it.
- Reads (`readLeaderboard`, final, overall, explanations, eligibility,
  heats for the next round, the Final split) come from the replayed log.
- Undo, "go back to a point", and backups work on the log.
- The edit preview is the library's answer: the main process saves the
  edit as Save would, reads the standings back and rolls back, so what is
  shown before Save is what Save stores (it is the same code).
- Removed: `Leaderboard`, `FinalLeaderboard`, `GlobalLeaderboard`, the
  recompute, the per-boat scoring/standings code in `src/main/functions`
  and `src/shared/scoring`, the SHRS 3.1(5) snapshot tables.

## Phases

Revised after phase 0: the log is built from the tables first, and reads
move to it before writes do, so there is never a second source of truth to
keep in step.

0. **Library in the app build.** `regatta-core` importable from main,
   renderer and tests (tsconfig paths, webpack, jest).
1. **The tables as a log.** `functions/eventLog.ts`: `eventToLog` turns
   an event's tables into a decision log; `checkEventLog` replays it and
   compares every heat and every score with the tables. It is the
   migration of existing events and the read path of phase 2.
2. **Reads from the log.** Standings, explanations, eligibility, next-round
   heats and the Final split come from the library on the converted log;
   the `Leaderboard` / `FinalLeaderboard` tables are no longer read.
3. **Writes through the log.** Handlers build the decision first; replay
   decides; the projection is rebuilt. The old validation and scoring code
   goes.
4. **History on the log.** Decision ids; undo = withdraw a decision (kept
   on record, can be redone); go back = replay a prefix; backups and
   snapshots = the event file plus people.
5. **Renderer.** Reads the library's results; the edit preview replays
   the log with the edit; the duplicated renderer scoring goes.
6. **Cleanup.** Remove the projection tables the screens no longer read,
   old tests replaced by library tests, AGENTS.md.

## Decisions taken

- The renderer keeps its IPC shapes until phase 5, so phases 1-4 change
  only the main process and the database.
- Existing events are converted, never dropped. An event whose stored state
  the library refuses (e.g. an entry after the Final started, R1) is
  reported by the migration with the reason; see "Conversion" below.

## Progress

- [x] Phase 0: `regatta-core` resolves in tsc, webpack (main checked) and both Jest configs
- [x] Phase 1: `eventToLog` / `checkEventLog`, checked after every step of the comparison test (400 events) and the chaos test (200 sessions)
- [x] Phase 2: the leaderboard reads, both explanations and the Final Series eligibility come from the library (`libraryStandings`, `libraryExplain`, `libraryEvent`). `getMaxHeatSize` stays on the tables until the writes move
- [x] Phase 3: every scoring write goes through the library (`libraryWrite`); the event's decision log is stored (`Decisions`, migration 9, `decisionStore`), converted from the tables the first time an event is used (notes and anomalies in `EventLogs`); reads replay the stored log; the tables are the projection. Restores of backups, imports and the old history paths convert the tables again (until phase 4; backups since carry the log, phase 6). A boat's details edit is a boatChanged in each of her events
- [x] Phase 4: undo from the history and going back to a point work on the stored log (`logHistory`): an undo withdraws the action's decisions and brings back, as its own, the ones it withdrew (so undoing an undo works the same way); going back makes the log what it was right after that action, and the event's own columns come back from the journal. A point before the event's log was converted uses the row-based history and converts again. Chaos (200 sessions) and the comparison (200 events) pass
- [x] Phase 5: the renderer reads the library
  - [x] The Final Series refuses a round built but not sailed (R7): the screen says to undo or sail it
  - [x] The event form reads the discard locks and `qualifying_started` from the races (R11)
  - [x] Every read carries the library's excluded scores (`race_excluded`); the screens mark them and take the library's totals; the exports count discards from them
  - [x] The edit preview is the library's: each edit is saved as Save saves it, read back and rolled back (`previewLeaderboardEdit`, `libraryWrite.previewOnEvent`), and those rows replace the draft. Before, the draft kept the places from before the edit (29 of 30 random sessions); `leaderboardEdit.wysiwyg` now checks the whole draft against the leaderboard after Save, qualifying and Final
  - [x] The compare panel shows the library's SHRS steps (5.7(ii)(3))
- [ ] Phase 6: cleanup
  - [x] The old engine removed (calculate\*BoatScores, leaderboardRecompute, refreshStandings, the old explanations, overall, fleet split, next round, seeding, `shared/scoring/series|overall|ranking`, `shared/fleetAssignment`) and unused helpers
  - [x] Migration 10 drops `Leaderboard` / `FinalLeaderboard`; backups no longer carry them
  - [x] The old engine's rule scenarios ported to `packages/regatta-core/test/ported` (209 tests; the library was right in every case where they disagreed)
  - [x] `euroIom2025.published` and `.startingHeats` replay the real sheet through the library
  - [x] AGENTS.md
  - [x] Events from before the switch are converted at start-up (one history action each); what the conversion changed is recorded (migration 11) and shown on the leaderboard until confirmed (`ConversionNotice`)
  - [x] R13: a three-way tie's higher place goes to every boat no tied boat beats (5.7(ii)(3))
  - [x] The old Save path removed (`applyRaceColumnState`, the per-boat 3.1.5 shields, their in-memory cache, `raceTieScoring`); its rule scenarios run through the real Save in `leaderboardCorrection.rules` (RDG1 is the A9(a) average now, R9)
  - [x] The renderer's instant-draft maths (`applyExclusions`, `shared/redress`) removed: the draft only re-ranks the edited race with the library's `applyRaceColumnEdit`; totals, discards and averages come from the preview
  - [x] Backups carry the log (2026-11-05). The backup file is `schemaVersion: 3` with `log` (the decisions in force, as `loadLog` returns them) beside `people` and the tables (kept for people and older versions, not read). Restoring it into the same event replaces the log (`replaceEventLog`: the decisions in force withdrawn, the file's appended, replayed, projected; one action that can be gone back from; nothing converted, EventLogs untouched). Importing it as a new event matches the boats through `sailorEntry` and renames them in the log with the library's new `renameBoats` (pure, tested, refuses a boat left unmapped or two boats made one); EventLogs records that the log came from a file, so the start-up conversion leaves it alone. A version 2 file (no log) is still converted from its tables; an event whose stored log no longer replays is backed up as version 2
- [x] Phase 7: every rule in the library only (2026-11-05). The owner: "I have the package for scoring and the whole logic; I don't need logic in my main code."
  - [x] What a correction does to a race (`applyRaceColumnEdit`, `scoreRaceColumn`) moved from `src/shared/raceColumnEdit.ts` into `rules/correction.ts`, with its tests (`test/correction.test.ts`); the main process (`checkedRaceColumn`, `rescoreRace`) and the renderer import it from `regatta-core`
  - [x] Point rules (`scoringPenalty`, `scoring/statusPoints`, the points of `scoreStatus`, `shared/points`): the library's `penaltyPoints`, `noPlacePoints`, `toTenth`, `sumPoints` / `exactPoints`; the code lists and their order are `NO_PLACE_CODES`, `PENALTY_CODES`, `COMMITTEE_CODES`, `REDRESS_CODES`, `RESULT_CODES`
  - [x] Discards and redress (`scoring/discards`, the count in `discardProfile`, `shared/redress`, the renderer's `applyExclusions` / `rescoreEntry` / `refreshSessionRdgAverages` / `withRedressAverage` / `averageSelectedRacePoints`): `discardCount`, `excludedScores`, `redressAverage`, and the rows' `race_excluded`; the stored setting reads as a `DiscardProfile` (`toDiscardProfile`)
  - [x] Order and names (`sailOrder`, `penaltyOrder`, `raceSeeding`, `fleetNames`, `heatSizing`, the round bar's next heat): `compareBoats`, `inRecordingOrder` / `codeRank`, `movementImbalanceExpected`, `fleetName` / `fleetIndex`, `MAX_HEAT_SIZE` / `MAX_HEATS` / `fewestHeats`, `nextInRound` (what `nextStep` now uses)
  - [x] ESLint guard: `src/` cannot import the removed modules or declare their rule functions again (`.eslintrc.js`, AGENTS.md §1)

- [x] Phase 8: one status from the library drives the screens (2026-11-05)
  - [x] regatta-core `eventStatus(state)`: series (`entries` / `qualifying` / `final`), the round, the heats being sailed (boats, races), `nextStep` (its `createRound` now says whether the Final Series may start instead), and for every action the screens offer (score / undo a heat's race, create / undo a round, start the Final Series) `ok` or the reason, and `offered`. `ok` is exactly what replay accepts: a decision is tried on the state as replay applies it (`tryDecision`), an undo is checked by the function that builds its log (`undoLastRace`, `undoLatestRound`, moved from the handlers). Tested case by case and on every prefix of 40 random events against replay (`test/status.test.ts`)
  - [x] IPC `readEventStatus` (`libraryEvent`: library heat ids to the app's heats), read under `['event', id, 'status']`; `getFinalSeriesEligibility` folded into it (`startFinal.eligibility`, same shape)
  - [x] The round bar, the heat cards' buttons, Undo round, Start Final Series and the entries page's `HeatsSummary` read it; `useRoundActions` and the submit's SHRS 3.1 warning read it fresh. Removed: `utils/roundStatus.ts`, `getLastHeats`, the undo pre-check on heat names (`laterRoundBlocksUndoMessage`), the Final Series button's group count, `creatingNewHeatsUtls.ts` (`checkRaceCountForLatestHeats`) and the Final Series handler's own table checks: the handlers refuse what the status refuses, and the chaos test checks every round action against the status read before it

## Phase 8: what changed for the user

Where the old screen (or the handler behind it) decided differently from
the library, the library is followed:

- **A heat left with no boats** (every boat moved out before racing): the
  round bar offered Create Round N / Start Final Series, then the main
  process refused ("Not all heats have the same number of races yet";
  "…not all sailed the same number of races"), counting the empty heat's 0
  races. Now the round is complete and both are done (SHRS 1.1: a heat
  with no boats has nothing to sail). Such a heat's card no longer offers
  "Score race 1".
- **A heat that sailed twice in a round** (older records): the green Create
  Round N was enabled and refused on click. Now it is shown disabled with
  the reason, "Every heat of this round must sail the same races first."
- **Undo round while the round has races**: was enabled and refused on
  click; now disabled with the reason as its title.
- **A recorded round in a one-heat event** (converted records only): Undo
  round is offered (the library takes it back); the old bar offered it
  only in rounds of several heats. Start Final Series follows the round
  being sailed (two or more heats), not every group letter ever used.
- Refusals read before asking: Create Round, Undo round and Undo race say
  the library's reason instead of a confirmation that could only fail.

## Phase 7: what changed for the user

The correction rule moved unchanged (same code, same tests, now in the
library), and the app's point, discard and order copies computed what the
library computes. Where the app copy and the library differed, the library
is followed:

- **Edit draft.** The draft re-ranks the edited race at once; totals,
  discards, the Overall and redress averages change when the library's
  preview arrives (milliseconds), not from a second calculation. Without a
  preview they stay as before the edit until Save.
- **RDG1 / RDG2 while editing** show the boat's current points in that race
  until the preview shows the library's average (RRS A9); that is also the
  value Save sends (above 0, at most 99), which the library ignores. Before,
  the renderer averaged with its own copy.
- **RDG2 from the race picker keeps her place in the order** (RRS A6.2),
  as RDG1, RDG3 and DPI always did. The picker used to drop it, so a boat
  level with her lost the shared points of the dead heat on Save.
- **Round bar.** A qualifying heat with no boats no longer holds the round
  up (it has nothing to sail; the library's rule), and "one fleet races on"
  follows the heats of the current round rather than the event's group
  count.
- **Code lists** (leaderboard menu, scoring-screen menu, export legend, the
  refusal message for an unknown code) are in the library's order: ZFP, SCP,
  T1, then SHRS 5.3 (DNF, RET, NSC, OCS, DNS, DNC, WTH, UFD, BFD, DSQ, DNE),
  DGM, DPI, RDG1-3. RAF is no longer listed anywhere (read as RET, A10).
- The leaderboard no longer reads the event's discard settings: nothing in
  the renderer counts discards.

## Conversion

The tables hold the event's state, not its history, so the converted log
is a record that leads to that state: heats as made, sheets, committee
decisions, the split (by the rules if they give the stored fleets, else as
made). What only the old app could write and the rules cannot express
exactly is reported as an anomaly; there the log's scores can differ from
the tables, and the migration must show the user every such difference:

- a result for a boat not listed in the heat (a no-heat DNC corrected to a
  finish): the log puts her in the heat, which can change the largest heat;
- a kept RDG / DPI place a later correction gave to a finisher;
- a gap in the stored places;
- a boat entered after the Final Series started (in no fleet).

The library gained three record forms for this (checked for shape only):
`heatsCreated.heats`, `roundCreated.heats`, `finalSeriesStarted.fleets`.

In the chaos test 31 of 200 random sessions hit an anomaly that changes a
score or a heat; random sessions do far stranger things than race offices.
Everywhere else the converted log gives exactly the tables' heats and
points. The known app bugs (R8, R9, SHRS 3.1(5) after a correction) are
where the app's tables are wrong, and the log follows the rules.
