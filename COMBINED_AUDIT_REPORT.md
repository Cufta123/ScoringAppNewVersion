# Combined Audit Report — IOM Regatta Manager (ScoringApp)

**Assembled:** 2026-07-22 · **Branch:** `fix/usability-severity3`

This document merges the six standalone audit reports into a single deduplicated
reference. Where the same defect was reported by more than one audit, it appears **once**
here with all sources tagged. Full narrative detail (failure scenarios, code traces)
remains in the original reports.

## Source reports

| Tag       | File                               | Scope                                   | Raw findings |
| --------- | ---------------------------------- | --------------------------------------- | ------------ |
| **HRH**   | `AUDIT_REPORT.md`                  | Heat Race Handler subsystem (8 files)   | 36           |
| **CMP**   | `AUDIT_REPORT_COMPREHENSIVE.md`    | Leaderboard, heats & scoring (broad)    | 65           |
| **UIX**   | `UI_UX_AUDIT_REPORT_2026-07-22.md` | UI/UX, WCAG, navigation (21+ files)     | ~50          |
| **MEGA**  | `LEADERBOARD_MEGA_AUDIT_REPORT.md` | Leaderboard hook/tables/cells (deep)    | 50+ new      |
| **SI**    | `SCORING_INPUT_AUDIT_REPORT.md`    | ScoringInputComponent + write path      | 26           |
| **RULES** | `docs/SCORING_AUDIT.md`            | SHRS 2026-1 / RRS Appendix A compliance | C/M/m items  |

**Baseline (latest, from MEGA + RULES):** TypeScript `tsc --noEmit` clean; ESLint clean in
production (18 errors in `e2e/` only); unit suite 593–605 passing with **1 known
environment failure** (`python` not on PATH in a migration test). Orphaned test files not in
`jest.unit.config.ts`: `App.test.tsx`, `ScoreCell.editAtMax.test.jsx`.

---

## Deduplication map

Issues that multiple audits found independently, now merged into single entries below:

| Merged finding                                                                       | Combined ID         | Reported by                                                    |
| ------------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------- |
| `Heat_Boat` missing `UNIQUE(heat_id, boat_id)` → duplicate boats / score inflation   | **BK-1**            | HRH M5, CMP B-3, MEGA C-NEW-5                                  |
| `fetchLeaderboard` vs `checkFinalSeriesStarted` race / no cancellation / stale edits | **LB-1**            | CMP B-1, CMP D-13, MEGA H-NEW-11, UIX 7.3                      |
| State-based double-submit guards (should be ref-based)                               | **LB-2 / SI-2**     | CMP C-3, MEGA C-NEW-3, UIX 7.1, SI D-5/L13                     |
| CSV formula/newline injection in export                                              | **LB-6**            | CMP B-6, MEGA M-NEW-24                                         |
| Shift-mode cascade skips ZFP/SCP/T1                                                  | **LB-7**            | CMP C-1, MEGA M-NEW-7                                          |
| `computeSwapEdits` vacated place / 3+ boat conflicts                                 | **LB-8**            | CMP C-2, MEGA M-NEW-3, MEGA M-NEW-19                           |
| `processLeaderboardEntry` discards computed total                                    | **LB-9**            | CMP C-13, MEGA H-NEW-12                                        |
| Position-keeping penalty set duplicated across files                                 | **LB-10**           | CMP C-14, MEGA M-NEW-16, MEGA H-NEW-18                         |
| All `<th>` missing `scope`                                                           | **UX-A1**           | CMP C-16, MEGA H-NEW-19                                        |
| `Rdg2Picker` no focus trap / role=dialog                                             | **UX-A2**           | CMP C-17, MEGA H-NEW-20                                        |
| `raceGrid.key` optional → duplicate React keys                                       | **LB-15**           | CMP C-25, MEGA M-NEW-14                                        |
| `activeTab` permanently 'final' / dead                                               | **LB-16**           | CMP E-5, MEGA M-NEW-21, MEGA M-NEW-23                          |
| `updateEventLeaderboard` returns `undefined`                                         | **BK-9**            | HRH N2, MEGA H-NEW-14, MEGA I-5                                |
| HeatComponent effect depends on `event` object not `event_id`                        | **UX-S1**           | CMP B-4, HRH L9                                                |
| `handleDisplayHeats()` called without `await` in `runExclusive`                      | **UX-S2**           | HRH M8, CMP C-4                                                |
| "No heats yet" empty-state flash during load                                         | **UX-S3**           | CMP C-19, UIX 4.5, HRH L7                                      |
| `rememberSnapshot` stale closure                                                     | **UX-S4**           | HRH M9, CMP D-10                                               |
| Missing `onDragEnd` on ScoringInputComponent DnD                                     | **SI-6**            | CMP C-8, CMP C-9, SI M6, SI M9                                 |
| `place \|\| penaltyPlace` → wrong SHRS 5.2 non-finisher position                     | **BK-3**            | HRH M11, SI H3/M10, SI L12                                     |
| Drag-and-drop not keyboard/touch accessible                                          | **UX-A3**           | CMP A-1/A-2/C-21, UIX 2.1/8.1, MEGA H-NEW-10, SI               |
| Discard count: per-boat vs series-wide inconsistencies                               | **RULE-C1 / LB-11** | RULES C1/M4 (fixed), MEGA H-NEW-2/M-NEW-1/M-NEW-20             |
| A8 tie fallback invents order from `boat_id`                                         | **RULE-M8 / LB-12** | RULES M8 (fixed qual/overall), MEGA H-NEW-1 (final still open) |

---

# Part 1 — Scoring / Heat Race Backend (`HeatRaceHandler.ts`, `DBManager.js`, recompute)

### 🔴 CRITICAL

**BK-1 — `Heat_Boat` has no `UNIQUE(heat_id, boat_id)`; transfers/inserts can duplicate a boat**
_Sources: HRH M5, CMP B-3, MEGA C-NEW-5._ `transferBoatBetweenHeats` DELETEs from source with
`changes:0` when the boat is absent, then unconditionally INSERTs into target. With no UNIQUE
constraint a boat can appear twice in a heat. Consequences: `getMaxHeatSize` double-counts
(inflates every non-finisher penalty by a point); `seedRaceWithDefaultDnsScores` inserts two DNS
rows; and `recomputeFinalLeaderboard`'s `Heat_Boat LEFT JOIN Scores` multiplies `SUM(points)` by the
duplication factor (`leaderboardRecompute.ts:97-106`). **Fix:** add the UNIQUE constraint; add
`SELECT DISTINCT` dedup in the recompute query; dedup-check in `insertHeatBoat`/`transferBoatBetweenHeats`.

**BK-2 — `startFinalSeriesAtomic` WTH filter uses ANY-race-WTH, not ALL-races-WTH (SHRS violation)**
_Source: HRH C1 (`HeatRaceHandler.ts:1355-1364`)._ A boat is classed withdrawn if _any one_
qualifying race is `WTH`. Under SHRS a withdrawn boat has withdrawn from the _whole series_. A boat
that DNS'd one race but sailed the rest is wrongly sorted to the bottom of final-fleet assignment.

**BK-4 — Duplicate/empty sail numbers silently score the wrong boat**
_Source: HRH C2 (`:1087-1089`)._ `boatsBySail` is a `Map` keyed by sail number in
`submitHeatRaceScoresAtomic`; a second boat sharing a sail number overwrites the first. The
`UNMATCHED_SAILS` guard doesn't catch it (key exists). First boat keeps its DNS seed; its result is
lost. Related: HRH L6 (`createInitialHeatsAtomic` doesn't validate distinct sail numbers).

### 🟠 HIGH

**BK-3 — Non-scoring-penalty boats get frontend sequential position instead of SHRS 5.2 place**
_Sources: HRH M11, SI H3/M10, SI L12 (`:1140`)._ `position = place || penaltyPlace` — `place` is
always ≥1 from the frontend, so the `|| penaltyPlace` branch never fires and DSQ/DNF/DNS boats get
sequential positions (5, 6, …) instead of the shared `maxHeatSize + 1` (SHRS 5.2). Points _are_
correct, so rankings are right but stored/displayed race positions are wrong. **Fix:** `position = penaltyPlace`
for non-scoring penalties. (`place || penaltyPlace` also masks 0/NaN input — HRH M11.)

**BK-5 — Transaction boundaries: writes commit before recompute / seeding not atomic**
_Sources: HRH C3, HRH C4, CMP B-2, CMP C-10, CMP C-11, SI H2._ Several write paths are not wrapped
so a later failure leaves partial state:

- `insertRace` INSERTs then seeds DNS outside one transaction → orphan race with zero scores (HRH C3, CMP C-11).
- `insertScore` does UPDATE-then-INSERT (and tie-scoring, discard lock) with no transaction → concurrent calls double-INSERT / race (HRH C4, CMP C-10).
- `updateRaceResult` runs 2–3 sequential UPDATEs then recompute, unwrapped (CMP B-2).
- `submitHeatRaceScoresAtomic`: `writeScores()` commits, _then_ `recomputeEventLeaderboard`/`recomputeFinalLeaderboard` runs unwrapped; a recompute failure leaves scores committed + stale leaderboard, and **retry creates a duplicate race** (SI H2).

  **Fix:** wrap each handler body (writes + recompute) in one `db.transaction()`. Note SI Appendix A: the
  earlier "nested transaction fails in prod" claim is **incorrect** — better-sqlite3 v12.11.1 converts
  inner transactions to savepoints; the redundant nesting is a LOW code smell only.

**BK-6 — NaN position/points written to `Scores` without validation**
_Source: HRH H1 (`:175, 1127-1128, 1151, 1155, 1206, 1914-1915`)._ `Number(new_position)` can yield
`NaN`; bound to a `REAL NOT NULL` column it becomes 0 or NULL (opaque `SQLITE_CONSTRAINT`, whole batch
rolls back). Multiple call sites. Related: HRH H2 (FINISHED boat with `place=0` writes position 0 &
points 0), CMP C-23/C-24 (no final IPC sanitization; `min={1}` blocks legit <1 RDG/DPI values).
**Fix:** validate finite positive integer server-side; clamp 1..N.

**BK-7 — `updateScore` / `deleteScore` don't re-run tie scoring or recompute**
_Sources: HRH H3, HRH M6._ `updateScore` updates the row + locks discard, but never calls
`applyRaceTieScoring(race_id)` → stale A7 tie points for other finishers. `deleteScore` only DELETEs →
remaining tied boats keep stale averaged points; no leaderboard recompute. **Fix:** call
`applyRaceTieScoring` + recompute after both.

**BK-8 — Leaderboard recompute skipped/silently swallowed after qualifying race scored**
_Source: HRH H8 (`:1172-1185`)._ If `getLatestQualifyingHeats`/`getRaceCountForHeat` throws, the error
is caught silently, `allHeatsEqual` stays false, `recomputeEventLeaderboard` never runs — standings go
stale with no error surfaced.

**BK — latent race conditions & error handling (HIGH):**

- HRH H6 — `existingRaceCount` read outside `writeScores` transaction; safe only while no `await` exists between read and txn.
- HRH H7 — payload destructuring outside try/catch in `submitHeatRaceScoresAtomic` → opaque TypeError on bad payload.

### 🟡 MEDIUM

- **BK-9 — `updateEventLeaderboard` returns `undefined`** (should be `{success:true}` like `updateFinalLeaderboard`). _HRH N2, MEGA H-NEW-14, MEGA I-5._
- **HRH M1** — discard lock is a one-way latch; undo handlers never clear `shrs_discard_locked_*`, so the discard profile stays locked with no way to unlock.
- **HRH M2 / CMP mention** — SQL IN-clause built by string interpolation of status constants (`:235-237, 395-397`); safe today (trusted constants) but violates prepared-statement discipline → injection vector if statuses become user-configurable.
- **HRH M3** — `saveLeaderboardRaceResultsAtomic` wraps edits + recompute in one txn; recompute failure rolls back _all_ valid score edits.
- **CMP B-12** — same handler: in-memory snapshot Map mutated inside txn is **not** reverted on rollback → cache/DB divergence after restart.
- **HRH M4** — `submitHeatRaceScoresAtomic` trusts payload `event_id` without cross-checking the heat's actual event → wrong `getMaxHeatSize` / wrong leaderboard recomputed.
- **HRH M7** — `completedFinalRaceCount` counts races per-heat not per-fleet (SHRS 1.5); one scored fleet triggers combined overall scoring while another fleet has none.
- **MEGA M-NEW-26** — recompute transactions use DEFERRED mode → `SQLITE_BUSY` risk; use `{behavior:'immediate'}`.
- **MEGA I-2** — dual leaderboard recompute per save (`saveLeaderboardRaceResultsAtomic` recomputes inside txn, then `fetchLeaderboard`→`updateEventLeaderboard` recomputes again).
- **MEGA I-3 / I-1** — WHERE-on-LEFT-JOIN pattern (semantically INNER) in `readLeaderboard`/`startFinalSeriesAtomic`; `boat_id`/`race_id` type degrades number→string through GROUP_CONCAT round-trip (strict `===` fails silently).

### 🔵 LOW

- HRH L1 — `readOverallLeaderboard` `overall_points` NULL when `total_points_final` NULL (use `COALESCE(...,0)`).
- HRH L2 — sequential ranks ignore ties (tied boats should share rank).
- HRH L3 — `deleteHeatsByEvent` over-broad empty catch swallows real SQL errors.
- HRH L4 — `getRankedBoatsInHeatForRace` can produce empty-string status.
- HRH L5 — handlers accept any `event_id` unvalidated → silent `[]`.
- HRH L12 — `saveLeaderboardRaceResultsAtomic` silently discards non-array `operations` and returns `{success:true, updatedCount:0}`.
- MEGA H-NEW-17 — `readGlobalLeaderboard` SQL `ORDER BY` overridden by JS re-sort (fragile).
- CMP D-19 — `deleteEvent` doesn't clean up `RaceAssignmentSnapshots` orphans.
- CMP D-20 / MEGA I-3 — `readLeaderboard` excludes boats having Leaderboard entries but zero Scores.
- MEGA L-NEW-40 — unnecessary `COALESCE` on `Scores.status` (NOT NULL) across ~7 queries.

**Notes (non-defects):** HRH N1 (`undoLastScoredRace` dead code), N3–N10 (minor: missing dialog parent
window, filename typo `creatingNewHeatsUtls.ts`, `any`-typed cache key, unvalidated IPC `as` casts).

---

# Part 2 — Scoring Input (live race entry: `ScoringInputComponent.tsx`, `HeatRacePage.tsx`, `App.css`)

> SI confirmed **0 CRITICAL** (nested-transaction claim disproved — see BK-5).

### 🟠 HIGH

- **SI H1 — Penalty-select touch target ~26-29px** (`App.css:1706`). Below the 44px minimum; unusable on a rocking jury boat. No touch handlers, no media overrides. **Fix:** `min-height:44px`, larger padding.
- **SI-2 — double-submit guard is state-based** — see LB-2 (shared pattern). `handleSubmit`'s `if (submitting) return` uses batched React state; the "missing boats" branch never sets `submitting` → toast-spam on rapid clicks (SI L13). **Fix:** `useRef` guard, matching HeatComponent's `runExclusive`.
- **CMP B-5 — unhandled `onSubmit` rejection**: try/finally with no catch re-enables the button; scorer believes scores saved when the DB write failed. **Fix:** catch + `reportError`.

### 🟡 MEDIUM

- **SI M1** — boat-fetch failure has no inline error/retry; `validBoats` stays `[]`, silently breaking all interaction.
- **SI M2 / UIX 8.3 (HIGH)** — penalty selector lives only in the left (boat-list) panel while the workflow is on the right → cross-panel hunting per boat. **Fix:** inline penalty control on right-panel rows.
- **SI M3** — `.finish-place-input` ~34px tall / 52px wide with spinner arrows; too small for touch.
- **SI M4** — penalty-only boat stays as orphan **FINISHED** finisher when the penalty is cleared (no `autoAdded` flag). Corrupts the race result on submit.
- **SI M5** — up/down reorder of a displacing-penalty boat is immediately reversed by `getOrderedBoatNumbers`/`orderBoatsByPenalty`; UI "fights" the user.
- **SI-6 — no `onDragEnd`/`onDragLeave`; DnD can't drop at end of list** _(SI M6+M9, CMP C-8+C-9)_. Cancelled drags leak stale `draggingIndex`/`dropIndex`; end-of-list drop indicator is dead code (`dropIndex === length` unreachable). **Fix:** add `onDragEnd` reset + `<ul>`-level `onDragOver` for the tail zone.
- **SI M7** — navigation-guard stale closure: submit resolving during the "discard?" dialog silently ignores the user's "Keep scoring" choice.
- **SI M8** — `validBoats` fetched once on mount; external heat-membership changes never re-fetched → stale validation.
- **UIX 8.2 (Critical)** — Submit button looks disabled (`cursor:not-allowed` + muted) but still works and surfaces the missing-boats hint; users never click it. **Fix:** `cursor:pointer`, keep muted styling.
- **CMP B-7 / UIX 8.4** — two-step add-then-reorder flow too slow under race pressure; no "Clear All"/reset.
- **CMP C-27 / UIX 8.7** — 15-option penalty dropdown, no `<optgroup>`, no inline explanations.
- **CMP C-28** — cannot submit partial heat results (`allBoatsAccountedFor` requires every boat).

### 🔵 LOW

SI L1 (silent penalty auto-add), L2 (added-row contrast in sunlight), L3 (invalid-sail warning gives no
next step), L4/L14 (empty-heat "0 of 0 scored"), L5 (Set dedup type mismatch — unreachable), L6
(`normalizeBoatNumber` → "null"/"undefined"), L7 (`parseInt` truncates decimals silently), L8 (empty
heat allows submit → orphan race, also CMP-adjacent), L9 (unreachable penalty safety-net dead code),
L10 (clearing displacing penalty repositions oddly), L11 (non-`UNMATCHED_SAILS` `ok:false` falsely
reported as success). Plus CMP D-1..D-7 (parseInt `"5abc"`→5, `__proto__` sail-key theoretical risk,
setState on unmounted, stale `validBoats`).

---

# Part 3 — Leaderboard (`useLeaderboard.ts`, `ScoreCell.tsx`, Qualifying/FinalFleetTable, RdgLegend, Rdg2Picker, ComparePanel)

### 🔴 CRITICAL

**LB-3 — Stale RDG2 picker overrides an explicit non-RDG2 status change** _(MEGA C-NEW-1,
`ScoreCell.tsx:232-246` + `useLeaderboard.ts:1132-1134`)._ Open picker → change status to DNS/FINISHED →
click Apply: `confirmRdg2` unconditionally re-sets `RDG2`, silently reverting the user's choice
(ScoreCell onChange never calls `setRdg2Picker(null)` for non-RDG2). **Fix:** clear the picker on
non-RDG2 change + guard `confirmRdg2` that the status is still RDG2.

**LB-4 — Duplicate React keys when `race_id` is null** _(MEGA C-NEW-2, `QualifyingTable.tsx:330`)._
`key={ev-${boat_id}-${raceId}}` collides for DNS placeholder rows with null race_ids → duplicate-key
warnings + DOM misreconciliation. **Fix:** include race index: `${raceId ?? ri}`.

**LB-2 — State-based double-submit guard in `handleSave` allows concurrent saves** _(MEGA C-NEW-3,
CMP C-3, UIX 7.1; `:1355`)._ `if (saving) return` uses batched state, and `saving` is only set _after_
the `confirmChoice` dialog — two clicks start two `saveLeaderboardRaceResultsAtomic` chains. **Fix:**
`savingRef` set synchronously before any dialog.

**LB-5 — Edits not cleared when `fetchLeaderboard` throws after a successful atomic save** _(MEGA
C-NEW-4, `:1448-1451`)._ Save persists, `fetchLeaderboard()` throws → jumps to outer catch, so
`userEditsRef.clear()` and `setEditMode(false)` never run. Retry re-sends stale pre-save edits on top of
already-persisted data. **Fix:** clear edits + exit edit mode _before_ `fetchLeaderboard`.

### 🟠 HIGH

**LB-1 — `fetchLeaderboard` vs `checkFinalSeriesStarted` race; no cancellation; stale edits retained**
_(CMP B-1, CMP D-13, MEGA H-NEW-11, UIX 7.3; `:459-581`)._ Both fire on mount with no `cancelled` flag.
A late qualifying-mode fetch overwrites correct final-series data; and when `finalSeriesStarted` flips,
`fetchLeaderboard` re-runs without clearing `userEditsRef` → stale edits later applied to the wrong race
columns. **Fix:** add cancellation cleanup (pattern already used for `maxHeatSizes`); clear
`userEditsRef` at the top of `fetchLeaderboard`; disable edit mode on re-fetch.

**LB-11 — Series-wide `excludeCount` can exceed a boat's own race count → score zeroed** _(MEGA
H-NEW-2, `calculateBoatScores.ts:255-270`)._ A late-entering boat with few races has all scores
excluded → `totalPoints=0`, ranked first. **Fix:** `Math.min(excludeCount, boat.number_of_races)`.
_Related renderer mismatch:_ **MEGA M-NEW-1** — `applyExclusions` (renderer, `leaderboardUtils.ts:96`)
uses per-boat `rawPositions.length` while backend uses series-wide max → visible exclusions disagree
with the stored total. **MEGA M-NEW-20** — `calculateFinalBoatScores` claimed to use per-boat count
(inconsistent with qualifying; _not verified_). See RULE-C1 for the fixed backend baseline.

**LB-12 — Final-series tie-break still uses `boat_id` as artificial tiebreaker (SHRS 5.7 violation)**
_(MEGA H-NEW-1, `calculateFinalBoatScores.ts:148`)._ `String(a.boat_id).localeCompare(...)` separates
truly-tied boats. The qualifying/overall paths were **fixed** (RULES M8) to return `0`; the **final
path appears unfixed** — flag as an incomplete fix / regression. **Fix:** `return 0`.

**LB-9 — `processLeaderboardEntry` discards the total computed by `applyExclusions`** _(CMP C-13, MEGA
H-NEW-12; `leaderboardUtils.ts:145-158`)._ Uses DB-stored `total_points_final`; if the discard profile
changed but wasn't recomputed, parentheses (markings) and the numeric total disagree. **Fix:** use the
locally computed `total`.

**LB-7 — Shift-mode cascade skips position-keeping penalties (ZFP/SCP/T1)** _(CMP C-1, MEGA M-NEW-7;
`:1044-1065`)._ Ripple loop skips _all_ `PENALTY_CODES`; ZFP/SCP/T1 occupy real slots and should shift.
`rerankRaceColumn` only updates FINISHED → duplicate positions in preview. **Fix:** filter only hard
penalties.

**LB-8 — `computeSwapEdits`: vacated place read from saved (not editable) state; breaks for 3+ boats**
_(CMP C-2, MEGA M-NEW-3, MEGA M-NEW-19; `:1310-1351`)._ Only `movedHere[0]` is considered; other
conflicting boats collapse onto one vacated place, creating a new silent conflict. **Fix:** N-boat
swap-chain algorithm; check the editable leaderboard for the vacated place.

**ScoreCell / RDG (HIGH):**

- **MEGA H-NEW-3** — edit-mode `<input type="number">` has **no keyboard handlers** (Enter/Escape/Tab); every keystroke commits, so Escape can't cancel. (WCAG 2.1.1)
- **MEGA H-NEW-4** — `type="number"` renders **blank** for penalty-code values (e.g. "DSQ") on disabled cells → looks broken. **Fix:** `type="text"` when disabled.
- **MEGA H-NEW-5** — **RAF silently converted to RET** on any status-select interaction (`value={raceStatus==='RAF'?'RET':...}`); inspecting the dropdown persists RET, losing RAF irreversibly.
- **MEGA H-NEW-8** — `confirmRdg2` doesn't bounds-check race indices; stale picker indices after a data reload compute the average from the wrong races.
- **MEGA H-NEW-9** — `toScoreValuesForTotal` returns raw display strings ("DNF") for non-scoring penalties → `parseFloat`→NaN→0 in `recomputeEntryScores`; edit **preview** total wrong (save unaffected).

**RDG legend / final-fleet display (HIGH):**

- **MEGA H-NEW-6** — RdgLegend omits qualifying RDG cells shown in the final-series view (legend source = final entries only).
- **MEGA H-NEW-7** — `rdgMeta` key `boatId-raceIndex` doesn't distinguish Q vs F series → latent collision; also blocks H-NEW-6 fix.
- **MEGA H-NEW-15** — `finalRaceCount = entries[0].races.length`; if the top-ranked boat has 0 final races, all other boats' final scores become invisible. **Fix:** `Math.max(...entries.map(e=>e.races?.length||0))`.
- **MEGA H-NEW-10 / UX-A3** — clickable compare-mode `<tr>` in Qualifying/FinalFleetTable not keyboard-accessible.

**Accessibility (HIGH, leaderboard):** UX-A1 (`<th scope>`), UX-A2 (Rdg2Picker focus trap) — see Part 5.

### 🟡 MEDIUM

- **LB-15 — `raceGrid.key` optional → duplicate keys** _(CMP C-25, MEGA M-NEW-14)_; fall back to `label ?? index`.
- **LB-16 — `activeTab` set to 'final' once and never reset; overwrites user tab preference** _(CMP E-5, MEGA M-NEW-21, M-NEW-23)_.
- **LB-10 — position-keeping penalty set duplicated** across `penaltyOrder.ts:10` and `scoringPenalty.ts:6` _(CMP C-14, MEGA M-NEW-16, H-NEW-18)_; single-source it.
- **MEGA M-NEW-2** — `applyExclusions` tie-break uses array index vs backend's `race_number, race_id`; diverges if arrays reorder.
- **MEGA M-NEW-4** — overlapping RDG cells computed from one stale snapshot (RRS A9 wants post-change points).
- **MEGA M-NEW-5** — `hasUnsavedChanges` uses `JSON.stringify` equality with no float tolerance → spurious "unsaved changes" from 5.0 vs 4.999999999.
- **MEGA M-NEW-6** — `getPenaltyPosition` uses `size || entryCount` (`||` treats 0 as missing) → wrong penalty position for empty series; use `??`.
- **MEGA M-NEW-8** — ComparePanel animation effect: early returns don't clear `timerRef`; stale timer overwrites displayed value.
- **MEGA M-NEW-10/11 / I-4** — `Rdg2Picker` `new Set(selectedIndices)` unguarded at `:239` (guarded at `:181`) → crash on programmatic state.
- **MEGA M-NEW-12** — Rdg2Picker Escape handler doesn't `stopPropagation` → other Escape handlers also fire.
- **MEGA M-NEW-13** — FinalFleetTable header (`finalRaceCount`) vs body (`entry.races.map`) use inconsistent counts → blank/mismatched cells.
- **MEGA M-NEW-15** — ComparePanel `tied` optional; `!tied` fires on `undefined`.
- **MEGA M-NEW-17** — malformed router-state event `{event:{}}` bypasses deep-link recovery (no field validation).
- **MEGA M-NEW-18** — leaderboard not refreshed on SPA back-navigation (effect deps stable).
- **MEGA M-NEW-25** — `toggleEditMode` lacks `saving` guard → discard during in-flight save.
- **MEGA M-NEW-9 / UIX 6.5** — RDG legend has no overflow containment → wall of text for many entries.
- **LB-6 — CSV injection** — see Part 6 (security).
- **CMP C-15/C-20** — shared-race yellow indicator (~1.1:1) and teal buttons (~3.5:1) unreadable in sunlight.
- **CMP C-12** — inconsistent exclusion tiebreaker: `leaderboardUtils.ts:115` (earliest race, correct) vs `fleetAssignment.ts:105-108` (latest race). Align to SHRS A2.1 earliest-first.

### 🔵 LOW

MEGA L-NEW-1..40 (mostly ScoreCell/Qualifying/FinalFleetTable/RdgLegend/Rdg2Picker/Toolbar polish:
excluded-value strikethrough missing, `min/step` vs decimal RDG3/DPI, `#444`/`#0` hardcoded colors break
dark mode, missing ARIA on legend, no focus restoration on picker close, ExportDropdown no
Escape/aria-expanded/keyboard-nav/loading-state, `JSON.stringify` deep-compare cost, `exportToExcel`
unused, `parseRaceNum` returns 0 for penalty codes, `applyExclusions` defaults missing status to
FINISHED). CMP D-12 (unreachable RDG branch), D-14 (zero-change save reports "saved"), D-15/D-17
(compare flicker / uncleared setTimeout), D-16 (cleared input snaps back), D-18 (`key` uses optional
`boat_id`), D-21/D-22 (`getScoringPenaltyPoints` silent fallback, RAF missing from penalty order).

---

# Part 4 — SHRS 2026-1 / RRS Appendix A Rules Compliance (`docs/SCORING_AUDIT.md`)

This audit is rules-focused and tracks fixes. **Status legend:** ✅ confirmed · ⚠️ plausible (not
re-verified) · ⚖️ needs a rule ruling.

### Already FIXED (with regression tests) — recorded for traceability

| ID                 | Fix                                                                                                      | Files                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **RULE-C1**        | Discard count now series-wide, not per-boat (SHRS 5.4)                                                   | `calculateBoatScores.ts`                                                             |
| RULE-C2            | RDG no longer re-ranks other boats even with shift on (A6.2)                                             | `HeatRaceHandler.ts`                                                                 |
| RULE-C3            | ZFP/SCP/T1 boats move up on a DSQ ahead + points recomputed; no phantom A7 tie                           | `HeatRaceHandler.ts`                                                                 |
| RULE-M1 / M1-Final | Non-finisher points renormalized to series-wide largest heat at recompute (Qual **and** Final, SHRS 5.2) | `leaderboardRecompute.ts`, `heatQueries.ts`, `scoreStatus.ts`                        |
| RULE-M3            | Rule 4.3 excludes the _second-worst_ score, not "+1 discard"                                             | `fleetAssignment.ts`                                                                 |
| RULE-M4            | Fleet-assignment 5.4/4.3 window uses series-wide race count                                              | `fleetAssignment.ts`                                                                 |
| RULE-M5            | Scoring-penalty base = DNF score (`maxBoats+1`) — off-by-one fixed (RRS 44.3(c))                         | `scoringPenalty.ts`                                                                  |
| RULE-M6            | Sail numbers sort numerically (9 before 10)                                                              | `scoreStatus.ts`                                                                     |
| RULE-M7 / M7b      | Overall A8.2 compares final-series before qualifying (comparator + explain panel)                        | `overallTieBreak.ts`, `explainTieBreak.ts`                                           |
| **RULE-M8**        | Unresolved A8.1/A8.2 ties stay tied (no `boat_id` invented order) — qualifying + overall                 | `calculateBoatScores.ts`, `overallTieBreak.ts`, `explainTieBreak.ts`                 |
| RULE-M9            | DPI (A10) keeps protest-committee points, edit-flow entry (mirrors RDG3)                                 | `scoreStatus.ts`, `HeatRaceHandler.ts`, `useLeaderboard.ts`, `ScoreCell.tsx`, others |
| RULE-M2            | ❌ **WITHDRAWN** — not a bug; SHRS 5.2 uses one series-wide largest-heat value (confirmed w/ organiser)  | —                                                                                    |

> ⚠️ **Cross-report reconciliation:** MEGA **LB-12 (H-NEW-1)** reports `calculateFinalBoatScores.ts:148`
> **still** uses the `boat_id` tiebreaker, i.e. RULE-M8's fix may not have reached the _final_ comparator.
> MEGA **LB-11 (H-NEW-2)** is the residual edge of RULE-C1's series-wide fix (late entrants over-discarded).
> Verify both against current code before closing.

### Still OPEN

- **RULE-M10 ⚠️** — RDG2 pools qualifying + final race points into one average (SHRS 5.6 wants per-series). `useLeaderboard.ts:1080`. _(A test — `useLeaderboard.rdg.property.test.jsx:208` — encodes this misreading and is the one known-wrong assertion.)_
- **RULE-M11 ⚠️** — `roundToNearestTenthHalfUp` rounds an exact x.05 average **down**; A9(a)/(b) says round 0.05 up → RDG grants 0.1 too few. `useLeaderboard.ts:186`.
- **RULE-M12 ⚠️** — no UI path can score an RRS A7 finish-line tie (`ScoringInputComponent.tsx:87` forces distinct places; shift-off stores duplicate places without averaging).
- **RULE-M13 ⚠️** — assignment snapshot not invalidated on `Heat_Boat` change → transferred boat keeps old snapshot position, can enter two next-round heats. `HeatRaceHandler.ts:543`. _(Related to BK-1.)_
- **RULE-M14 ⚠️** — any RC score correction permanently freezes heat assignment (`:165` snapshots pre-protest order on first edit); 3.1(v) only shields _protest-committee_ decisions.
- **RULE-M15 ⚠️** — Final tab with no final race sailed ranks by `FinalLeaderboard` row order, not qualifying score (SHRS 1.5). `:2076`. _(Overlaps HRH M7.)_
- **RULE-M16 ⚖️** — default (shift-off) DSQ path doesn't promote worse-placed boats; RRS A6.1 makes promotion mandatory. Shift-on over-reaches (RULE-C3), default under-applies. **Your ruling.**
- **RULE-m2 ⚠️** — fleet ordering collapses beyond 4 fleets (only Gold/Silver/Bronze/Copper named); a lower fleet can outrank a higher one. `:2100`.
- **RULE-m3 ⚠️** — `getFinalSeriesEligibility` returns `ok:true` with 0 qualifying races, but `startFinalSeriesAtomic` then throws. `:1299`.
- **RULE-m4 ⚠️** — edit preview applies the Final discard profile to the Qualifying tab once finals start. `useLeaderboard.ts:188`.
- **RULE-m5 ⚠️** — SHRS 5.3 displaced-boat ties recorded by sail number only, ignoring national letter. `ScoringInputComponent.tsx:78`.
- **RULE-m6 ⚠️ / m1** — empty custom discard `{thresholds:[]}` silently reverts to standard 4/8/8 instead of "never discard" (`discardConfig.ts:79` vs `:125`) — **product decision needed**; 2-heat advisory omits the 10-boat case (`:466`).

---

# Part 5 — UI/UX, Accessibility & Navigation (app-wide, `UI_UX_AUDIT_REPORT`)

### 🔴 CRITICAL

- **UIX 4.1 — No React error boundary**: any render throw blanks the whole Electron window with no recovery. **Highest-ROI stability fix.** Wrap `<Routes>` in an error boundary with a reload/home fallback.
- **UIX 1.1 — Event names with unsafe URL chars (`/`, `%`, `#`) break routing** → unreachable event, blank page, no catch-all route. Validate/slug at creation.
- **UIX 1.2 — Browser/Electron back button bypasses all unsaved-changes guards** → data loss. Add `popstate`/hash-change listeners + `beforeunload` on LeaderboardPage.
- **UX-A3 — Core interactions keyboard-inaccessible & touch-incompatible** _(UIX 2.1/8.1, CMP A-1/A-2/C-21, MEGA H-NEW-10, SI touch)_: scoring-row click-to-add, finish-order reorder, and boat transfer between heats all use mouse-only HTML5 DnD / `<tr onClick>` with no `tabIndex`/`role`/`onKeyDown`. Tablets are the primary field device. **Fix:** keyboard handlers on rows; touch-capable DnD (`@dnd-kit`) or a "Move to…" modal fallback.
- **UIX 2.3 — HelpModal lacks a focus trap** despite `aria-modal="true"` (Tab leaks to background); `AppModal` does it correctly.
- **UX-A1 — `--text-muted` (#5a7389 ~4.4:1) fails WCAG AA site-wide** _(UIX 2.4)_ — used for metadata, hints, progress. Darken to ≥ `#496077`.
- **UIX 8.2 — Submit button looks disabled but works** — see Part 2.

### 🟠 HIGH

- **UIX 2.2** — sortable `<th>` (SailorList `SortTh`) not keyboard-accessible (focus styles exist but unwired).
- **UX-A1' — all `<th>` missing `scope`** _(CMP C-16, MEGA H-NEW-19)_; add `scope="col"`/`"row"`.
- **UX-A2 — `Rdg2Picker` has no focus trap / `role="dialog"` / `aria-modal`** _(CMP C-17, MEGA H-NEW-20)_.
- **UIX 2.5/2.6** — tab toggle lacks ARIA tab pattern; heading jumps h2→h4.
- **UIX 3.1/3.2/3.3** — hardcoded hex colors bypass CSS-variable system app-wide; two divergent button visual languages; no dark mode (expensive until 3.1 done).
- **UIX 3.4** — inconsistent empty-state approaches (card vs info-banner).
- **UIX 4.2** — no retry on event-load failure; all three event pages `navigate('/')` on any error (even transient). Differentiate "not found" from "DB error".
- **UIX 4.3** — dual toast on every error (contextual + global handler). Remove/suppress the global one.
- **UIX 4.4** — boat-fetch error hidden behind "no sailors registered yet" (indistinguishable from empty). Add `boatsLoadFailed` state.
- **UIX 5.1** — Country `<select>` = 207 unsorted items, no search/optgroup. Replace with searchable combobox.
- **UIX 6.1** — no data-freshness indicator on leaderboard; standings can be silently stale. Add "last updated" + refresh.
- **UIX 6.2** — numeric columns center-aligned; should be right-aligned for scanning.
- **UIX 6.3** — no frozen/sticky identity columns on wide (20+ col) leaderboards; boat identity lost when scrolling right.
- **UIX 8.3/8.4** — penalty context-switching (see SI M2); no "Clear All" in scoring view.

### 🟡 MEDIUM

- **UX-S1** — HeatComponent effect depends on `event` object not `event_id` → re-fetch thrash + resets `raceHappened` _(CMP B-4, HRH L9)_.
- **UX-S2** — `handleDisplayHeats()` called without `await` in `runExclusive` at 3 sites; busy lock releases before refresh completes _(HRH M8, CMP C-4)_.
- **UX-S3** — "No heats yet" flashes before data loads _(CMP C-19, UIX 4.5, HRH L7)_; add a `loading` flag.
- **UX-S4** — `rememberSnapshot` stale closure drops a snapshot on rapid double-save _(HRH M9, CMP D-10)_; use functional updater.
- **CMP C-5/C-6** — Start-Final-Series button active before mount check completes; `handleRecreateHeats` deletes then fails-and-swallows, leaving no heats.
- **CMP C-7** — `Promise.all` in `handleDisplayHeats` discards all heats on one failure; use `allSettled`.
- **CMP M10 (HRH)** — stale event data on direct route-param change (event state seeded once).
- **CMP B-8/B-9/B-10/B-11/B-13 / UIX 8.5/8.6** — undo hidden from scoring view; 5 sequential confirm dialogs with no progress; Rule 4.3 dialog incomprehensible; "shift other boats" jargon; native OS file-save dialog confuses non-technical users; heat action buttons jump without animation.
- **UIX 7.2** — second confirm dialog silently cancels the first (`ConfirmDialogHost`) → user sees a dialog vanish with no feedback.
- **UIX 7.4** — TOCTOU on duplicate event-name check; no UNIQUE on `event_name`.
- **HRH H4/H5** — TOCTOU boat transfer proceeds after an async confirm dialog goes stale; stale async `handleDisplayHeats` results overwrite correct state (no request-ID/cancellation).
- **UIX 4.6/4.7/4.8** — `raceHappened` not re-checked on nav-back; snapshot corruption silently → `[]`; SailorForm validation via toasts only (no inline/onBlur).
- **UIX 5.2/5.3/5.4** — no required-field indicators; inline country edit is a raw text box (IOC code typos); EventForm mixed change-vs-submit validation timing.
- **UIX 6.4/6.6** — Q-Tot/F-Tot hidden by default; GlobalLeaderboard uses a different visual language.
- **CMP C-22** — no client-side validation on imported sailor CSV rows (defense-in-depth).
- **CMP M12 (HRH) / L10 (HRH)** — Excel export renders "null"/"undefined" for null names (PDF/HTML correct); `printNewHeats` mutates caller's React state objects.

### 🔵 LOW

UIX 1.4/1.5/1.6 (route param `:name` vs `:eventName`, no 404 route, event-name-as-key), 2.7/2.8 (nav
`aria-label`, react-select name), 3.5/3.6 (container widths, color inconsistencies), 4.9
(`localStorage.setItem` unguarded — also HRH D-8), 5.5/5.6 (club prefix-only match, no autofocus),
6.7 (empty `boat_type` blank vs em-dash), 8.9/8.10/8.11 (`inputMode="numeric"`, drag handle icon,
place-input affordance). Heat-name regex edge cases (HRH L8, CMP D-9). `printNewHeats` `|| 'N/A'`
treats `sail_number:0` as missing (HRH L11).

---

# Part 6 — Cross-cutting: Integration, Security & Architecture

**Security**

- **LB-6 — CSV formula/newline injection in export** _(CMP B-6, MEGA M-NEW-24; `useLeaderboard.ts:1627-1632`)_. `escape` handles `,`/`"` but not formula triggers (`=`,`+`,`-`,`@`) or `\r`; a sail number / name like `=HYPERLINK(...)` executes in Excel/Sheets. `.xlsx` is immune. **Fix:** prefix `'` on dangerous leads; add `\r` to the escape condition.
- **HRH M2** — status-list SQL string interpolation (see Part 1).
- **CMP C-22/C-23** — missing client-side CSV/IPC validation layers (defense-in-depth).

**Integration / type-contract (MEGA I-series, CMP E-series):**

- **BK-9** — `updateEventLeaderboard` returns `undefined` vs `updateFinalLeaderboard`'s `{success:true}`.
- **MEGA I-1 / CMP E-2** — `boat_id`/`race_id` degrade number→string through GROUP_CONCAT; `HeatBoatRow.sail_number` typed `number` but string at runtime.
- **MEGA I-2** — dual recompute per save (perf).
- **MEGA I-3** — WHERE-on-LEFT-JOIN (semantic INNER) in 3 read queries.
- **MEGA H-NEW-13** — IPC channel doc mismatches: `saveLeaderboardRaceResults` (actual `…Atomic`), `readQualifyingLeaderboard` (nonexistent), `recomputeEventLeaderboard` (not a channel).
- **CMP E-1** — `HeatWithBoats` vs `ScoringHeat` structural mismatch at the HeatComponent↔HeatRacePage boundary; same on `onUndoLastRace`.
- **CMP E-3/E-4** — `isFinalSeries` sent but ignored (handler derives it); duplicate `readAllHeats` calls on mount.
- **CMP E-6 / MEGA orphans** — `ScoreCell.editAtMax.test.jsx` (+ `App.test.tsx`) not in `jest.unit.config.ts`.

**Test-coverage gaps (MEGA + RULES):** `recomputeFinalLeaderboard` renormalization; `getLatestQualifyingHeats`
multi-digit heat suffixes (A10/A11 string-sort); ScoreCell rendering for DNF/DSQ/DPI/RDG statuses;
tie-break with applied discards; loading/empty LeaderboardPage; export functions; qualifying edit while
finals active; malformed discard-profile JSON. RULES: no backend test for fractional A7 (M12),
A6.1 place-shift after DSQ (C2/M16), A9 x.05 rounding boundary (M11); the RDG property test locks in the
M10 misreading.

---

# What was clean (merged across audits)

- **Core heat algorithms** — `heatQueries.ts`, `creatingNewHeatsUtls.ts` (serpentine/zig-zag assignment, movement table, name grouping): exhaustively traced, zero defects (HRH, MEGA).
- **IPC wiring** — all 33–34 channels registered + preload-bridged + call-sites verified; only `undoLastScoredRace` is dead (HRH, CMP, MEGA).
- **Scoring math pairs** — `rerankRaceColumn` ↔ backend `applyRaceTieScoring` produce identical RRS A7 tie results; `applyExclusions` DNE/DGM protection & SHRS 5.4 threshold math correct (MEGA).
- **Penalty ordering** — `penaltyOrder.ts` SHRS 5.3 severity + numeric sail tiebreak correct (SI, RULES).
- **ScoringInputComponent submit payload** construction, boat add/remove, loading/empty shields, sticky action bar, successful-drop DnD mechanics (SI).
- **Robust deep-link recovery, guarded in-app navigation, `beforeunload` on scoring, `runExclusive` ref-guard, first-run experience, HashRouter choice, skip link** (UIX positive findings).
- **`QualifyingTable`, `FinalFleetTable`, `LeaderboardToolbar`, `Rdg2Picker`, `compareUtils`, `penaltyLabels`, `subgroups`** — passed adversarial review (CMP, MEGA).
- **Backend scoring test assertions match the rules** — 593+ passing; only known-wrong assertion is RULES M10 (frontend, deprioritised) (RULES).

---

# Consolidated priority action plan

### Immediate (correctness / data-integrity / stability)

| #   | ID          | Finding                                                   | Effort |
| --- | ----------- | --------------------------------------------------------- | ------ |
| 1   | UIX 4.1     | Add React error boundary (blank-screen-on-crash)          | S      |
| 2   | BK-1        | `UNIQUE(heat_id, boat_id)` + recompute dedup              | S      |
| 3   | BK-5        | Wrap write+recompute paths in one transaction             | M      |
| 4   | BK-2        | Fix WTH all-races-withdrawn filter (SHRS)                 | S      |
| 5   | BK-4        | Guard duplicate/empty sail numbers                        | S      |
| 6   | BK-3        | Non-finisher position = `penaltyPlace` (SHRS 5.2)         | S      |
| 7   | LB-3        | Stale RDG2 picker overrides status change                 | S      |
| 8   | LB-5        | Clear edits before `fetchLeaderboard` after save          | S      |
| 9   | LB-2 / SI-2 | Ref-based double-submit guards                            | S      |
| 10  | LB-1        | `fetchLeaderboard` cancellation + clear `userEditsRef`    | S      |
| 11  | LB-11       | Cap `excludeCount` to per-boat race count                 | S      |
| 12  | LB-12       | Final tie-break `return 0` (SHRS 5.7) — verify vs RULE-M8 | S      |

### Short-term

BK-6/BK-7/BK-8 (validation + tie/recompute after edit/delete + silent-stale fix), LB-4 (React keys),
LB-9 (computed total), LB-7 (shift-mode penalties), LB-8 (swap edits N-boats), MEGA H-NEW-3/4/5/6/9/15
(ScoreCell keyboard/penalty/RAF/legend/final-count), UX-A3 (keyboard+touch DnD), LB-6 (CSV injection),
UIX 1.1/1.2 (URL safety, back-button guard), UIX 4.2/4.3/4.4 (retry/dual-toast/hidden fetch error),
UX-S1..S4 (event_id dep, await refresh, loading flag, snapshot closure).

### Rules ledger to close/verify

RULE-M10, M11, M12, M13, M14, M15 (⚠️ verify + fix), RULE-M16 & m6 (⚖️ product/ruling decisions),
and reconcile RULE-M8 vs LB-12 and RULE-C1 vs LB-11 against current code.

### Accessibility & UX polish

UX-A1/A2 (`scope`, focus traps), UIX 2.2/2.5/2.6 (keyboard headers, ARIA tabs, heading order),
UIX 6.1/6.2/6.3 (freshness, right-align, frozen columns), UIX 3.1→3.3 (CSS variables → dark mode),
UIX 5.1 (searchable country), SI touch-target sizing (H1/M3), and the LOW polish backlog.

---

_Combined from six source audits dated 2026-07-22 (plus the 2026-07-17/18 passes recorded in
`docs/SCORING_AUDIT.md`). Each finding's full failure scenario and code trace lives in the original
report named in its **Sources** tag. Fixed items (Part 4) are retained for traceability, not re-work._
