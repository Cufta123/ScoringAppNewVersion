# FABLE TEST PROMPT

**Objective**: Validate IOM Regatta Manager app logic is bulletproof across all user journeys.

**Context Files**:
1. `docs/FABLE_BRIEFING.md` - System architecture & critical invariants
2. `docs/SHRS-2026-1.md` - Official scoring rules
3. `AGENTS.md` - Implementation details

## Test Scenarios (Execute in Order)

### 0. Existing Test Suite Audit (FIRST PRIORITY)
**Before validating app logic, audit existing tests in `src/__tests__/`:**

**High-Priority Test Files**:
- `calculateBoatScores.test.ts`
- `calculateFinalBoatScores.test.ts`
- `creatingNewHeatsUtils.test.ts`
- `HeatRaceHandler.createNewHeats.test.ts`
- `HeatRaceHandler.overallTieBreak.test.ts`
- `leaderboardStatusCodes.test.ts`
- `SHRS_comprehensive.test.ts`
- `leaderboardUtils.exclusions.test.ts`
- `HeatRaceHandler.startFinalSeriesAtomic.test.ts`

**For Each Test File, Validate**:
1. **Test Logic Correctness**: Do test assertions match SHRS-2026-1 rules?
2. **Edge Cases Missing**: What scenarios are NOT tested?
3. **False Positives**: Could tests pass with incorrect implementation?
4. **Test Data Validity**: Are mock data setups realistic?
5. **Coverage Gaps**: What critical paths are untested?

**Critical Edge Cases to Look For**:
- DNE/DGM non-excludable penalties (SHRS 5.4 exclusions)
- Tie-break with excluded scores (SHRS 5.7.2)
- Temporary 2nd-worst exclusion for 5-7 race fleet assignment (SHRS 4.3)
- Penalty points = largest heat size, not total fleet (SHRS 5.2)
- Same-heat tie-break vs different-heat tie-break (SHRS 5.7)
- Multiple penalty types in same race (DNF, RET, NSC, OCS order)
- Final series separate discard calculation (SHRS 5.4)
- RDG average calculated separately per series (SHRS 5.6)
- Heat movement with all DNF in heat
- Fleet size balancing (Gold ≤ Silver ≤ Bronze ≤ Copper)

**Report Format**:
```markdown
### TEST FILE: calculateBoatScores.test.ts
✅ CORRECT: [Test case name] - validates [SHRS rule]
⚠️ LOGIC ERROR: [Test case name] - expects [X] but SHRS-2026-1 section [Y] says [Z]
❌ MISSING EDGE CASE: [Scenario description] - needed to cover [rule/invariant]
💡 SUGGESTION: Add test for [specific scenario]
```

### 1. Event Creation & Setup
- Create event (single fleet and multi-heat configurations)
- Test event metadata storage (name, date, format)

### 2. Sailor & Boat Registration
- Add sailors with various attributes (name, club, category)
- Register boats with duplicate sail numbers (should succeed post-migration)
- Associate boats to events via Boat_Event
- Verify cross-event boat persistence

### 3. Heat Creation - Progressive Assignment (QUALIFYING SERIES LOGIC)
**Race 1 (2-5 heats)**:
- Seed 20, 24, 30 boats
- Verify 1,2,3,4,5,5,4,3,2,1 distribution pattern
- Confirm equal heat sizes (±1 boat)

**Race 2+**:
- Record mixed finishes: FINISHED places + penalties (DNF, DNS, OCS, DSQ, UFD, BFD, RET, NSC, DNE, DGM)
- Verify movement table assignment (Heat Movement Table 1 from SHRS-2026-1)
- Test tie scenarios → alphanumeric ordering
- Verify penalty order: DNF, RET, NSC, OCS, DNS, DNC, UFD, BFD, DSQ, DNE
- Confirm protest decisions don't change next race assignments

### 4. Scoring Calculations
**Qualifying Series**:
- 3 races (0 discards) → verify scores
- 5 races (1 discard) → verify worst excluded
- 10 races (2 discards) → verify 2 worst excluded
- Penalty points = largest heat size (NOT total fleet) ✓
- Non-excludable penalties (DNE, DGM) ✓

**Edge Cases**:
- All boats DNF in heat → scoring correct?
- Mixed FINISHED + penalties + RDG in same race
- Boat withdraws mid-series (DNC/WTH)

### 5. Final Series Transition & Scoring (EQUALLY CRITICAL AS QUALIFYING)
**Fleet Assignment**:
- 3 qualifying races → no temporary exclusion
- 6 qualifying races → 2nd worst temporarily excluded for fleet assignment only
- 10 qualifying races → standard assignment
- Verify Gold ≤ Silver ≤ Bronze ≤ Copper sizes
- Withdrawn boats → lowest fleet
- Check fleet size balancing algorithm

**Final Series Scoring** (COMPLETE VALIDATION):
- Record final races per fleet (Gold/Silver/Bronze/Copper)
- Verify independent fleet scoring (each fleet separate)
- Test different race counts per fleet
- Verify separate discard calculation per series
- Penalty points = max(fleet size) not max(original heat size)
- Overall score = qualifying + final ✓
- Test all penalty types in final series (DNF, DSQ, RDG, etc.)
- Verify RDG average uses only final series races for final series redress

### 6. Tie-Breaking Logic
**Qualifying Series (Multi-Heat)**:
- 2-boat tie in same heat → RRS A8.1 with excluded scores
- 3-boat tie → resolve highest place first
- Boats never in same heat → standard RRS A8
- Multi-heat event with partial overlap
- Verify excluded scores ARE used for tie-break (SHRS 5.7.2)

**Final Series (Single Fleet)**:
- Standard RRS A8.1 and A8.2 (all boats in same fleet)
- Verify excluded scores behavior
- Test ties across Gold/Silver fleet boundary

### 7. Leaderboard Generation
- GlobalLeaderboard ordering
- FinalLeaderboard vs Leaderboard separation
- Verify all boats appear exactly once

### 8. RDG (Redress) Handling
- RDG1/RDG2/RDG3 calculations
- Averages computed separately for qualifying vs final
- Verify excluded scores not used in average

### 9. Stress Tests (FULL WORKFLOW)
**Qualifying Series**:
- 50 boats, 5 heats, 15 qualifying races
- Mass penalties in single race
- Fleet size changes between races (boat withdrawals)

**Final Series**:
- 4 fleets (Gold/Silver/Bronze/Copper)
- Different race counts per fleet (e.g., Gold: 8 races, Silver: 6, Bronze: 4)
- Mixed penalties across all fleets
- Verify overall ranking: Gold > Silver > Bronze > Copper regardless of scores

## Validation Approach

**⚠️ EQUAL PRIORITY: Qualifying Series AND Final Series logic both critical!**

### Phase 0: Test Suite Audit (First)
1. **Read** each high-priority test file in `src/__tests__/`
2. **Cross-reference** test expectations against SHRS-2026-1 rules
3. **Identify** logic errors in test assertions
4. **Find** missing edge cases and coverage gaps
5. **Suggest** additional test scenarios

### Phase 1-9: Implementation Validation
For each scenario:
1. **Predict** expected database state and leaderboard positions
2. **Trace** through implementation in:
   - `HeatRaceHandler.ts` (assignments, scoring, fleet creation)
   - `calculateBoatScores.ts` (qualifying series)
   - `calculateFinalBoatScores.ts` (final series - EQUALLY IMPORTANT)
   - `creatingNewHeatsUtls.ts` (heat generation + fleet assignment)
3. **Validate BOTH series independently**:
   - Qualifying: heat movement, scoring, discards
   - Final: fleet assignment, independent scoring, separate discards
4. **Identify** logic bugs, off-by-one errors, missed edge cases
5. **Report** findings with:
   - Scenario description
   - Expected behavior (per SHRS-2026-1 section reference)
   - Actual implementation behavior
   - Severity: CRITICAL / HIGH / MEDIUM / LOW
   - Suggested fix (file + function)

## Output Format

### For Test Audit (Scenario 0)
```markdown
## TEST SUITE AUDIT REPORT

### 📄 TEST FILE: calculateBoatScores.test.ts
✅ **CORRECT**: "should calculate scores with 1 discard" - validates SHRS 5.4 discard logic
⚠️ **LOGIC ERROR**: "should handle DNE correctly" - expects DNE excludable, but SHRS 5.3 says non-excludable
❌ **MISSING**: No test for mixed FINISHED + penalties in same race
💡 **SUGGESTION**: Add test for 3-boat tie with excluded scores (SHRS 5.7.2)

### 📄 TEST FILE: calculateFinalBoatScores.test.ts
...

### 🎯 CRITICAL GAPS SUMMARY
1. [Missing scenario 1]
2. [Missing scenario 2]
...
```

### For Implementation Validation (Scenarios 1-9)
```markdown
## VALIDATION REPORT

### ✅ PASSED: [Scenario Name]
- [Brief confirmation]

### ⚠️ ISSUE FOUND: [Scenario Name]
**Severity**: [CRITICAL/HIGH/MEDIUM/LOW]
**Location**: [file.ts:function]
**Expected**: [per SHRS-2026-1 section X.Y]
**Actual**: [implementation behavior]
**Impact**: [user-facing consequence]
**Fix**: [specific code change needed]
```

## Constraints
- Read source files strategically (start with handlers, then utilities)
- **For test audit**: Focus on LOGIC correctness (assertions, expected values), NOT code style
- Cross-reference calculations against SHRS-2026-1 section numbers
- Prioritize critical invariants (#1-24 in briefing) over minor UI issues
- Assume database schema correct per DBManager.js
- Focus on logic bugs, not code style
- **Test bugs are CRITICAL** - they hide real implementation bugs

**Start with scenario #0 (test audit), then proceed sequentially through 1-9. Report after: test audit (0), scenarios 1-3, scenario 4, scenarios 5-6, scenarios 7-9.**
