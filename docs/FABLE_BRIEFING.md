# IOM Regatta Manager - Fable Testing Briefing

## System Overview
Electron desktop app for sailing regatta management. Stack: React renderer, Node.js main process, SQLite database via better-sqlite3.

## Core Architecture
- **IPC Layer**: `src/main/preload.ts` exposes `window.electron.sqlite.*` API
- **Handlers**: `src/main/ipcHandlers/{Event,Sailor,HeatRace}Handler.ts`
- **Database**: `public/Database/DBManager.js` (schema), `*Manager.js` (queries)
- **Scoring Logic**: `src/main/functions/{calculateBoatScores,calculateFinalBoatScores,creatingNewHeatsUtls}.ts`

## Critical Database Tables
- **Events**: `is_locked` flag gates all mutations
- **Sailors**, **Boats**, **Clubs**, **Categories**
- **Boat_Event**: boat-to-event association
- **Heats**, **Races**, **Scores**, **Heat_Boat**
- **Leaderboard**, **FinalLeaderboard**, **GlobalLeaderboard**

## Scoring Rules (SHRS-2026-1)

**⚠️ CRITICAL: Both Qualifying and Final Series logic must be 100% correct - equal priority!**

**Qualifying Series**: 
- 2+ heats per race, boats assigned progressively (movement table) or pre-assigned
- Scoring: RRS A Low Point System, penalties scored as DNF/DNS/DSQ/OCS/UFD/BFD/RET/NSC/DNE/DGM/DPI/RDG1/RDG2/RDG3
- Penalty points = largest heat size + 1 (not total fleet) — SHRS 5.2
- Discards: 0 if <4 races, 1 if 4-7 races, 2 if >=8 races, +1 per 8 additional
- Heat movement tables control boat assignments between races

**Final Series** (EQUALLY IMPORTANT):
- Fleets (Gold/Silver/Bronze/Copper) assigned by qualifying rank
- Equal fleet sizes, best boats to Gold
- If 5-7 qualifying races: temporarily exclude 2nd worst score for fleet assignment only
- Each fleet scored independently
- Combined score = qualifying + final
- Different fleets may sail different number of races

**Tie Breaking**:
- Only scores from same-heat races used
- Excluded scores count for tie breaks (changes RRS A8.1)
- Multi-boat ties: resolve highest place first

## Critical Invariants to Validate

### Event Lifecycle
1. Event creation successful
2. Event metadata stored correctly

### Boat/Sailor Management
3. Boats can have duplicate sail numbers (uniqueness constraint removed)
4. Boats persist across events via Boat_Event junction

### Heat Creation (Progressive Assignment - Qualifying Series)
5. Race 1: boats seeded 1,2,3,4,5,5,4,3,2,1 pattern across heats
6. Subsequent races: movement table based on previous finishing position
7. Tied boats: alphanumeric sail number order
8. Heat sizes remain equal (±1 boat)
9. Protest decisions don't change assignments
10. DNF/RET/NSC/OCS/DNS/DNC/UFD/BFD order respected in movement

### Scoring Integrity (Both Qualifying & Final)
11. Penalty points = max(heat sizes) + 1, not total fleet
12. Non-excludable statuses: DNE, DGM
13. Discount logic respects race count thresholds independently per series
14. RDG average calculated separately for qualifying/final series

### Final Series Transition (CRITICAL)
15. Fleet assignment uses qualifying rank (with temporary 2nd-worst exclusion if 5-7 races)
16. Gold fleet size ≤ Silver ≤ Bronze ≤ Copper
17. Withdrawn boats placed in lowest fleet
18. Overall score = qualifying score + final score
19. Final series races scored independently per fleet
20. Final series has separate discard calculation

### Tie-Break Edge Cases (Both Qualifying & Final)
21. Only same-heat results used for tie-break (qualifying only)
22. Excluded scores included in tie-break calculation
23. 3+ boat ties: resolve highest place before lower
24. Final series ties follow SHRS 5.7.2.2: boats in the same fleet shared all races, so A8.1 is applied with excluded scores included

## Test Execution Strategy
For each scenario, verify:
- **Pre-conditions** met
- **Database state** correct after operation
- **Leaderboard calculations** accurate
- **UI consistency** with backend state

## Existing Test Suite (Audit First)

**High-Priority Tests** in `src/__tests__/`:
- `calculateBoatScores.test.ts` - Qualifying series scoring
- `calculateFinalBoatScores.test.ts` - Final series scoring
- `creatingNewHeatsUtils.test.ts` - Heat generation logic
- `HeatRaceHandler.createNewHeats.test.ts` - IPC handler heat creation
- `HeatRaceHandler.overallTieBreak.test.ts` - Tie-break algorithms
- `leaderboardStatusCodes.test.ts` - Penalty status handling
- `SHRS_comprehensive.test.ts` - End-to-end SHRS rules
- `leaderboardUtils.exclusions.test.ts` - Discard calculations
- `HeatRaceHandler.startFinalSeriesAtomic.test.ts` - Fleet assignment

**Test Audit Goals**:
1. Validate test logic matches SHRS-2026-1 rules
2. Find logic errors in test assertions
3. Identify missing edge cases
4. Detect false positive scenarios
5. Suggest additional test coverage

Read source code ONLY when behavior is ambiguous. Cross-reference calculations against SHRS-2026-1 rules directly.
