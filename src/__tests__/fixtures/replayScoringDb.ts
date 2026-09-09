/**
 * An in-memory stand-in for `public/Database/DBManager`'s `db`, backed by a
 * flat list of score rows.
 *
 * The scoring modules under test (`calculateBoatScores`,
 * `calculateFinalBoatScores`, `overallTieBreak`, `discardConfig`) all read
 * through `db.prepare(sql)` and then `.all(...)` / `.get(...)`. This helper
 * dispatches on the SQL text and answers each statement with the same rows —
 * in the same order — SQLite would have returned for the replay data, so the
 * production query text stays the single description of what each read means.
 *
 * Only the statements those four modules issue are implemented; anything else
 * throws rather than returning an empty result, so a query added to the
 * production code fails the test loudly instead of quietly scoring zero.
 */
import type { ReplayScoreRow } from './euroIom2025';

export interface ReplayDbOptions {
  scores: ReplayScoreRow[];
  /** Stored `shrs_discard_profile_*` value; 'standard' is SHRS 5.4 as written. */
  discardProfile?: string;
}

type Row = Record<string, unknown>;

interface PreparedStatement {
  all: (...params: unknown[]) => Row[];
  get: (...params: unknown[]) => Row | undefined;
}

const bySeries = (rows: ReplayScoreRow[], heatType: string) =>
  rows.filter((row) => row.heat_type === heatType);

/** ORDER BY points DESC, r.race_number ASC, s.race_id ASC */
const orderA81 = (rows: ReplayScoreRow[]) =>
  [...rows].sort(
    (left, right) =>
      right.points - left.points ||
      left.race_number - right.race_number ||
      left.race_id - right.race_id,
  );

/** ORDER BY r.race_number DESC, s.race_id DESC */
const orderA82 = (rows: ReplayScoreRow[]) =>
  [...rows].sort(
    (left, right) =>
      right.race_number - left.race_number || right.race_id - left.race_id,
  );

export function createReplayDb({
  scores,
  discardProfile = 'standard',
}: ReplayDbOptions) {
  const forBoat = (boat_id: unknown) =>
    scores.filter((row) => row.boat_id === String(boat_id));

  const prepare = (sql: string): PreparedStatement => {
    // ── discardConfig.getEventDiscardConfig ──────────────────────────────
    if (sql.includes('shrs_discard_profile')) {
      return {
        get: () => ({ discard_profile: discardProfile }),
        all: () => [],
      };
    }

    // ── discardConfig.getSeriesDiscardRaceCount ──────────────────────────
    if (sql.includes('MAX(race_count)')) {
      return {
        get: (_event_id: unknown, heat_type: unknown, heat_name?: unknown) => {
          const rows = scores.filter(
            (row) =>
              row.heat_type === heat_type &&
              (heat_name === undefined || row.heat_name === heat_name),
          );
          const perBoat = new Map<string, number>();
          rows.forEach((row) =>
            perBoat.set(row.boat_id, (perBoat.get(row.boat_id) ?? 0) + 1),
          );
          const counts = [...perBoat.values()];
          return { max_count: counts.length ? Math.max(...counts) : null };
        },
        all: () => [],
      };
    }

    // ── overallTieBreak.buildOverallTiePacket (both series at once) ───────
    if (sql.includes("heat_type IN ('Qualifying', 'Final')")) {
      return {
        all: (_event_id: unknown, boat_id: unknown) =>
          forBoat(boat_id).map((row) => ({
            race_id: row.race_id,
            race_number: row.race_number,
            points: row.points,
            heat_type: row.heat_type,
            heat_name: row.heat_name,
            status: row.status,
          })),
        get: () => undefined,
      };
    }

    // ── calculateFinalBoatScores: A8.1 / A8.2 within one final fleet ─────
    if (sql.includes("heat_type = 'Final'")) {
      const isA81 = sql.includes('ORDER BY points DESC');
      return {
        all: (_event_id: unknown, boat_id: unknown, heat_name: unknown) => {
          const rows = forBoat(boat_id).filter(
            (row) => row.heat_type === 'Final' && row.heat_name === heat_name,
          );
          return isA81
            ? orderA81(rows).map((row) => ({
                points: row.points,
                status: row.status,
                race_id: row.race_id,
                race_number: row.race_number,
              }))
            : orderA82(rows).map((row) => ({ points: row.points }));
        },
        get: () => undefined,
      };
    }

    // ── calculateBoatScores: the three qualifying reads ──────────────────
    if (sql.includes("heat_type = 'Qualifying'")) {
      const rowsFor = (boat_id: unknown) =>
        bySeries(forBoat(boat_id), 'Qualifying');

      if (sql.includes('ORDER BY points DESC')) {
        // getScoresForA81
        return {
          all: (_event_id: unknown, boat_id: unknown) =>
            orderA81(rowsFor(boat_id)).map((row) => ({
              points: row.points,
              status: row.status,
              race_id: row.race_id,
              race_number: row.race_number,
            })),
          get: () => undefined,
        };
      }

      if (sql.includes('SELECT s.race_id')) {
        // getRaceScoresForTieBreak
        return {
          all: (_event_id: unknown, boat_id: unknown) =>
            orderA82(rowsFor(boat_id)).map((row) => ({
              race_id: row.race_id,
              race_number: row.race_number,
              points: row.points,
            })),
          get: () => undefined,
        };
      }

      // getScoresForA82
      return {
        all: (_event_id: unknown, boat_id: unknown) =>
          orderA82(rowsFor(boat_id)).map((row) => ({ points: row.points })),
        get: () => undefined,
      };
    }

    throw new Error(`replayScoringDb: unhandled SQL statement:\n${sql}`);
  };

  return { prepare };
}
