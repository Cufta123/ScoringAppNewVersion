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
- IPC handlers:
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
  - `/global-leaderboard`
  - `/event/:name`
  - `/event/:eventName/heat-race`
  - `/event/:eventName/leaderboard`
- Uses `window.electron` API from preload (via the `src/renderer/api/db` wrapper).

### Preload contract

- `src/main/preload.ts` exposes grouped sqlite APIs under `window.electron.sqlite.*`.
- Wrapper throws on `false` return values, so renderer callers should expect exceptions.
- Channel names are strongly listed in `type Channels`.

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
- `Leaderboard`, `FinalLeaderboard`, `GlobalLeaderboard`
- `RaceAssignmentSnapshots` (SHRS 3.1.5 pre-protest assignment order, persisted
  so the in-memory cache in `raceAssignmentSnapshot.ts` survives restarts)

Important migration details:

- `Boats.sail_number` used to have a UNIQUE constraint. `DBManager.js` migrates
  it away by rebuilding the table (note the transient `Boats_tmp` table).
- `Scores` has a unique index covered by `Scores.uniqueIndex.migration.test.ts`.
- Code that touches the DB must tolerate older databases missing newer
  tables/columns (e.g. `RaceAssignmentSnapshots` reads are wrapped in try/catch).

DB file paths:

- Packaged: under `app.getPath('userData')/scoring_app.db`
- Dev: from `public/Database/data/scoring_app.db`

## 5. Domain Rules And Scoring Notes

`HeatRaceHandler.ts` holds the IPC wiring; the actual logic has been extracted
into focused modules under `src/main/functions/`. Map of that directory:

- `calculateBoatScores.ts` — qualifying series scoring + SHRS 5.7 tie-break.
- `calculateFinalBoatScores.ts` — final-fleet scoring (A8.1/A8.2 per group).
- `creatingNewHeatsUtls.ts` — progressive/zig-zag heat assignment + movement
  tables (filename typo `Utls` is intentional, see §10).
- `discardConfig.ts` — per-event discard profile + `getExcludeCountForConfig`.
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
- `eventSnapshot.ts` — full per-event export/restore.
- `raceAssignmentSnapshot.ts` — SHRS 3.1.5 pre-protest assignment cache +
  persistence.

Shared (renderer + main): `src/shared/fleetAssignment.js`
(`computeAdjustedFleetTotals`, used for rule 4.3) and `src/shared/subgroups.js`.

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
  Qualifying Series score. (`recomputeFinalLeaderboard` produces no rows; the
  qualifying `Leaderboard` stands.)
- 1.6 — RRS T1 (post-race penalties) applies; modelled by the `T1` status.

Number/size of heats

- 2.1–2.2 — As few heats as possible; sizes as equal as possible.
- 2.3 — **Max 20 boats per heat** (`SHRS_MAX_BOATS_PER_HEAT` in
  `HeatRaceHandler.ts`; overflow governed by `shrs_heat_overflow_policy`).

Qualifying assignment (`creatingNewHeatsUtls.ts`)

- 3.1 — **Progressive**: Race 1 seeds top-down `1,2,3,4,5,5,4,3,2,1`; later
  races use the Heat Movement Table (`getNextHeatIndexByMovementTable`).
  Non-finishers ordered `DNF, RET, NSC, OCS, DNS, DNC, UFD, BFD, (DSQ)`; ties by
  alphanumeric national-letter + sail number; protest decisions do **not** move
  boats.
- 3.2 — **Pre-assignment**: equal size/ability, published before racing.
  (`shrs_qualifying_assignment_mode` = `progressive` | `pre-assigned`.)

Final Series (`calculateFinalBoatScores.ts`, `shared/fleetAssignment.ts`)

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
- RRS A7 — **Race ties**: tied places share the summed points equally.
- 5.2 (changes RRS A5.2) — A boat scored DNS/DNF/DSQ/etc. gets **(boats in the
  largest heat) + 1** points — NOT boats entered in the series.
- 5.3 — Recording order: finishers by place, then
  `DNF, RET, NSC, OCS, DNS, DNC, WTH, UFD, BFD, DSQ, DNE`; ties alphanumeric.
  Position-keeping penalties (`ZFP`, `SCP`, `T1`) keep the boat's finishing
  place (`compareSeededRows`, `scoringPenaltyStatuses`).
- 5.4 — **Discards** (per series, Qualifying and Final counted independently):
  0 below 4 completed races, 1 at 4–7, 2 at 8–15, then +1 per additional 8.
  Non-excludable: `DNE`, `DGM` (RRS 90.3(b)). Configurable per event before the
  first warning signal (`discardConfig.ts`).
- 5.5 — Overall event score = Qualifying + Final series scores. Lowest in Gold
  wins; fleets rank in order `Gold > Silver > Bronze > Copper` regardless of raw
  points.
- 5.6 — Redress averages computed separately per series.
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
- `Scores.uniqueIndex.migration.test.ts` shells out to `python`; it fails in
  environments where `python` is not on PATH (e.g. a bare `pyenv`). This is an
  environment gap, not a code regression — confirm any failure is this one.

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
- Returning `false` from preload methods is converted to thrown errors by wrapper.
- App uses hash routing, so route handling assumptions must match `HashRouter`.
- `HeatRaceHandler.ts` is intentionally thin wiring: most logic now lives in
  `src/main/functions/`. Add new pure logic there, not inline in the handler.
- `functions/` modules import `db` directly from `DBManager` (not passed in),
  and only call `db.prepare` inside functions — never at module top level, so
  importing a module never touches the database.
- When adding a preload channel, update all four: `type Channels`, the
  `electronHandler` map in `preload.ts`, the handler's `ipcMain.handle`, and the
  renderer `api/db` wrapper.

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

This repo also includes `CLAUDE.md` as a mirror pointer for Claude workflows.
If both files diverge, treat this `AGENTS.md` as source of truth and sync `CLAUDE.md`.
