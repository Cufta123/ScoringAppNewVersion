import { NO_PLACE_CODES, PENALTY_CODES } from 'regatta-core';

/**
 * Single source of truth for the plain-language meaning of every scoring status
 * code (SHRS 2026-1 / RRS Appendix A). Both the finish-order entry screen and
 * the leaderboard edit/read views draw their labels from here so a race officer
 * always sees the same explanation for a code — never a bare "BFD" they must
 * recall from memory.
 */

/** Short description for each status code, WITHOUT the code prefix. */
export const PENALTY_DESCRIPTIONS: Record<string, string> = {
  FINISHED: 'Finished',
  ZFP: '20% penalty (keeps finish place)',
  SCP: 'Scoring penalty (keeps finish place)',
  T1: 'Post-race penalty 30% (keeps finish place)',
  DNS: 'Did not start',
  DNF: 'Did not finish',
  RET: 'Retired',
  RAF: 'Retired after finishing',
  NSC: 'Did not sail the course',
  OCS: 'Over the start line early',
  DNC: 'Did not come to the start area',
  WTH: 'Withdrawn from series',
  UFD: 'U-flag disqualification',
  BFD: 'Black-flag disqualification',
  DSQ: 'Disqualified',
  DNE: 'Disqualified (cannot be discarded)',
  DGM: 'Disqualified, gross misconduct',
  DPI: 'Discretionary penalty (points set by protest committee)',
  RDG1: 'Redress: average of all races',
  RDG2: 'Redress: average of selected races',
  RDG3: 'Redress: manual score',
};

/**
 * "CODE — description" for menus and tooltips. Falls back to the bare code if a
 * description is missing so a new/unknown status never renders blank.
 */
export const penaltyLabel = (code: string): string => {
  const description = PENALTY_DESCRIPTIONS[code];
  return description ? `${code} — ${description}` : code;
};

/**
 * The codes offered during finish-order entry, in regatta-core's order:
 * the penalties that keep the place, then the no-place codes in SHRS 5.3
 * order. RDG* and DPI carry a score the protest committee sets, entered on
 * the leaderboard (where the points field exists), not here.
 */
export const FINISH_ENTRY_PENALTY_CODES: readonly string[] = [
  ...PENALTY_CODES,
  ...NO_PLACE_CODES,
];
