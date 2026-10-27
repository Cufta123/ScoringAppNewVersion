/**
 * Why the Final Series cannot start yet, in words a scorer can act on.
 *
 * SHRS eligibility itself (group counting, equal-race-count, the Rule 4.3
 * window) is decided in the main process by getFinalSeriesEligibility; the
 * renderer only turns its verdict into a prompt. Keeping that mapping here
 * makes each message checkable without driving the heats screen.
 */

export interface FinalSeriesEligibility {
  ok?: boolean;
  reason?: string;
  raceCountBreakdown?: Array<{ name: string; count: number }>;
  numFinalHeats?: number;
  completedQualifyingRaces?: number;
  rule43Applies?: boolean;
  noRacesCompleted?: boolean;
  latestRoundUnsailed?: boolean;
  latestRoundNumber?: number | null;
}

export function finalSeriesBlockedMessage(
  eligibility: FinalSeriesEligibility,
): string {
  switch (eligibility.reason) {
    case 'NO_HEATS':
      return 'No qualifying heats found. Please create heats before starting the Final Series.';
    case 'SINGLE_FLEET':
      return 'With only one heat the event is a single-fleet event (SHRS 1.1) — no Final Series applies.';
    case 'NO_RACES_COMPLETED':
      // RULE-m3: SHRS 4.2 divides fleets by the Qualifying Series ranking, so
      // there is no seeding-only start to offer.
      return 'No qualifying races have been completed yet. Final-fleet assignment is based on the Qualifying Series ranking (SHRS 4.2), so complete at least one qualifying race before starting the Final Series.';
    default: {
      const breakdown = (eligibility.raceCountBreakdown || [])
        .map((heat) => `${heat.name}: ${heat.count} race(s)`)
        .join('\n');
      return `Cannot start the Final Series — not all heats have the same number of races:\n\n${breakdown}\n\nFinish the current round first.`;
    }
  }
}

/**
 * A newer round of heats exists but has no completed races. That is not "no
 * races completed" — earlier rounds were sailed — so the empty round is
 * ignored and the last completed one is used. The scorer confirms first.
 */
export function unsailedLatestRoundMessage(
  eligibility: FinalSeriesEligibility,
): string {
  const latestLabel = eligibility.latestRoundNumber
    ? ` (round ${eligibility.latestRoundNumber})`
    : '';
  const completed = eligibility.completedQualifyingRaces ?? 0;
  return (
    `The latest round of heats${latestLabel} has no completed races yet.\n\n` +
    `The Final Series will be based on the last completed round — ${completed} qualifying race(s). ` +
    `The empty latest round will be ignored.\n\nContinue?`
  );
}
