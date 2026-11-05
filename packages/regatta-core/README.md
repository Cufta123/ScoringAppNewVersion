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
```

Or everything at once, as plain JSON:

```ts
import { results } from 'regatta-core';

results({ decisions: log }); // heats, next step, qualifying, final, overall
```

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

| File                         | What                                             |
| ---------------------------- | ------------------------------------------------ |
| `schema/event.schema.json`   | input: `{ "name"?, "decisions": [Decision, …] }` |
| `schema/results.schema.json` | output of `results()` and of the command line    |
| `examples/*.json`            | event files                                      |
| `examples/expected/*.json`   | their results                                    |

Both schemas are generated from the types in `src/results.ts` and
`src/types.ts` (`npm run schema`); a test fails when they are out of date.
The results are a public shape of their own (`RaceScore`, `SeriesStanding`,
…), not the internal types, so they change only on purpose.

An event file can start with `"$schema": "../schema/event.schema.json"` for
completion and checking in an editor.

## Tests

```sh
npm test
```

| Test                     | What                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `test/rules.test.ts`     | rule by rule (points, discards, seeding, fleets, ranking)         |
| `test/event.test.ts`     | whole events through `replay`, from the rules' text               |
| `test/examples.test.ts`  | each `examples/*.json` gives `examples/expected/*.json`           |
| `test/schema.test.ts`    | schemas up to date; examples and results valid; bad files refused |
| `test/cli.test.ts`       | command line: output, exit codes, error messages                  |
| `test/isolation.test.ts` | nothing in `src/` but the CLI imports outside the library         |

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
| `heatsCreated`        | race office       | the first round (3.1(1) serpentine from the seeding)         |
| `boatAssigned`        | race office       | a late entry joins a heat of the current round               |
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

- Score explanations ("how was this calculated?") and tie-break explanations
  (the comparators `qualifyingTieBreak` / `overallTieBreak` are there to build
  them on).
- Moving a boat between heats of the current round.
- The app does not use the library yet.
