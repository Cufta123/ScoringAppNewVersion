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

## Rule questions: decided

Decided on 2026-11-05 against the SHRS 2026-1 text and RRS 2025-2028.
"Done" means both sides follow it now; "switch" means the library follows
it and the app will when it moves onto the library (step 2).

| #   | Situation                                     | Decision                                 | Basis                                                                                                                                              | State                      |
| --- | --------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| R1  | Entry after the Final Series started          | refused                                  | 4.1: boats compete in one fleet throughout the Final Series                                                                                        | library; app at switch     |
| R2  | Remove a boat once any race is scored         | refused only if she raced                | RRS A2.2: a boat that entered any race is scored for the whole series                                                                              | library; app at switch     |
| R3  | Late entry into a heat that has already raced | allowed, DNC for that race               | RRS A5.1 / A2.2                                                                                                                                    | library; app at switch     |
| R4  | More heats than boats                         | refused                                  | 2.1: as few heats as possible                                                                                                                      | library; app at switch     |
| R5  | "CRO 012" and "CRO 12"                        | **two boats**                            | decided by the app's owner; the app stores sail numbers as integers                                                                                | done (library, `sameBoat`) |
| R6  | Boats sharing a place at a fleet boundary     | national letters, then sail number       | 4.2 says "based on their ranking" and nothing more; SHRS orders every other tie this way (3, 3.1(iv), 5.3)                                         | done (both)                |
| R7  | Final split with a round built but not sailed | refused; the app offers "undo the round" | 4.2: ranking in the Qualifying Series as sailed                                                                                                    | library; app at switch     |
| R8  | A DNC for a boat with no heat in a race       | shared with nobody                       | 5.7(ii)(1): only races "in which the tied boats competed in the same heat"; she competed in none. A one-heat event stays single-heat (5.7(i), 1.1) | library; app at switch     |
| R9  | RDG1/RDG2 with nothing to average             | worked out again on each read            | RRS A9: an average of her races                                                                                                                    | library; app at switch     |
| R10 | A final fleet that has not raced, order       | qualifying place                         | 1.5                                                                                                                                                | library; app at switch     |
| R11 | Discard setting after every race is undone    | unlocked                                 | 5.4: may change "before the warning signal for the first race"                                                                                     | library; app at switch     |
| R12 | Redress or a correction for a "no heat" DNC   | possible                                 | RRS A9, 62.1                                                                                                                                       | library; app at switch     |

R6 and R8 change who goes to Gold and who wins a tie in rare cases; the
rules do not settle them word for word, so a race officer's view is still
welcome. R6 is the order SHRS uses for every tie it does settle; R8 follows
5.7(ii)(1) to the letter.

## Found while checking the rules

- **RRS 44.3(c) 2025-2028 adds the penalty to her points, not her place**:
  "the score she would have received without that penalty, made worse
  by …". Both sides added it to the place, which differs only when the
  penalised boat is tied at the finish (2.5 + 2 = 4.5, not 2 + 2 = 4).
  Fixed in the library (`test/decided-rules.test.ts`). **The app still
  adds it to the place**: its five penalty paths (scoring screen,
  leaderboard save, recompute, edit preview, status points) get the place
  only. Rare (a tie at the finish and a ZFP/SCP/T1 on one boat); the switch
  removes those paths.
- Rounding to the tenth (44.3(c), A9), A2.1 (equal worst scores: the
  earliest is excluded), A6.1, A7, A8.1/A8.2 (2025 text) and the SHRS 5.4
  discard counts match the library.
- 4.3 builds "a ranking for assigning boats to fleets". Both sides order
  equal 4.3 totals by the ordinary qualifying ranking rather than running
  the tie-break again on the 4.3 scores. It differs only for boats that
  never met (5.7(ii)(4), plain A8.1 without excluded scores) with 6 or 7
  races. Left as it is; noted here.

## Library work (no rule question)

1. ~~**Stable race references.**~~ Done: `raceScored` names its race
   (`race: { heat, race }`) and must be the heat's next one, so taking a
   middle race out of the log stops replay at the next race instead of
   re-pointing later corrections, protests and RDG2 choices.
2. ~~**Moving a boat between heats**~~ Done: `boatMoved { boat, from, to }`
   (`test/move.test.ts`), with the app's checks plus one it lacks: both
   heats must be in the current round.
3. ~~**Unchanged settings are not a change.**~~ Done: only a value that
   differs from the one in force is checked against the locks.
4. ~~**Checks the app has.**~~ Done in replay (`test/checks.test.ts`): DPI
   and RDG3 points more than 0, at most 99, one decimal; discard profiles
   (whole numbers, increasing); assignment method and overflow setting;
   codes and penalties on a sheet; a boat's id, letters and sail number.
   The app corrects bad discard settings silently; the library refuses
   them. RAF is not a 2025-2028 code (A10): the app's converter maps it to
   RET.
5. ~~**Boat details changed**~~ Done: `boatChanged { boat, nat?, sail?,
name? }`, refused if it collides with another entry.
6. ~~**`nextStep`**~~: nothing to change. `createRound` comes only when
   the round is complete, which is also when the Final Series can start;
   which one is next is the notice of race's to say (SHRS 1.4), so the
   screen offers both, as the app's round bar does. Empty heats no longer
   stop a round (fixed earlier).
7. ~~**Format version**~~ Done: `formatVersion: 1` in the event file and
   the results; `readEventFile` is where upgrades of older files go, and a
   newer file is refused in words.
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

## Also fixed

- A correction of a race sailed before a boat joined the heat asked for
  her too (the sheet was checked against the heat's boats now). It is
  checked against the boats of the original sheet.
- R12: redress (RDG1/2/3) for a race a boat had no heat in is a
  `protestDecided` filed under any heat of that round; anything else for
  that race is refused (`test/late-entries.test.ts`).
