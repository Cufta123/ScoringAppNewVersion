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
- Preload bridge and exposed API: `src/main/preload.ts`
- Renderer routes: `src/renderer/App.tsx`
- Database schema and migration logic: `public/Database/DBManager.js`
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
- Uses `window.electron` API from preload.

### Preload contract

- `src/main/preload.ts` exposes grouped sqlite APIs under `window.electron.sqlite.*`.
- Wrapper throws on `false` return values, so renderer callers should expect exceptions.
- Channel names are strongly listed in `type Channels`.

## 4. Database Model (SQLite)

Database initialization and schema creation are in `public/Database/DBManager.js`.

Key tables:

- `Events` (`is_locked` flag controls mutating operations)
- `Sailors`
- `Boats`
- `Clubs`
- `Categories` (seeded with KADET/JUNIOR/SENIOR/VETERAN/MASTER)
- `Boat_Event` (boat-event association)
- `Heats`, `Races`, `Scores`, `Heat_Boat`
- `Leaderboard`, `FinalLeaderboard`, `GlobalLeaderboard`

Important migration detail:

- `Boats.sail_number` used to have a UNIQUE constraint.
- `DBManager.js` includes migration to remove that uniqueness by rebuilding table.

DB file paths:

- Packaged: under `app.getPath('userData')/scoring_app.db`
- Dev: from `public/Database/data/scoring_app.db`

## 5. Domain Rules And Scoring Notes

The heaviest scoring logic lives in `src/main/ipcHandlers/HeatRaceHandler.ts` plus:

- `src/main/functions/calculateBoatScores.ts`
- `src/main/functions/calculateFinalBoatScores.ts`
- `src/main/functions/creatingNewHeatsUtls.ts`

Observed rule implementation details:

- Supported statuses include `FINISHED`, penalties (`DNF`, `DNS`, `DSQ`, `OCS`, `ZFP`, `RET`, `SCP`, `BFD`, `UFD`, `DNC`, `NSC`, `WTH`, `DNE`, `DGM`, `DPI`) and redress variants (`RDG1`, `RDG2`, `RDG3`).
- Exclusion count logic:
  - `<4` races: 0 exclusions
  - `4-7`: 1 exclusion
  - `>=8`: `2 + floor((races - 8) / 8)`
- Some statuses are non-excludable (for example `DNE`, `DGM`).
- Tie-break logic has dedicated handling for shared-race and multi-heat scenarios.

When changing scoring logic, update or add tests first.

## 6. Event Locking Contract

Lock behavior is central and must be preserved:

- `Events.is_locked = 1` should block mutating operations for that event.
- `EventHandler.lockEvent` also updates `GlobalLeaderboard` ordering.
- Mutating handlers should check lock state before writes.

## 7. Commands Agents Should Use

Run from repo root.

- Install deps: `npm install`
- Dev app: `npm start`
- Build/package Windows: `npm run package`
- Lint: `npm run lint`
- Lint fix: `npm run lint:fix`
- Unit tests: `npm run test:unit`
- Full tests: `npm run test:full`

If native module issues occur after dependency changes:

- `npm run rebuild`

## 8. Test Map

High-signal tests in `src/__tests__` include:

- `calculateBoatScores.test.ts`
- `calculateFinalBoatScores.test.ts`
- `creatingNewHeatsUtils.test.ts`
- `HeatRaceHandler.createNewHeats.test.ts`
- `HeatRaceHandler.overallTieBreak.test.ts`
- `leaderboardStatusCodes.test.ts`
- `SHRS_comprehensive.test.ts`
- `ScoringInputComponent.test.jsx`

Jest unit config explicitly targets a subset via `jest.unit.config.ts`.

## 9. Fast Change Workflow

For most feature/fix requests, do this in order:

1. Identify if change touches renderer UI, IPC contract, handler logic, or DB schema.
2. Update types/contracts first (`preload.ts`, renderer usage, handler signatures).
3. Implement logic change in handler/functions.
4. Add or update tests in `src/__tests__`.
5. Run targeted tests, then broader test set.
6. Run lint when touching multiple files.

## 10. Known Quirks To Avoid Mistakes

- File name typo is intentional in codebase: `creatingNewHeatsUtls.ts` (not `Utils`).
- Handlers are registered by import side effects; deleting imports can silently break IPC.
- Returning `false` from preload methods is converted to thrown errors by wrapper.
- App uses hash routing, so route handling assumptions must match `HashRouter`.

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
