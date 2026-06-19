export function assignBoatsToNewHeatsZigZag(
  leaderboardResults: string | any[],
  nextHeatNames: string | any[],
  // Kept for call-site compatibility; distribution is identical every round.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  raceNumber: number,
) {
  const numHeats = nextHeatNames.length;
  if (numHeats === 0) {
    throw new Error('Cannot assign boats when no heats are provided.');
  }
  const numBoats = leaderboardResults.length;
  const baseParticipantsPerHeat = Math.floor(numBoats / numHeats);
  const extraParticipants = numBoats % numHeats;
  const participantsPerHeat = new Array(numHeats).fill(baseParticipantsPerHeat);

  for (let i = 0; i < extraParticipants; i += 1) {
    participantsPerHeat[i] += 1;
  }

  const assignments = [];
  let direction = 1;
  let heatIndex = 0;
  let repeatedBoundary = false;
  const remainingSpots = [...participantsPerHeat];

  const findAvailableHeat = () => {
    for (let j = 0; j < numHeats; j += 1) {
      if (remainingSpots[j] > 0) {
        return j;
      }
    }
    return heatIndex;
  };

  for (let i = 0; i < leaderboardResults.length; i += 1) {
    const boatId = leaderboardResults[i].boat_id;
    assignments.push({ heatId: heatIndex, boatId });
    remainingSpots[heatIndex] -= 1;

    if (i === leaderboardResults.length - 1) break;

    let candidate;

    if (heatIndex === numHeats - 1 && direction === 1) {
      if (!repeatedBoundary && remainingSpots[heatIndex] > 0) {
        candidate = heatIndex;
        repeatedBoundary = true;
      } else {
        repeatedBoundary = false;
        direction = -1;
        candidate = heatIndex + direction;
      }
    } else if (heatIndex === 0 && direction === -1) {
      if (!repeatedBoundary && remainingSpots[heatIndex] > 0) {
        candidate = heatIndex;
        repeatedBoundary = true;
      } else {
        repeatedBoundary = false;
        direction = 1;
        candidate = heatIndex + direction;
      }
    } else {
      candidate = heatIndex + direction;
    }

    if (
      candidate < 0 ||
      candidate >= numHeats ||
      remainingSpots[candidate] === 0
    ) {
      direction = -direction;
      candidate = heatIndex + direction;
      if (
        candidate < 0 ||
        candidate >= numHeats ||
        remainingSpots[candidate] === 0
      ) {
        candidate = findAvailableHeat();
      }
      repeatedBoundary = false;
    }

    heatIndex = candidate;
  }

  return assignments;
}

export function getNextHeatIndexByMovementTable(
  previousHeatIndex: number,
  finishingPlaceInHeat: number,
  numberOfHeats: number,
) {
  if (numberOfHeats <= 0) {
    throw new Error('Number of heats must be greater than 0.');
  }
  if (finishingPlaceInHeat <= 0) {
    throw new Error('Finishing place must be greater than 0.');
  }
  if (previousHeatIndex < 0 || previousHeatIndex >= numberOfHeats) {
    throw new Error('Previous heat index is out of range.');
  }

  // SHRS 2026-1 Heat Movement Table (Table 1 / Table 2): 1st place stays in the
  // same heat; each additional place rotates the boat DOWN the heat list (Heat
  // 2 -> Heat 1, Heat 1 -> last heat), wrapping around. That is a negative
  // rotation by (place - 1). Adding the shift instead rotates the wrong way and
  // only happens to match for 2 heats (where +1 and -1 are equal mod 2).
  const shift = (finishingPlaceInHeat - 1) % numberOfHeats;
  return (
    (((previousHeatIndex - shift) % numberOfHeats) + numberOfHeats) %
    numberOfHeats
  );
}

type HeatRef = { heat_name: string; heat_id: number };

/**
 * Group heats by their base letters ("Heat A2" -> base "A", suffix 2) and
 * keep only the heat with the highest numeric suffix for each base.
 */
function buildLatestHeatMapByBase(
  heats: HeatRef[],
): Record<string, { suffix: number; heat: HeatRef | null }> {
  return heats.reduce(
    (acc: Record<string, { suffix: number; heat: HeatRef | null }>, heat) => {
      const match = heat.heat_name.match(/Heat ([A-Z]+)(\d*)/);
      if (match) {
        const [, base, suffix] = match;
        const numericSuffix = suffix ? parseInt(suffix, 10) : 0;
        acc[base] = acc[base] || { suffix: -1, heat: null };
        if (numericSuffix >= acc[base].suffix) {
          acc[base] = { suffix: numericSuffix, heat };
        }
      }
      return acc;
    },
    {},
  );
}

export function findLatestHeatsBySuffix(existingHeats: HeatRef[]) {
  return Object.values(buildLatestHeatMapByBase(existingHeats))
    .map((entry) => entry.heat as HeatRef)
    .filter((heat) => heat !== null);
}

export function checkRaceCountForLatestHeats(
  lastHeats: { heat_name: string; heat_id: number }[],
  db: any,
) {
  const raceCountQuery = db.prepare(
    `SELECT COUNT(*) as race_count FROM Races WHERE heat_id = ?`,
  );

  const heatRaceCounts = lastHeats.map((heat) => {
    const raceCount = raceCountQuery.get(heat.heat_id).race_count;
    return { heat_name: heat.heat_name, raceCount };
  });

  const uniqueRaceCounts = [
    ...new Set(heatRaceCounts.map((item) => item.raceCount)),
  ];

  if (uniqueRaceCounts.length > 1) {
    const breakdown = heatRaceCounts
      .map((h) => `${h.heat_name}: ${h.raceCount} race(s)`)
      .join(', ');
    throw new Error(
      `Not all heats have the same number of races yet — you need to finish the current round before redistributing.\n\nCurrent state: ${breakdown}`,
    );
  }
}

export function generateNextHeatNames(latestHeats: HeatRef[]) {
  const heatMap = buildLatestHeatMapByBase(latestHeats);
  return Object.keys(heatMap).map(
    (base) => `Heat ${base}${heatMap[base].suffix + 1}`,
  );
}
