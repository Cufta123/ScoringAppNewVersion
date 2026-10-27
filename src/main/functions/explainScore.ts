import { db } from '../../../public/Database/DBManager';
import { roundPoints } from '../../shared/points';
import { parseRedressRaceIds } from '../../shared/redress';
import {
  BoatScoreExplanation,
  explainBoatSeries,
  ExplainRaceInput,
  SeriesBlock,
  TieNote,
} from '../../shared/scoring/explain';
import {
  getEventDiscardConfig,
  getSeriesDiscardRaceCount,
} from './discardConfig';
import explainTieBreak from './explainTieBreak';
import { getMaxHeatSizeForEvent } from './heatQueries';

// Loads one boat's scores for the score explanation and hands them to the
// scoring core (shared/scoring/explain.ts). Ties are explained by the same
// tie-break explanation the compare panel uses.

interface ScoreRow {
  race_id: number;
  race_number: number;
  status: string;
  position: number;
  points: number;
  rdg_race_ids: string | null;
}

function loadRaces(
  event_id: number,
  boat_id: number,
  heatType: 'Qualifying' | 'Final',
): ExplainRaceInput[] {
  const rows = db
    .prepare(
      `SELECT s.race_id, r.race_number, COALESCE(s.status, 'FINISHED') AS status,
              s.position, s.points, s.rdg_race_ids
       FROM Scores s
       JOIN Races r ON s.race_id = r.race_id
       JOIN Heats h ON r.heat_id = h.heat_id
       WHERE h.event_id = ? AND s.boat_id = ? AND h.heat_type = ?
       ORDER BY r.race_number, r.race_id`,
    )
    .all(event_id, boat_id, heatType) as ScoreRow[];
  // Same order and labels as the leaderboard columns.
  const prefix = heatType === 'Qualifying' ? 'Q' : 'F';
  return rows.map((row, i) => ({
    race_id: row.race_id,
    race_number: row.race_number,
    label: `${prefix}${i + 1}`,
    status: row.status,
    position: Number(row.position),
    points: Number(row.points),
    rdg_race_ids: parseRedressRaceIds(row.rdg_race_ids),
  }));
}

const sailOf = (boat_id: number) => {
  const row = db
    .prepare('SELECT country, sail_number FROM Boats WHERE boat_id = ?')
    .get(boat_id) as { country?: string; sail_number?: number } | undefined;
  return row ? `${row.country ?? ''} ${row.sail_number ?? ''}`.trim() : '';
};

function tieNotes(
  event_id: number,
  boat_id: number,
  otherIds: number[],
  overall: boolean,
): TieNote[] {
  return otherIds.map((other) => {
    const result = explainTieBreak(
      event_id,
      String(boat_id),
      String(other),
      overall,
    );
    const decisive = result.steps.find((step) => step.resolved);
    return {
      boat_id: other,
      sail: sailOf(other),
      winnerBoatId: result.winnerBoatId,
      rule: decisive?.rule ?? result.route?.rule ?? 'SHRS 5.7',
      note: decisive?.note ?? result.route?.note ?? '',
    };
  });
}

function seriesBlock(
  event_id: number,
  boat_id: number,
  heatType: 'Qualifying' | 'Final',
  heatName: string | null,
): SeriesBlock | null {
  const races = loadRaces(event_id, boat_id, heatType);
  if (races.length === 0) return null;
  const largestHeat = getMaxHeatSizeForEvent(event_id, heatType);
  const seriesRaceCount = getSeriesDiscardRaceCount(
    event_id,
    heatType,
    heatName,
  );
  return {
    ...explainBoatSeries({
      races,
      seriesRaceCount,
      discardConfig: getEventDiscardConfig(
        event_id,
        heatType === 'Qualifying' ? 'qualifying' : 'final',
      ),
      largestHeat,
    }),
    largestHeat,
    seriesRaceCount,
    ties: [],
  };
}

/** One boat's score, race by race, with the rules behind each number. */
export default function explainBoatScore(
  event_id: number,
  boat_id: number,
): BoatScoreExplanation {
  const finalRow = db
    .prepare(
      `SELECT fl.placement_group, fl.total_points_final, h.heat_name
       FROM FinalLeaderboard fl
       LEFT JOIN Heat_Boat hb ON hb.boat_id = fl.boat_id
       LEFT JOIN Heats h ON h.heat_id = hb.heat_id
         AND h.event_id = fl.event_id AND h.heat_type = 'Final'
       WHERE fl.event_id = ? AND fl.boat_id = ?
       ORDER BY h.heat_name IS NULL
       LIMIT 1`,
    )
    .get(event_id, boat_id) as
    | {
        placement_group: string;
        total_points_final: number;
        heat_name: string | null;
      }
    | undefined;

  const qualifying = seriesBlock(event_id, boat_id, 'Qualifying', null);

  if (!finalRow) {
    if (qualifying) {
      // Boats on the same qualifying total: how SHRS 5.7 separated them.
      const tied = db
        .prepare(
          `SELECT boat_id FROM Leaderboard
           WHERE event_id = ? AND boat_id != ? AND ABS(total_points_event - ?) < 1e-6
           ORDER BY place`,
        )
        .all(event_id, boat_id, qualifying.total) as { boat_id: number }[];
      qualifying.ties = tieNotes(
        event_id,
        boat_id,
        tied.map((row) => row.boat_id),
        false,
      );
    }
    return { qualifying, final: null, overall: null };
  }

  const heatName = finalRow.heat_name ?? `Final ${finalRow.placement_group}`;
  const finalBlock = seriesBlock(event_id, boat_id, 'Final', heatName);
  const qualifyingTotal = qualifying?.total ?? 0;
  const finalTotal = finalBlock?.total ?? 0;
  const overallPoints = roundPoints(qualifyingTotal + finalTotal);

  // Same fleet, same overall points (SHRS 5.5 ranks fleets first).
  const tied = db
    .prepare(
      `SELECT fl.boat_id FROM FinalLeaderboard fl
       LEFT JOIN Leaderboard lb ON lb.boat_id = fl.boat_id AND lb.event_id = fl.event_id
       WHERE fl.event_id = ? AND fl.boat_id != ? AND fl.placement_group = ?
         AND ABS(COALESCE(lb.total_points_event, 0) + fl.total_points_final - ?) < 1e-6`,
    )
    .all(event_id, boat_id, finalRow.placement_group, overallPoints) as {
    boat_id: number;
  }[];

  return {
    qualifying,
    final: {
      ...(finalBlock ?? {
        races: [],
        discards: {
          rule: 'SHRS 5.4',
          text: 'Her fleet has not raced yet.',
          count: 0,
        },
        gross: 0,
        total: 0,
        largestHeat: 0,
        seriesRaceCount: 0,
        ties: [],
      }),
      fleet: finalRow.placement_group,
      ties: tieNotes(
        event_id,
        boat_id,
        tied.map((row) => row.boat_id),
        true,
      ),
    },
    overall: {
      points: overallPoints,
      rule: 'SHRS 5.5',
      text: `Overall score = qualifying series ${qualifyingTotal} + final series ${finalTotal} = ${overallPoints}. Boats in ${finalRow.placement_group} are ranked among their own fleet; Gold is ranked before Silver, Silver before Bronze, and so on.`,
    },
  };
}
