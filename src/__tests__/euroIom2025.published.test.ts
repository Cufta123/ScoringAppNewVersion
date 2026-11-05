/**
 * A real, published regatta replayed through regatta-core.
 *
 * The fixture is the corrected final result sheet of the IOM European
 * Championship 2025 (`e2e/fixtures/The IOM EC 2025 corrected.json`): 98
 * competitors, 12 qualifying races, 5 final fleets, 6 final races, and the
 * codes a real week produces (DNF, BFD, DSQ, DNS, RET, RDG, DNC, DNE, NSC,
 * OCS). `fixtures/euroIom2025Log.ts` turns the sheet into a decision log
 * (how, and what the sheet does not record, is said there); the library
 * scores it, and every number is compared with what the sheet printed.
 *
 * Where the library and the sheet differ, the difference is pinned and
 * explained at the assertion, never smoothed over. There are three: a
 * place the sheet did not move up after a disqualification (RRS A6.1), a
 * DNE it printed in brackets (RRS 90.3(b): its own nett keeps it), and a
 * tie whose published order its own numbers cannot give.
 */
import {
  finalStandings,
  overallStandings,
  qualifyingStandings,
  replay,
  type EventState,
} from 'regatta-core';
import { FINAL_LABELS, QUALIFYING_LABELS } from './fixtures/euroIom2025';
import {
  boatIdOf,
  eventLog,
  published,
  qualifyingRound,
} from './fixtures/euroIom2025Log';

function replayed(): EventState {
  const split = replay(eventLog());
  if (!split.ok) throw new Error(split.reason);
  const result = replay(eventLog(split.state.fleets!.map((f) => f.id)));
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

const state = replayed();
const qualifying = new Map(
  qualifyingStandings(state).standings.map((s) => [s.boat, s]),
);
const finals = finalStandings(state);
const final = new Map(
  finals.flatMap((fleet) => fleet.standings.map((s) => [s.boat, s])),
);
const overall = overallStandings(state);
const nameOf = (boat: string) => published.results[Number(boat.slice(1))].name;

/** Every (boat, race) where the library and the sheet differ. */
function differences(
  key: (score: { points: number; excluded: boolean }) => unknown,
  sheetKey: (race: { score: number; discarded: boolean }) => unknown,
) {
  const found: string[] = [];
  published.results.forEach((competitor, i) => {
    const boat = boatIdOf(i);
    const sheet = competitor.races;
    const scores = [
      ...qualifying.get(boat)!.scores,
      ...final.get(boat)!.scores,
    ];
    const labels = [
      ...QUALIFYING_LABELS,
      ...FINAL_LABELS.slice(0, final.get(boat)!.scores.length),
    ];
    labels.forEach((label, k) => {
      const race = sheet.find((r) => r.race === label)!;
      if (key(scores[k]) !== sheetKey(race)) {
        found.push(`${competitor.name} ${label}`);
      }
    });
  });
  return found;
}

// ─────────────────────────────────────────────────────────────────────────────
// The premises the replay rests on. If one of these breaks, the scoring
// comparisons below are comparing something other than what they claim to.
// ─────────────────────────────────────────────────────────────────────────────
describe('published sheet — structure the replay depends on', () => {
  it('is the 98-boat, 5-heat event the fixture header claims', () => {
    expect(published.results).toHaveLength(published.competitor_count);
    expect(published.results).toHaveLength(98);
    expect(published.heats).toEqual([
      'Heat A',
      'Heat B',
      'Heat C',
      'Heat D',
      'Heat E',
    ]);
    const sizes = published.heats.map(
      (heat) => published.results.filter((c) => c.heat === heat).length,
    );
    expect(sizes).toEqual([20, 20, 20, 19, 19]);
  });

  it("prints a `total` that is the plain sum of the boat's races", () => {
    published.results.forEach((competitor) => {
      const sum = competitor.races.reduce((acc, race) => acc + race.score, 0);
      // Two boats carry a redress score of x.1, so compare with a tolerance
      // rather than exactly — the sheet prints one decimal.
      expect(sum).toBeCloseTo(competitor.total, 6);
    });
  });

  it('sailed Q1–Q12 for everyone and F1–F6 for every fleet but Heat E', () => {
    published.results.forEach((competitor) => {
      const labels = competitor.races.map((race) => race.race);
      const expected =
        competitor.heat === 'Heat E'
          ? [...QUALIFYING_LABELS, ...FINAL_LABELS.slice(0, 5)]
          : [...QUALIFYING_LABELS, ...FINAL_LABELS];
      expect(labels).toEqual(expected);
    });
  });

  it('scores each qualifying race in five heats, so the sheet cannot say which heat a boat was in', () => {
    // Every qualifying place is held by exactly five boats — five heats of
    // ~20 sailing the same race number. Which five boats shared a heat is not
    // printed anywhere, which is why `buildReplay` models a qualifying label
    // as one race; see the note there.
    QUALIFYING_LABELS.forEach((label) => {
      const winners = published.results.filter((competitor) =>
        competitor.races.some(
          (race) => race.race === label && race.score === 1,
        ),
      );
      expect(winners).toHaveLength(5);
    });
  });

  it('scores each final race inside one fleet, which the sheet does record', () => {
    // Within a fleet a final race is a permutation of 1..n, with a penalty
    // score of 21 standing in for a place. That is what lets `buildReplay`
    // give each (fleet, label) pair its own race_id.
    published.heats.forEach((heat) => {
      const fleet = published.results.filter((c) => c.heat === heat);
      const labels =
        heat === 'Heat E' ? FINAL_LABELS.slice(0, 5) : FINAL_LABELS;
      labels.forEach((label) => {
        const finishes = fleet
          .map((competitor) =>
            competitor.races.find((race) => race.race === label),
          )
          .filter((race) => race && !race.code)
          .map((race) => (race as { score: number }).score);
        expect(new Set(finishes).size).toBe(finishes.length);
      });
    });
  });

  it('scores non-finishers as largest heat + 1 (SHRS 5.2)', () => {
    // The largest heat is 20 boats, so DNF/DNS/DNC/DSQ/BFD score 21 — which is
    // the value the app's own `deriveNonFinisherPoints` would produce.
    const nonFinisher = published.results.flatMap((competitor) =>
      competitor.races.filter((race) =>
        [
          'DNF',
          'DNS',
          'DNC',
          'DSQ',
          'BFD',
          'RET',
          'DNE',
          'NSC',
          'OCS',
        ].includes(race.code ?? ''),
      ),
    );
    expect(nonFinisher.length).toBeGreaterThan(90);
    nonFinisher.forEach((race) => expect(race.score).toBe(21));
  });
});

describe('the sheet as a decision log', () => {
  it('replays: 12 qualifying rounds of five heats, five fleets, every race', () => {
    expect(state.rounds).toHaveLength(12);
    state.rounds.forEach((round) => expect(round).toHaveLength(5));
    expect(finals.map((fleet) => fleet.standings.length)).toEqual([
      20, 20, 20, 19, 19,
    ]);
  });

  it('rebuilds every qualifying heat without a gap and none over 20 (largest heat + 1 = 21)', () => {
    QUALIFYING_LABELS.forEach((label) => {
      const sizes = qualifyingRound(label).heats.map((heat) => heat.length);
      expect(Math.max(...sizes)).toBe(20);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(98);
    });
  });

  it('puts a redressed boat on the place she kept where the places show one (RRS A6.2)', () => {
    // Q5 and Q12 have a place fewer in one heat than in the next: the
    // redressed boats held them. In Q1 and Q2 the redressed boat had none.
    const held = (label: string) => [
      ...qualifyingRound(label).heldPlaces.values(),
    ];
    expect(held('Q1')).toEqual([]);
    expect(held('Q2')).toEqual([]);
    expect(held('Q5')).toEqual([10]);
    expect(held('Q12').sort((a, b) => a - b)).toEqual([13, 14]);
  });
});

describe('every race scored as the sheet printed it', () => {
  it('gives every boat the points the sheet printed in every race she sailed, but one', () => {
    // Heat D, F1: Ballestin was disqualified (DSQ 21) and the sheet left
    // Grant Larry, who finished behind him, on 19 with no 18th place. RRS
    // A6.1: "each boat with a worse finishing place shall be moved up one
    // place". The library moves him up to 18.
    expect(
      differences(
        (score) => score.points,
        (race) => race.score,
      ),
    ).toEqual(['Grant Larry F1']);
    const grant = final.get(
      boatIdOf(published.results.findIndex((c) => c.name === 'Grant Larry')),
    )!;
    expect(grant.scores[0].points).toBe(18);
  });

  it('scores redress with the points the committee gave (RDG)', () => {
    published.results.forEach((competitor, i) => {
      competitor.races
        .filter((race) => race.code === 'RDG')
        .forEach((race) => {
          const k = QUALIFYING_LABELS.indexOf(race.race);
          expect(qualifying.get(boatIdOf(i))!.scores[k].points).toBe(
            race.score,
          );
        });
    });
  });
});

describe('discards (SHRS 5.4, RRS 90.3(b))', () => {
  it('excludes the races the sheet put in brackets, but for three boats', () => {
    expect(
      differences(
        (score) => score.excluded,
        (race) => race.discarded,
      ).sort(),
    ).toEqual([
      // RRS 90.3(b): a DNE cannot be excluded. The sheet prints "(DNE 21)"
      // in brackets, but its own nett column keeps the DNE and drops the
      // next-worst race, as the library does.
      'Goirand Philippe Q10',
      'Goirand Philippe Q4',
      'Gomes Paulo Maio Q1',
      'Gomes Paulo Maio Q5',
      // Follows from F1 above: with 18 there, F4 (19) is his worst.
      'Grant Larry F1',
      'Grant Larry F4',
    ]);
    published.results.forEach((competitor, i) => {
      qualifying.get(boatIdOf(i))!.scores.forEach((score, k) => {
        const race = competitor.races.find(
          (r) => r.race === QUALIFYING_LABELS[k],
        )!;
        if (race.code === 'DNE') expect(score.excluded).toBe(false);
      });
    });
  });
});

describe('overall standings (SHRS 5.5)', () => {
  it("gives every boat the sheet's nett, but Grant Larry (F1, RRS A6.1)", () => {
    const differing = overall.filter(
      (row) =>
        Math.abs(
          row.total - published.results[Number(row.boat.slice(1))].nett,
        ) > 1e-9,
    );
    expect(differing.map((row) => [nameOf(row.boat), row.total])).toEqual([
      ['Grant Larry', 189.1],
    ]);
    expect(published.results.find((c) => c.name === 'Grant Larry')!.nett).toBe(
      190.1,
    );
  });

  it('ranks the fleets in the published order', () => {
    const fleetOf = new Map(
      finals.flatMap((fleet, f) => fleet.standings.map((s) => [s.boat, f])),
    );
    const byPlace = [...overall].sort((a, b) => a.place - b.place);
    expect(byPlace.map((row) => fleetOf.get(row.boat))).toEqual(
      published.results.map((c) => 'ABCDE'.indexOf(c.heat.slice(-1))),
    );
  });

  it('reproduces the published order but one tie the sheet cannot explain', () => {
    const order = [...overall]
      .sort((a, b) => a.place - b.place)
      .map((row) => nameOf(row.boat));
    const sheet = published.results.map((c) => c.name);
    const differing = order
      .map((name, index) => ({ name, sheet: sheet[index], index }))
      .filter((row) => row.name !== row.sheet);
    // Heat A, tied on 70 points, 7th and 8th on the sheet:
    //   Beltri Guillermo  Q 2 4 2 (9) 1 5 6 5 1 5 (DSQ 21) 1 | F 8 3 (13) 3 13 11
    //   Golison Mark      Q 3 9 1 4 (12) 7 2 (15) 4 1 1 2   | F (19) 6 6 1 7 16
    // The sheet puts Beltri first. RRS A8.1 on any set of races that holds
    // their six shared finals puts Golison first (Beltri's finals hold an
    // 8, an 11 and two 13s, none of which Golison has anywhere), so A8.2,
    // the only comparison Beltri wins (F6 11 against 16), is never reached.
    // The sheet's order cannot be reproduced from its numbers under A8;
    // the other ties on the sheet are settled exactly as published.
    expect(differing).toEqual([
      { name: 'Golison Mark', sheet: 'Beltri Guillermo', index: 6 },
      { name: 'Beltri Guillermo', sheet: 'Golison Mark', index: 7 },
    ]);
  });
});
