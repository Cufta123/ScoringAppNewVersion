/**
 * Replay of the published results of the IOM World Championship 2024
 * (Gladstone, Australia, 20–28 Oct 2024; 76 boats, 20 races) through the
 * app's discard and totalling code.
 *
 * Fixture: e2e/fixtures/iom-worlds-2024-gladstone.json — the published sheet
 * transcribed verbatim (rank, sail number, nation, every race cell as printed,
 * total and nett). Sailor names are not stored.
 *
 * WHAT THIS CAN AND CANNOT CHECK
 *
 * The event was sailed under HMS, not SHRS: race 1 was five seeding heats
 * scored within each heat (scores 1–16, 17 for a non-finisher), and races
 * 2–20 were promotion/relegation heats scored across the whole fleet (1–76,
 * 77 for a non-finisher). The app's heat assignment and SHRS 5.2 penalty
 * scoring therefore do not apply and are not replayed here. Who sailed in
 * which race-1 heat is not recoverable from the sheet (five boats share every
 * place) and was not found published anywhere.
 *
 * What is shared with SHRS and IS checked against the sheet:
 *   - how many scores are discarded at 20 races (SHRS 5.4 standard: 3);
 *   - WHICH scores are discarded, including ties between equal worst scores;
 *   - each boat's nett and gross total;
 *   - the final order by nett.
 *
 * Expected values are read from the sheet, never recomputed by a second copy
 * of the rules. Where the sheet disagrees with itself it is recorded below,
 * not smoothed over.
 */
import fs from 'fs';
import path from 'path';
import { getExcludedIndexes } from '../main/functions/scoringUtils';
import { getExcludeCountForProfile } from '../shared/discardProfile';
import { sumPoints } from '../shared/points';
import { applyExclusions } from '../renderer/utils/leaderboardUtils';

interface Competitor {
  rank: number;
  sail: string;
  nation: string;
  races: string[];
  total: number;
  nett: number;
}

const fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      '../../e2e/fixtures/iom-worlds-2024-gladstone.json',
    ),
    'utf8',
  ),
) as { competitors: Competitor[] };

const { competitors } = fixture;
const RACES = 20;

const points = (cell: string) => Number(cell.replace(/[(),]/g, ''));
const publishedDiscards = (c: Competitor) =>
  c.races
    .map((cell, i) => (cell.startsWith('(') ? i : -1))
    .filter((i) => i >= 0);

/**
 * The one boat whose printed nett is not the sum of her printed, non-discarded
 * scores: 905 by her own cells, 913 printed. Nothing on the sheet explains the
 * 8 points (no penalty code is shown), so the app's 905 is asserted and the
 * printed value is kept here as a known discrepancy in the source.
 */
const SHEET_NETT_DISCREPANCIES: Record<string, { printed: number }> = {
  'ARG 63': { printed: 913 },
};

describe('IOM Worlds 2024 (published sheet) — discards and totals', () => {
  it('is the complete sheet: 76 boats, 20 races each', () => {
    expect(competitors).toHaveLength(76);
    competitors.forEach((c) => expect(c.races).toHaveLength(RACES));
  });

  it('discards 3 scores at 20 races, as the sheet does (SHRS 5.4 standard)', () => {
    expect(getExcludeCountForProfile(RACES, 'standard')).toBe(3);
    competitors.forEach((c) => expect(publishedDiscards(c)).toHaveLength(3));
  });

  it('discards exactly the races the sheet put in parentheses', () => {
    const excludeCount = getExcludeCountForProfile(RACES, 'standard');
    competitors.forEach((c) => {
      const entries = c.races.map((cell, i) => ({
        points: points(cell),
        status: 'FINISHED',
        race_number: i + 1,
      }));
      const ours = [...getExcludedIndexes(entries, excludeCount)].sort(
        (a, b) => a - b,
      );
      expect({ sail: c.sail, discards: ours }).toEqual({
        sail: c.sail,
        discards: publishedDiscards(c),
      });
    });
  });

  it('marks the same discards in the leaderboard view', () => {
    competitors.forEach((c) => {
      const raw = c.races.map((cell) => cell.replace(/[()]/g, ''));
      const { markedRaces } = applyExclusions(raw, [], raw, 'standard', RACES);
      expect({ sail: c.sail, cells: markedRaces }).toEqual({
        sail: c.sail,
        cells: c.races,
      });
    });
  });

  it('reproduces every gross total and nett', () => {
    competitors.forEach((c) => {
      const all = c.races.map(points);
      const raw = c.races.map((cell) => cell.replace(/[()]/g, ''));
      const { total } = applyExclusions(raw, [], raw, 'standard', RACES);
      expect({ sail: c.sail, gross: sumPoints(all) }).toEqual({
        sail: c.sail,
        gross: c.total,
      });
      const expectedNett = SHEET_NETT_DISCREPANCIES[c.sail] ? 905 : c.nett;
      expect({ sail: c.sail, nett: total }).toEqual({
        sail: c.sail,
        nett: expectedNett,
      });
    });
  });

  it('records the sheet’s own nett discrepancy rather than hiding it', () => {
    const arg63 = competitors.find((c) => c.sail === 'ARG 63') as Competitor;
    expect(arg63.nett).toBe(SHEET_NETT_DISCREPANCIES['ARG 63'].printed);
  });

  it('ranks the fleet in the published order by nett (no ties to break)', () => {
    const ours = [...competitors]
      .map((c) => {
        const raw = c.races.map((cell) => cell.replace(/[()]/g, ''));
        return {
          sail: c.sail,
          nett: applyExclusions(raw, [], raw, 'standard', RACES).total,
        };
      })
      .sort((a, b) => a.nett - b.nett)
      .map((c) => c.sail);
    const published = [...competitors]
      .sort((a, b) => a.rank - b.rank)
      .map((c) => c.sail);

    // The sheet's one inconsistency moves a place: by her own printed cells
    // ARG 63 has 905, ahead of USA 85 on 906, so she is 60th; the sheet
    // ranked her 61st on its printed 913. Everyone else matches.
    const expected = [...published];
    const usa85 = expected.indexOf('USA 85');
    const arg63 = expected.indexOf('ARG 63');
    expect([usa85 + 1, arg63 + 1]).toEqual([60, 61]);
    [expected[usa85], expected[arg63]] = [expected[arg63], expected[usa85]];

    expect(ours).toEqual(expected);
  });
});
