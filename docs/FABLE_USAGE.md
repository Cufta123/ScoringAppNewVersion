# Fable Testing - Usage Guide

## Files Created

1. **`docs/FABLE_BRIEFING.md`** - Condensed system architecture (900 tokens)
2. **`docs/FABLE_TEST_PROMPT.md`** - Testing instructions (1200 tokens)
3. **`docs/SHRS-2026-1.md`** - Official rules (already exists, ~2000 tokens)

## Minimal Credit Usage Strategy

### Initial Prompt to Fable

```
Read these 3 files in order:
1. docs/FABLE_BRIEFING.md (architecture & invariants)
2. docs/SHRS-2026-1.md (scoring rules)
3. docs/FABLE_TEST_PROMPT.md (test instructions)

Execute the test plan in FABLE_TEST_PROMPT.md. Report after: test audit (0), scenarios 1-3, scenario 4, scenarios 5-6, and scenarios 7-9.
```

**Why this works**:
- ~4000 tokens upfront context vs rebuilding from scratch
- Clear deliverables prevent rambling
- Sectioned reporting allows early course correction
- Fable reads source code only when needed (strategic deep-dive)

### Managing Fable's Investigation

**After test audit (Scenario 0)**:
- 🔴 **If critical test logic errors found**: Fix tests FIRST before implementation validation
- 🟡 **If missing edge cases found**: Note them for implementation validation
- 🟢 **If tests mostly correct**: Proceed to scenarios 1-9

**After each implementation report section**, either:
- ✅ **"Continue to next section"** (if no critical issues)
- 🔍 **"Deep-dive [specific scenario]"** (if issue needs investigation)
- 🛑 **"Stop, implement fixes first"** (if blocking bugs found)

### Expected Token Usage

| Phase | Tokens | Notes |
|-------|--------|-------|
| Initial context | ~4000 | 3 briefing files |
| **Test audit (Scenario 0)** | **~10000** | **Review 9 test files for logic errors + gaps** |
| Scenario 1-3 validation | ~8000 | Event/sailor/heat logic |
| Scenario 4 validation | ~6000 | Scoring calculations (heavy) |
| Scenario 5-6 validation | ~5000 | Final series + ties |
| Scenario 7-9 validation | ~6000 | Leaderboards + RDG + stress tests |
| **Total estimated** | **~39k** | Full validation pass with test audit |

**If issues found**: +5-10k tokens per deep investigation

### Cost Optimization Tips

1. **Batch questions**: Don't respond after every finding, let Fable complete sections
2. **Trust Fable's read strategy**: It knows when to read source vs infer
3. **Use incremental validation**: Fix critical bugs before continuing
4. **Avoid "check everything"**: The prompt already scopes validation

### What Fable Will Find

Based on 24 critical invariants, Fable will validate **BOTH series with equal priority**:

**Test Suite Audit (NEW - Scenario 0)**:
- ⚠️ Logic errors in existing test assertions
- ❌ Missing edge cases in test coverage
- 💡 Gaps in critical path testing
- 🔍 False positive tests (pass when they shouldn't)
- ✅ Validated correct tests against SHRS-2026-1

**Qualifying Series Logic**:
- ✅ Heat assignment logic (progressive movement tables)
- ✅ Race 1 seeding (1,2,3,4,5,5,4,3,2,1 pattern)
- ✅ Penalty order in movement (DNF, RET, NSC, OCS, DNS, DNC, UFD, BFD, DSQ, DNE)
- ✅ Penalty scoring split correctly: A5.2-style penalties use largest heat size + 1; ZFP/SCP use 20%, T1 uses 30%
- ✅ Discount calculations (race count thresholds per series)
- ✅ Tie-breaking (same-heat only, excluded scores count)

**Final Series Logic** (EQUALLY IMPORTANT):
- ✅ Fleet assignment algorithm (Gold/Silver/Bronze/Copper)
- ✅ Temporary 2nd-worst exclusion for 5-7 qualifying races
- ✅ Independent fleet scoring (separate leaderboards)
- ✅ Separate discard calculation per series
- ✅ In final series, A5.2-style penalties use max(fleet size) + 1, while ZFP/SCP/T1 remain percentage-based
- ✅ Overall ranking (Gold > Silver > Bronze > Copper)

**Both Series**:
- ✅ RDG redress calculations (separate averages)
- ✅ Edge cases (mass DNF, withdrawals, etc.)
- ✅ Complete workflow: qualifying → fleet assignment → final → overall results

### What Fable Won't Catch (Out of Scope)

- UI/UX design issues
- Performance optimization
- Code style/maintainability
- Non-critical rendering bugs
- TypeScript type coverage

### After Validation Complete

Fable will provide prioritized issue list. Implement fixes in order:
1. **TEST LOGIC ERRORS** → Incorrect test assertions can hide real bugs
2. CRITICAL → blocks core workflows
3. HIGH → incorrect scoring per SHRS-2026-1
4. MEDIUM → edge case handling
5. LOW → minor inconsistencies

⚠️ **Fix test bugs BEFORE implementation bugs** - incorrect tests give false confidence!

## Emergency Stop

If Fable starts reading entire codebase randomly:
```
STOP. Return to FABLE_TEST_PROMPT.md scenario [X]. 
Read only files listed in FABLE_BRIEFING.md section "First Places To Look".
```

## Re-Testing After Fixes

```
Re-validate scenarios [X, Y, Z] using previous test cases.
Report only: PASS or new issues found.
```

(Much cheaper than full re-run)
