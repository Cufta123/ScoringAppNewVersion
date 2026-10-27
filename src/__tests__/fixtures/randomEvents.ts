/**
 * Seeded random events in a real SQLite database (node:sqlite), built the way
 * the app writes them: qualifying heats named "Heat A1", one race per heat per
 * round (race_number 1), final fleets "Final Gold"… with races numbered 1..n.
 * Shared by the scoring characterisation and the score-explanation tests.
 */
import { EVENT_LIFECYCLE_SCHEMA } from './eventLifecycleSchema';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite');

export const EVENT_ID = 1;

/** mulberry32: small, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0; // eslint-disable-line no-bitwise
  return () => {
    /* eslint-disable no-bitwise */
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    /* eslint-enable no-bitwise */
  };
}

const DISCARD_PROFILES = [
  'standard',
  'standard',
  JSON.stringify({ thresholds: [2, 5] }),
  JSON.stringify({ firstDiscardAt: 3, secondDiscardAt: 6, additionalEvery: 3 }),
  JSON.stringify({ thresholds: [] }),
];
const FLEETS = ['Gold', 'Silver', 'Bronze'];

export function buildRandomEvent(seed: number) {
  const random = rng(seed);
  const int = (lo: number, hi: number) =>
    lo + Math.floor(random() * (hi - lo + 1));
  const pick = <T>(items: T[]): T => items[int(0, items.length - 1)];

  const db = new DatabaseSync(':memory:');
  db.exec(EVENT_LIFECYCLE_SCHEMA);
  const qualifyingProfile = pick(DISCARD_PROFILES);
  const finalProfile = pick(DISCARD_PROFILES);
  db.prepare(
    `INSERT INTO Events (event_id, event_name, event_location, start_date, end_date,
       shrs_version, shrs_qualifying_assignment_mode, shrs_discard_profile_qualifying,
       shrs_discard_profile_final, shrs_discard_locked_qualifying,
       shrs_discard_locked_final, shrs_heat_overflow_policy)
     VALUES (?, 'E', 'X', '2026-05-01', '2026-05-03', '2026-1', 'progressive',
       ?, ?, 0, 0, 'auto-increase')`,
  ).run(EVENT_ID, qualifyingProfile, finalProfile);

  const boatCount = int(4, 14);
  const boats = Array.from({ length: boatCount }, (_, i) => i + 1);
  boats.forEach((id) => {
    db.exec(
      `INSERT INTO Boats (boat_id, sail_number, country, model) VALUES (${id}, ${id}, 'CRO', 'IOM');
       INSERT INTO Boat_Event (boat_id, event_id) VALUES (${id}, ${EVENT_ID});`,
    );
  });

  const insertHeat = db.prepare(
    'INSERT INTO Heats (event_id, heat_name, heat_type) VALUES (?, ?, ?)',
  );
  const insertHeatBoat = db.prepare(
    'INSERT INTO Heat_Boat (heat_id, boat_id) VALUES (?, ?)',
  );
  const insertRace = db.prepare(
    'INSERT INTO Races (heat_id, race_number) VALUES (?, ?)',
  );
  const insertScore = db.prepare(
    `INSERT INTO Scores (race_id, boat_id, position, points, status)
     VALUES (?, ?, ?, ?, ?)`,
  );

  /** One sailed race: a random (often tied) score for every boat in it. */
  const scoreRace = (raceId: number, entrants: number[], spread: number) => {
    entrants.forEach((boat) => {
      const roll = random();
      if (roll < 0.06) {
        insertScore.run(raceId, boat, 0, entrants.length + 1, 'DNF');
      } else if (roll < 0.09) {
        insertScore.run(raceId, boat, 0, entrants.length + 1, 'DNE');
      } else if (roll < 0.13) {
        const tenths = int(10, 10 * spread) / 10;
        insertScore.run(raceId, boat, tenths, tenths, 'RDG3');
      } else {
        const place = int(1, spread);
        insertScore.run(raceId, boat, place, place, 'FINISHED');
      }
    });
  };

  const heatCount = int(1, 3);
  const rounds = int(1, 9);
  for (let round = 1; round <= rounds; round += 1) {
    const shuffled = [...boats].sort(() => random() - 0.5);
    for (let h = 0; h < heatCount; h += 1) {
      const heatId = Number(
        insertHeat.run(
          EVENT_ID,
          `Heat ${String.fromCharCode(65 + h)}${round}`,
          'Qualifying',
        ).lastInsertRowid,
      );
      // About one boat in fifteen misses the round entirely.
      const entrants = shuffled
        .filter((_, i) => i % heatCount === h)
        .filter(() => random() > 0.07);
      entrants.forEach((boat) => insertHeatBoat.run(heatId, boat));
      if (entrants.length > 0) {
        const raceId = Number(insertRace.run(heatId, 1).lastInsertRowid);
        scoreRace(raceId, entrants, int(2, Math.max(2, entrants.length)));
      }
    }
  }

  const hasFinal = random() < 0.6;
  if (hasFinal) {
    const fleetCount = Math.min(int(1, 3), boatCount);
    for (let f = 0; f < fleetCount; f += 1) {
      const fleetBoats = boats.filter((_, i) => i % fleetCount === f);
      const heatId = Number(
        insertHeat.run(EVENT_ID, `Final ${FLEETS[f]}`, 'Final').lastInsertRowid,
      );
      fleetBoats.forEach((boat) => insertHeatBoat.run(heatId, boat));
      const races = int(0, 7);
      for (let r = 1; r <= races; r += 1) {
        const raceId = Number(insertRace.run(heatId, r).lastInsertRowid);
        scoreRace(raceId, fleetBoats, int(2, Math.max(2, fleetBoats.length)));
      }
    }
  }

  return { db, hasFinal, qualifyingProfile, finalProfile };
}
