/**
 * CountedRaces: the races that count in the standings.
 *
 * SHRS 1.1: "each race will consist of two or more heats", so a qualifying
 * race of the series is completed only when EVERY heat of its round has sailed
 * it. Until then the heats that have sailed are results in progress: shown,
 * not counted, so every boat in the standings has the same races. Final Series
 * races always count: each fleet is scored as its own series (SHRS 5.1, 4.5).
 *
 * A qualifying race of the series is keyed by (round, race_number). The round
 * is the number at the end of the heat name ("Heat B3" -> 3, "Heat A" -> 0),
 * read as src/shared/heatNames.ts getHeatRoundFromName reads it. Heats not
 * named "Heat ..." belong to no round and never count, as in the DNC backfill.
 * A heat with no boats assigned cannot sail and does not hold its round open.
 *
 * This view is the one definition: the standings rebuild, discards, tie-break,
 * score explanation, the leaderboard screen and the DNC backfill all use it.
 */
const COUNTED_RACES_VIEW = `
  CREATE VIEW IF NOT EXISTS CountedRaces AS
  WITH qualifying_heats AS (
    SELECT
      heat_id,
      event_id,
      CAST(COALESCE(NULLIF(
        substr(heat_name, length(rtrim(heat_name, '0123456789')) + 1), ''
      ), '0') AS INTEGER) AS round
    FROM Heats
    WHERE heat_type = 'Qualifying' AND heat_name GLOB 'Heat [A-Z]*'
      -- A heat nobody is assigned to cannot sail, so it never holds a round
      -- open.
      AND EXISTS (SELECT 1 FROM Heat_Boat hb WHERE hb.heat_id = Heats.heat_id)
  ),
  heats_per_round AS (
    SELECT event_id, round, COUNT(*) AS heat_count
    FROM qualifying_heats
    GROUP BY event_id, round
  ),
  heats_that_sailed AS (
    SELECT q.event_id, q.round, r.race_number,
           COUNT(DISTINCT r.heat_id) AS heat_count
    FROM Races r
    JOIN qualifying_heats q ON q.heat_id = r.heat_id
    GROUP BY q.event_id, q.round, r.race_number
  )
  SELECT r.race_id, q.event_id, 'Qualifying' AS heat_type
  FROM Races r
  JOIN qualifying_heats q ON q.heat_id = r.heat_id
  JOIN heats_that_sailed s
    ON s.event_id = q.event_id AND s.round = q.round
   AND s.race_number = r.race_number
  JOIN heats_per_round p ON p.event_id = q.event_id AND p.round = q.round
  WHERE s.heat_count = p.heat_count
  UNION ALL
  SELECT r.race_id, h.event_id, 'Final' AS heat_type
  FROM Races r
  JOIN Heats h ON h.heat_id = r.heat_id
  WHERE h.heat_type = 'Final';
`;

module.exports = { COUNTED_RACES_VIEW };
