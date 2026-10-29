/**
 * The shape of the SHRS 5.7 tie-break explanation that crosses IPC
 * (`explainTieBreak`). Defined once here: the main process builds it
 * (functions/explainTieBreak.ts) and the renderer's compare panel reads it.
 *
 * Boat ids in an explanation are the ids as text, because they name a boat
 * for display and comparison only.
 */

/** RRS A8.1 (best scores, position by position) or A8.2 (last race back). */
export type TieBreakComparison = {
  mode: 'A8.1' | 'A8.2';
  scoreA: number;
  scoreB: number;
  position?: number;
  raceId?: number;
};

export type TieBreakStep = {
  rule: string;
  note: string;
  subtitle?: string;
  resolved: boolean;
  comparison?: TieBreakComparison;
};

/** Which rule route decided the tie. */
export type TieBreakRoute = { rule: string; note: string };

export type TieBreakRaceGridCell = {
  key: string;
  label: string;
  scoreA: number | string;
  scoreB: number | string;
  excludedA: boolean;
  excludedB: boolean;
  shared: boolean;
  isBreaker: boolean;
};

/** A race both boats sailed (same race_id), with each boat's points. */
export type TieBreakRacePair = {
  raceId: number;
  raceNumber: number;
  /** Qualifying round of the heat (see getHeatRoundFromName); orders races in time. */
  round?: number;
  heatType: string;
  pointsA: number;
  pointsB: number;
  excludedA: boolean;
  excludedB: boolean;
  displayA: number;
  displayB: number;
};

export type TieBreakExplanation = {
  tied: boolean;
  totalA: number;
  totalB: number;
  winnerBoatId: string | null;
  route: TieBreakRoute | null;
  steps: TieBreakStep[];
  raceGrid: TieBreakRaceGridCell[];
  sharedRacePairs: TieBreakRacePair[];
  sharedQualRacePairs: TieBreakRacePair[];
};
