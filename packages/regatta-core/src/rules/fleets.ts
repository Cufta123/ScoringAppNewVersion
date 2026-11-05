/**
 * The Final Series fleets: SHRS 4.1 (how many, how big, their names), 4.2
 * (who goes where), 4.3 (the ranking used for the split) and 2.3.
 */
import { sum } from './points';
import { NOT_EXCLUDABLE } from './discards';

export const MAX_HEAT_SIZE = 20;

const NAMED = ['Gold', 'Silver', 'Bronze', 'Copper'];

/** SHRS 4.1: Gold, Silver, Bronze, Copper, then "Fleet 5", "Fleet 6", … */
export function fleetName(index: number): string {
  return NAMED[index] ?? `Fleet ${index + 1}`;
}

/** SHRS 4.3: only when 6 or 7 qualifying races are completed. */
export function rule43Applies(completedRaces: number): boolean {
  return completedRaces > 5 && completedRaces < 8;
}

/**
 * A boat's qualifying total for the fleet split under SHRS 4.3: her 5.4
 * discards, and her second-worst score left out as well (when 5.4 already
 * dropped the worst, that is the next one; with no discards the worst
 * stays and only the second-worst goes).
 */
export function splitTotal(
  scores: ReadonlyArray<{ points: number; code?: string }>,
  discards: number,
  rule43: boolean,
): number {
  const worstFirst = scores
    .map((score, index) => ({ ...score, index }))
    .filter((score) => !NOT_EXCLUDABLE.has(score.code ?? ''))
    .sort((a, b) => b.points - a.points);
  const left = new Set(worstFirst.slice(0, discards).map((s) => s.index));
  if (rule43 && worstFirst.length >= 2) left.add(worstFirst[1].index);
  return sum(scores.filter((_s, i) => !left.has(i)).map((s) => s.points));
}

export type FleetSplit<T> =
  | { ok: true; fleets: T[][] }
  | { ok: false; reason: string };

/**
 * SHRS 4.1 / 4.2 / 2.3: `ranked` best first. Withdrawn boats go last. As
 * many fleets as qualifying heats; more when a fleet would pass 20 boats and
 * the event adds fleets; never more fleets than boats. Fleets as equal as
 * possible, the earlier fleets taking the extra boats.
 */
export function splitIntoFleets<T>(
  ranked: readonly T[],
  withdrawn: (item: T) => boolean,
  heatCount: number,
  overflow: 'add-fleets' | 'allow-oversize',
): FleetSplit<T> {
  const ordered = [
    ...ranked.filter((item) => !withdrawn(item)),
    ...ranked.filter(withdrawn),
  ];
  if (ordered.length === 0) {
    return { ok: false, reason: 'There are no qualifying results yet.' };
  }
  let count = Math.max(1, heatCount);
  if (ordered.length > count * MAX_HEAT_SIZE && overflow === 'add-fleets') {
    count = Math.ceil(ordered.length / MAX_HEAT_SIZE);
  }
  count = Math.min(count, ordered.length);
  const size = Math.floor(ordered.length / count);
  const extra = ordered.length % count;
  const fleets: T[][] = [];
  let next = 0;
  for (let i = 0; i < count; i += 1) {
    const end = next + size + (i < extra ? 1 : 0);
    fleets.push(ordered.slice(next, end));
    next = end;
  }
  return { ok: true, fleets };
}
