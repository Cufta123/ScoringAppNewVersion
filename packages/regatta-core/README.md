# regatta-core

SHRS 2026-1 heat racing as a library: **a log of decisions in, heats, scores
and standings out.** No database, no UI, no clock. The same log gives the
same results in the app, in a test, or in a results viewer on the web.

```ts
import {
  replay,
  qualifyingStandings,
  overallStandings,
  nextStep,
} from 'regatta-core';

const result = replay(log); // the event, or the first decision the rules refuse
if (!result.ok) console.log(`Decision ${result.at}: ${result.reason}`);
qualifyingStandings(result.state);
overallStandings(result.state);
nextStep(result.state); // { kind: 'score', heat: 'B3', race: 1 }
eventStatus(result.state); // what may be done now, and why not
explainScore(result.state, 'b7'); // her points race by race, with the rules
explainTie(result.state, 'b7', 'b12'); // why one is ahead on equal points
```

Or everything at once, as plain JSON:

```ts
import { results } from 'regatta-core';

results({ decisions: log }); // heats, next step, qualifying, final, overall
```

## For screens and other programs

Everything a program shows about the rules comes from here, so a screen
never needs a second copy of one (the ScoringApp's ESLint config forbids
it):

| What                         | Exports                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| A result corrected in place  | `applyRaceColumnEdit`, `scoreRaceColumn`, `holdsPlace`, `keepsProvidedPoints`, `slotOf`             |
| Points                       | `noPlacePoints`, `penaltyPoints`, `toTenth`, `redressAverage`, `sumPoints`, `exactPoints`           |
| Codes, in order              | `NO_PLACE_CODES`, `PENALTY_CODES`, `COMMITTEE_CODES`, `REDRESS_CODES`, `RESULT_CODES`               |
| Discards (SHRS 5.4)          | `discardCount`, `excludedScores`, `NOT_EXCLUDABLE`                                                  |
| Order (SHRS 3, 5.3)          | `compareBoats`, `sameBoat`, `inRecordingOrder`, `codeRank`                                          |
| Heats and fleets (SHRS 2, 4) | `MAX_HEAT_SIZE`, `MAX_HEATS`, `fewestHeats`, `movementImbalanceExpected`, `fleetName`, `fleetIndex` |
| What next                    | `nextStep` (on an event), `nextInRound` (on a screen's own heats)                                   |
| What may be done now         | `eventStatus` (each action: `ok` or the reason, and `offered`), `undoLastRace`, `undoLatestRound`   |
| The same log, other boat ids | `renameBoats`, `boatsNamed`                                                                         |

`eventStatus(state)` is where the event stands and what the race office
may do now, for a screen: the series (`entries`, `qualifying`, `final`),
the qualifying round, the heats being sailed (boats, races sailed), the one
next step, and for every action a screen offers (score or undo a heat's
race, create or undo a round, start the Final Series) `ok`, or `ok: false`
with the reason in words for the race officer, and `offered` (the action
belongs to this point of the event, so the screen shows it). `ok` is what
replay accepts, decided by the same code: a decision is tried on the event
as replay would apply it, and an undo by the function that builds the new
log (`undoLastRace(log, heat)`, `undoLatestRound(log)`). The Final Series
verdict carries why not (`check`: `NO_HEATS`, `SINGLE_FLEET`,
`UNEQUAL_RACE_COUNTS`, `NO_RACES_COMPLETED`, `LATEST_ROUND_UNSAILED`, …)
and whether SHRS 4.3 applies.

`renameBoats(log, { oldId: newId, … })` gives the same event with the
boats named as another program or database names them (every decision
that names a boat: entries, seeding, heats, moves, sheet lines, protest
decisions, recorded heats and fleets). It refuses, in words, a boat the
log names that has no new id and two boats given the same one;
`boatsNamed(log)` lists the boats a log names. The ScoringApp uses it to
open a backup file as a new event on another computer.

`applyRaceColumnEdit` takes a race as a column of cells (place, points,
status, and the place a redressed boat keeps) and one boat's new result,
and returns the race as the rules give it: a new place moves the boat and
the boats in between make room; a code with no place moves the boats
behind up (RRS A6.1); RDG / DPI move no one and keep her place (A6.2, A10);
ZFP / SCP / T1 keep the place (44.3(c)); boats on one place share its
points (A7); a code scores the largest heat + 1 (SHRS 5.2).

## Command line

In the ScoringApp checkout the tools come from the app's `npm install`;
run these in `packages/regatta-core`. On its own, run `npm install` first.

```sh
npm run build

node dist/cli.js examples/heats-and-final.json          # results as JSON
node dist/cli.js --text examples/heats-and-final.json   # the same as tables
node dist/cli.js - < event.json                         # from stdin
npm run results -- --text examples/one-fleet.json       # straight from src/
```

Exit codes: `0` results, `1` a decision was refused (the results are the
event before it, with `refused: { at, reason, decision }`), `2` the file is
not JSON or not a valid event file (the schema errors are printed per
decision).

## File format

| File                         | What                                                                 |
| ---------------------------- | -------------------------------------------------------------------- |
| `schema/event.schema.json`   | input: `{ "formatVersion": 1, "name"?, "decisions": [Decision, …] }` |
| `schema/results.schema.json` | output of `results()` and of the command line                        |
| `examples/*.json`            | event files                                                          |
| `examples/expected/*.json`   | their results                                                        |

Both schemas are generated from the types in `src/results.ts` and
`src/types.ts` (`npm run schema`); a test fails when they are out of date.
The results are a public shape of their own (`RaceScore`, `SeriesStanding`,
…), not the internal types, so they change only on purpose.

An event file can start with `"$schema": "../schema/event.schema.json"` for
completion and checking in an editor.

`formatVersion` is the file format's version (`FORMAT_VERSION`, now 1).
A change an older reader would misread raises it; `readEventFile` then
upgrades older files, and a newer file is refused in words.

## Tests

```sh
npm test
```

| Test                      | What                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `test/rules.test.ts`      | rule by rule (points, discards, seeding, fleets, ranking)                          |
| `test/event.test.ts`      | whole events through `replay`, from the rules' text                                |
| `test/examples.test.ts`   | each `examples/*.json` gives `examples/expected/*.json`                            |
| `test/schema.test.ts`     | schemas up to date; examples and results valid; bad files refused                  |
| `test/cli.test.ts`        | command line: output, exit codes, error messages                                   |
| `test/isolation.test.ts`  | nothing in `src/` but the CLI imports outside the library                          |
| `test/correction.test.ts` | a result corrected in place (`applyRaceColumnEdit`)                                |
| `test/app-rules.test.ts`  | codes, recording order, heat counts, fleet names, next heat, points                |
| `test/rename.test.ts`     | `renameBoats`: every decision type, refusals, same results renamed                 |
| `test/status.test.ts`     | `eventStatus` and the undos: every action and reason; random events against replay |

To add a case: put an event file in `examples/`, run `npm run examples`,
and **check the new `examples/expected/` file by hand against the rules**
before committing it. Those files record what the library says, not what
the rules say; a wrong expected file only locks a bug in.

## The idea

The event **is** its decision log (`Decision` in `src/types.ts`):

| Decision              | Who               | What                                                         |
| --------------------- | ----------------- | ------------------------------------------------------------ |
| `settingsChanged`     | race committee    | assignment method, discard profiles, fleet overflow          |
| `boatEntered/Removed` | race office       | entries                                                      |
| `boatChanged`         | race office       | national letters, sail number or name corrected              |
| `heatsCreated`        | race office       | the first round (3.1(1) serpentine from the seeding)         |
| `boatAssigned`        | race office       | a late entry joins a heat of the current round               |
| `boatMoved`           | race office       | a boat to another heat of the round, before either races     |
| `raceScored`          | race office       | a heat's next race, named: the finishing **order** and codes |
| `raceCorrected`       | race office       | the whole sheet again                                        |
| `protestDecided`      | protest committee | DSQ / DNE / DGM / DPI / RDG1-3 for one boat, or cleared      |
| `roundCreated`        | race office       | the next round (Heat Movement Table or pre-assignment)       |
| `finalSeriesStarted`  | race office       | the fleet split (4.1-4.3)                                    |

Everything else is worked out on every read, in milliseconds. Nothing derived
is stored, so nothing can go stale or need a "recompute".

What falls out of that:

- **Undo** is taking a decision out of the log. `replay` re-checks every later
  decision, so it says exactly what depended on the one removed ("Every heat
  of this round must sail the same races first").
- **Checks in one place.** A decision the rules do not allow is refused with
  the reason, in words for the race officer, by the same code that scores.
- **SHRS 3.1(5)** needs no snapshots: rounds read the race office's sheet,
  and protest decisions sit beside it.
- **No impossible places.** A sheet is an order (with ties marked), not a
  list of place numbers, so gaps and duplicates cannot be entered.
- **History and backup** are the log itself.

## Rules covered

SHRS 1.1, 1.5, 2.3, 3.1 (1)-(5), 3.2, 4.1-4.3, 5.1-5.7; RRS A4, A5.1, A6.1,
A6.2, A7, A8, A9 (RDG1/2/3, live averages), A10 (DPI), 44.3(c), T1. Tests in
`test/` come from the rule text and its worked examples, not from the app.

## Checked against the app

In the ScoringApp repository (where this library started, in
`packages/regatta-core`),
`src/__tests__/regattaCore.differential.integration.test.ts` runs random
events through the app's real handlers on real SQLite and through this
library, and after every step compares every heat and the qualifying, final
and overall standings (`DIFF_SEEDS`, default 60). On 100 events (1,351 races,
156 rounds, 57 final splits, 170 corrections, 142 protest decisions, 112 late
entries) they agree on every heat and every total.

Two app bugs it found are fixed in the app since (ScoringApp `d967d31` and
`0ca961b`), so the app and the library now agree on them too:

1. **SHRS 5.7 can go round in a circle.** Under 5.7(ii) each pair of tied
   boats is compared on the races they sailed together, so A can beat B, B
   beat C and C beat A. The rules do not settle that. Both now give the place
   to the boat no tied boat beats and settle a true circle by plain RRS A8
   (as 5.7(ii)(4) does for boats that never met). Only the library marks
   those boats `circular`, so the screen can say so. Circles came up in 72
   of 200 standings.
2. **Redress beside a tie (RRS A6.2).** When one of two boats level on a
   place got RDG or DPI, the app re-scored the other as if she finished
   alone (6.5 became 6). A6.2 says redress changes no other boat's score;
   both keep 6.5.

Still different:

3. **Who decided a DSQ.** The app does not record who entered a DSQ, so it
   treats every DSQ, DNE or DGM saved on the leaderboard as a protest
   decision for 3.1(5). The library knows: `raceCorrected` is the race office,
   `protestDecided` is the protest committee.

Interpretations shared with the app (decided before): a boat with no heat in
a counted race is DNC (the library files it under heat A, the app under the
first heat scored: see `docs/parity`, R8); RDG1/RDG2 with
nothing to average yet score as no place (largest heat + 1); a boat always
keeps one score after discards; SHRS 1.5 for the overall standings applies
while no final race at all is completed.

## Size

About 1,800 lines with comments, against about 4,400 in the app for the same
rules (scoring, heats, standings and their database glue; score explanations
not counted).

## Not yet

The full list, with the app's behaviour beside the library's, is in
[`docs/parity`](docs/parity/README.md).

- Nothing here beyond the list in `docs/parity`. The ScoringApp scores
  only through this library.
