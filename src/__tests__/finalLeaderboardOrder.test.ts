/* eslint-disable camelcase */
/**
 * SHRS 1.5 (rank by qualifying score when the Final Series has no completed
 * races) and SHRS 5.5 (fleet precedence for every fleet, not just the four
 * named ones).
 */
import {
  fleetNameForIndex,
  fleetRank,
  NAMED_FLEETS,
} from '../shared/fleetNames';
import {
  fleetsWithCompletedFinalRace,
  hasAnyCompletedFinalRace,
  hasNoCompletedFinalRaces,
  orderFinalLeaderboardRows,
} from '../main/functions/finalLeaderboardOrder';

const row = (
  boat_id: string,
  placement_group: string,
  {
    total_points_final = 0,
    qualifying_points = 0,
    race_ids = '',
  }: {
    total_points_final?: number;
    qualifying_points?: number;
    race_ids?: string;
  } = {},
) => ({
  boat_id,
  placement_group,
  total_points_final,
  qualifying_points,
  race_ids,
});

const idsOf = (rows: { boat_id: string }[]) => rows.map((r) => r.boat_id);

describe('SHRS 4.1 fleet naming and 5.5 precedence (RULE-m2)', () => {
  it('names the first four fleets Gold, Silver, Bronze, Copper', () => {
    expect(NAMED_FLEETS.map((_n, i) => fleetNameForIndex(i))).toEqual([
      'Gold',
      'Silver',
      'Bronze',
      'Copper',
    ]);
  });

  it('names the 5th and later fleets "Fleet N"', () => {
    expect(fleetNameForIndex(4)).toBe('Fleet 5');
    expect(fleetNameForIndex(7)).toBe('Fleet 8');
  });

  it('ranks the named fleets in SHRS 5.5 order', () => {
    expect(fleetRank('Gold')).toBe(1);
    expect(fleetRank('Silver')).toBe(2);
    expect(fleetRank('Bronze')).toBe(3);
    expect(fleetRank('Copper')).toBe(4);
  });

  it('gives the overflow fleets DISTINCT, correct ranks', () => {
    // The bug: every fleet past Copper shared one catch-all rank, so Fleet 6
    // could outrank Fleet 5 on raw points.
    expect(fleetRank('Fleet 5')).toBe(5);
    expect(fleetRank('Fleet 6')).toBe(6);
    expect(fleetRank('Fleet 5')).toBeLessThan(fleetRank('Fleet 6'));
  });

  it('keeps the name and the rank in step for every fleet index', () => {
    for (let i = 0; i < 9; i += 1) {
      expect(fleetRank(fleetNameForIndex(i))).toBe(i + 1);
    }
  });

  it('sorts an unrecognised fleet label last instead of ahead of Gold', () => {
    expect(fleetRank('Platinum')).toBeGreaterThan(fleetRank('Fleet 9'));
  });
});

describe('SHRS 5.5: fleet precedence beats points (RULE-m2)', () => {
  it('ranks a slower Fleet 5 boat ahead of a faster Fleet 6 boat', () => {
    const ordered = orderFinalLeaderboardRows([
      row('sixth', 'Fleet 6', { total_points_final: 1, race_ids: '9' }),
      row('fifth', 'Fleet 5', { total_points_final: 30, race_ids: '9' }),
    ]);
    expect(idsOf(ordered)).toEqual(['fifth', 'sixth']);
  });

  it('orders all six fleets by precedence regardless of points', () => {
    const ordered = orderFinalLeaderboardRows([
      row('f6', 'Fleet 6', { total_points_final: 1, race_ids: '9' }),
      row('cop', 'Copper', { total_points_final: 2, race_ids: '9' }),
      row('f5', 'Fleet 5', { total_points_final: 3, race_ids: '9' }),
      row('gold', 'Gold', { total_points_final: 99, race_ids: '9' }),
      row('bro', 'Bronze', { total_points_final: 4, race_ids: '9' }),
      row('sil', 'Silver', { total_points_final: 50, race_ids: '9' }),
    ]);
    expect(idsOf(ordered)).toEqual(['gold', 'sil', 'bro', 'cop', 'f5', 'f6']);
  });
});

describe('SHRS 1.5: no completed final races → rank by qualifying score (RULE-M15)', () => {
  it('detects the no-final-races state from the absence of race ids', () => {
    expect(hasNoCompletedFinalRaces([row('a', 'Gold'), row('b', 'Gold')])).toBe(
      true,
    );
    expect(
      hasNoCompletedFinalRaces([
        row('a', 'Gold', { race_ids: '301' }),
        row('b', 'Gold'),
      ]),
    ).toBe(false);
  });

  it('treats a partially-scored final race as completed (presence of any final score)', () => {
    // SHRS 1.5: a final race is "completed" once it has been SAILED — i.e. once
    // ANY boat has a final score — not only when every boat in the heat has one.
    // Only boat 'a' has a final score here; the race is still completed.
    expect(
      hasAnyCompletedFinalRace([
        row('a', 'Gold', { race_ids: '301' }),
        row('b', 'Gold'),
        row('c', 'Gold'),
      ]),
    ).toBe(true);
    expect(
      hasNoCompletedFinalRaces([
        row('a', 'Gold', { race_ids: '301' }),
        row('b', 'Gold'),
      ]),
    ).toBe(false);
  });

  it('ranks by the qualifying series score when no final race has been sailed', () => {
    // Every total_points_final is 0, so without SHRS 1.5 the incoming row
    // order would stand and the qualifying standings would be ignored.
    const ordered = orderFinalLeaderboardRows([
      row('slow', 'Gold', { qualifying_points: 42 }),
      row('fast', 'Gold', { qualifying_points: 7 }),
      row('mid', 'Gold', { qualifying_points: 21 }),
    ]);
    expect(idsOf(ordered)).toEqual(['fast', 'mid', 'slow']);
  });

  it('still applies fleet precedence before the qualifying score', () => {
    const ordered = orderFinalLeaderboardRows([
      row('silverBest', 'Silver', { qualifying_points: 1 }),
      row('goldWorst', 'Gold', { qualifying_points: 88 }),
    ]);
    expect(idsOf(ordered)).toEqual(['goldWorst', 'silverBest']);
  });

  it('decides the fallback PER FLEET, not once for the whole event', () => {
    // Fleets need not start their finals together (postponement, staggered
    // starts, the SHRS 4.5 time limit). Deciding this event-wide meant Gold
    // sailing flipped Silver onto total_points_final too — which is 0 for
    // every Silver boat, tying them all and leaving Silver in raw DB order.
    const ordered = orderFinalLeaderboardRows([
      row('silverWorstQual', 'Silver', { qualifying_points: 99 }),
      row('silverBestQual', 'Silver', { qualifying_points: 5 }),
      row('goldA', 'Gold', { total_points_final: 3, race_ids: '501' }),
      row('goldB', 'Gold', { total_points_final: 1, race_ids: '501' }),
    ]);
    // Gold sailed, so Gold ranks on its final score; Silver has not, so it
    // still ranks on the qualifying series.
    expect(idsOf(ordered)).toEqual([
      'goldB',
      'goldA',
      'silverBestQual',
      'silverWorstQual',
    ]);
  });

  it('reports exactly which fleets have sailed a final race', () => {
    expect(
      fleetsWithCompletedFinalRace([
        row('g', 'Gold', { race_ids: '501' }),
        row('s', 'Silver'),
        row('b', 'Bronze', { race_ids: '502' }),
      ]),
    ).toEqual(new Set([fleetRank('Gold'), fleetRank('Bronze')]));
  });

  it('keeps a partially-scored fleet on its final score', () => {
    // One Silver boat scored is enough: the race was sailed, so the whole
    // fleet ranks on the final series (the unscored boats sit at 0 = ahead,
    // which is the same behaviour a fully-scored fleet has mid-race).
    const ordered = orderFinalLeaderboardRows([
      row('silverScored', 'Silver', {
        total_points_final: 4,
        qualifying_points: 1,
        race_ids: '502',
      }),
      row('silverUnscored', 'Silver', { qualifying_points: 99 }),
    ]);
    expect(idsOf(ordered)).toEqual(['silverUnscored', 'silverScored']);
  });

  it('switches back to the final score once any final race is completed', () => {
    const ordered = orderFinalLeaderboardRows([
      row('a', 'Gold', {
        total_points_final: 9,
        qualifying_points: 1,
        race_ids: '301',
      }),
      row('b', 'Gold', {
        total_points_final: 2,
        qualifying_points: 99,
        race_ids: '301',
      }),
    ]);
    // b won the final race despite a far worse qualifying series.
    expect(idsOf(ordered)).toEqual(['b', 'a']);
  });
});
