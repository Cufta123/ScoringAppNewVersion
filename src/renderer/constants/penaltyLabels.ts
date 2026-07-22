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
 * Ordered list of penalties offered during initial finish-order entry.
 * Position-keeping penalties first, then non-finishers, then disqualifications.
 * Excludes RDG* and DPI, which carry a numeric score entered via the leaderboard
 * edit flow (where the points field exists), not during finish-order entry.
 */
export const FINISH_ENTRY_PENALTY_CODES = [
  'ZFP',
  'SCP',
  'T1',
  'DNS',
  'DNF',
  'RET',
  'NSC',
  'OCS',
  'DNC',
  'WTH',
  'UFD',
  'BFD',
  'DSQ',
  'DNE',
  'DGM',
];
