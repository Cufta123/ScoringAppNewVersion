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
  - `src/main/ipcHandlers/HeatRaceHandler.ts`
- Pure/domain logic (extracted out of the handlers): `src/main/functions/`
  (see §5 for the full module map).
- Cross-process helpers: `src/shared/` (`fleetAssignment.js`, `subgroups.js`).
- Preload bridge and exposed API: `src/main/preload.ts`
- Renderer DB access wrapper: `src/renderer/api/db` (re-exports `eventDB`,
  `heatRaceDB`, etc. over `window.electron.sqlite.*`).
- Renderer routes: `src/renderer/App.tsx`
- Database schema and migration logic: `public/Database/DBManager.js`
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
- Channel names live once in `SQLITE_CHANNELS`, grouped as the renderer consumes
  them; `type Channels` and the invoker map are derived from that list.

## 4. Database Model (SQLite)

Database initialization and schema creation are in `public/Database/DBManager.js`.

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
- `ensurePerformanceIndexes()` adds `idx_races_heat_id` and `idx_heats_event_id`
  (298 ms -> 3 ms for the DNC backfill probe on a four-season database).
  `Scores(boat_id)` and `ANALYZE` are deliberately excluded — both help one
  query on the leaderboard click and hurt the other more. Re-measure before
  adding either; `DBManager.performanceIndexes.test.ts` records the numbers.

DB file paths:

- Packaged: under `app.getPath('userData')/scoring_app.db`
- Dev: from `public/Database/data/scoring_app.db`

## 5. Domain Rules And Scoring Notes

`HeatRaceHandler.ts` holds the IPC wiring; the actual logic has been extracted
into focused modules under `src/main/functions/`. Map of that directory:

- `calculateBoatScores.ts` — qualifying series scoring + SHRS 5.7 tie-break.
- `calculateFinalBoatScores.ts` — final-fleet scoring (A8.1/A8.2 per group).
- `creatingNewHeatsUtls.ts` — Race 1 serpentine seeding + Heat Movement Tables
  (filename typo `Utls` is intentional, see §10).
- `discardConfig.ts` — per-event discard profile lookup. The pure parsing/count
  logic lives in `src/shared/discardProfile.ts` and is re-exported here, so the
  renderer preview and the backend compute discards from one implementation.
- `finalLeaderboardOrder.ts` — final-leaderboard ordering: SHRS 5.5 fleet
  precedence + the SHRS 1.5 qualifying-score fallback.
- `scoringUtils.ts` — `getKeptScores`, `compareScoreArrays`, sequential tie
  resolution.
- `scoreStatus.ts` — status vocabulary, `normalizeScoreStatus`,
  `getScoringPenaltyPoints` (RRS 44.3c/T1), `compareSeededRows` (SHRS 5.3 order).
- `overallTieBreak.ts` / `explainTieBreak.ts` — overall standings tie packets
  and human-readable tie-break explanations.
- `finalSeriesEligibility.ts` — `getFinalSeriesEligibility` (whether the Final
  Series can start; rule 4.3 window detection).
- `leaderboardRecompute.ts` — rebuilds `Leaderboard` / `FinalLeaderboard` from
  raw `Scores`.
- `heatQueries.ts` — shared reads (`getLatestQualifyingHeats`,
  `getRaceCountForHeat`).
- `eventSettings.ts` — per-event SHRS configuration on the Events row:
  qualifying assignment mode (3.1/3.2), heat overflow policy and
  `SHRS_MAX_BOATS_PER_HEAT` (2.3), and the discard-profile lock (5.4).
- `raceScoring.ts` — every write to `Scores` for a single race:
  `applyRaceResultUpdate` (RRS A6.1/A6.2, SHRS 5.2), `applyRaceTieScoring`
  (RRS A7), `getMaxHeatSize`, `seedRaceWithDefaultDnsScores`,
  `ensureCompleteRaceScoresForEvent` (DNS repair +
  `ensureDncScoresForMissedQualifyingRaces`, RRS A5.1),
  `recomputeLeaderboardsForRace`.
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
- `scoringPenalty.ts` — RRS 44.3(c)/T1 points, `scoringPenaltyStatuses`, and
  `mandatoryDisplaceStatuses` (the RRS A6.1 promotion trigger).
- `discardProfile.ts` — SHRS 5.4 profile parsing + exclusion count.
- `fleetNames.ts` — SHRS 4.1 fleet naming and 5.5 precedence (`fleetRank`
  orders "Fleet 5"+ too, not just Gold/Silver/Bronze/Copper).
- `sailOrder.ts` — SHRS 5.3 / 3.1(iv) tie order: national letter then numeric
  sail number.
- `raceTieScoring.ts` — the RRS A7 place walk: tied boats share the averaged
  points of the places they occupy, position-keeping penalties consume a slot
  without being re-scored.
- `raceColumnEdit.ts` — what one result edit does to a whole race: the RRS A6.1
  promotion, the optional manual ripple, and the A7 re-average. The main
  process (`applyRaceResultUpdate`) and the renderer's edit preview
  (`handleRaceChange`) BOTH call this, so the preview cannot disagree with what
  Save persists. Each used to implement it separately — SQL on one side, array
  arithmetic on the other, kept aligned by hand and by comment. Do not
  reintroduce a local copy.

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
  `HeatRaceHandler.ts`; overflow governed by `shrs_heat_overflow_policy`).

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
  the finishing order and every boat behind her **moves up one place**. This is
  mandatory, so it is NOT gated on the leaderboard's "Shift other boats" toggle
  (`mandatoryDisplaceStatuses`; mirrored in the renderer's edit preview).
- RRS A7 — **Race ties**: tied places share the summed points equally. Enterable
  from the scoring screen via the per-row tie ("=") control, which submits a
  shared place for `applyRaceTieScoring` to average.
- RRS A5.1 / 5.3 — **Every entered boat is scored for every race in the
  series.** A boat who sailed in no heat for a round (added mid-event via
  `assignBoatToHeat`, or entered and never started) is scored **DNC** at
  (largest heat + 1), not left without a row
  (`ensureDncScoresForMissedQualifyingRaces` in `raceScoring.ts`, run as part of
  `ensureCompleteRaceScoresForEvent`). Qualifying only: in the Final Series a
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

- `calculateBoatScores.test.ts`, `calculateFinalBoatScores.test.ts`
- `SHRS_comprehensive.test.ts` (exhaustive rule walk-through)
- `scoreStatus.test.ts` (status normalization, penalty math, 5.3 order)
- `leaderboardRecompute.test.ts` (recompute glue: query/persist/transaction)
- `leaderboardStatusCodes.test.ts`, `penaltyOrder.test.ts`
- `creatingNewHeatsUtils.test.ts` (note: tests the `...Utls.ts` source)

Handler / integration:

- `HeatRaceHandler.createNewHeats.test.ts`,
  `HeatRaceHandler.overallTieBreak.test.ts`,
  `HeatRaceHandler.submitScoresAtomic.test.ts`,
  `HeatRaceHandler.updateRaceResult.test.ts`,
  `HeatRaceHandler.startFinalSeriesAtomic.test.ts`,
  `HeatRaceHandler.finalSeriesEligibility.test.ts`
- `explainTieBreak.test.ts`, `compareUtils.test.ts`
- `ScoringInputComponent.test.jsx`, `useLeaderboard.scoring.test.jsx`

`npm run test:unit` targets the explicit list in `jest.unit.config.ts`; when you
add a test, also add it there or it only runs under `test:full`. Tests avoid the
native `better-sqlite3` build — they mock `db` from `DBManager` (SQL-sniffing or
op-log mocks), so no real SQLite is needed.

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
  Heats" was `deleteHeatsByEvent` then `createInitialHeatsAtomic`; the
  destructive half ran first, so a rejected create left the event with no heats.
  `recreateInitialHeatsAtomic` plans before it wipes, in one transaction.
  `planInitialHeats` / `insertPlannedInitialHeats` exist for exactly this split.
- Renderer `raceHappened`-style state can be stale — never let it be the only
  guard on a destructive channel. `deleteHeatsByEvent`, `removeBoatFromEvent`
  and `recreateInitialHeatsAtomic` all re-check server-side.
- Async actions that mutate rounds go through `useExclusiveAction` (renderer
  hook). The ref inside it is load-bearing: two clicks in the same tick both
  read `busy === false` from state. `busy` only drives `disabled`.
- `HeatRaceHandler.ts` is intentionally thin wiring: the logic lives in
  `src/main/functions/`. Add new pure logic there, not inline in the handler.
  This had drifted — 718 lines of domain helpers had accumulated back in the
  handler and were moved out in Sept 2026. If you find yourself writing a
  non-handler function in this file, it belongs in `functions/`.
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

## 11. What To Search Only If Needed

Only run repo-wide search if needed after using this file.

- IPC channel usage: search by channel name string.
- SQL writes: search for `.run(` in `src/main/ipcHandlers`.
- Score status handling: search `status`, `penalty`, `RDG`, `exclude` in `HeatRaceHandler.ts`.

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
