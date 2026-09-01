# Audit Fixes Log

This document tracks fixes applied against `COMBINED_AUDIT_REPORT.md`, written as they
are made so each can be independently audited. Every entry lists the finding ID, the
exact file/line touched, what changed, why, and how it was verified.

**Branch:** `fix/usability-severity3`
**Baseline before work:** unit suite `600 passing, 1 failing` — the single failure is the
known `python`-not-on-PATH environment gap in `Scores.uniqueIndex.migration.test.ts`
(documented in `AGENTS.md §7`), not a code regression.

**How to audit an entry:** read the "Files changed" hunk, confirm it matches the "What
changed" description, then run the listed test command.

### Cross-check against `docs/SHRS-2026-1.md` (the rules source of truth)

Every rules-affecting decision here was verified against the actual rule text, not just the
audit's paraphrase:

| Fix / decision                                     | Rule(s)                                                                                                                                                                | Verdict                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **LB-12** (tie stays tied, no `boat_id` order)     | **5.7** lists only A8.1/A8.2 as tie-breakers — no further fallback, so unresolved ties **remain tied**                                                                 | ✅ fix matches the rule                                                               |
| **BK-3** (non-finisher pts/pos = largest-heat + 1) | **5.2** ("replace 'boats entered in the series' with 'boats in the largest heat'")                                                                                     | ✅ fix matches the rule                                                               |
| **LB-11** (never discard every score)              | **5.4** — discards are _series-wide_ and presuppose each boat is scored for every completed race (DNC for missed); a boat with fewer scores is the edge the cap guards | ✅ fix consistent; the DNC-seeding question I flagged is exactly what 5.4 assumes     |
| **BK-2 REJECTED** (keep `.some(WTH)`)              | **4.2** "boats withdrawn from the event at the time of division → lowest heat" + **5.3** "WTH (DNC – withdrawn from **series**)"                                       | ✅ rules **confirm** any WTH ⇒ withdrawn; the audit's `.every(WTH)` would violate 4.2 |
| **BK-7** (A7 tie re-score on edit)                 | **5.1** (RRS A low-point) + RRS A7 tie averaging                                                                                                                       | ✅ fix restores correct averaging                                                     |

**Progress:** 13 fixes applied — LB-12, BK-9, LB-11, BK-3, BK-7, BK-8, LB-15, LB-4, MEGA H-NEW-15,
HRH M4, LB-10, MEGA M-NEW-8, **BK-1**. 8 audit items reviewed without a code change: **BK-2**,
**MEGA M-NEW-6**, **RULE-M11**, **MEGA H-NEW-5**, **MEGA H-NEW-4** rejected/working-as-designed
with evidence; **LB-9** deferred (pair with MEGA M-NEW-1); **LB-16** deferred (pair with RULE-m4);
**RULE-m3** needs your product ruling. All rules-affecting decisions cross-checked against
`docs/SHRS-2026-1.md` (see table above). Suite is now **`612 passing, 0 failing`** (+11 new
tests: LB-12, LB-11, BK-3, 4× BK-7, HRH M4, 3× BK-1) — the previously-persistent `python`
migration-test failure was also removed by porting it to `node:sqlite` (test-infra, not an audit
fix). `tsc --noEmit` clean; no new lint errors introduced.

**Update — RULE-m3 (14th), LB-9 + M-NEW-1 (15th), LB-16 + RULE-m4 (16th) now fixed.** Suite
**615 passing, 0 failing**.

> ⚠️ **Correction to an earlier claim in this log.** The previous version of this paragraph said
> "all audit items from the combined report are now either fixed, reviewed-as-working-as-designed,
> or resolved as no-change". That was **wrong**: the 21 entries below cover 21 of the combined
> report's ~200 findings. At that point 5 of the 12 items in the report's own "Immediate" table
> were still untouched in code (UIX 4.1 error boundary, LB-1, LB-2, LB-3, LB-5, BK-4; BK-5 only
> partly), as were LB-6, LB-7, LB-8, BK-6, UX-A1, UX-A2 and the whole open rules ledger. The log
> also missed commit `c55bc99`, which landed seven Scoring-Input fixes (SI H1, SI M3, SI-2, SI M1,
> SI M4, SI-6, UIX 8.2) that are still not written up here.

---

## Rules-compliance pass (SHRS 2026-1 / RRS Appendix A)

Everything in the audit's **"Still OPEN" rules ledger** (Part 4) is now closed against the rule
text in `docs/SHRS-2026-1.md`. Suite **654 passing, 0 failing, 53 suites**; `tsc --noEmit` clean;
lint back at the documented baseline (18 errors, all pre-existing in `e2e/`).

| ID                    | Rule                    | Resolution                                                                                                                 |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **RULE-M10**          | 5.6                     | RDG2 averages are now per-series. Cross-series selection removed from the picker, the state type and the hook.             |
| **RULE-M12**          | RRS A7                  | Dead heats are now scorable: a per-row "=" tie control in the finish order submits a shared place.                         |
| **RULE-M13**          | 3.1.5                   | Assignment snapshots are invalidated for both heats on a boat transfer.                                                    |
| **RULE-M14**          | 3.1.5                   | Only protest-committee-typed statuses snapshot the assignment; ordinary RC corrections no longer freeze it.                |
| **RULE-M15**          | 1.5                     | With no completed final race the final leaderboard ranks by qualifying series score.                                       |
| **RULE-M16**          | RRS A6.1                | Promotion after a DSQ/RET-after-finishing is mandatory — no longer gated on the "Shift other boats" toggle.                |
| **RULE-m1**           | Movement-table end-note | The odd/even 2-heat advisory now covers the 10-boat case the rule names.                                                   |
| **RULE-m2**           | 4.1 / 5.5               | Fleets past Copper get real, distinct precedence ("Fleet 5" ranks 5th) instead of one shared catch-all rank.               |
| **RULE-m5**           | 5.3                     | The data-entry tie order uses national letter **then** sail number, via the same comparator as the backend.                |
| **RULE-m6**           | 5.4                     | An explicitly empty threshold list now means "never discard" instead of silently reverting to standard 4/8/8.              |
| **RULE-M11**          | RRS A9                  | Unchanged — re-verified as already correct (see the earlier entry).                                                        |
| **MEGA M-NEW-20**     | 5.4 + 5.1               | Confirmed real (the audit left it unverified): final-fleet discards used each boat's own race count; now fleet-wide.       |
| **LB-11 (tie-break)** | 5.4                     | The discard cap was applied to the total but not to the A8.1 vector, so a short-race boat entered the tie-break with `[]`. |

Two divergences found while tracing the above and fixed with them:

- **Renderer discard profile** — `leaderboardUtils.getExcludeCount` reimplemented SHRS 5.4 and
  honoured only the `thresholds` list, silently applying the standard 4/8/8 to every custom
  first/second/every profile. The pure profile logic now lives in `src/shared/discardProfile.ts`
  and both processes call it.
- **SHRS 5.7(ii)(2)** — checked, **already correct**: multi-heat shared-race comparison uses raw
  scores (excluded ones included); `keptScores` is only used for the single-heat and
  never-shared-a-heat paths, which is what the rule requires.

New shared modules (one definition per rule, imported by both processes):
`src/shared/fleetNames.ts` (4.1/5.5), `src/shared/sailOrder.ts` (5.3/3.1(iv)),
`src/shared/discardProfile.ts` (5.4), plus `src/main/functions/finalLeaderboardOrder.ts` (1.5/5.5).

**Three tests asserted the old, rule-violating behaviour and were rewritten**, not deleted — each
had been written to _document_ a bug pending a decision, and the rule text settles it:

- `leaderboardUtils.exclusions.test.ts` — "CURRENT (surfaces m6-analog): … silently reverts to
  standard 4/8/8" → now asserts never-discard.
- `discardConfig.test.ts` / `calculateBoatScores.test.ts` — the same m6 fallback, unit and
  end-to-end.
- `HeatRaceHandler.updateRaceResult.test.ts` — "with shifting OFF … no A6.1/A7 cascade" → split
  into "a DSQ still promotes" (A6.1) and "a plain place change still edits only the named boat".

**Still open — NOT rules items, and NOT addressed by this pass.** These are the correctness and
accessibility findings listed in the correction above; the combined report's "Immediate" table is
the right worklist for them.

---

## ✅ LB-12 — Final-series tie-break no longer invents order from `boat_id` (SHRS 5.7)

**Finding (audit Part 3 / Part 4):** `calculateFinalBoatScores.ts:148` used
`String(a.boat_id).localeCompare(String(b.boat_id))` as the last tie-break fallback. When
two final-fleet boats are genuinely tied (identical A8.1 kept-score vectors _and_ identical
A8.2 chronological vectors), the rules (SHRS 5.7(ii)(4) / RRS A8) say they **remain tied**.
The qualifying and overall paths were already fixed for this under RULE-M8 (they `return 0`),
but the final-fleet comparator still fabricated an order from the internal database id — an
arbitrary, non-rule ordering. The audit flagged this as an incomplete fix / regression.

**What changed:**

- `src/main/functions/calculateFinalBoatScores.ts` — replaced the `localeCompare(boat_id)`
  fallback in `compareTieCandidates` with `return 0`, plus a comment tying it to
  SHRS 5.7(ii)(4) and the existing RULE-M8 fix. This makes the final comparator behave
  identically to the already-fixed qualifying comparator in `calculateBoatScores.ts`.

**Why this is safe:** `resolveTiesSequentially` sorts with V8's _stable_ sort, so a `0`
return preserves the input (result-row) order instead of a boat_id order. Displayed places
are still sequential (1, 2, …) exactly as before — the only change is that truly-tied boats
are no longer reordered by their database id. All existing tie tests have a definite A8.1 or
A8.2 winner, so they are unaffected.

**Test added:** `calculateFinalBoatScores.test.ts` — "leaves a perfectly-tied final group in
stable order (no boat_id fallback)". Inputs two boats with identical A8.1 and A8.2 vectors,
listed as `[boatZ, boatA]`. The old `localeCompare` fallback would pull `boatA` to 1st; the
fix keeps `boatZ` first (input order preserved).

**Verification:** `npx jest --config jest.unit.config.ts calculateFinalBoatScores`
→ 22 passed (was 21).

**Reviewer note:** this closes the "RULE-M8 vs LB-12" reconciliation item in the audit's
rules ledger — the final comparator now matches the qualifying/overall ones.

---

## ✅ BK-9 — `updateEventLeaderboard` now returns `{success:true}` (was `undefined`)

**Finding (audit Part 1 / Part 6, HRH N2 / MEGA H-NEW-14 / MEGA I-5):** the
`updateEventLeaderboard` IPC handler ran the recompute but returned nothing, while its sibling
`updateFinalLeaderboard` returns `{ success: true }`. The inconsistent contract meant any
caller inspecting the result of the event (qualifying) path got `undefined` where the final
path gives a success object.

**What changed:**

- `src/main/ipcHandlers/HeatRaceHandler.ts` (`updateEventLeaderboard` handler) — added
  `return { success: true }` after `recomputeEventLeaderboard(event_id)`, matching
  `updateFinalLeaderboard` exactly, with a comment referencing BK-9.

**Why this is safe / no behavior regression:** the only renderer consumer
(`useLeaderboard.ts:470`) `await`s the call and never reads the resolved value; its declared
type in `api/db.ts` is `Promise<unknown>`. Existing test mocks already resolve this channel to
a truthy value (`true`). Returning `{success:true}` is strictly more informative and breaks no
consumer or assertion.

**Test:** no new test — there is no consumer that branches on the return shape, so this is a
pure contract-alignment change. Verified by running the full leaderboard/useLeaderboard suites
(the code paths that call this channel).

**Verification:** `npx jest --config jest.unit.config.ts useLeaderboard leaderboard`
→ 92 passed, 9 suites.

---

## ✅ LB-11 — Discard count capped so a boat can't have all its scores discarded (SHRS 5.4)

**Finding (audit Part 3, MEGA H-NEW-2, `calculateBoatScores.ts:255-270`):** the SHRS 5.4
discard count is series-wide (correct, per RULE-C1). But it was applied to every boat without
bound, so a boat whose own race count is smaller than the discard count — e.g. a late entrant
whose missing races are not seeded — had _all_ of its scores excluded, giving `totalPoints = 0`
and wrongly ranking it first.

**What changed:**

- `src/main/functions/calculateBoatScores.ts` — renamed the raw series-wide value to
  `seriesExcludeCount` and derived the applied `excludeCount` as
  `Math.min(seriesExcludeCount, Math.max(0, scoreEntries.length - 1))`, so at least one score
  is always kept. The debug log now notes when the cap bit.

**Design note — deviation from the audit's literal suggestion (please review):** the audit
suggested `Math.min(excludeCount, boat.number_of_races)`. That is **insufficient** — a boat
with exactly one race would still get that one score discarded (`min(2,1)=1`) → total 0. The
correct invariant in low-point scoring is that you can never discard your way _below your
single best race_, so the cap must keep at least one score: `scoreEntries.length - 1`. I also
capped against `scoreEntries.length` (the actual rows) rather than `number_of_races` (a
COUNT column) so the guard holds even if the two ever disagree.

**Scope of the change:** the cap only alters behavior in the pathological case where
`excludeCount >= scoreEntries.length`. In every normal case (each boat has ≥ its own discard
count + 1 scores) `Math.min` returns the series-wide value unchanged — confirmed by the
existing discard tests still passing untouched.

**Open question flagged for your ruling (NOT fixed here):** this guard stops the 0-point
collapse, but the _deeper_ question — should a late entrant's missing races be seeded as `DNC`
(RRS A4/A5) so it is scored across the full series rather than on its 1 sailed race? — is a
rules/product decision. With no DNC seeding, a 1-race boat is still scored only on that race
(e.g. 20 pts above), which may or may not be what you want. See also the audit's
`MEGA M-NEW-1` (renderer `applyExclusions` uses a per-boat count vs the backend's series-wide
count) — that display divergence is separate and still open.

**Test added:** `calculateBoatScores.test.ts` — "caps discards so a boat with fewer races than
the discard count keeps a score (LB-11)". boatFull (8 races, all 1sts) vs boatLate (1 race,
20th). Without the cap boatLate → 0 pts → place 1; with the cap boatLate keeps 20 pts and
correctly places 2nd behind boatFull.

**Verification:** `npx jest --config jest.unit.config.ts calculateBoatScores` → 37 passed
(was 36). Full suite: `602 passed, 1 failing` (the known `python` env failure only).

---

## ✅ BK-3 — Non-finisher boats stored at the shared penalty position (SHRS 5.2)

**Finding (audit Part 1, HRH M11 / SI H3/M10/L12, `HeatRaceHandler.ts:1140`):** for non-scoring
penalties (DNF/DNS/DSQ/…) the write path used `position = place || penaltyPlace`. The frontend
always sends a sequential `place` (≥1), so the `|| penaltyPlace` branch never fired and these
boats were stored with sequential positions (5, 6, …) instead of the shared
`maxHeatSize + 1` that SHRS 5.2 requires (all non-finishers share one position). Points were
already `penaltyPlace` (correct), so leaderboard _rankings_ were right, but the stored/displayed
race _positions_ were wrong.

**What changed:**

- `src/main/ipcHandlers/HeatRaceHandler.ts` — in `submitHeatRaceScoresAtomic`'s per-boat write,
  non-scoring penalties now set `position = penaltyPlace` (matching `points = penaltyPlace`),
  with a comment referencing BK-3. This also removes the `place || …` masking of `0`/`NaN`
  place input noted in HRH M11.

**Scope:** only affects boats submitted with a non-scoring-penalty status. FINISHED boats and
position-keeping penalties (ZFP/SCP/T1, which correctly keep their finishing place) are
untouched.

**Test added:** `HeatRaceHandler.submitScoresAtomic.test.ts` — "stores non-scoring-penalty
boats at the shared penalty position, not their sequential place (BK-3 / SHRS 5.2)". Submits a
DNF (place 2) and a DSQ (place 3) in a 10-boat heat; both must be stored at position **11**
(largest-heat size + 1), not 2/3.

**Verification:** `npx jest --config jest.unit.config.ts submitScoresAtomic` → 5 passed (was 4).

---

## ⛔ BK-2 — REVIEWED, NOT CHANGED — audit recommendation appears incorrect (please confirm)

**Finding as written (audit Part 1, HRH C1, `HeatRaceHandler.ts:1365`):** the withdrawn-boat
filter in `startFinalSeriesAtomic` uses `statuses.some(s => s === 'WTH')` (ANY race WTH). The
audit recommends changing it to ALL-races-WTH, arguing "a withdrawn boat has withdrawn from the
whole series."

**Why I did NOT apply the recommended fix — evidence from the codebase:**

1. `src/renderer/constants/penaltyLabels.ts:22` defines `WTH: 'Withdrawn from series'` — WTH is
   explicitly a _series-level_ withdrawal marker, not a per-race one.
2. `src/renderer/pages/EventPage/EventPage.tsx:202-205` documents the intended workflow:
   "A withdrawal **mid-series** is recorded as WTH in scoring… Record a mid-series withdrawal
   by scoring the boat as WTH."

   A boat that withdraws mid-series therefore has some **FINISHED** races (before withdrawal)
   and some **WTH** races (from the withdrawal onward).

3. SHRS 4.2 sends withdrawn boats to the **lowest** fleet.

Under this model the **current `.some(WTH)` is correct**: any WTH ⇒ the boat withdrew from the
series ⇒ lowest fleet. The audit's proposed `.every(WTH)` would look at a genuine mid-series
withdrawal (which has FINISHED races too), conclude "not all WTH → not withdrawn," and leave the
boat in a normal fleet — a **regression**. The audit's own example ("a boat that DNS'd one race
but sailed the rest") describes a **DNS** boat, which `.some(WTH)` already does _not_ classify as
withdrawn, so it doesn't demonstrate the claimed bug.

**Action:** left the code as-is. If your regatta records WTH differently (e.g. a single WTH race
that should _not_ mean series withdrawal), tell me and I'll revisit — but as the app is currently
designed, the audit's fix would introduce a bug.

---

## ✅ BK-7 — `updateScore` / `deleteScore` now re-run A7 tie scoring and recompute

**Finding (audit Part 1, HRH H3 / M6):** the `updateScore` handler wrote the row and locked the
discard profile but never called `applyRaceTieScoring(race_id)`, leaving stale RRS A7 tie points
on the other finishers, and never recomputed the leaderboard. `deleteScore` only ran the DELETE —
remaining tied boats kept stale averaged points and no leaderboard recompute happened.

**Note on current impact:** these two IPC channels are registered and bridged but have **no
renderer call sites today** (only the `api/db.ts` type declarations and preload wiring exist), so
this was a _latent_ bug — harmful only when/if these channels get wired into the UI. Fixed now so
the write path is correct whenever it is used.

**What changed (`src/main/ipcHandlers/HeatRaceHandler.ts`):**

- Added a `recomputeLeaderboardsForRace(race_id)` helper that looks up the race's event + heat
  type and calls `recomputeEventLeaderboard`, plus `recomputeFinalLeaderboard` for Final heats
  (mirrors `undoLastScoredRaceForHeat`).
- `updateScore`: the UPDATE, `lockDiscardProfileForRace`, and `applyRaceTieScoring(raceId)` now
  run inside one `db.transaction()`; the leaderboard recompute runs after it commits.
- `deleteScore`: now reads the `race_id` **before** deleting, runs the DELETE +
  `applyRaceTieScoring` in a transaction (only when a row was actually removed), then recomputes.

**Why safe:** wrapping in a transaction also partially addresses the atomicity concern from BK-5
for these two paths (a tie-scoring failure now rolls the edit back instead of leaving a
half-updated race). No existing behavior relied on the old no-recompute path (no callers, no
tests).

**Test added:** new file `src/__tests__/HeatRaceHandler.scoreEditRecompute.test.ts` (4 cases),
registered in `jest.unit.config.ts`:

- `updateScore` on one of two tied finishers → both finishers re-scored to the averaged **1.5**
  points, and `recomputeEventLeaderboard(42)` is called (final recompute is not).
- `deleteScore` → tie scoring re-runs and the leaderboard recomputes.
- A **Final**-heat edit also calls `recomputeFinalLeaderboard(42)`.
- A `deleteScore` that removes nothing (`changes === 0`) does **not** recompute.

**Verification:** `npx jest --config jest.unit.config.ts scoreEditRecompute` → 4 passed. Full
suite `607 passing, 1 failing` (known `python` env only); `tsc --noEmit` clean; no new lint
errors.

---

## ✅ BK-8 — Swallowed heat-count error is now surfaced (silent stale standings)

**Finding (audit Part 1, HRH H8, `HeatRaceHandler.ts:1172-1185`):** after a qualifying race is
scored, the handler checks whether every latest heat has the same race count before recomputing
the leaderboard. If `getLatestQualifyingHeats` / `getRaceCountForHeat` threw, the `catch` block
silently set `allHeatsEqual = false`, so the recompute never ran and standings went stale with
**no error surfaced anywhere**.

**What changed (`src/main/ipcHandlers/HeatRaceHandler.ts`, `submitHeatRaceScoresAtomic`):** the
empty `catch` now logs the cause via `console.error` with the event id and an explicit note that
the recompute was skipped and standings may be stale until the next scored race.

**Deliberately NOT changed (control flow):**

- It does **not** throw. The scores are already committed at this point; throwing would make a
  successful submit report failure, and a retry would create a **duplicate race** (the SI H2
  hazard). Surfacing must be non-fatal here.
- It still **skips** the recompute on an indeterminate heat state. Recomputing while heats have
  unequal race counts would itself produce wrong standings — the skip is intentional; only the
  _silence_ was the bug.

**Test:** none added — this is an observability-only change with no behavioral difference on any
exercised path (the existing `submitScoresAtomic` suite covers the normal equal/unequal-heats
branches and still passes; the error branch requires a thrown query, which the mock never does).

**Verification:** `npx jest --config jest.unit.config.ts submitScoresAtomic` → 5 passed; no new
lint errors.

---

## ⏸️ LB-9 — REVIEWED, DEFERRED — coupled to a larger fix (MEGA M-NEW-1)

**Finding (audit Part 3, CMP C-13 / MEGA H-NEW-12, `leaderboardUtils.ts:145-158`):**
`processLeaderboardEntry` throws away the `total` that `applyExclusions` computes and instead
shows the DB-stored `total_points_final ?? total_points_event`. If the discard profile changed
without a recompute, the parenthesised markings (from `applyExclusions`) and the numeric total
(from the DB) can disagree. The audit's fix is "use the locally computed `total`".

**Why I did NOT apply it yet:** the frontend `applyExclusions` computes its exclusion count from
a **per-boat** race count (`getExcludeCount(rawPositions.length, …)`, `leaderboardUtils.ts:96`),
while the backend uses a **series-wide** count (post RULE-C1). The audit itself records this
divergence as **MEGA M-NEW-1**. So the local `total` is computed from a _different discard rule_
than the one that produced the stored ranking. Swapping `computed_total` to the local value would
make the displayed number disagree with the ranking order for any boat whose race count differs
from the series — arguably a worse inconsistency than the one LB-9 describes.

**Correct ordering (recommendation):** first align the frontend `applyExclusions` exclusion count
with the backend's series-wide count (MEGA M-NEW-1), _then_ switch `processLeaderboardEntry` to
the local total (LB-9). Done together they are safe; done alone LB-9 risks visible total-vs-rank
mismatches. This is a deliberate deferral, not an oversight — flagging for your call on whether to
take on the paired change.

---

## ⛔ MEGA M-NEW-6 — REVIEWED, NOT CHANGED — audit recommendation would regress

**Finding as written (audit Part 3, `useLeaderboard.ts:203`):** `getPenaltyPosition` uses
`(size || entryCount) + 1`; the audit says `||` "treats 0 as missing" and recommends `??`.

**Why I did NOT apply it — evidence:** `maxHeatSizes` is initialised to `{ qualifying: 0,
final: 0 }` (`useLeaderboard.ts:182-185`) and every update coerces with `|| 0`
(`:448`), so `size` is **always a number and its not-yet-loaded sentinel is `0`, never
null/undefined**. The comment at `:198-199` states the intent: fall back to `entryCount` _only
while heat sizes are not loaded_. With `??`, the unloaded state (`size === 0`) would **skip** the
fallback and yield `penaltyPosition = 0 + 1 = 1` during loading — wrong. For a genuinely empty
series both operators give the same result (`entryCount` is also 0), so `??` fixes nothing and
breaks the load path. The existing `||` is correct given this initialisation.

**Action:** left as-is. (If `maxHeatSizes` is ever reworked to use `null` for "unloaded", revisit —
then `??` would be the right operator.)

---

## ✅ LB-15 — ComparePanel race-grid cells get stable, unique React keys

**Finding (audit Part 3, CMP C-25 / MEGA M-NEW-14):** `RaceGridCell.key` is optional
(`types.ts:308`), and `ComparePanel` rendered its three race-grid rows with `key={`h-${race.key}`}`
(and `a-`/`b-`). When `race.key` is undefined every cell collapses to `h-undefined` → duplicate
React keys → React warnings and possible DOM misreconciliation across renders.

**What changed (`src/renderer/components/leaderboard/ComparePanel.tsx`):** all three
`raceGrid.map(...)` blocks now take the map `index` and key on
`` `h-${race.key ?? race.label ?? ri}` `` (and `a-`/`b-`), so a missing key falls back to the
label and finally to the positional index — always unique within the row.

**Scope:** ComparePanel is the only render site of `raceGrid` (confirmed by grep). This is the
`raceGrid.key` case only; the separate `QualifyingTable` null-`race_id` duplicate-key issue is
audit item **LB-4** (still open).

**Test:** none — this is a React-key uniqueness fix (no logic/output change); the existing
`compareUtils` suite still passes. Verified via `tsc --noEmit` (clean) and eslint (no errors).

**Verification:** `tsc --noEmit` clean; full suite `607 passing, 1 failing` (known `python` env
only).

---

## ⛔ RULE-M11 — REVIEWED, VERIFIED CORRECT — false positive (redress rounding)

**Finding as written (audit Part 4, ⚠️ not re-verified, `useLeaderboard.ts:186`):**
`roundToNearestTenthHalfUp` allegedly rounds an exact `x.05` average **down**, so RDG redress
grants 0.1 too few (RRS A9/A10 says 0.05 rounds **up**).

**Verification (empirical):** the function is
`Math.round((value + Number.EPSILON) * 10) / 10`. I brute-forced it against
(a) every `sum / count` division for `count ∈ [2,20]`, `sum ∈ [1,400]` and
(b) every multiple of 0.05 up to 100. **Zero** values round the wrong way — every `x.05` rounds
**up**, exactly as RRS requires (`Math.round` breaks ties toward +∞ for positives, and the
`+ EPSILON` covers the float boundary; e.g. `2.05*10` evaluates to `20.5` and rounds to `21`).
Redress averages never exceed ~40, so the theoretical large-value fragility of `EPSILON` never
bites.

**Action:** left as-is; this closes RULE-M11 as already-correct. (If you ever want belt-and-braces
hardening for very large inputs I can switch to a relative-epsilon form, but it isn't needed and
would risk perturbing the `useLeaderboard.rdg.property` test.)

---

## ⚖️ RULE-m3 — REVIEWED, NEEDS YOUR RULING — real inconsistency, product decision

**Finding (audit Part 4, ⚠️, `finalSeriesEligibility.ts` vs `HeatRaceHandler.ts:1299`):**
`getFinalSeriesEligibility` returns `ok: true` (with `noRacesCompleted: true`) when ≥2 heat groups
exist but **0 qualifying races** have been sailed — yet `startFinalSeriesAtomic` then **throws**
("Cannot start final series without qualifying leaderboard data"). Confirmed both halves in code.

**Why this needs a decision, not a silent fix:** the renderer (`HeatComponent.tsx:333`)
_deliberately_ handles `noRacesCompleted` by asking the user to confirm "Boats will be assigned to
fleets based on their initial seeding only. Start anyway?" So the **UI intends to allow** a
seeding-only final series, while the **backend forbids it**. SHRS 4.2 assigns fleets "based on
their ranking in the Qualifying Series", and SHRS 3 defines a seeding fallback "if no ranking… is
available" — so a seeding-only start is arguably rule-legal, but it isn't implemented in
`startFinalSeriesAtomic`.

Two consistent resolutions — **your call**:

- **(A) Forbid it:** make eligibility return `ok:false` (new reason `NO_RACES_COMPLETED`) and drop
  the UI's seeding-only confirm path. Smaller change.
- **(B) Allow it:** implement seeding-based fleet assignment in `startFinalSeriesAtomic` for the
  0-race case (national-letter + sail-number order per SHRS 3). Larger change, matches current UI
  intent.

I did not implement either — tell me which and I'll do it (with tests).

---

## ✅ LB-4 — Unique React keys for DNS placeholder cells in QualifyingTable

**Finding (audit Part 3, MEGA C-NEW-2, `QualifyingTable.tsx:330`):** race cells were keyed
`ev-${boat_id}-${raceId}`, but DNS placeholder rows have a **null** `race_id`, so every such cell
in a row collapsed to `ev-<boat>-undefined` → duplicate React keys → warnings and DOM
misreconciliation.

**What changed (`src/renderer/components/leaderboard/QualifyingTable.tsx`):** the key now falls
back to the map index when `raceId` is null — `` `ev-${entry.boat_id}-${raceId ?? `i${ri}`}` `` —
with the index prefixed (`i${ri}`) so a real numeric `race_id` can never collide with a fallback
index within the same row.

**Checked the sibling:** `FinalFleetTable` already keys its cells on `raceIndex`
(`f-cell-${boat_id}-${raceIndex}`), so it had no equivalent bug.

**Test:** none added — React-key uniqueness fix, no logic change; the 9 leaderboard suites
(92 tests) still pass. Verified via `tsc --noEmit` (clean) + eslint.

---

## ✅ MEGA H-NEW-15 — Leaderboard column count comes from the widest boat, not entries[0]

**Finding (audit Part 3, `FinalFleetTable.tsx`):** `finalRaceCount` (and the analogous
`qualRaceCount`) were derived from `entries[0]?.races?.length` — the **top-ranked** boat only. If
that boat had fewer races than the others (e.g. 0 final races so far), the header rendered too few
columns and every other boat's scores in the missing columns became invisible.

**What changed (`src/renderer/components/leaderboard/FinalFleetTable.tsx`):**

- `qualRaceCount = Math.max(0, ...eventLeaderboard.map(e => e.races?.length || 0))`
- `finalRaceCount = Math.max(0, ...entries.map(e => e.races?.length || 0))`

**Completeness note:**

- **Qualifying columns are fully fixed** — both the header (`:205`) and the body (`:430`) iterate
  `Array.from({ length: qualRaceCount })` and index into each boat's races, so widening the count
  aligns everything.
- **Final columns:** the header (`:249`) uses `finalRaceCount` but the body (`:487`) still maps
  each boat's own `entry.races`. Widening the header is strictly an improvement (previously a
  short top boat hid _every_ boat's final cells; now the common case renders correctly). Making
  the final body pad to `finalRaceCount` like the qualifying body is the **separate** audit item
  **MEGA M-NEW-13** — I left it because those cells are _editable_, and rendering padded editable
  cells for races a boat hasn't sailed needs care around the edit/`onRaceChange` flow. Flagged as
  still-open rather than rushed.

**Why safe:** within a fleet every boat sails the same final races (SHRS 4.4), so normally all
entries share the count and `Math.max` returns the same value; it only changes behavior in the
anomalous short-top-boat case, where it reveals hidden data.

**Test:** none added — display-count fix; the 9 leaderboard suites (92 tests) still pass;
`tsc --noEmit` clean.

---

## ✅ HRH M4 — Atomic scoring uses the heat's real event, not the payload's

**Finding (audit Part 1, HRH M4, `HeatRaceHandler.ts`):** `submitHeatRaceScoresAtomic` read
`event_id` from the renderer payload and used it for `getMaxHeatSize(event_id, …)` and the
leaderboard recompute — even though it already fetches the heat row (which carries the real
`event_id`). A stale/wrong payload `event_id` would compute the SHRS 5.2 penalty base
(largest-heat size) for the **wrong** event and recompute the **wrong** leaderboard.

**Rule tie-in:** SHRS **5.2** bases non-finisher points on "the number of boats in the largest
heat" — of _this_ event. Using another event's heat sizes silently corrupts every non-finisher's
score.

**What changed (`src/main/ipcHandlers/HeatRaceHandler.ts`):** the payload `event_id` is now
captured as `payloadEventId` and **ignored** for logic; `event_id` is destructured from the
fetched `heatRow` (`const { event_id } = heatRow`). If the payload value is present and disagrees,
a `console.warn` records the mismatch. This mirrors the handler's existing treatment of the
`isFinalSeries` payload flag (already derived from the heat, not trusted).

**Test added:** `HeatRaceHandler.submitScoresAtomic.test.ts` — "scores against the heat's own
event, ignoring a wrong payload event_id (HRH M4)". The harness now records which `event_id`
reaches `getMaxHeatSize`; the test submits `event_id: 999` for a heat that belongs to event `1`
and asserts `getMaxHeatSize` was called with **1**, not 999. (Before the fix it received 999.)

**Verification:** `npx jest --config jest.unit.config.ts submitScoresAtomic` → 6 passed (was 5);
full suite `608 passing, 1 failing` (known `python` env only); `tsc --noEmit` clean; no new lint
errors.

---

## ⛔ MEGA H-NEW-5 — REVIEWED, WORKING AS DESIGNED (RAF → RET is intentional)

**Finding as written (audit Part 3, `ScoreCell.tsx:232`):** the status `<select>` value uses
`raceStatus === 'RAF' ? 'RET' : raceStatus`, allegedly converting RAF ("Retired after finishing")
to RET "irreversibly" on inspection.

**Why it's not a bug:**

1. `RAF` is **not** in `allowedScoreStatuses` (`scoreStatus.ts:64`), and `normalizeScoreStatus`
   maps `RAF → RET` (`:104`) _before_ the allow-list check. Every write path normalises, so
   **`RAF` can never be persisted** — the DB only ever holds `RET`. There is no distinct stored
   RAF value to lose.
2. RAF and RET **score identically** (both are non-finisher "retired"), and SHRS **5.3** lists
   only `RET` in the recording order — the app deliberately treats RAF as an input alias of RET
   (documented in the code comments at `ScoreCell.tsx:263-265`).
3. A native `<select>` fires `onChange` only on an actual value change, not on opening/inspecting
   it, so "inspecting the dropdown persists RET" doesn't occur either.

**Action:** left as-is; the RAF→RET mapping is correct and intentional.

---

## ⛔ MEGA H-NEW-4 — REVIEWED, DOES NOT REPRODUCE AS DESCRIBED

**Finding as written (audit Part 3):** an edit-mode `<input type="number">` renders **blank** for
penalty-code values (e.g. "DSQ") on disabled cells, so the cell "looks broken"; suggested fix is
`type="text"` when disabled.

**Why it doesn't reproduce:** the numeric input's value is `draft ?? rawNumeric`, and `rawNumeric`
comes from `race`, which is the boat's stored **position** — `race_positions` GROUP_CONCATs
`sc.position` (a number; e.g. `11 = maxHeatSize+1` for a DSQ after BK-3), **not** the status code.
The code string "DSQ" is only ever produced by `getRaceCellDisplay` for the **read-mode**
`displayText` (`ScoreCell.tsx:169`); the edit input never receives it. So a locked penalty cell
shows its numeric position (e.g. `11`, greyed at opacity 0.35), not a blank field.

**Residual (cosmetic, not fixed):** showing the position number in a locked cell is mildly
inconsistent with the read-mode code ("DSQ"), but it is neither blank nor broken, and the adjacent
status `<select>` already shows "DSQ". Not worth a risky `type` swap. If you want the locked cell
to echo the code instead of the number, say so and I'll make it a deliberate display change.

---

## ✅ LB-10 — Position-keeping penalty set single-sourced (ZFP/SCP/T1)

**Finding (audit Part 3, CMP C-14 / MEGA M-NEW-16 / H-NEW-18):** the set of position-keeping
penalties `['ZFP','SCP','T1']` was declared **twice** — `scoringPenalty.ts:6`
(`scoringPenaltyStatuses`, used by the main process + edit-preview) and `penaltyOrder.ts:10`
(`POSITION_KEEPING_PENALTIES`, used by the data-entry component). Two copies of a scoring rule can
drift apart, and the renderer preview would then disagree with the persisted scores.

**What changed (`src/renderer/utils/penaltyOrder.ts`):** removed the duplicate literal and made
`POSITION_KEEPING_PENALTIES` an alias of the shared `scoringPenaltyStatuses`
(`import { scoringPenaltyStatuses } from '../../shared/scoringPenalty'`). `src/shared/` is the
existing single-source-of-truth module for scoring-penalty math (imported by both processes), so
this points both names at one definition.

**Why safe:** the two sets had identical members, and every consumer
(`penaltyOrder.ts`, `ScoringInputComponent.tsx`, `penaltyOrder.test.js`) only calls `.has()` /
iterates — no mutation, no behavior change.

**Rule tie-in:** SHRS **5.3** — ZFP/SCP/T1 keep the boat's finishing place (not displaced);
having one definition guarantees the renderer and backend apply 5.3 identically.

**Test:** existing `penaltyOrder` + `ScoringInputComponent` suites (22 tests) still pass unchanged;
`tsc --noEmit` clean.

---

## ✅ MEGA M-NEW-8 — ComparePanel fade timer is now cleaned up

**Finding (audit Part 3, `ComparePanel.tsx`):** the fade-animation `useEffect` scheduled a
`setTimeout` (`timerRef.current`) but returned **no cleanup**. If a dep changed (or the panel
unmounted) while a fade was pending, the timer would later fire and call
`setDisplayed(compareInfo)` / `setFading(false)` with a **stale** `compareInfo` closure —
overwriting the displayed comparison, or setting state on an unmounted component.

**What changed (`src/renderer/components/leaderboard/ComparePanel.tsx`):** the effect now returns
a cleanup that clears the pending timer (and nulls `timerRef`). The early-return branches were
made `return undefined` for `consistent-return`.

**Why safe (doesn't break the fade):** the effect deps are `[compareInfo, displayed, show]`, none
of which change during the 160 ms fade, so the cleanup never runs mid-animation — it only fires
when a dep genuinely changes (exactly when the stale timer should be cancelled) or on unmount.

**Test:** the 9 leaderboard suites (92 tests) that render/compare still pass; `tsc --noEmit` clean;
lint clean.

---

## ⏸️ LB-16 — REVIEWED, NOT CHANGED — entangled with the qualifying/final edit context (RULE-m4)

**Finding (audit Part 3, CMP E-5 / MEGA M-NEW-21 / M-NEW-23):** `activeTab` is set to `'final'`
once (when finals start, `useLeaderboard.ts:428`) and never reset; the audit calls it dead /
preference-overwriting.

**What I found:** `activeTab` is returned from the hook but **not consumed by `LeaderboardPage`**
(the page renders `QualifyingTable` + `FinalFleetTable` based on `finalSeriesStarted`, not
`activeTab`). However, `activeTab` is _not_ inert — it is used **internally** (`:201`, `:1362`,
`:1445`) to decide `isFinalEdit`, i.e. whether an edit uses the **final** or **qualifying**
max-heat-size and discard profile. Because it's stuck at `'final'` after finals start and there's
no exposed setter, editing a **qualifying** cell then applies the **final** series context — which
is exactly the audit's separate rules item **RULE-m4** ("edit preview applies the Final discard
profile to the Qualifying tab once finals start").

**Why deferred:** the correct fix isn't "reset a tab" — it's to derive the edit context from
_which table/cell_ is being edited rather than from a single global `activeTab`. That touches the
edit/preview pipeline and should be done together with RULE-m4, deliberately and with tests, not as
a one-liner. Flagged for a focused follow-up (tell me to take on the LB-16 + RULE-m4 pair and I
will).

---

## ✅ BK-1 — `Heat_Boat` UNIQUE(heat_id, boat_id) constraint + migration + safe inserts

**Finding (audit Part 1, HRH M5 / CMP B-3 / MEGA C-NEW-5) — CRITICAL:** `Heat_Boat` had no
`UNIQUE(heat_id, boat_id)`, so a boat could be recorded in the same heat twice (e.g.
`transferBoatBetweenHeats` does DELETE-from-source then unconditional INSERT-into-target; if the
boat was already in the target it duplicated). Duplicates inflate `getMaxHeatSize` (every
non-finisher penalty +1 under SHRS 5.2), double-seed DNS rows, and multiply `SUM(points)` in the
`Heat_Boat LEFT JOIN Scores` recompute.

**What changed:**

1. **Migration (`public/Database/DBManager.js`)** — added `hasUniqueHeatBoatConstraint()` +
   `ensureUniqueHeatBoat()`, mirroring the existing `ensureUniqueRaceBoatScores()` pattern, and
   called it right after the `Heat_Boat` table is created. It (a) collapses historical duplicates
   keeping one row per pair (`DELETE … WHERE rowid NOT IN (SELECT MIN(rowid) … GROUP BY heat_id,
boat_id)`), then (b) creates `UNIQUE INDEX idx_heat_boat_unique ON Heat_Boat(heat_id, boat_id)`.
   Runs for both fresh and existing databases (idempotent — the constraint check short-circuits).
2. **Constraint-safe inserts** — the UNIQUE index would otherwise make a duplicate insert _throw_
   instead of silently duplicating, so the three insert paths where a duplicate can legitimately be
   attempted now use `INSERT OR IGNORE`:
   - `insertHeatBoat` (re-adding a boat already in the heat → benign no-op),
   - `transferBoatBetweenHeats` (boat already in target → delete-from-source + no-op insert leaves
     it in the target),
   - `eventSnapshot.ts` restore (tolerates snapshot files captured before the constraint that may
     contain duplicate rows).

**Deliberately NOT changed:**

- **Bulk-creation inserts** (`createInitialHeatsAtomic`, heat-recreate) stay plain `INSERT`. Those
  build fresh heats from a computed serpentine assignment where each boat appears once; if one ever
  produced a duplicate that now throws, that's a real assignment bug we _want_ surfaced (the
  transaction rolls back cleanly), not silently ignored.
- **The recompute `SELECT DISTINCT` dedup** the audit suggested is now **unnecessary**: the
  migration removes historical duplicates and the UNIQUE index prevents new ones, and the migration
  runs at startup before any recompute. Adding DISTINCT would be dead defense against a state that
  can no longer exist. (Say the word if you want it anyway as belt-and-braces.)

**Rule tie-in:** SHRS **2.3** (max 20 boats/heat) and **5.2** (penalty base = largest-heat size)
both depend on an accurate per-heat boat count; duplicates corrupted both.

**Test added:** `src/__tests__/Heat_Boat.uniqueIndex.migration.test.ts` (3 cases), registered in
`jest.unit.config.ts`. It runs the **exact** migration SQL against a real in-memory SQLite via
`node:sqlite` — **no `python`** (unlike the analogous Scores test, which is the suite's one known
env failure) and no native `better-sqlite3`:

- historical duplicates collapse to one row per (heat_id, boat_id);
- the unique index is created and a plain duplicate INSERT throws while a different pair inserts;
- `INSERT OR IGNORE` on a duplicate is a no-op (`changes === 0`) and doesn't grow the table.

Also updated `HeatRaceHandler.transferBoat.test.ts`'s mock to match the new
`INSERT OR IGNORE INTO Heat_Boat` SQL and honour its dedup no-op.

**Verification:** `npx jest --config jest.unit.config.ts Heat_Boat.uniqueIndex` → 3 passed;
`transferBoat` → 5 passed. Full suite `611 passing, 1 failing` (only the pre-existing `python`
Scores-migration env gap); `tsc --noEmit` clean; no new lint errors.

> Side note: my new migration test proves the `node:sqlite` approach works in this environment.
> The suite's one persistent failure (`Scores.uniqueIndex.migration.test.ts`) could be ported off
> `python` to `node:sqlite` the same way to make the suite fully green — say the word and I'll do
> it (it's a test-infra change, not an audit fix, so I left it).

---

## ✅ Test infra — Scores migration test ported off `python` → suite fully green

**Not an audit finding — a test-infra cleanup you approved.** `Scores.uniqueIndex.migration.test.ts`
shelled out to `python` and was the suite's single persistent failure (documented in `AGENTS.md §7`
as an environment gap) in any environment without `python` on PATH.

**What changed:** rewrote it to run the exact `ensureUniqueRaceBoatScores` migration SQL against a
real in-memory SQLite via `node:sqlite` (the same approach as the new BK-1 test) — no `python`, no
native `better-sqlite3`. Same schema, same seed rows, same assertions (latest duplicate row kept,
unique index created, future duplicate blocked, different pair still inserts). Updated `AGENTS.md §7`
to reflect that both migration tests now use `node:sqlite`.

**Verification:** full unit suite is now **612 passing, 0 failing, 51 suites** — the whole suite is
green for the first time in this workspace. `tsc --noEmit` clean; lint clean.

---

# Rules-grounded resolutions of the open decisions (checked against `docs/SHRS-2026-1.md`)

You asked "what do the rules say?" for the four open items. Verdicts, with citations:

| Item                                 | Rule basis                                                                                                                                               | Verdict                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **RULE-m3** (0-race finals)          | **4.2** fleet assignment = "ranking in the Qualifying Series" (needs scores, 5.4); **§3** seeding fallback is for _qualifying_ assignment only           | **Forbid** — implemented below                                                                                     |
| **LB-11** (DNC seeding)              | **5.4** totals "her race scores"; **5.1/RRS A** score every _entered_ boat each race (DNC via **5.2**) — but DNC only for races the boat was entered for | **Keep the cap; do NOT auto-seed DNC** (needs per-boat entry data the app lacks). No further change.               |
| **LB-9 + M-NEW-1** (exclusion count) | **5.4** "races completed **in that series**" ⇒ series-wide, not per-boat                                                                                 | **Align frontend to series-wide** (backend is correct)                                                             |
| **LB-16 + RULE-m4** (edit context)   | **5.1** "each fleet scored separately"; **5.4** discards "in that series" independently; **5.2** largest heat differs per series                         | **Edit context must follow the cell's series** (qualifying cell → qualifying profile/max-heat; final cell → final) |

## ✅ RULE-m3 — Final Series now rejected with 0 completed qualifying races (SHRS 4.2)

**Resolution: FORBID** (rules do not support a seeding-only start — see table). Implemented:

- `src/main/functions/finalSeriesEligibility.ts` — added reason `NO_RACES_COMPLETED`; when
  `completedQualifyingRaces === 0` the function now returns `ok:false` (with a rule comment citing
  4.2). This makes eligibility **consistent** with `startFinalSeriesAtomic`, which already rejected
  the zero-row qualifying leaderboard.
- `src/renderer/components/HeatComponent.tsx` — added a clear `NO_RACES_COMPLETED` message
  ("…complete at least one qualifying race before starting the Final Series (SHRS 4.2)") and
  **removed** the old "assign by initial seeding only — start anyway?" confirm path (rule-unsupported).
  The genuine `latestRoundUnsailed` case (≥1 completed race, empty latest round) is untouched.

**Tests updated (no net count change):**

- `finalSeriesEligibility.test.ts` — the old "reports noRacesCompleted / ok:true at 0 races" and the
  "m3 inconsistent" tests now assert `ok:false` + `reason: 'NO_RACES_COMPLETED'`, and that the start
  handler still rejects — i.e. the two now **agree**.
- `HeatComponent.startFinalSeries.integration.test.jsx` — the "asks SHRS 4.3 with 7 completed but
  latest heats show 0" test had a self-contradictory mock (`completedQualifyingRaces:7` +
  `noRacesCompleted:true`); corrected it to the real `latestRoundUnsailed` state and updated the
  first-confirm assertion accordingly. The 4.3 assertion (the test's real point) is unchanged.

**Verification:** `finalSeriesEligibility` + `HeatComponent.startFinalSeries` suites pass (21);
full suite **612 passing, 0 failing**; `tsc --noEmit` clean; lint clean.

## LB-11 (DNC seeding) — resolved as NO further change

Per the table: the rules assume every _entered_ boat is scored each race (DNC via 5.2), so
rule-correctly there are no "missing" races — but auto-seeding DNC would wrongly penalise a
genuinely late entrant for races **before she entered**, which the rules do not require, and the app
does not track per-boat entry rounds. The **cap already applied under LB-11** is the correct,
rule-safe guard. Full DNC-seeding should stay a race-office action, not automatic. **No code change.**

---

## ✅ LB-9 + MEGA M-NEW-1 — Frontend exclusion count aligned to series-wide; leaderboard total computed locally (SHRS 5.4)

**Findings:**

- **M-NEW-1** (`leaderboardUtils.ts:96`): the renderer `applyExclusions` derived the discard count
  from the boat's **own** race count (`rawPositions.length`), while the backend
  (`calculateBoatScores`) uses the **series-wide** count. For any boat with fewer races than the
  series they disagreed, so the renderer's parenthesised discards / net total diverged from the
  stored ranking.
- **LB-9** (`processLeaderboardEntry`): the displayed `computed_total` came from the DB-stored
  `total_points_final ?? total_points_event`, which can be stale if the discard profile changed
  without a recompute — so the markings (from `applyExclusions`) and the number could disagree.

**Rule basis (SHRS 5.4):** "After 4 races have been completed **in that series**… excluding her
worst score… for every 8 additional races completed" — the discard count keys off races completed
**in the series**, not per boat. So the backend is correct and the frontend had to be aligned;
once aligned, the locally-computed total is the right thing to display.

**What changed:**

- `src/renderer/utils/leaderboardUtils.ts`
  - `applyExclusions` takes an optional `seriesRaceCount`. When given, the discard threshold uses
    it (`getExcludeCount(seriesRaceCount, …)`); it also applies the **LB-11 cap**
    (`min(seriesExcludeCount, max(0, n-1))`) so a boat can never have all scores discarded —
    mirroring the backend. Omitting the argument preserves the old per-boat behavior (used by unit
    tests / single-entry callers).
  - `processLeaderboardEntry` forwards `seriesRaceCount` and now sets `computed_total` to the
    **locally computed net total** (falling back to the stored total only when there are no races).
- `src/renderer/hooks/useLeaderboard.ts`
  - **Read path:** computes the series-wide count as the max race count across the fetched rows
    (`seriesRaceCountOf`) and passes it to `processLeaderboardEntry` for both the event and the
    active (qualifying/final) leaderboards.
  - **Edit path:** a hook-level `editSeriesRaceCount` (max race count across `editableLeaderboard`;
    stable during a cell edit) is passed to both edit-mode `applyExclusions` previews, so the live
    preview uses the same series-wide count.

**Why safe:** in the common case every boat has the same race count, so series-wide == per-boat and
nothing changes — confirmed by the existing 203 leaderboard/scoring/comprehensive tests passing
untouched. The change only affects boats whose race count differs from the series (the exact case
that was wrong). The displayed total now matches the markings and the current profile.

**Tests added (`leaderboardUtils.exclusions.test.ts`, +3):**

- series-wide count drives the threshold (5-race boat in an 8-race series → 2 discards, not 1);
- the frontend LB-11 cap keeps a single-race boat's score in an 8-race series (not zeroed);
- `processLeaderboardEntry` computes `computed_total` locally (10), ignoring a stale DB total (999).

**Verification:** `leaderboardUtils.exclusions` → 9 passed (was 6); leaderboard/scoring/comprehensive
suites (203) still pass; full suite **615 passing, 0 failing**; `tsc --noEmit` clean; lint clean.

---

## ✅ LB-16 + RULE-m4 — Removed the dead `activeTab`; edit context follows the series (SHRS 5.1/5.4/5.2)

**Findings:** LB-16 — `activeTab` set to `'final'` once and never reset. RULE-m4 — an edit preview
could apply the Final discard profile to a Qualifying-tab edit once finals start.

**What I found by tracing the code (the important part):**

- `setActiveTab('final')` fires **only** alongside `setFinalSeriesStarted(true)` (one call site),
  both from the same initial state, so `activeTab` is **always in lockstep** with
  `finalSeriesStarted` (`activeTab==='event'` ⟺ `!finalSeriesStarted`). It was returned from the
  hook but consumed by **no component and no test** — pure dead state.
- The leaderboard page only makes the **active series'** cells editable: qualifying cells are
  editable _only before_ finals start (`QualifyingTable`, gated `!finalSeriesStarted`); once finals
  start the qualifying columns are read-only (`isEditable={false}` inside `FinalFleetTable`) and
  only the **final** columns are editable. So an edit's discard profile + largest-heat (keyed off
  `finalSeriesStarted`) **already** match the edited cell's series. **RULE-m4 is not reachable** —
  you can't edit a qualifying cell once finals start — and the context was already correct per
  SHRS 5.1 ("each fleet scored separately"), 5.4 (discards per series), 5.2 (largest heat per
  series). The `activeTab` layer was redundant indirection, not a source of wrong results.

**What changed (`src/renderer/hooks/useLeaderboard.ts`) — behavior-identical simplification:**

- Removed the `activeTab`/`setActiveTab` state, the `setActiveTab('final')` call, the `activeTab`
  return field, and the now-unused `ActiveTab` type.
- Replaced its three uses with the equivalent `finalSeriesStarted` expression (proven equal by the
  lockstep): `isFinalEdit` → `finalSeriesStarted` (in `getPenaltyPosition`); the save's
  `isFinalSeries` arg → `finalSeriesStarted`; `originalSource` selection → `finalSeriesStarted ?
leaderboard : eventLeaderboard`.
- Added comments documenting the invariant: edit context follows `finalSeriesStarted`, which is the
  series whose cells are editable (and a note for any future change that makes a different series'
  cells editable — it must thread the series through `handleRaceChange`).

**Why this is the right resolution (vs. a bigger "derive from the cell" refactor):** within any
edit session only the active leaderboard's cells are editable, so the cell's series _is_
`finalSeriesStarted`. Threading a per-cell series would add machinery with no behavioral difference
and new risk. The rules are already satisfied; the fix is to delete the misleading dead state.

**Test:** no new test — behavior is provably unchanged (lockstep), and the full leaderboard/scoring
suites (95) exercise both series' edit paths. Full suite **615 passing, 0 failing**; `tsc` clean;
lint clean.

---

## ✅ Severity-3 usability fixes — remaining findings completed (branch `fix/usability-severity3`)

This entry closes the "Still open" worklist in the correction note above. All remaining Immediate /
correctness / accessibility findings are now fixed, each with tests and each independently
code-reviewed (adversarial `bug-hunter` passes) before final verification.

**RULE-M12 implementation (was missing — completed first).** The dead-heat tie feature had tests +
CSS but no component logic. Implemented a per-row `=` "tied with the boat above" control in
`ScoringInputComponent.tsx`: `ties` state keyed by **explicit lower::upper pair** (not the bare lower
boat), a tie-aware `buildPlaceNumbers`, `pruneTies`, `handleToggleTie`, and a submit path that uses
`placeNumbers[boatNumber]` for both FINISHED and position-keeping (ZFP/SCP/T1) boats. The pair key
means a tie can never silently rebind when the boat above is removed or displaced.

**Remaining findings fixed (parallel subagents, partitioned by file ownership):**

| Area                | Findings                                                                                                                               | Files                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Backend correctness | BK-4 (duplicate sail numbers), BK-5 (remaining transactions), BK-6 (NaN validation)                                                    | `HeatRaceHandler.ts`, new `functions/validation.ts`         |
| Leaderboard hook    | LB-1/2/3/5 (race/cancel/double-submit/RDG2-picker/edit-clear), LB-6 (CSV injection), LB-7 (shift skips ZFP/SCP/T1), LB-8 (N-boat swap) | `useLeaderboard.ts`, `ScoreCell.tsx`, `leaderboardUtils.ts` |
| Accessibility       | UX-A1 (`<th scope>` ×45), UX-A2 (Rdg2Picker focus trap/dialog)                                                                         | 10 renderer files + `Rdg2Picker.tsx`                        |
| Stability           | UIX 4.1 (React error boundary)                                                                                                         | `App.tsx`, new `components/ErrorBoundary.tsx`               |

**Code-review follow-ups (8 real bugs found and fixed):**

1. RULE-M12 tie silently rebinding when the boat _above_ is removed/penalised → explicit pair key.
2. RULE-M12 position-keeping boat submitted the running place instead of the shared tied place.
3. LB-7 renderer/backend divergence: the backend manual ripple only shifted FINISHED, not ZFP/SCP/T1
   → added a `shiftPositionKeepingRows` ripple with `getScoringPenaltyPoints` recompute.
4. LB-8 two conflicts could displace two boats onto the same hole → global `claimedPlaces` set.
5. LB-6 `escapeCsvCell` missed `\t`/`\r` formula triggers → added to the trigger set.
6. BK-6 over-validation: non-scoring penalties (DNF/DNS/…) now skip integer validation (their
   provided place is discarded and overridden to `maxBoats + 1`).
7. Assignment-snapshot in-memory cache outliving a rolled-back transaction → rollback guard that
   forgets only the race ids absent before the transaction.
8. `insertScore` was transaction-wrapped but unvalidated → added `sanitizePositiveInteger`/`Finite`.

**Verification:** full unit suite **702 passing, 0 failing, 59 suites**; `tsc --noEmit` clean; lint at
the documented baseline (**18 errors, all pre-existing in `e2e/`**, 72 `no-console` warnings — no new
lint errors). Working tree only, nothing committed.

---

## Post-merge review follow-ups (2026-09-01)

Three defects found by an independent review of the merged
`fix/usability-severity3` diff. All three were incompletely-applied fixes from
that branch rather than regressions against the previous `main`.

### ✅ RULE-M15b — SHRS 1.5 fallback is decided per FLEET, not per event

**Finding:** `finalLeaderboardOrder.ts` computed `rankByQualifying` once over
every row in the event. Fleets do not have to start their Final Series together
(postponement, staggered starts, the SHRS 4.5 time limit), so as soon as _any_
fleet sailed a final race, every other fleet switched to `total_points_final` —
which is 0 for all of them. That tied the whole fleet and left it in raw
database order instead of qualifying order.

Reproduced before the fix, with Gold sailed and Silver not:

```
MIXED PROGRESS:   gold_b , gold_a , silver_bad_qual , silver_good_qual   <- silver wrong
NO FINALS SAILED: silver_good_qual , silver_bad_qual                     <- correct
```

**What changed:** new exported `fleetsWithCompletedFinalRace(rows)` returns the
`fleetRank`s that have sailed at least one final race; `orderFinalLeaderboardRows`
consults it per fleet. `hasAnyCompletedFinalRace` / `hasNoCompletedFinalRaces`
are unchanged and still exported.

**Tests added** (`finalLeaderboardOrder.test.ts`): a mixed-fleet-progress case
that fails on the old event-wide logic, a `fleetsWithCompletedFinalRace` unit
test, and a partially-scored-fleet case.

### ✅ BK-7b — `deleteScore` recomputed outside its transaction

**Finding:** `updateScore` calls `recomputeLeaderboardsForRace` _inside_
`applyUpdate` precisely so a recompute failure rolls the edit back (BK-7).
`deleteScore` called it _after_ its transaction committed. A recompute throw
therefore left the score deleted and the other finishers' A7 tie points
rewritten, with a stale stored leaderboard — while the IPC call still rejected,
so the renderer reported a failure over an already-mutated database.

**What changed:** `recomputeLeaderboardsForRace(raceId)` moved inside
`applyDelete`, matching `updateScore`. `lockDiscardProfileForRace` was
deliberately _not_ added: the insert that created the score already locks the
profile, and a delete adds no racing.

**Tests added** (`HeatRaceHandler.scoreEditRecompute.test.ts`): the recompute
runs inside the transaction, and a throwing recompute propagates from inside the
transaction callback so better-sqlite3 can roll back. Both fail on the old code.

### ✅ UX-S5 — exit guard reported an in-flight save as already saved

**Finding:** `HeatRacePage.confirmDiscardEntry` checked a boolean
`submittingRef`, which is true precisely while a submit is _in flight_ — not
after it resolved, as its comment claimed. When set, the guard announced "Your
scores were saved while the dialog was open" and allowed the exit. Since the
entered finish order lives only in `ScoringInputComponent`'s local state,
unmounting on a save that then failed lost it for good.

**What changed:** the ref now holds the in-flight submit _promise_, and the
guard awaits its real outcome — leave on success, stay (with the entry intact)
on failure. `handleSubmitScores` was restructured so its inner `runSubmit`
resolves `true` only when the scores are actually persisted. "Back to Heats" is
additionally `disabled`/`aria-busy` while a submit is pending; the navbar and
breadcrumb exits are covered by the guard itself.

**Tests added** (`HeatRacePage.test.jsx`): a failing in-flight save keeps the
scoring view and never claims success (both via the disabled Back button and via
the navbar path, which is not disabled), plus a success-path regression guard.
The first two fail on the old code.

**Verification:** `tsc --noEmit` clean; unit suite **790 passing, 0 failing, 60
suites** (was 782); production build green; lint back at the documented baseline
(**18 errors, all pre-existing in `e2e/`**, no new source errors).
