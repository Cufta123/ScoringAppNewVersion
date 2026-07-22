# IOM Regatta Manager — App Overview for Design Exploration

> This document exists to brief a design tool (e.g. Claude Designer) on what this app is, who uses it, what screens it has, and how it's currently built — so it can propose visual/UX design directions. It is not a technical spec for engineers.

## 1. What this app is

**IOM Regatta Manager** is a desktop application (built with Electron) used by race officers to run **radio-controlled model sailboat regattas** — specifically IOM class (International One Metre) events, but the scoring engine follows the general "SHRS" (Sailing Handicap/Racing) + RRS (Racing Rules of Sailing) Appendix A scoring system used in fleet racing.

It replaces a spreadsheet-and-paper workflow. A **Race Officer** runs an event across a weekend: registers sailors and boats, splits them into heats, records finishing positions and penalties heat-by-heat, and the app computes live leaderboards, discards, tie-breaks, and final-series (Gold/Silver/Bronze/Copper fleet) standings automatically.

It is a **local, offline-first, single-user desktop tool** — data lives in a local SQLite database on the machine running the app, not in the cloud. There is no login/auth system; whoever has the app open is the operator.

## 2. Primary user & context of use

- **User**: a volunteer or club race officer, often not a professional software user, operating the app **rink-side** during a live regatta — sometimes on a laptop outdoors, under time pressure, between races.
- **Stakes of mistakes**: entering a result wrong or double-submitting can affect real competitive standings, so the UI leans toward confirmations, guard rails against double-submit, and clear status/error feedback (toasts).
- **Session shape**: long open-app sessions (a whole event day), frequent repetitive data entry (heat after heat, race after race), occasional lookups (leaderboard checks, sailor lookups) mixed in.
- **Tone so far**: functional, dense-information, form-and-table heavy — not a consumer/marketing app. Think "regatta scoring software" / "race management tool," closer to sports-timing software or a spreadsheet app than a social/media app.

## 3. Core user journey (what the app is _for_)

1. **Land on the app** → see a list of past/current events, or create a new one.
2. **Create an Event** → give it a name/date/location, set discard rules.
3. **Add Sailors & Boats** → register competitors, either one at a time via a form or bulk import via CSV.
4. **Run Heats & Races** (the core loop, repeated many times over an event):
   - Create a new heat (the app auto-assigns boats to heats using a progressive/zig-zag algorithm, or a pre-assigned mode).
   - Enter race results per heat: finishing order, or penalty codes (DNF, DSQ, OCS, RDG, etc.).
   - Submit scores → leaderboard recalculates automatically.
5. **Check the Leaderboard** at any point:
   - Qualifying series standings (with discards applied).
   - Once eligible, transition into the **Final Series** — boats split into Gold/Silver/Bronze/Copper fleets based on qualifying rank, each fleet races its own final heats, discards apply again.
   - Overall event result = qualifying + final series combined, tie-break logic per rule.
6. **Export / print**: starting lists, new-heat sheets, and leaderboards can be printed or exported (PDF/CSV/Excel) for posting on a notice board or archiving.
7. **(On hold)** A cross-event Global Leaderboard page exists but the feature is currently paused/not actively populated.

## 4. Screens / pages (routes)

The app is a single-window desktop app using hash-based client-side routing. Screens:

| Route                           | Screen                      | Purpose                                                                                                                                                          |
| ------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                             | **Landing Page**            | Hero + list of existing events (cards), "create new event" form, entry point to everything. First-run state shown when there are no events yet.                  |
| `/event/:name`                  | **Event Page**              | Event "hub" — sailor/boat roster management, add/import sailors, event settings (discard config), navigation into heats and leaderboard.                         |
| `/event/:eventName/heat-race`   | **Heat & Race Page**        | The core data-entry workspace: create heats, assign boats to heats, enter race results per boat (place or penalty status), submit scores.                        |
| `/event/:eventName/leaderboard` | **Leaderboard Page**        | Qualifying table, Final Series fleet tables (Gold/Silver/Bronze/Copper), compare-boats panel, tie-break explanations, RDG (redress) picker/legend, print/export. |
| `/global-leaderboard`           | **Global Leaderboard Page** | Cross-event leaderboard (feature currently on hold / not actively maintained).                                                                                   |

Shared UI elements across screens:

- **Navbar** (top nav, present on most pages)
- **Breadcrumbs** (event > heat-race / leaderboard navigation context)
- Modal dialogs (`AppModal`, `HelpModal`, `ConfirmDialogHost` for confirm-before-destructive-action prompts)
- Toast notifications (bottom-right, success/error feedback on every save/submit)
- Empty states and loading states for async data
- A "skip to main content" accessibility link

## 5. Key UI components (what needs visual design)

- **EventForm** — create/edit event, plus the event list/cards on the landing page.
- **SailorForm / SailorImport / SailorList** — add a sailor manually, or bulk-import via CSV with a preview step; list/search/edit registered sailors.
- **HeatComponent** — heat creation and boat-to-heat assignment view.
- **ScoringInputComponent** — the main data-entry grid for recording race results per boat (place numbers, or penalty codes like DNF/DSQ/OCS/RDG picked from a dropdown/legend).
- **Leaderboard components**:
  - `QualifyingTable` — main qualifying-series standings table (boats × races grid, points, discards struck through, totals).
  - `FinalFleetTable` — one per final fleet (Gold/Silver/Bronze/Copper).
  - `ComparePanel` — side-by-side tie-break comparison of two boats' score sequences.
  - `Rdg2Picker` / `RdgLegend` — redress-related pickers/legends (RDG = redress points).
  - `ScoreCell` — individual score cell, likely color/style-coded by status (finished / discarded / penalty).
  - `LeaderboardToolbar` — controls above the table (filters, print/export actions).
  - `SectionDivider` — visual separation between qualifying/final sections.
- **Navbar**, **Breadcrumbs** — navigation chrome.
- Shared primitives: `AppModal`, `HelpModal`, `EmptyState`, `LoadingState`, `ConfirmDialogHost`.

## 6. Data domain (for context, not to redesign)

Entities: **Events, Sailors, Boats, Clubs, Categories** (Kadet/Junior/Senior/Veteran/Master), **Heats, Races, Scores**, **Leaderboard / FinalLeaderboard / GlobalLeaderboard**.

Score statuses a user can enter beyond a finishing place: `FINISHED`, and penalty/status codes `DNF, DNS, DSQ, OCS, ZFP, RET, SCP, BFD, UFD, DNC, NSC, WTH, DNE, DGM, DPI`, plus redress variants `RDG1, RDG2, RDG3`. These need clear, scannable visual treatment in tables (badges/color codes), since officers scan them quickly under time pressure.

Fleets in the Final Series are named **Gold, Silver, Bronze, Copper** — an obvious opportunity for a metallic/tiered color palette if desired.

## 7. Current tech stack (for feasibility context, not required reading)

- **Electron** (desktop shell) + **React 18** (renderer, TypeScript/JSX) + **react-router-dom** (HashRouter)
- Plain CSS per page/component (no CSS framework/design system currently — `App.css` + one `.css` file per page/component)
- **react-toastify** for toasts, **react-select** for dropdowns, **react-autosuggest** for autocomplete (e.g. club/country lookups), **react-country-flag** / **react-world-flags** for nationality flags
- **Font Awesome** free icon set is already in use (`fa fa-*` classes)
- Exports: `jspdf` + `jspdf-autotable` (PDF), `exceljs` (Excel), `papaparse` (CSV import/export)
- Data: **better-sqlite3** (local SQLite file, no network/cloud)
- No existing design system, component library, or brand guidelines — this is greenfield for visual design.

## 8. Folder structure

```
ScoringApp-main/
├── AGENTS.md                 # engineering/agent operating guide (source of truth for devs)
├── CLAUDE.md                 # pointer to AGENTS.md
├── package.json
├── assets/                   # app icons, entitlements
├── public/
│   └── Database/
│       ├── DBManager.js      # SQLite schema + migrations
│       └── data/             # dev-mode SQLite database file
├── src/
│   ├── main/                          # Electron main process
│   │   ├── main.ts                    # app bootstrap, BrowserWindow
│   │   ├── menu.ts                    # native app menu
│   │   ├── preload.ts                 # contextBridge API exposed to renderer
│   │   ├── ipcHandlers/
│   │   │   ├── index.ts               # registers all IPC handlers
│   │   │   ├── EventHandler.ts
│   │   │   ├── SailorHandler.ts
│   │   │   └── HeatRaceHandler.ts     # heat/race/score IPC wiring
│   │   └── functions/                 # pure scoring/domain logic (unit-tested)
│   │       ├── calculateBoatScores.ts
│   │       ├── calculateFinalBoatScores.ts
│   │       ├── creatingNewHeatsUtls.ts
│   │       ├── discardConfig.ts
│   │       ├── scoringUtils.ts
│   │       ├── scoreStatus.ts
│   │       ├── overallTieBreak.ts / explainTieBreak.ts
│   │       ├── finalSeriesEligibility.ts
│   │       ├── leaderboardRecompute.ts
│   │       ├── heatQueries.ts
│   │       ├── eventSnapshot.ts
│   │       └── raceAssignmentSnapshot.ts
│   │
│   ├── renderer/                      # React UI (this is what gets redesigned)
│   │   ├── App.tsx                    # router + routes + toast host
│   │   ├── App.css
│   │   ├── index.tsx
│   │   ├── api/
│   │   │   └── db.ts                  # typed wrapper over window.electron.sqlite.*
│   │   ├── pages/
│   │   │   ├── LandingPage/           # "/" — event list + create event
│   │   │   ├── EventPage/             # "/event/:name" — sailor/boat roster hub
│   │   │   ├── HeatRacePage/          # "/event/:name/heat-race" — scoring entry
│   │   │   ├── LeaderboardPage/       # "/event/:name/leaderboard" — standings
│   │   │   └── GlobalLeaderboardPage/ # "/global-leaderboard" — on hold
│   │   ├── components/
│   │   │   ├── Navbar.tsx
│   │   │   ├── EventForm.tsx
│   │   │   ├── SailorForm.tsx
│   │   │   ├── SailorImport.tsx
│   │   │   ├── SailorList.tsx
│   │   │   ├── HeatComponent.tsx
│   │   │   ├── ScoringInputComponent.tsx
│   │   │   ├── leaderboard/
│   │   │   │   ├── QualifyingTable.tsx
│   │   │   │   ├── FinalFleetTable.tsx
│   │   │   │   ├── ComparePanel.tsx
│   │   │   │   ├── LeaderboardToolbar.tsx
│   │   │   │   ├── Rdg2Picker.tsx
│   │   │   │   ├── RdgLegend.tsx
│   │   │   │   ├── ScoreCell.tsx
│   │   │   │   └── SectionDivider.tsx
│   │   │   └── shared/
│   │   │       ├── AppModal.tsx
│   │   │       ├── Breadcrumbs.tsx
│   │   │       ├── ConfirmDialogHost.tsx
│   │   │       ├── EmptyState.tsx
│   │   │       ├── HelpModal.tsx
│   │   │       └── LoadingState.tsx
│   │   ├── constants/                 # flag-code maps, penalty label text
│   │   ├── hooks/
│   │   │   └── useLeaderboard.ts
│   │   ├── utils/                     # print/export helpers, formatting, etc.
│   │   └── types.ts
│   │
│   ├── shared/                        # logic shared between main & renderer
│   │   ├── fleetAssignment.ts         # final-fleet split logic
│   │   ├── scoringPenalty.ts
│   │   └── subgroups.ts
│   │
│   └── __tests__/                     # Jest unit/integration tests
│
├── e2e/                       # Playwright end-to-end tests
├── docs/
└── scripts/
```

## 9. What design exploration should focus on

Given the above, useful design directions to explore might include:

- A cohesive **visual system** (color, type, spacing) to replace the current ad-hoc per-page CSS — the app has no design system today.
- **Data-dense table design** for the leaderboard (qualifying grid, final fleets, discard strike-through, penalty badges) that stays scannable at a glance, rink-side, possibly in bright outdoor light.
- A clear **status/penalty badge language** (color + icon + label) for the ~15 score status codes, reusable across the scoring entry grid and the leaderboard tables.
- **Fast, low-friction data entry** patterns for the Heat & Race scoring screen — this is the highest-frequency, highest-repetition screen in the app.
- A **fleet identity system** for Gold/Silver/Bronze/Copper (final series) that's visually distinct but not gimmicky.
- Sensible **empty/first-run states** (new event, no sailors yet, no heats yet) and **confirmation/destructive-action** patterns, since the app already leans on toasts and confirm dialogs for a non-technical, time-pressured user.
- A **print/export** visual treatment (starting lists, new-heat sheets, leaderboard exports) that looks good both on-screen and on a printed notice-board sheet.

This is a **utility tool for a niche sport**, not a consumer product — clarity, density-without-clutter, and speed of scanning/entry should outweigh decorative flourish.
