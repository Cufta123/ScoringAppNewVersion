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
- The renderer runs the library itself for the edit preview, so what is
  shown before Save is what Save stores.
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
- [ ] Phase 2: 2a done — the three leaderboard reads come from the library (`functions/libraryStandings.ts`). Still to do: explanations, eligibility, `getMaxHeatSize`, then stop reading `Leaderboard` / `FinalLeaderboard`
- [ ] Phase 3
- [ ] Phase 4
- [ ] Phase 5
- [ ] Phase 6

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
