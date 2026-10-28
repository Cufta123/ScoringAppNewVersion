/**
 * The verdict of `getFinalSeriesEligibility`: whether the Final Series can
 * start (SHRS 4.1 / 4.3) and, when it cannot, why. Defined once; the main
 * process builds it and the renderer turns it into a prompt.
 */
export type FinalSeriesEligibility = {
  ok: boolean;
  reason:
    | 'OK'
    | 'NO_HEATS'
    | 'SINGLE_FLEET'
    | 'UNEQUAL_RACE_COUNTS'
    | 'NO_RACES_COMPLETED';
  numFinalHeats: number;
  completedQualifyingRaces: number;
  rule43Applies: boolean;
  // True only when NOTHING has been scored anywhere in the qualifying series.
  noRacesCompleted: boolean;
  // True when the most recent round of heats has been created but not sailed
  // yet (0 races), while earlier rounds DO have results. The Final Series then
  // falls back to the last completed round — the renderer tells the user so.
  latestRoundUnsailed: boolean;
  // Numeric suffix of the latest round (e.g. "Heat A7" -> 7), for the message.
  latestRoundNumber: number | null;
  raceCountBreakdown: { name: string; count: number }[];
};
