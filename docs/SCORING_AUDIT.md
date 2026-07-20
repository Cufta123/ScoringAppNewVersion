# SHRS 2026-1 / RRS Appendix A — Scoring Logic Audit

Audit of the IOM Regatta Manager scoring engine against `docs/SHRS-2026-1.md` and RRS
Appendix A. Produced by a multi-agent audit (11 rule-area finders, each finding checked
by up to 3 independent adversarial verifiers) plus hand-verification.

**Status legend**

- ✅ **Confirmed** — proven by an executed test / hand-trace, or by a 2–3 vote adversarial panel.
- ⚠️ **Plausible** — traced and credible, not yet independently re-verified end-to-end.
- ⚖️ **Needs ruling** — turns on a rule interpretation you should decide.

## Fixed so far (with regression tests)

| ID       | Fix                                                                                                                                                                                   | Files                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| C1       | Discard count is now the series-wide race count, not each boat's own                                                                                                                  | `calculateBoatScores.ts`                                                                                                         |
| C2       | Redress (RDG) no longer re-ranks other boats, even with shift on (A6.2)                                                                                                               | `HeatRaceHandler.ts`                                                                                                             |
| C3       | ZFP/SCP/T1 boats now move up on a DSQ ahead and have points recomputed; no phantom A7 tie                                                                                             | `HeatRaceHandler.ts`                                                                                                             |
| M1       | Non-finisher points are re-derived to the current series-wide largest heat at recompute, so all races in a series agree                                                               | `leaderboardRecompute.ts`, `heatQueries.ts`, `scoreStatus.ts`                                                                    |
| M3       | Rule 4.3 now excludes the _second-worst_ score, not "+1 to the discard count"                                                                                                         | `fleetAssignment.ts`                                                                                                             |
| M4       | Fleet-assignment discard/4.3 window now use the series-wide race count                                                                                                                | `fleetAssignment.ts`                                                                                                             |
| M5       | Scoring-penalty base is now the DNF score (`maxBoats + 1`), fixing the off-by-one                                                                                                     | `scoringPenalty.ts`                                                                                                              |
| M6       | Sail numbers now sort numerically in `compareSeededRows` (9 before 10)                                                                                                                | `scoreStatus.ts`                                                                                                                 |
| M7       | Overall A8.2 now compares final-series races before qualifying races                                                                                                                  | `overallTieBreak.ts`                                                                                                             |
| M7b      | Tie-break **explanation panel** now walks A8.2 final-before-qualifying too, naming the correct decider race                                                                           | `explainTieBreak.ts`                                                                                                             |
| M8       | Unresolved A8.1/A8.2 ties now stay **tied** instead of an arbitrary internal-`boat_id` order (qualifying, overall, and both explain panels report "no winner")                        | `calculateBoatScores.ts`, `overallTieBreak.ts`, `explainTieBreak.ts`                                                             |
| M9       | DPI (RRS A10) is no longer auto-scored as `largest heat + 1`; its protest-committee-set points are kept (edit-flow entry, mirrors RDG3)                                               | `scoreStatus.ts`, `HeatRaceHandler.ts`, `useLeaderboard.ts`, `leaderboardUtils.ts`, `ScoreCell.tsx`, `ScoringInputComponent.tsx` |
| M1-Final | `recomputeFinalLeaderboard` now renormalizes final non-finisher points to the series-wide largest final heat (SHRS 5.2), mirroring the Qualifying fix; unblocked by the M2 withdrawal | `leaderboardRecompute.ts`                                                                                                        |
| —        | Test-config gap closed: `fleetAssignment`, `finalFleetAssignmentReport`, `leaderboardUtils.exclusions`, `scoringPenalty` added to `jest.unit.config.ts`                               | `jest.unit.config.ts`                                                                                                            |

`npm run test:unit`: 410 passing (the single failure is the pre-existing `python`-not-on-PATH
migration test, per AGENTS.md §7). M5 rests on the modern RRS 44.3(c) "20% of the score for DNF"
wording — revert the one-line base change if your rulebook says otherwise.

**M1 implementation note.** "Largest heat" is the series-wide maximum heat size (which physical heat
holds it may move round to round). `getMaxHeatSize` already computes that; the bug was that
non-finisher points were _frozen_ at write time. `renormalizeNonFinisherScores` now re-derives every
non-finisher score to the current series-wide largest heat at the start of the qualifying recompute,
so all races agree. **Still needs app-level verification** against a real multi-round event before
release — the unit tests cover the derivation logic but not the full Electron/SQLite round-trip.
The **Final series** deliberately does NOT renormalize yet: SHRS 5.1 scores each fleet separately, so
it needs the _per-fleet_ largest heat (that is finding **M2**, still open).

**C3 note:** the fix is localized to the displacement path in `applyRaceResultUpdate` and is exact
when the shifted boats have no genuine tie among them (the common case). A DSQ that also creates an
A7 tie _involving_ a penalty boat is a rare edge that would need `applyRaceTieScoring` to own penalty
re-derivation; flagged for an app-verified pass.

Frontend (`.jsx/.tsx`) tests are out of scope per instructions, but scoring logic that lives in
renderer hooks (`useLeaderboard.ts`) is in scope because it computes points.

---

## Test coverage status (2026-07-17)

Backend scoring-module coverage after this pass (`npm run test:unit`, 430 passing):

| Module                               |      Branch | Assertions audited vs rules                     |
| ------------------------------------ | ----------: | ----------------------------------------------- | --------------- | --- | --- |
| leaderboardRecompute, scoringPenalty |         100 | ✓ rule-correct                                  |
| scoringUtils                         |          91 | ✓                                               | scoreStatus     | 84  | ✓   |
| calculateBoatScores                  |          86 | ✓                                               | fleetAssignment | 86  | ✓   |
| overallTieBreak                      | 74 (was 52) | ✓ (added no-shared-heat branch)                 |
| discardConfig                        | 96 (was 74) | ✓ (surfaced **m6** empty-thresholds fallback)   |
| calculateFinalBoatScores             |          75 | ✓ rule-correct                                  |
| SHRS_comprehensive (exhaustive)      |           — | ✓ boundary table + penalties + ties all correct |
| penaltyOrder (renderer)              |           — | ✓ 5.3 order + numeric sail ties                 |

**Assertion audit result:** backend scoring test expected-values match the rules. The only known
_wrong_ assertion is **M10** in `useLeaderboard.rdg.property.test.jsx` (renderer; encodes the SHRS 5.6
pooled-average misreading) — deprioritised as frontend.

**Still uncovered (lower value / not scoring math):** `HeatRaceHandler.ts` 57% branch (mostly IPC
orchestration + error paths; scoring paths covered via integration tests), `raceAssignmentSnapshot.ts`
45%, `subgroups.ts` 50% branch, `explainTieBreak.ts` 67% (display text), `eventSnapshot.ts` 6%
(export/restore, not scoring). Coverage % ≠ assertion correctness — verified separately above.

## Critical (wrong series score / rank / fleet)

### C1 ✅ Discard count taken from each boat's own race count, not the series count — `SHRS 5.4`

`calculateBoatScores.ts:253` feeds per-boat `number_of_races` into `getExcludeCountForConfig`;
that value is `COUNT(DISTINCT Races.race_id)` grouped **per boat** (`leaderboardRecompute.ts:13`).
A boat that missed a round discards fewer scores than boats in the same series.
**Proven by executed test:** 4-race series, a boat with 3 races gets 0 discards and keeps a
10-point race that should have been dropped (scores 12 instead of 2).
Same root cause: `overallTieBreak.ts:44`, `fleetAssignment.ts:74` (see F2).
**Fix:** drive the discard count from races completed in the series, not per boat.

### C2 ✅ Redress with "shift other boats" re-ranks the whole race — `RRS A6.2`

`applyRaceTieScoring` (`HeatRaceHandler.ts:234`) walks only `FINISHED` + ZFP/SCP/T1 rows; an RDG
row drops out of the place walk and every worse-placed boat compacts up one place.
Give 5th place redress in a 10-boat race → boats 6–10 silently become 5–9. A6.2 forbids changing
other boats' scores.

### C3 ✅ ZFP/SCP/T1 boat collides with a shifted finisher → phantom A7 tie + stale penalty — `RRS A7 / 44.3(c)`

The DSQ displacement UPDATE (`HeatRaceHandler.ts:214`) filters `status='FINISHED'`, so a
position-keeping penalty boat stays put while a finisher shifts into its slot. Two rows then share
a position; `applyRaceTieScoring` (`:349/:398`) reads it as an A7 tie and averages the points
(e.g. 4.5), and the penalty boat's own points are never re-derived from its corrected place
(`:398` only rewrites FINISHED rows). Confirmed by 3 verifiers.

---

## Major (wrong points / tie-break / fleet assignment)

### M1 ✅ `getMaxHeatSize` stale + inflated across rounds — `SHRS 5.2`

Non-finisher points (`largest heat + 1`) are frozen into `Scores.points` at write time and never
recomputed. `getMaxHeatSize` (`HeatRaceHandler.ts:242`) takes `MAX` across **all** qualifying heats
in the event, and each new round _inserts_ new `Heats`/`Heat_Boat` without deleting the prior round.
Result: the identical DNF scores 8 in race 1 but 9 in race 3 of the same series — under any single
definition of "largest heat" they must match, so at least one is provably wrong, and
`recomputeEventLeaderboard` sums the stale value. Also triggered by a late entry via `insertHeatBoat`.
**Fix:** define one series-wide largest-heat value and re-derive (or compute at read time) whenever
`Heat_Boat` changes.

### M2 ❌ WITHDRAWN — not a bug (rule misreading)

Original claim: final-series non-finishers should use the boat's own fleet's largest heat. This
**misread SHRS 5.2**, which substitutes a single value — _"the number of boats in the largest heat"_
(biggest heat in the series) — into RRS A5.2, giving DNF/DSQ = **biggest heat + 1** for every boat
regardless of fleet. `getMaxHeatSize(event, 'Final')` returns `MAX(boat_count)` across the final
heats (i.e. Gold), which is exactly correct. SHRS 5.1's "each fleet scored separately" governs the
per-fleet **series score / discards / ranking**, not the definition of "the largest heat." No change
made. (Confirmed with the event organiser, 2026-07-17.)

### M3 ✅ Rule 4.3 does "+1 discard" instead of "exclude the second-worst" — `SHRS 4.3`

`fleetAssignment.ts:76` increments the discard count. Coincidentally correct under the standard
profile, but under a no-discard profile it drops the **worst** score when the rule says keep the worst
and drop the **second-worst** → wrong fleet-assignment ranking.

### M4 ✅ Fleet-assignment discard from per-boat race count — `SHRS 4.3 / 5.4`

`fleetAssignment.ts:74` derives both the 5.4 discard count and the 4.3 window from each boat's own
race count, so a boat that missed qualifying races is ranked under a different discard rule and can
land in the wrong fleet. (Same family as C1.)

### M5 ✅ Penalty base off-by-one — `RRS 44.3(c) / SHRS 5.2`

`scoringPenalty.ts:20` computes `round(rate × maxBoats)`, but 44.3(c) bases the penalty on the DNF
score, which SHRS 5.2 makes `maxBoats + 1`. **Verified:** heat size 12, ZFP finishing 5th scores 7,
rule-correct is 8. Diverges at heat sizes {2,7,12,17} for 20% and {4,8,11,14,18} for 30%. The code's
own cap already uses `maxBoats+1`, confirming intent. _(Rests on the modern "20% of the score for
DNF" wording — confirm against your rulebook.)_

### M6 ✅ Sail numbers sort as strings, not numerically — `SHRS 5.3 / 3.1(iv)`

`buildAlphanumericKey` + `localeCompare` (`scoreStatus.ts:133`) orders CRO 10 before CRO 9. The repo
does this correctly elsewhere (`creatingNewHeatsUtls.ts:16` uses `{numeric:true}`). Drives wrong
next-round seeding and wrong 5.3 recording order on ties.

### M7 ✅ Overall A8.2 compares qualifying races before final races — `RRS A8.2 / SHRS 5.5`

`overallTieBreak.ts:149` sorted shared races by `race_number` descending, ignoring `heat_type`. Final
races restart at number 1, so the event's actual last race wasn't compared first. **Fixed** in the
comparator (M7) and, in a follow-up, in the explanation panel (`explainTieBreak.ts`, M7b), which
reproduced the same wrong order and named the wrong tie-break race. Both now rank final-series pairs
ahead of qualifying pairs.

### M8 ✅ A8 tie fallback invents an order from `boat_id` — `RRS A8.1/A8.2 / SHRS 5.7(ii)(4)`

When A8.1 and A8.2 both failed to break a tie, `calculateBoatScores.ts:231` (and the final/overall
equivalents) fell back to `localeCompare(boat_id)` — an internal DB row id — instead of leaving the
boats tied. **Fixed:** all three comparators now return `0` (stay tied); place assignment uses stable
order, and both explanation panels report `winnerBoatId: null`. The rules define no tiebreak beyond
A8.2, so genuinely-identical boats remain tied.

### M9 ✅ DPI auto-scored as a non-finisher — `RRS A10 / SHRS 5.3`

`scoreStatus.ts` / `HeatRaceHandler.ts` scored DPI (discretionary penalty imposed) as
`largest-heat + 1`, identical to DSQ, destroying the boat's finishing place. Per RRS A10, DPI's points
are set by the protest committee. **Fixed:** `deriveNonFinisherPoints` returns `null` for DPI (kept, not
renormalized) and `applyRaceResultUpdate` keeps the frontend-provided value (grouped with RDG under
`keepsProvidedPoints`). Entry is via the leaderboard **edit flow** (the PC types the points, mirroring
RDG3, and they stand as a normal — discardable — race score); DPI was removed from the initial
finish-order dropdown, which has no points field. Product decisions (2026-07-18): entered value IS the
race score; edit-flow only.

### M10 ⚠️ RDG2 pools qualifying + final race points into one average — `SHRS 5.6`

`useLeaderboard.ts:1080`: a redress granted in a final race is averaged over qualifying races too.
SHRS 5.6 requires averages computed separately per series.

### M11 ⚠️ Redress rounding rounds an exact x.05 average DOWN — `RRS A9(a)/(b)`

`roundToNearestTenthHalfUp` (`useLeaderboard.ts:186`) rounds x.05 down when the averaged set contains
a fractional score, so RDG1/RDG2 grant 0.1 point too few. A9 says "0.05 to be rounded upward."

### M12 ⚠️ No UI path can score an RRS A7 finish-line tie — `RRS A7`

`ScoringInputComponent.tsx:87` forces strictly distinct places, and the leaderboard shift-off override
stores duplicate places without averaging (`HeatRaceHandler.ts:209`). The x.5 average is unreachable.

### M13 ⚠️ Assignment snapshot not invalidated on `Heat_Boat` change — `SHRS 2.2/2.3/3.1` (data corruption)

`HeatRaceHandler.ts:543`: a boat transferred between heats after a score edit keeps its old snapshot
position and can be inserted into two heats of the next round.

### M14 ⚠️ Any RC score correction permanently freezes the heat assignment — `SHRS 3.1(ii) vs 3.1(v)`

`HeatRaceHandler.ts:165` snapshots the pre-protest order on the _first_ score edit of a race. 3.1(v)
only shields **protest committee** decisions; an ordinary race-committee data-entry correction should
still feed 3.1(ii) movement, but here it's frozen out.

### M15 ⚠️ No-final-race Final tab ranks by arbitrary row order, not qualifying score — `SHRS 1.5`

`HeatRaceHandler.ts:2076`: with the Final Series started but no final race sailed, boats are ordered by
`FinalLeaderboard` row order instead of their qualifying series score.

### M16 ⚖️ Default DSQ path doesn't promote worse-placed boats — `RRS A6.1`

With "shift" off (default), `applyRaceResultUpdate` leaves all other boats untouched
(`HeatRaceHandler.ts:204-208`). A6.1 is mandatory: on DSQ / RET-after-finish / NSC, worse-placed boats
_shall_ move up one. The opt-in shift path over-reaches (C3); the default under-applies. Partly a
design decision — your call.

---

## Minor

- **m1 ✅** 2-heat odd/even advisory omits the 10-boat case the SHRS end-note lists — `HeatRaceHandler.ts:466` (`totalBoats >= 14` guard).
- **m2 ⚠️** Fleet ordering collapses for the 5th+ final fleet (only Gold/Silver/Bronze/Copper named), letting a lower fleet outrank a higher one — `HeatRaceHandler.ts:2100`, `SHRS 5.5`.
- **m3 ⚠️** `getFinalSeriesEligibility` returns `ok:true` with 0 qualifying races, but `startFinalSeriesAtomic` then throws — `HeatRaceHandler.ts:1299`, `SHRS 4.2`.
- **m4 ⚠️** Leaderboard edit preview applies the Final discard profile to the Qualifying tab once the final series starts — `useLeaderboard.ts:188`, `SHRS 5.4`.
- **m5 ⚠️** SHRS 5.3 ties among displaced boats recorded by sail number only, ignoring national letter — `ScoringInputComponent.tsx:78`.
- **m6 ⚠️ (surfaced by coverage work)** An empty custom discard threshold list (`{thresholds: []}`) silently reverts to the standard 4/8/8 profile instead of "never discard": `normalizeDiscardConfig` keeps `thresholds: []` but `getExcludeCountForConfig` only honours thresholds when `length > 0` — `discardConfig.ts:79` vs `:125`. A user setting an empty list expecting no discards would still get standard discards. Needs a product decision (pinned by a test documenting current behaviour).

---

## Test coverage gaps (confirmed)

- **Config gap:** `SHRS.finalFleetAssignmentReport.test.ts` and `leaderboardUtils.exclusions.test.ts`
  are **not** in `jest.unit.config.ts`, so `npm run test:unit` never runs them (AGENTS.md §8 trap).
- **RDG property test encodes the 5.6 misreading:** `useLeaderboard.rdg.property.test.jsx:208` asserts
  the qual+final pooled average — it locks in M10.
- **No backend test** exercises: fractional A7 points end-to-end (M12), A6.1 place-shifting after
  DSQ (C2/M16), or the A9 x.05 rounding boundary (M11).

### 2026-07-18 test-hardening pass (+~160 tests, `npm run test:unit` 593 passing / 0 skipped)

A 5-domain audit added rule-correct edge-case tests across the scoring engine and closed several of
the gaps above. Now covered by backend tests: unequal per-boat race counts (C1), cross-round
renormalization for both Qualifying **and** Final (M1 / M1-Final), penalty base at boundary heat sizes
(M5, new `scoringPenalty.test.ts`), discard-step boundaries 7/8/15/16 (5.4), the 4.3 window at 5/6/7/8,
the full status vocabulary + SHRS 5.3 order, and the M7/M8/M9 fixes landed this pass (their
previously-skipped regression tests are now green). No wrong assertions were found in the pre-existing
suite. Remaining known-wrong assertion: **M10** (`useLeaderboard.rdg.property.test.jsx`, frontend,
still deprioritised).

---

## Process note

The multi-agent workflow repeatedly hit the opus session limit before its synthesis step could run;
this report is the hand-assembled synthesis of all completed finder + verifier output plus direct
verification. The `persistence-recompute` finder was the last to run and its findings (M13–M15, m2–m3)
are marked ⚠️ pending a second verification pass.
