// Single source of truth for the final-fleet assignment totals.
// Both the renderer (HeatComponent, exercised by tests) and the main-process
// IPC handler delegate here so the SHRS 4.3 temporary-discard rule cannot drift
// between two copies.

const NON_EXCLUDABLE_FLEET_STATUSES = new Set(['DNE', 'DGM']);

// SHRS 2026-1 Rule 4.3: when a qualifying series has more than five but fewer
// than eight completed races, a boat's second-worst score is temporarily
// excluded — only for the purpose of ranking boats into the final fleets.
export function shouldApplyShrs43TemporarySecondDiscard(
  numberOfRaces: number,
): boolean {
  return numberOfRaces > 5 && numberOfRaces < 8;
}

function parsePointsCsv(value: string | null | undefined): number[] {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((entry) => Number(entry))
    .filter((entry) => !Number.isNaN(entry));
}

function parseStatusCsv(
  value: string | null | undefined,
  expectedLength: number,
): string[] {
  const statuses = value
    ? String(value)
        .split(',')
        .map((entry) => entry.trim().toUpperCase())
    : [];

  // Keep status and points arrays aligned for the exclusion logic.
  while (statuses.length < expectedLength) {
    statuses.push('FINISHED');
  }

  return statuses.slice(0, expectedLength);
}

export interface FleetLeaderboardEntry {
  boat_id: number;
  race_points?: string | null;
  race_statuses?: string | null;
  [key: string]: unknown;
}

export interface ComputeAdjustedFleetTotalsOptions {
  /** Base discard count for the active profile (caller supplies the profile). */
  getExcludeCount: (numberOfRaces: number) => number;
  applyShs43TemporarySecondDiscard?: boolean;
}

export interface FleetTotal {
  boat_id: number;
  totalPoints: number;
}

/**
 * Computes each boat's net assignment total.
 */
export function computeAdjustedFleetTotals(
  leaderboard: FleetLeaderboardEntry[],
  {
    getExcludeCount,
    applyShs43TemporarySecondDiscard = true,
  }: ComputeAdjustedFleetTotalsOptions,
): FleetTotal[] {
  return leaderboard.map((boat) => {
    const points = parsePointsCsv(boat.race_points);
    const statuses = parseStatusCsv(boat.race_statuses, points.length);
    const n = points.length;

    let excludeCount = getExcludeCount(n);
    if (
      applyShs43TemporarySecondDiscard &&
      shouldApplyShrs43TemporarySecondDiscard(n)
    ) {
      excludeCount += 1;
    }

    const excludableCandidates = points
      .map((value, idx) => ({
        points: value,
        status: statuses[idx] || 'FINISHED',
        idx,
        raceIndex: idx,
      }))
      .filter(
        (entry) =>
          !NON_EXCLUDABLE_FLEET_STATUSES.has(
            String(entry.status || 'FINISHED'),
          ),
      )
      .sort(
        (left, right) =>
          right.points - left.points || right.raceIndex - left.raceIndex,
      );

    const excludedIndexes = new Set(
      excludableCandidates.slice(0, excludeCount).map((entry) => entry.idx),
    );

    const totalPoints = points.reduce(
      (sum, value, idx) => (excludedIndexes.has(idx) ? sum : sum + value),
      0,
    );

    return { boat_id: boat.boat_id, totalPoints };
  });
}
