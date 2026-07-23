/* eslint-disable camelcase */

import { scoringPenaltyStatuses } from '../../shared/scoringPenalty';

// SHRS 5.3 recording order for a heat: boats are recorded by finishing place,
// then non-finishers in this severity order. Position-keeping penalties
// (ZFP/SCP/T1) keep the boat's finishing place and are NOT displaced.
//
// Kept as a standalone module so this scoring rule has one home and can be
// unit-tested independently of the data-entry component.

// LB-10: single-source the position-keeping penalty set from the shared scoring
// module (`scoringPenaltyStatuses`) instead of re-declaring `['ZFP','SCP','T1']`
// here. The renderer and main process must agree on which penalties keep their
// finishing place, or edit-mode previews drift from the persisted scores.
export const POSITION_KEEPING_PENALTIES = scoringPenaltyStatuses;

// SHRS (5.3) is the primary order used by this app.
export const SHRS_PENALTY_ORDER = [
  'DNF',
  'RET',
  'NSC',
  'OCS',
  'DNS',
  'DNC',
  'WTH',
  'UFD',
  'BFD',
  'DSQ',
  'DNE',
];

// Codes not enumerated in SHRS 5.3; recorded after the listed ones.
export const APPENDIX_FALLBACK_PENALTY_ORDER = ['DGM', 'DPI'];

export const EFFECTIVE_PENALTY_ORDER = [
  ...SHRS_PENALTY_ORDER,
  ...APPENDIX_FALLBACK_PENALTY_ORDER,
];

const penaltyOrderIndex = new Map<string, number>(
  EFFECTIVE_PENALTY_ORDER.map((status, index): [string, number] => [
    status,
    index,
  ]),
);

// Lower rank = recorded earlier. Unknown statuses sort last.
export const getPenaltyRank = (status: string): number =>
  penaltyOrderIndex.get(status) ?? EFFECTIVE_PENALTY_ORDER.length;

/**
 * Order boats for the heat result: boats that keep their place (no penalty or a
 * position-keeping penalty) stay in their current order; displaced boats are
 * appended in SHRS 5.3 severity order, ties broken alphanumerically by sail
 * number (RRS A10 / SHRS 5.3).
 *
 * @param boats - sail numbers in their current display order
 * @param penaltiesByBoat - sail number -> status code
 * @param compareBoatNumbers - sail-number tiebreak
 * @returns ordered sail numbers
 */
export function orderBoatsByPenalty<T extends string | number>(
  boats: T[],
  penaltiesByBoat: Record<string, string>,
  compareBoatNumbers: (a: T, b: T) => number,
): T[] {
  const withPosition: T[] = [];
  const displaced: T[] = [];

  boats.forEach((boatNumber) => {
    const penalty = penaltiesByBoat[String(boatNumber)];
    if (!penalty || POSITION_KEEPING_PENALTIES.has(penalty)) {
      withPosition.push(boatNumber);
      return;
    }
    displaced.push(boatNumber);
  });

  displaced.sort((a, b) => {
    const penaltyRankDiff =
      getPenaltyRank(penaltiesByBoat[String(a)]) -
      getPenaltyRank(penaltiesByBoat[String(b)]);
    if (penaltyRankDiff !== 0) return penaltyRankDiff;
    return compareBoatNumbers(a, b);
  });

  return [...withPosition, ...displaced];
}
