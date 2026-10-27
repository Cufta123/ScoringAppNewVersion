/**
 * Average-points redress (RRS 2025–2028 A9, "Guidance on redress"),
 * shared by the main-process recompute and the renderer's edit preview so the
 * two can never disagree.
 *
 *   RDG1 — A9(a): the average of her points in ALL the races in the series
 *          except the race in question.
 *   RDG2 — the average of a group of races the protest committee chose, e.g.
 *          A9(b) "all the races before the race in question".
 *   RDG3 — points set directly by the protest committee (A9(c) or any other
 *          arrangement under rule 64.3). Never recomputed.
 *
 * Both averages are rounded "to the nearest tenth of a point (0.05 to be
 * rounded upward)" and are LIVE: an RDG1 granted after race 3 must reflect
 * races 4..n as they are sailed, so the recompute re-derives them every time.
 *
 * What goes into the average:
 *  - every race of the SAME series only (SHRS 5.6: Qualifying and Final
 *    averages are separate);
 *  - discarded races too — the rule averages her race points, not her series
 *    score;
 *  - NOT other races that were themselves scored by average redress (RDG1 /
 *    RDG2). Their points are derived, not sailed, and including them would
 *    make two averages depend on each other. This follows common event
 *    redress policy; the RRS leaves the arrangement to the protest committee
 *    (rule 64.3), so RDG3 remains available for anything else.
 */

export const AVERAGE_REDRESS_STATUSES: ReadonlySet<string> = new Set([
  'RDG1',
  'RDG2',
]);

/** Nearest tenth, 0.05 rounded upward (RRS A9). */
export function roundToTenthHalfUp(value: number): number {
  // The epsilon absorbs binary noise such as 2.05 being stored as
  // 2.04999999…, which would otherwise round down.
  return Math.floor(value * 10 + 0.5 + 1e-9) / 10;
}

export interface RedressCell {
  points: number;
  status: string;
}

/**
 * The redress average over `cells` (the candidate races, the redressed race
 * already removed by the caller). Returns null when no race qualifies — e.g.
 * an RDG1 in the first race of a series, before anything else is sailed — so
 * the caller can keep the value it has rather than invent one.
 */
export function averageRedressPoints(cells: RedressCell[]): number | null {
  const eligible = cells.filter(
    (cell) =>
      Number.isFinite(cell.points) &&
      !AVERAGE_REDRESS_STATUSES.has(String(cell.status || '').toUpperCase()),
  );
  if (eligible.length === 0) return null;
  const sum = eligible.reduce((acc, cell) => acc + cell.points, 0);
  return roundToTenthHalfUp(sum / eligible.length);
}

/** Parse the stored RDG2 race selection (a JSON array of race ids). */
export function parseRedressRaceIds(raw: unknown): number[] | null {
  if (raw == null || raw === '') return null;
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.map(Number).filter((id) => Number.isFinite(id));
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}
