/**
 * A consistent stand-in for a boat's Scores rows in SQL-sniffing tests.
 *
 * Older scoring tests described a boat twice — once as her scores worst-first
 * (the A8.1 query) and once latest-race-first (the A8.2 query) — and the two
 * lists did not have to describe the same races. The scoring core now reads
 * one list per boat and derives both orders from it, as the database does, so
 * the mocks must describe one set of races too.
 *
 * `boatRaces` merges the old inputs into that one set, most specific first:
 *   1. explicit race rows (race_id, race_number, points);
 *   2. the latest-first list: race n is the first entry, race 1 the last;
 *   3. the worst-first list, numbered in the order given.
 * A status given on a worst-first entry is carried over to the race with the
 * same points.
 */
export interface MockRace {
  race_id: number;
  race_number: number;
  points: number;
  status: string;
}

type WorstFirstEntry =
  | number
  | { points: number; status?: string; race_id?: number; race_number?: number };

export function boatRaces(
  worstFirst: WorstFirstEntry[] | undefined,
  latestFirst: number[] | undefined,
  races:
    | Array<{ race_id: number; race_number: number; points: number }>
    | undefined,
): MockRace[] {
  const fromWorstFirst = (worstFirst ?? []).map((entry, index) =>
    typeof entry === 'number'
      ? {
          points: entry,
          status: 'FINISHED',
          race_id: index + 1,
          race_number: index + 1,
        }
      : {
          points: entry.points,
          status: entry.status ?? 'FINISHED',
          race_id: entry.race_id ?? index + 1,
          race_number: entry.race_number ?? index + 1,
        },
  );
  if (races) {
    return races.map((race) => ({ ...race, status: 'FINISHED' }));
  }
  if (latestFirst && latestFirst.length > 0) {
    const statuses = fromWorstFirst.filter((e) => e.status !== 'FINISHED');
    const count = latestFirst.length;
    return latestFirst.map((points, i) => {
      const match = statuses.findIndex((e) => e.points === points);
      const status =
        match >= 0 ? statuses.splice(match, 1)[0].status : 'FINISHED';
      return { points, status, race_id: count - i, race_number: count - i };
    });
  }
  return fromWorstFirst;
}

/** The rows the worst-first scores query returns for these races. */
export const worstFirstRows = (races: MockRace[]) =>
  [...races].sort(
    (a, b) =>
      b.points - a.points ||
      a.race_number - b.race_number ||
      a.race_id - b.race_id,
  );
