# Parity: the app against regatta-core

Step 1 of moving the app's scoring onto regatta-core: everything the app
does with scoring, and whether the library can express it. Done on
2026-11-05 against ScoringApp `core/scoring-library` at `0ca961b`.

| File                     | Area                                                          |
| ------------------------ | ------------------------------------------------------------- |
| [heats.md](heats.md)     | first round, late entries, next round, transfers, final split |
| [scoring.md](scoring.md) | race scoring, codes, discards, standings, tie-breaks, tables  |
| [event.md](event.md)     | entries, settings, database schema, history, rebuilding a log |

Every row was checked in the code on both sides; rows marked UNVERIFIED
were not. Line numbers are as of that commit.

**Points and standings agree.** All no-place codes, penalties, ties,
protest outcomes, redress averages, discard profiles, counted races,
tie-breaks, final and overall standings score the same. The differences are
in what each side accepts, in rare orderings, and in what the app's
database remembers.

## Fixed already

- A boat removed after the fleets were made stayed in her fleet (library).
- A heat with no boats crashed the next round in progressive mode (library).

Both have tests in `test/edge-cases.test.ts`.

## Rule questions: the app and the library disagree

Each needs one answer, then both sides follow it. Recommendations in
_italics_; all are open until decided.

| #   | Situation                                     | App                                  | Library                       |
| --- | --------------------------------------------- | ------------------------------------ | ----------------------------- |
| R1  | Entry after the Final Series started          | allowed                              | refused                       |
| R2  | Remove a boat once any race is scored         | refused for every boat               | refused only if she raced     |
| R3  | Late entry into a heat that has already raced | refused                              | allowed, DNC for that race    |
| R4  | More heats than boats                         | allowed (empty heats)                | refused                       |
| R5  | "CRO 012" and "CRO 12"                        | two boats                            | the same boat                 |
| R6  | Boats sharing a place at a fleet boundary     | ordered by database id               | ordered by entry              |
| R7  | Final split with a round built but not sailed | that round ignored (after a confirm) | refused                       |
| R8  | A DNC for a boat with no heat in a race       | filed under the first-scored heat    | filed under heat A            |
| R9  | RDG1/RDG2 with nothing to average             | stored value kept (can go stale)     | worked out again on each read |
| R10 | A final fleet that has not raced, order       | qualifying total, then database id   | qualifying place              |
| R11 | Discard setting after every race is undone    | stays locked                         | unlocked                      |
| R12 | Redress or a correction for a "no heat" DNC   | possible                             | not possible                  |

_R1 refuse; R2, R3 as the library; R4 refuse; R5 same boat; R6 needs the
rule text (SHRS 4.2); R7 refuse, with "undo the round" offered; R8 needs
the rule text (5.7 compares races sailed together); R9, R10, R11 as the
library; R12 add to the library._ R6 and R8 change who is in Gold and who
wins a tie, so they should be checked with a race officer.

## Library work (no rule question)

1. **Stable race references.** A race is addressed by its position in the
   heat. Taking a race that is not the heat's last out of the log silently
   re-points later corrections, protests and RDG2 choices to the next race.
   Each `raceScored` should state its race number, so replay refuses them
   instead.
2. **Moving a boat between heats** of the current round (the app's
   transfer).
3. **Unchanged settings are not a change.** `settingsChanged` refuses
   `qualifyingMode` or qualifying discards once racing has started even
   when the value is the same; the app saves every field on every save.
4. **Checks the app has:** DPI and RDG3 points above 0 and at most 99;
   custom and threshold discard profiles; codes checked at replay, not only
   by the schema; RAF read as RET.
5. **Boat details changed** (national letters, sail number): they order the
   seeding and the ties, so a change is a decision.
6. **`nextStep`:** a "start the Final Series" step; empty heats.
7. **Format version** in the event file and the settings, with migrations.
8. **Score and tie-break explanations** (the app has both).
9. **A withdrawn decision stays on record.** Undo now deletes from the log;
   the app keeps an audit trail and can redo. The log needs a "withdrawn"
   decision instead of deletion (part of step 3, the decision log in the
   database).

## The comparison test misses

RDG2; undo; heats scored out of A, B, C order; two or more races per round
with several heats; protests on boats that did not finish; corrections
after a protest in the same race. These go into
`src/__tests__/regattaCore.differential.integration.test.ts` next.

## For the switch (step 2)

- **Tables with derived values:** `Leaderboard` (read by the three
  leaderboard reads, score explanations and the Final split order),
  `FinalLeaderboard`, `GlobalLeaderboard` (unused), and `Scores.points` /
  `Scores.position` plus automatic DNS/DNC rows. The renderer also works
  totals and discards out again (`leaderboardStandings.ts`,
  `leaderboardUtils.ts`, the leaderboard edit preview, `resultsModel.ts` for
  exports). All of these switch together. See [scoring.md](scoring.md) §2.
- **Who decided:** the app does not store whether the race office or the
  protest committee set a DSQ/DNE/DGM/DPI/RDG. From now on, leaderboard
  edits with those codes are protest decisions and every other edit is a
  correction.
- **Two final-split choices are not stored:** SHRS 4.3 on or off, and the
  oversize confirmation. They must be stored before a log can be rebuilt
  without guessing.
- **Existing events:** a full log can be rebuilt only for events journalled
  from the start (schema v4, 2026-10-27) and never restored or imported.
  Older events get a plausible log, checked by replaying it against every
  stored heat and score. See [event.md](event.md) §3.
