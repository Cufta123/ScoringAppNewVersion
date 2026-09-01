# SHRS 2026-1 — Coverage & Correctness Audit

**Date:** 2026-09-01
**Branch:** `fix/usability-severity3`
**Scope:** every rule in `docs/SHRS-2026-1.md` plus the RRS Appendix A primitives
the app implements (A4, A5.2, A6.1, A7, A8.1/A8.2), checked against the
implementation in `src/main/functions/`, `src/shared/`, and
`src/main/ipcHandlers/HeatRaceHandler.ts`.

**Result:** 6 medium-severity correctness bugs and a set of coverage gaps were
found. All 6 bugs are now fixed; a handful of lower-severity/latent issues are
fixed or documented below. Baseline suite grew from **765 → 773** passing tests,
all green (`59 suites / 773 tests`), typecheck and lint clean.

---

## 1. Correctness bugs fixed

### M1 — RRS A6.1 promotion skipped for position-keeping penalties (ZFP/SCP/T1)

A boat scored `ZFP`/`SCP`/`T1` holds a real finishing place. Editing it to
`DSQ`/`RET`/`DNE`/`DGM` must remove it from the finishing order and move the
boats behind it up one place — but `promotesBoatsBehind` only fired when the
previous status was `FINISHED`.

**Fix:** moved `promotesBoatsBehind` into `src/shared/scoringPenalty.ts` (single
source of truth for main + renderer) and treat a position-keeping penalty as
"had finished". `scoreStatus.ts` re-exports it; `useLeaderboard.ts` now imports
the shared predicate instead of its own copy.

### M2 — A8.1 tie-break used the boat's own discard count instead of the series/fleet count

`overallTieBreak.ts` and `explainTieBreak.ts` computed the A8.1 "kept scores"
discard count from `scores.length` (the boat's own race count) instead of the
series-wide (qualifying) / fleet-wide (final) count that the totals use. A late
entrant with fewer races than the series got a different discard set, so the
tie-break explanation could disagree with the actual leaderboard.

**Fix:** added `getSeriesDiscardRaceCount()` in `discardConfig.ts`; both call
sites now derive the series/fleet count and cap per boat via
`capExcludeCountForBoat`, matching `calculateBoatScores` / `calculateFinalBoatScores`.

### M3 — SHRS 3.1.5 protest shield was per-race, not per-boat

A race-office correction to one boat cleared the whole race's assignment
snapshot, wiping the 3.1.5 shield on every other protest-decision boat in the
heat (a protest-DSQ'd boat fell to the non-finisher tail).

**Fix:** the snapshot is now **per-boat** — a map of `boat_id → {position,
status}` (the boat's frozen pre-decision finishing place). An ordinary
correction un-shields only the corrected boat
(`unshieldBoatFromAssignmentSnapshot`); the next-round assignment merges frozen
rows with live rows via `compareSeededRows`. Added `frozen_position` /
`frozen_status` columns (migrated via `ensureRaceAssignmentSnapshotsColumns`).

### M4 — SHRS 3.1.3 umpire-DSQ unrepresentable — **documented, not changed**

All `DSQ` are treated as protest-committee decisions (shielded per 3.1.5); an
on-the-water umpire DSQ (which 3.1.3 places after `BFD`) has no distinct code.
This is a deliberate, documented conservative choice (see §3 below).

### M5 — Empty final fleets when boats < qualifying groups (SHRS 4.1)

`startFinalSeriesAtomic` computed `Math.floor(boats / numFinalHeats)`, producing
a 0-boat trailing fleet when withdrawals left fewer boats than qualifying
groups. The rule's "may be reduced" was never implemented.

**Fix:** `finalHeatCount = Math.min(finalHeatCount, adjustedLeaderboard.length)`.

### M6 — 201+ boats could not be created through the UI (SHRS 2.1/2.3)

The renderer's heat-count select capped at 10 while the backend permits 1–26
(`ceil(boats/20)` heats required for 201+ boats) — a dead end.

**Fix:** the select now offers 1–26 to match `createInitialHeatsAtomic`.

---

## 2. Lower-severity fixes

- **`secondDiscardAt` repair** (`discardProfile.ts`): the invalid-config repair
  used the default `additionalEvery` (8) instead of the caller's value.
- **`transferBoatBetweenHeats`** now rejects a transfer into/out of/between
  Final Series fleets (SHRS 4.1 "boats stay in the same fleet") — the UI
  already blocked it, but a direct IPC call no longer bypasses it.

## 3. Documented known limitations (not code bugs)

- **Umpire DSQ (3.1.3).** No distinct "umpire DSQ" status exists. The app
  deliberately errs toward the conservative side of 3.1.5 (preserves the
  published assignment). Supporting it needs a new status code (UI + backend) —
  a feature decision, not a fix. Documented in `scoreStatus.ts:60-70`.
- **Legacy `insertScore` / `updateScore` IPC handlers** don't apply A6.1
  promotion. They are dead code (registered but never called by the renderer,
  which uses `saveLeaderboardRaceResultsAtomic` / `submitHeatRaceScoresAtomic`).
  Fixing them is deferred until they are re-wired.
- **`fleetNames.fleetRank`** maps unknown/custom fleet labels to
  `MAX_SAFE_INTEGER`, so two differently-named custom fleets can't be ordered
  relative to each other (inherent — names we don't recognise can't be ranked).
- **Duplicated largest-heat SQL** (`getMaxHeatSize` in `HeatRaceHandler.ts` vs
  `getMaxHeatSizeForEvent` in `heatQueries.ts`) — a code-quality duplication,
  not a bug; the two currently agree.
- **Renderer `buildAdjustedFleetLeaderboard`** (in `HeatComponent.tsx`) diverges
  from the authoritative backend 4.3 path for a custom qualifying discard
  profile; currently dead code (exported but only imported by tests).

---

## 4. Remaining test-coverage gaps (no correctness issue found)

These rules/behaviours are implemented correctly but under-tested:

| Area     | Gap                                                                                             |
| -------- | ----------------------------------------------------------------------------------------------- |
| 1.1      | `startFinalSeriesAtomic` <2-group rejection; "sections 2–4 don't apply"                         |
| 1.4      | No NOR/SI field for qualifying length (not implemented by design)                               |
| 2.1      | No minimum-heat guidance (not implemented by design)                                            |
| 2.3      | `createInitialHeatsAtomic` 20-cap branch; `insertHeatBoat` cap; `confirm-allow-oversize` branch |
| 3.1.2    | 5-heat movement table; `getNextHeatIndexByMovementTable` throw branches                         |
| 3.1.5    | `raceAssignmentSnapshot.ts` DB persistence round-trip (restart survival) has no dedicated test  |
| 3.2      | "equal ability" seeding + post-transfer re-balancing (not implemented)                          |
| 4.2      | multiple-withdrawal spill; WTH-in-earliest-race; equal-total tie-break                          |
| 4.4      | no dedicated test (structural)                                                                  |
| 5.4      | discard-lock enforcement (`EventHandler.ts`); `getEventDiscardConfig` direct test               |
| 5.7.1    | `detectSingleHeatEvent` empty/single-boat edge cases                                            |
| 5.7.2.4  | no-shared-heat fallback never exercised at handler level                                        |
| RRS A7   | 3-way ties, mid-field ties, multiple tie groups per race                                        |
| RRS A6.1 | (now covered for ZFP/SCP/T1 via M1 fix)                                                         |

---

## 5. Files changed

- `src/shared/scoringPenalty.ts` — `promotesBoatsBehind` (M1)
- `src/shared/discardProfile.ts` — `secondDiscardAt` repair
- `src/main/functions/scoreStatus.ts` — re-export `promotesBoatsBehind`
- `src/main/functions/discardConfig.ts` — `getSeriesDiscardRaceCount` (M2)
- `src/main/functions/overallTieBreak.ts` — series/fleet discard count (M2)
- `src/main/functions/explainTieBreak.ts` — series/fleet discard count (M2)
- `src/main/functions/raceAssignmentSnapshot.ts` — per-boat frozen rows (M3)
- `src/main/ipcHandlers/HeatRaceHandler.ts` — per-boat shield merge/unshield,
  fleet reduction (M5), final-fleet transfer guard
- `src/renderer/hooks/useLeaderboard.ts` — shared `promotesBoatsBehind`
- `src/renderer/components/HeatComponent.tsx` — heat-count select 1–26 (M6)
- `public/Database/DBManager.js` — `RaceAssignmentSnapshots` columns + migration
- tests: `scoreStatus`, `explainTieBreak`, `transferBoat`,
  `startFinalSeriesAtomic`, `updateRaceResult`, `createNewHeats`,
  `overallTieBreak`, `HeatRaceHandler.overallTieBreak`

## 6. Verification

```
npx jest --config jest.unit.config.ts --no-coverage   # 59 suites / 773 tests, all pass
npm run typecheck                                      # clean
npm run lint                                           # 0 errors in changed files (pre-existing e2e warnings only)
```

---

## 7. Post-audit code review — follow-up fixes

A code review of the changes above found five further defects, all introduced or
left behind by the M1–M6 work. All are now fixed, with regression tests that
were each confirmed to fail before the fix.

### R1 — legacy snapshot rows loaded with no finishing order (high)

`ensureRaceAssignmentSnapshotsColumns` ALTERs `frozen_position` /
`frozen_status` in as NULL on every pre-existing `RaceAssignmentSnapshots` row,
and the pre-M3 `getAssignmentRowsForHeatRace` persisted a snapshot on _every_
next-round assignment — not just protest decisions — so a mid-event database
carries rows for most races. Loading them mapped every boat to `position: null`;
`compareSeededRows` coalesces null to `MAX_SAFE_INTEGER`, so all boats compared
equal and fell through to national letter + sail number. On upgrade the next
round would have been seeded by sail number instead of results.

**Fix:** `loadPersistedAssignmentSnapshot` rebuilds the frozen place from the
still-populated 0-based `rank` column (`position: frozen_position ?? rank + 1`),
reproducing the legacy order exactly.

### R2 — protest shield not re-applied to an un-shielded boat (medium-high)

`captureRaceAssignmentSnapshotIfMissing` short-circuited on "a snapshot exists
for this race", but with per-boat freezing the snapshot can exist while the boat
being decided is absent from it: PC DSQs B1 (freezes the heat) → race office
corrects B2 (un-shields B2) → PC later DSQs B2 → no frozen row is created and
B2's DSQ reorders its next-round assignment, the exact SHRS 3.1.5 violation M3
set out to fix.

**Fix:** the guard is now per boat; a boat missing from an existing snapshot has
its current (pre-decision) place frozen before the decision is applied.

### R3 — frozen and live places could collide (medium)

Merging frozen rows with live rows can put two boats on the same `position`: a
boat DSQ'd from 1st keeps frozen position 1 while the RRS A6.1 promotion moves
the boat behind her to live position 1, and un-shielding that boat makes both
claim the slot. `compareSeededRows` settled it on sail number, i.e. arbitrarily.

**Fix:** on an equal position + status, the shielded boat holds the slot — a
protest decision must not move her (3.1.5).

### R4 — rollback guard assumed the snapshot cache was add-only (medium)

The in-memory cache survives a DB rollback, and the guards in `updateRaceResult`
/ `saveLeaderboardRaceResultsAtomic` only remembered whether a race id was
_present_ beforehand. `unshieldBoatFromAssignmentSnapshot` mutates an existing
entry rather than adding one, so a failed save left a boat permanently
un-shielded in memory while the DB still held its frozen row.

**Fix:** both guards now back up and restore the entry's contents.

### R5 — unknown final fleet widened the discard denominator (low)

When `getBoatFinalHeatName` returns null (final `Scores` rows but no `Heat_Boat`
row — a repaired/imported event), `getSeriesDiscardRaceCount` dropped its
`heat_name` filter and returned the largest race count across _all_ final
fleets. SHRS 4.5 lets fleets sail different numbers of races, so a boat in a
short fleet over-discarded.

**Fix:** a null fleet falls back to the boat's own race count.

### Reviewed and found sound

The M2 denominators match both authorities exactly (`fleetRaceCounts` in
`calculateFinalBoatScores.ts`, `number_of_races` in `leaderboardRecompute.ts`);
`COUNT(*)` there is safe because `ensureUniqueRaceBoatScores` puts a unique
index on `Scores(race_id, boat_id)`. M5 cannot divide by zero
(`leaderboard.length === 0` throws upstream). M1's shared `rdgStatuses` matches
both prior copies. The `secondDiscardAt` repair is safe (`additionalEvery` is
sanitized to >= 1 upstream).

### Corrections to this document

- §6 described the remaining lint output as "pre-existing e2e **warnings**".
  They are 18 **errors** (`no-await-in-loop`, `no-plusplus`, one unused var) in
  `e2e/diag.spec.ts` and `e2e/full-event-rules.spec.ts`. The substantive claim
  — zero errors in changed files — holds.
- §1 M5 justified the fleet-count cap as handling withdrawals. Withdrawn boats
  are not removed from `adjustedLeaderboard`; they are only sorted to the tail
  and still assigned to fleets. The cap is correct, but it only fires when the
  entered boat count is genuinely below the group count.

### Verification (after R1–R5)

```
npx jest --config jest.unit.config.ts --no-coverage   # 60 suites / 782 tests, all pass
npm run typecheck                                      # clean
npx eslint <changed files>                             # 0 errors (no-console warnings only)
```

### Files changed by the follow-up

- `src/main/functions/raceAssignmentSnapshot.ts` — rank fallback (R1)
- `src/main/functions/explainTieBreak.ts` — null-fleet fallback (R5)
- `src/main/ipcHandlers/HeatRaceHandler.ts` — per-boat capture guard (R2),
  collision tie rule (R3), snapshot rollback backups (R4)
- `jest.unit.config.ts` — register the new suite
- tests: `raceAssignmentSnapshot.test.ts` (new), `HeatRaceHandler.updateRaceResult`,
  `HeatRaceHandler.createNewHeats`, `explainTieBreak`
