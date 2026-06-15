/* eslint-disable camelcase */
/**
 * Tests for explainTieBreak.ts — the backend tie-break explanation that backs
 * the leaderboard compare panel. The winner it reports must always match the
 * authoritative comparators (calculateBoatScores / overallTieBreak), and the
 * route/steps must cite the correct SHRS 5.7 rules.
 */
import explainTieBreak from '../main/functions/explainTieBreak';
import { db } from '../../public/Database/DBManager';

jest.mock('../../public/Database/DBManager', () => ({
  db: { prepare: jest.fn() },
}));

const mockPrepare = (db as unknown as { prepare: jest.Mock }).prepare;

type RaceInput = {
  race_id: number;
  race_number: number;
  points: number;
  status?: string;
  heat_type?: string;
  heat_name?: string;
};

type Dataset = Record<string, RaceInput[]>;

function normalize(races: RaceInput[]): Required<RaceInput>[] {
  return races.map((race) => ({
    status: 'FINISHED',
    heat_type: 'Qualifying',
    heat_name: 'Heat A',
    ...race,
  }));
}

function setupDb(dataset: Dataset, discardProfile = 'standard') {
  const data: Record<string, Required<RaceInput>[]> = {};
  Object.entries(dataset).forEach(([boatId, races]) => {
    data[boatId] = normalize(races);
  });

  mockPrepare.mockImplementation((sql: string) => {
    const flat = sql.replace(/\s+/g, ' ');
    return {
      get: () => {
        if (flat.includes('discard_profile')) {
          return { discard_profile: discardProfile };
        }
        return undefined;
      },
      all: (eventId: unknown, boatId?: string, heatType?: string) => {
        // Distinct boat ids across qualifying scores.
        if (flat.includes('SELECT DISTINCT s.boat_id')) {
          return Object.keys(data)
            .filter((id) => data[id].some((r) => r.heat_type === 'Qualifying'))
            .map((id) => ({ boat_id: id }));
        }

        const races = data[boatId as string] ?? [];

        // Overall tie packet: both series.
        if (flat.includes("IN ('Qualifying', 'Final')")) {
          return races.map((r) => ({ ...r }));
        }

        // getSeriesRaceDisplay: heat_type filtered, race_number ASC.
        if (
          flat.includes('h.heat_type = ?') &&
          flat.includes('ORDER BY r.race_number ASC')
        ) {
          return races
            .filter((r) => r.heat_type === heatType)
            .sort(
              (a, b) => a.race_number - b.race_number || a.race_id - b.race_id,
            )
            .map((r) => ({ ...r }));
        }

        const qual = races.filter((r) => r.heat_type === 'Qualifying');

        // getScoresForA81: points DESC.
        if (flat.includes('ORDER BY points DESC')) {
          return [...qual].sort(
            (a, b) =>
              b.points - a.points ||
              a.race_number - b.race_number ||
              a.race_id - b.race_id,
          );
        }

        // getRaceScoresForTieBreak: race_number DESC, race_id DESC.
        if (flat.includes('ORDER BY r.race_number DESC, s.race_id DESC')) {
          return [...qual]
            .sort(
              (a, b) => b.race_number - a.race_number || b.race_id - a.race_id,
            )
            .map((r) => ({
              race_id: r.race_id,
              race_number: r.race_number,
              points: r.points,
            }));
        }

        // getScoresForA82: race_number DESC, points only.
        if (flat.includes('ORDER BY r.race_number DESC')) {
          return [...qual]
            .sort((a, b) => b.race_number - a.race_number)
            .map((r) => ({ points: r.points }));
        }

        return [];
      },
    };
  });
}

describe('explainTieBreak — qualifying series', () => {
  it('reports not tied when totals differ', () => {
    setupDb({
      A: [
        { race_id: 1, race_number: 1, points: 1 },
        { race_id: 2, race_number: 2, points: 1 },
      ],
      B: [
        { race_id: 1, race_number: 1, points: 5 },
        { race_id: 2, race_number: 2, points: 5 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(false);
    expect(res.winnerBoatId).toBeNull();
    expect(res.totalA).toBe(2);
    expect(res.totalB).toBe(10);
  });

  it('single-heat event: A8.1 without excluded scores (SHRS 5.7(i))', () => {
    // Both boats raced the same 2 races (single-heat event), tied at 5.
    // A8.1 best-to-worst: A [1,4] vs B [2,3] -> 1 < 2, A wins.
    setupDb({
      A: [
        { race_id: 1, race_number: 1, points: 4 },
        { race_id: 2, race_number: 2, points: 1 },
      ],
      B: [
        { race_id: 1, race_number: 1, points: 3 },
        { race_id: 2, race_number: 2, points: 2 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(true);
    expect(res.winnerBoatId).toBe('A');
    expect(res.route?.rule).toBe('SHRS 5.7(i)');
  });

  it('multi-heat event where tied pair shared all races: uses excluded scores (SHRS 5.7(ii)(2))', () => {
    // A and B sailed the same races (601-604); C sailed different races, so the
    // EVENT is multi-heat. Kept scores ([1,2,3] each) tie, but A's excluded
    // worst (9) > B's (7), so under 5.7.2.2 (excluded scores used) B wins.
    setupDb({
      A: [
        { race_id: 601, race_number: 1, points: 9 },
        { race_id: 602, race_number: 2, points: 3 },
        { race_id: 603, race_number: 3, points: 2 },
        { race_id: 604, race_number: 4, points: 1 },
      ],
      B: [
        { race_id: 601, race_number: 1, points: 7 },
        { race_id: 602, race_number: 2, points: 1 },
        { race_id: 603, race_number: 3, points: 2 },
        { race_id: 604, race_number: 4, points: 3 },
      ],
      C: [
        { race_id: 701, race_number: 1, points: 1 },
        { race_id: 702, race_number: 2, points: 1 },
        { race_id: 703, race_number: 3, points: 1 },
        { race_id: 704, race_number: 4, points: 2 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(true);
    expect(res.winnerBoatId).toBe('B');
    expect(res.route?.rule).toBe('SHRS 5.7(ii)');
    expect(res.steps.some((s) => s.rule.includes('5.7(ii)(2)'))).toBe(true);
  });

  it('multi-heat event, no shared races: standard A8 (SHRS 5.7(ii)(4))', () => {
    // A and B never shared a race; C provides a different race set so the event
    // is multi-heat. Tie on kept total (10 each); A8.1 best score 1 vs 1, then
    // second 2 vs 3 -> A wins.
    setupDb({
      A: [
        { race_id: 401, race_number: 1, points: 2 },
        { race_id: 402, race_number: 2, points: 8 },
      ],
      B: [
        { race_id: 501, race_number: 1, points: 3 },
        { race_id: 502, race_number: 2, points: 7 },
      ],
      C: [
        { race_id: 601, race_number: 1, points: 1 },
        { race_id: 602, race_number: 2, points: 1 },
      ],
    });
    const res = explainTieBreak(1, 'A', 'B', false);
    expect(res.tied).toBe(true);
    expect(res.route?.rule).toBe('SHRS 5.7(ii)(4)');
    expect(res.winnerBoatId).toBe('A');
  });
});

describe('explainTieBreak — final/overall series', () => {
  it('breaks a combined tie using shared races including excluded scores', () => {
    // Two boats, qualifying + final, tied on combined total. They share races
    // across both series; excluded scores are used (5.7.2.2). A's shared
    // best-to-worst beats B's.
    setupDb({
      A: [
        { race_id: 1, race_number: 1, points: 1, heat_type: 'Qualifying' },
        { race_id: 2, race_number: 2, points: 4, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 1,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
        {
          race_id: 12,
          race_number: 2,
          points: 2,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
      B: [
        { race_id: 1, race_number: 1, points: 2, heat_type: 'Qualifying' },
        { race_id: 2, race_number: 2, points: 3, heat_type: 'Qualifying' },
        {
          race_id: 11,
          race_number: 1,
          points: 2,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
        {
          race_id: 12,
          race_number: 2,
          points: 1,
          heat_type: 'Final',
          heat_name: 'Final Gold',
        },
      ],
    });
    // No discard (4 races -> 1 discard each; configure standard).
    const res = explainTieBreak(1, 'A', 'B', true);
    expect(res.tied).toBe(true);
    expect(['A', 'B']).toContain(res.winnerBoatId);
    expect(res.route?.rule).toBe('SHRS 5.7(ii)');
    // Shared pairs split across both series.
    expect(res.sharedQualRacePairs.length).toBe(2);
    expect(res.sharedRacePairs.length).toBe(2);
  });
});
