/**
 * Explanations against the standings: the same totals, the same points
 * race by race, and every tie explained the way the ranking broke it.
 */
import {
  explainScore,
  explainTie,
  finalStandings,
  overallStandings,
  overallTieBreak,
  qualifyingStandings,
  qualifyingTieBreak,
  replay,
  type Decision,
  type ExplainedRace,
  type TieExplanation,
} from '../src';
import { randomEvent } from './helpers/randomEvent';

const SEEDS = Array.from(
  { length: Number(process.env.EXPLAIN_SEEDS ?? 120) },
  (_v, i) => i + 1,
);
const sign = (n: number) => Math.sign(n) || 0;
const kept = (races: ExplainedRace[]) =>
  Math.round(
    races.filter((r) => !r.excluded).reduce((t, r) => t + r.points, 0) * 1e6,
  ) / 1e6;

type Placed = { boat: string; place: number; circular?: boolean };
const byPlace = (x: Placed, y: Placed) => {
  if (x.place < y.place) return x.boat;
  if (y.place < x.place) return y.boat;
  return null;
};

/**
 * `ahead` is the order shown. Outside a circle, a verdict that separates
 * them is that order; a verdict that does not, with different places, must
 * say why (5.7(ii)(3)).
 */
function checkTie(tie: TieExplanation, x: Placed, y: Placed, verdict: number) {
  expect(tie.ahead).toBe(byPlace(x, y));
  if (x.circular && y.circular) return;
  // Which rule applies depends on the verdict; each branch asserts it.
  /* eslint-disable jest/no-conditional-expect */
  if (verdict !== 0) {
    expect(sign(x.place - y.place)).toBe(verdict);
  } else if (x.place !== y.place) {
    expect(tie.steps.map((step) => step.rule)).toContain('SHRS 5.7(ii)(3)');
  }
  /* eslint-enable jest/no-conditional-expect */
}

describe.each(SEEDS)('random event %i', (seed) => {
  const { state } = replay(randomEvent(seed));
  const qualifying = qualifyingStandings(state);
  const fleets = finalStandings(state);

  it('explains every boat with the standings totals and points', () => {
    qualifying.standings.forEach((standing) => {
      const q = explainScore(state, standing.boat).qualifying!;
      expect(q.total).toBe(standing.total);
      expect(q.place).toBe(standing.place);
      expect(kept(q.races)).toBe(standing.total);
      expect(q.races.map((r) => [r.points, r.excluded])).toEqual(
        standing.scores.map((s) => [s.points, s.excluded]),
      );
      q.races.forEach((race) => {
        expect(race.reason.text).not.toMatch(/undefined|NaN/);
      });
      // Worked-out points end in the number the series counts.
      q.races
        .filter((race) => /^(RDG1|RDG2|ZFP|SCP|T1)$/.test(race.code ?? ''))
        .forEach((race) => {
          expect(race.reason.text).toContain(String(race.points));
        });
    });
    fleets.forEach((fleet) => {
      if (fleet.races === 0) return;
      fleet.standings.forEach((standing) => {
        const f = explainScore(state, standing.boat).final!;
        expect(f.fleet).toBe(fleet.fleet);
        expect(f.total).toBe(standing.total);
        expect(kept(f.races)).toBe(standing.total);
      });
    });
  });

  // Assertions are in checkTie, for every tie the event has.
  // eslint-disable-next-line jest/expect-expect
  it('explains every qualifying tie the way the ranking broke it', () => {
    const compare = qualifyingTieBreak(state);
    const { standings } = qualifying;
    standings.forEach((x) =>
      standings.forEach((y) => {
        if (x.boat >= y.boat || x.total !== y.total) return;
        const tie = explainTie(state, x.boat, y.boat, 'qualifying');
        checkTie(tie, x, y, sign(compare(x.boat, y.boat)));
      }),
    );
  });

  it('explains every final and overall tie the way the ranking broke it', () => {
    fleets.forEach((fleet) => {
      if (fleet.races === 0) return;
      fleet.standings.forEach((x) =>
        fleet.standings.forEach((y) => {
          if (x.boat >= y.boat || x.total !== y.total) return;
          const tie = explainTie(state, x.boat, y.boat, 'final');
          expect(tie.ahead).toBe(byPlace(x, y));
        }),
      );
    });
    if (!state.fleets?.some((f) => f.races.length > 0)) return;
    const compare = overallTieBreak(state);
    const overall = overallStandings(state);
    overall.forEach((x) =>
      overall.forEach((y) => {
        if (x.boat >= y.boat || x.total !== y.total || x.fleet !== y.fleet)
          return;
        const tie = explainTie(state, x.boat, y.boat, 'overall');
        checkTie(tie, x, y, sign(compare(x.boat, y.boat)));
      }),
    );
  });
});

describe('explanations in words', () => {
  const boat = (i: number): Decision => ({
    type: 'boatEntered',
    boat: { id: `b${i}`, nat: 'CRO', sail: String(i) },
  });
  const log: Decision[] = [
    boat(1),
    boat(2),
    boat(3),
    boat(4),
    { type: 'heatsCreated', heatCount: 2 }, // A1: 1, 4; B1: 2, 3
    boat(5), // late: no heat in round 1
    {
      type: 'raceScored',
      race: { heat: 'A1', race: 1 },
      lines: [{ boat: 'b1' }, { boat: 'b4', tied: true }],
    },
    {
      type: 'raceScored',
      race: { heat: 'B1', race: 1 },
      lines: [{ boat: 'b2' }, { boat: 'b3', penalty: 'ZFP' }],
    },
  ];
  const { state } = replay(log);
  const races = (id: string) => explainScore(state, id).qualifying!.races;

  it('a tie at the finish (RRS A7)', () => {
    expect(races('b4')[0].reason).toEqual({
      rule: 'RRS A7',
      text: 'Tied for 1 at the finish: the points of the places the tied boats fill are shared, 1.5 each.',
    });
  });

  it('a Z flag penalty (largest heat 2, DNF 3, 20% = 0.6)', () => {
    expect(races('b3')[0].reason).toEqual({
      rule: 'RRS 30.2, 44.3(c)',
      text: 'Finished 2 with a Z flag penalty: 20% of the DNF score (3) is 0.6, so 2 + 0.6 = 2.6.',
    });
  });

  it('no heat in a race', () => {
    expect(races('b5')[0]).toMatchObject({
      heat: null,
      code: 'DNC',
      reason: {
        rule: 'RRS A5.1, SHRS 5.2',
        text: 'She had no heat in this race, so DNC: one more than the 2 boats in the largest heat = 3.',
      },
    });
  });

  it('boats that never met (SHRS 5.7(ii)(4))', () => {
    // b1 and b2 each won their heat: 1 point each, never in the same heat.
    const met = replay([
      ...log.slice(0, 6),
      {
        type: 'raceScored',
        race: { heat: 'A1', race: 1 },
        lines: [{ boat: 'b1' }, { boat: 'b4' }],
      },
      {
        type: 'raceScored',
        race: { heat: 'B1', race: 1 },
        lines: [{ boat: 'b2' }, { boat: 'b3' }],
      },
    ]).state;
    const tie = explainTie(met, 'b1', 'b2');
    expect(tie.steps[0].rule).toBe('SHRS 5.7(ii)(4)');
    expect(tie.ahead).toBeNull();
    expect(tie.steps.at(-1)!.text).toBe(
      'No rule separates them, so they share the place.',
    );
  });

  it('not tied at all', () => {
    expect(explainTie(state, 'b1', 'b3')).toMatchObject({
      ahead: 'b1',
      steps: [
        { text: 'Not tied: 1.5 against 2.6 points; the lower total is ahead.' },
      ],
    });
  });
});
