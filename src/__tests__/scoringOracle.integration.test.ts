/** @jest-environment node */
export {};

/**
 * An independent check of the scoring, written from the rule text and sharing
 * no code with the app's scoring: random qualifying series are entered the way
 * the scoring screen enters them (finish order, penalties, RRS A7 dead heats),
 * through the real handlers on real SQLite, and after every completed round
 * each boat's race points, net score and place must equal what this file
 * computes from the rules alone:
 *
 *  - RRS A4 / A7: a finisher scores her place; tied boats share the average
 *    of the places they occupy.
 *  - RRS 44.3(c) (2025–2028): ZFP/SCP score the place plus 20% of the DNF
 *    score, rounded to the nearest tenth (0.05 up), never worse than DNF.
 *  - SHRS 5.2: DNF, DNS, OCS, … score the boats in the largest heat + 1.
 *  - SHRS 5.4: discards by completed races (1 from 4, 2 from 8, +1 per 8).
 *  - SHRS 5.7(ii): ties broken by RRS A8.1 then A8.2 using only races the
 *    tied boats sailed in the same heat, excluded scores included; with no
 *    shared heat, A8.1/A8.2 unmodified. (Checked for two-boat ties; a larger
 *    tie is checked for its block of places only.)
 *
 * Only what was typed is shared with the app: the oracle never reads a stored
 * point or place.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
    on: jest.fn(),
  },
  dialog: { showSaveDialog: jest.fn(), showOpenDialog: jest.fn() },
  app: { getPath: jest.fn(() => '/tmp') },
}));

const mockDbHolder: { current: any } = { current: null };
jest.mock('../../public/Database/DBManager', () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

// eslint-disable-next-line import/first, import/order
import { realEvent } from './fixtures/realEvent';
// eslint-disable-next-line import/first, import/order
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';
// eslint-disable-next-line import/first, import/order
import {
  HeatOutcome,
  oraclePoints,
  payloadFor,
  prng,
  randomOutcome,
  tenth,
} from './fixtures/scoringOracle';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

const excludeCount = (races: number) => {
  if (races < 4) return 0;
  if (races < 8) return 1;
  return 2 + Math.floor((races - 8) / 8);
};

interface BoatSeries {
  sail: number;
  /** One entry per completed round: points and the heat sailed. */
  races: { points: number; heat: string }[];
}

const netOf = (boat: BoatSeries) => {
  const scores = boat.races.map((r) => r.points);
  const worst = [...scores].sort((a, b) => b - a);
  const dropped = worst.slice(0, excludeCount(scores.length));
  return tenth(
    scores.reduce((s, p) => s + p, 0) - dropped.reduce((s, p) => s + p, 0),
  );
};

/** <0: a ranks ahead; >0: b ahead; 0: still tied. A8.1 then A8.2. */
function a8(aScores: number[], bScores: number[]) {
  const sa = [...aScores].sort((x, y) => x - y);
  const sb = [...bScores].sort((x, y) => x - y);
  for (let i = 0; i < Math.min(sa.length, sb.length); i += 1) {
    if (sa[i] !== sb[i]) return sa[i] - sb[i];
  }
  return 0;
}
function a82(aScores: number[], bScores: number[]) {
  for (let i = aScores.length - 1; i >= 0; i -= 1) {
    if (aScores[i] !== bScores[i]) return aScores[i] - bScores[i];
  }
  return 0;
}

/** SHRS 5.7(ii) for two boats with equal net scores. */
function breakTwoBoatTie(a: BoatSeries, b: BoatSeries): number {
  const shared = a.races
    .map((race, i) => ({ i, race }))
    .filter(({ i, race }) => race.heat === b.races[i].heat)
    .map(({ i }) => i);
  if (shared.length > 0) {
    const as = shared.map((i) => a.races[i].points);
    const bs = shared.map((i) => b.races[i].points);
    return a8(as, bs) || a82(as, bs);
  }
  // 5.7(ii)(4): never in the same heat: A8.1 (without excluded scores) and
  // A8.2 unmodified.
  const kept = (boat: BoatSeries) => {
    const scores = boat.races.map((r) => r.points);
    const drop = excludeCount(scores.length);
    return [...scores].sort((x, y) => x - y).slice(0, scores.length - drop);
  };
  return (
    a8(kept(a), kept(b)) ||
    a82(
      a.races.map((r) => r.points),
      b.races.map((r) => r.points),
    )
  );
}

// ── Heat assignment (SHRS 3.1), independently ─────────────────────────────
/** SHRS 3.1(iii): order of boats with no finishing position. */
const MOVEMENT_ORDER = [
  'DNF',
  'RET',
  'NSC',
  'OCS',
  'DNS',
  'DNC',
  'UFD',
  'BFD',
  'DSQ',
];

/**
 * The movement position of every boat in one heat race: finishing place
 * (ZFP/SCP keep it), dead-heated boats in sail order (3.1(iv)), then boats
 * with no finishing position in the 3.1(iii) order, ties in sail order.
 */
function movementOrder(
  outcome: HeatOutcome,
  sails: number[],
  bySail: (a: number, b: number) => number,
): number[] {
  const finishers: number[] = [];
  const { crossed } = outcome;
  let i = 0;
  while (i < crossed.length) {
    let j = i;
    while (
      j + 1 < crossed.length &&
      outcome.tiedWithAbove.has(crossed[j + 1])
    ) {
      j += 1;
    }
    finishers.push(...crossed.slice(i, j + 1).sort(bySail));
    i = j + 1;
  }
  const others = sails
    .filter((sail) => !crossed.includes(sail))
    .sort(
      (a, b) =>
        MOVEMENT_ORDER.indexOf(outcome.penalty.get(a)!) -
          MOVEMENT_ORDER.indexOf(outcome.penalty.get(b)!) || bySail(a, b),
    );
  return [...finishers, ...others];
}

/** SHRS Heat Movement Table: place p in heat h -> heat (h - (p - 1)) mod H. */
const nextHeatIndex = (heat: number, place: number, heats: number) =>
  (((heat - (place - 1)) % heats) + heats) % heats;

/** SHRS 3.1(i): race 1, ranked by national letter then sail number, 1..H,H..1. */
function serpentine(
  sails: number[],
  heats: number,
  bySail: (a: number, b: number) => number,
): Map<number, number> {
  const ranked = [...sails].sort(bySail);
  const heatOf = new Map<number, number>();
  ranked.forEach((sail, i) => {
    const lap = Math.floor(i / heats);
    const pos = i % heats;
    heatOf.set(sail, lap % 2 === 0 ? pos : heats - 1 - pos);
  });
  return heatOf;
}

const letterIndex = (heatName: string) =>
  heatName.replace(/^Heat /, '').charCodeAt(0) - 65;

describe('scoring agrees with an independent reading of the rules', () => {
  let db: any;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
  });
  afterAll(() => jest.restoreAllMocks());

  const SEEDS = Array.from(
    { length: Number(process.env.ORACLE_SEEDS || 40) },
    (_, i) => i + 1,
  );

  it.each(SEEDS)('random qualifying series, seed %i', async (seed) => {
    invalidateAssignmentSnapshotCache();
    db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    mockDbHolder.current = db;
    const rand = prng(seed * 7919);
    const event = realEvent(db, call);
    const eventId = await event.createEvent(`Oracle ${seed}`);
    const boatCount = 8 + Math.floor(rand() * 40);
    const heatCount = Math.max(
      2 + Math.floor(rand() * 3),
      Math.ceil(boatCount / 20),
    );
    const rounds = 2 + Math.floor(rand() * 9);
    const sails = Array.from({ length: boatCount }, (_, i) => 10 + i * 3);
    await event.enterBoats(eventId, sails);
    // Mixed nations: ties go by national letters, then sail number (SHRS
    // 3.1(iv), 5.3), and race 1 is seeded the same way (SHRS 3).
    const NATIONS = ['AUS', 'CRO', 'GBR', 'ITA', 'FRA', 'GER'];
    const nationOf = new Map<number, string>();
    sails.forEach((sail) => {
      const nation = NATIONS[Math.floor(rand() * NATIONS.length)];
      nationOf.set(sail, nation);
      db.prepare('UPDATE Boats SET country = ? WHERE sail_number = ?').run(
        nation,
        sail,
      );
    });
    const sailOrder = (a: number, b: number) =>
      nationOf.get(a)!.localeCompare(nationOf.get(b)!) || a - b;
    await call('createInitialHeatsAtomic', eventId, heatCount);

    const series = new Map<number, BoatSeries>(
      sails.map((sail) => [sail, { sail, races: [] }]),
    );
    const boatIdOf = new Map<number, number>(
      db
        .prepare('SELECT boat_id, sail_number FROM Boats')
        .all()
        .map((row: any) => [Number(row.sail_number), Number(row.boat_id)]),
    );

    const heatOfSail = (round: number) => {
      const map = new Map<number, number>();
      db.prepare(
        `SELECT b.sail_number, h.heat_name FROM Heat_Boat hb
         JOIN Heats h ON h.heat_id = hb.heat_id JOIN Boats b ON b.boat_id = hb.boat_id
         WHERE h.event_id = ? AND h.heat_name GLOB ?`,
      )
        .all(eventId, `Heat [A-Z]${round}`)
        .forEach((row: any) =>
          map.set(Number(row.sail_number), letterIndex(row.heat_name)),
        );
      return map;
    };
    // Race 1 assignment.
    expect({
      seed,
      heats: [...heatOfSail(1)].sort((a, b) => a[0] - b[0]),
    }).toEqual({
      seed,
      heats: [...serpentine(sails, heatCount, sailOrder)].sort(
        (a, b) => a[0] - b[0],
      ),
    });
    let expectedNext = new Map<number, number>();

    for (let round = 1; round <= rounds; round += 1) {
      if (round > 1) {
        const actual = heatOfSail(round);
        expect({
          seed,
          round,
          heats: [...actual].sort((a, b) => a[0] - b[0]),
        }).toEqual({
          seed,
          round,
          heats: [...expectedNext].sort((a, b) => a[0] - b[0]),
        });
      }
      expectedNext = new Map();
      const heats = db
        .prepare(
          'SELECT heat_id, heat_name FROM Heats WHERE event_id = ? AND heat_name GLOB ?',
        )
        .all(eventId, `Heat [A-Z]${round}`) as {
        heat_id: number;
        heat_name: string;
      }[];
      const largest = Math.max(
        ...db
          .prepare(
            `SELECT COUNT(*) AS n FROM Heat_Boat hb JOIN Heats h ON h.heat_id = hb.heat_id
             WHERE h.event_id = ? AND h.heat_type = 'Qualifying' GROUP BY hb.heat_id`,
          )
          .all(eventId)
          .map((row: any) => row.n),
      );
      /** Score a heat; the oracle keeps what the race officer entered. */
      const scoreHeat = async (heat: {
        heat_id: number;
        heat_name: string;
      }) => {
        const heatSails = event.sailsIn(heat.heat_id);
        const outcome = randomOutcome(rand, heat.heat_name, heatSails);
        const result = await call('submitHeatRaceScoresAtomic', {
          heat_id: heat.heat_id,
          placeNumbers: payloadFor(outcome, heatSails),
        });
        expect(result?.ok).toBe(true);
        const points = oraclePoints(outcome, largest, heatSails);
        movementOrder(outcome, heatSails, sailOrder).forEach((sail, index) => {
          expectedNext.set(
            sail,
            nextHeatIndex(letterIndex(heat.heat_name), index + 1, heats.length),
          );
        });
        heatSails.forEach((sail) => {
          const { races } = series.get(sail)!;
          if (races.length === round) races.pop(); // replaced after an undo
          races.push({ points: points.get(sail)!, heat: heat.heat_name });
        });
      };

      for (const heat of heats) {
        // Sometimes a heat is scored wrongly, undone (Undo last race) and
        // scored again: only the second entry may count.
        if (rand() < 0.2) {
          // eslint-disable-next-line no-await-in-loop
          await scoreHeat(heat);
          // eslint-disable-next-line no-await-in-loop
          await call('undoLastScoredRaceForHeat', heat.heat_id);
        }
        // eslint-disable-next-line no-await-in-loop
        await scoreHeat(heat);
      }

      // Sometimes the next round is created, then undone because a result
      // of this round was wrong; that heat is undone and scored again.
      if (round < rounds && rand() < 0.2) {
        await call('createNewHeatsBasedOnLeaderboard', eventId);
        await call('undoLatestHeatRedistribution', eventId);
        const heat = heats[Math.floor(rand() * heats.length)];
        await call('undoLastScoredRaceForHeat', heat.heat_id);
        await scoreHeat(heat);
      }

      // eslint-disable-next-line no-await-in-loop
      const rows = await call('readLeaderboard', eventId);
      expect(rows).toHaveLength(boatCount);
      const bySail = new Map<number, any>();
      rows.forEach((row: any) => bySail.set(Number(row.boat_number), row));

      // Race points and net score of every boat.
      series.forEach((boat) => {
        const row = bySail.get(boat.sail);
        const context = `seed ${seed} round ${round} sail ${boat.sail}`;
        expect({
          context,
          races: String(row.race_points).split(',').map(Number),
        }).toEqual({ context, races: boat.races.map((r) => r.points) });
        expect({ context, net: tenth(Number(row.total_points_event)) }).toEqual(
          {
            context,
            net: netOf(boat),
          },
        );
      });

      // Places: ordered by net; ties per SHRS 5.7.
      const boats = [...series.values()].sort((a, b) => netOf(a) - netOf(b));
      let start = 0;
      while (start < boats.length) {
        let end = start;
        while (
          end + 1 < boats.length &&
          netOf(boats[end + 1]) === netOf(boats[start])
        ) {
          end += 1;
        }
        const group = boats.slice(start, end + 1);
        const places = group.map((b) => Number(bySail.get(b.sail).place));
        const context = `seed ${seed} round ${round} net ${netOf(group[0])} sails ${group.map((b) => b.sail)}`;
        places.forEach((place) => {
          expect({
            context,
            inBlock: place >= start + 1 && place <= end + 1,
          }).toEqual({
            context,
            inBlock: true,
          });
        });
        if (group.length === 2) {
          const [a, b] = group;
          const decided = breakTwoBoatTie(a, b);
          const [pa, pb] = places;
          let expected: [number, number];
          if (decided < 0) expected = [start + 1, start + 2];
          else if (decided > 0) expected = [start + 2, start + 1];
          else expected = [start + 1, start + 1];
          expect({ context, places: [pa, pb] }).toEqual({
            context,
            places: expected,
          });
        }
        start = end + 1;
      }

      if (round < rounds) {
        // eslint-disable-next-line no-await-in-loop
        await call('createNewHeatsBasedOnLeaderboard', eventId);
      }
    }
    expect(boatIdOf.size).toBe(boatCount);

    // ── Final Series ────────────────────────────────────────────────────
    const qualRows = await call('readLeaderboard', eventId);
    const qualPlace = new Map<number, number>(
      qualRows.map((row: any) => [Number(row.boat_number), Number(row.place)]),
    );
    // SHRS 4.3: with 6 or 7 completed races the second-worst score is also
    // left out, for the fleet split only.
    const apply43 = rounds > 5 && rounds < 8;
    const splitScore = (boat: BoatSeries) => {
      const worstFirst = boat.races.map((r) => r.points).sort((a, b) => b - a);
      const drop = excludeCount(worstFirst.length) + (apply43 ? 1 : 0);
      return tenth(
        worstFirst.slice(drop).reduce((sum, points) => sum + points, 0),
      );
    };
    const ranked = [...series.values()].sort(
      (a, b) =>
        splitScore(a) - splitScore(b) ||
        qualPlace.get(a.sail)! - qualPlace.get(b.sail)! ||
        a.sail - b.sail,
    );
    // SHRS 4.1: as many fleets as heats, as equal as possible, Gold largest.
    const FLEETS = ['Gold', 'Silver', 'Bronze', 'Copper'];
    const fleetCount = heatCount;
    const fleetOf = new Map<number, number>();
    let next = 0;
    for (let f = 0; f < fleetCount; f += 1) {
      const size =
        Math.floor(boatCount / fleetCount) +
        (f < boatCount % fleetCount ? 1 : 0);
      ranked.slice(next, next + size).forEach((b) => fleetOf.set(b.sail, f));
      next += size;
    }
    await call('startFinalSeriesAtomic', eventId, false, apply43);

    const fleetSails = (f: number) =>
      sails.filter((sail) => fleetOf.get(sail) === f);
    const actualFleet = new Map<number, string>();
    db.prepare(
      `SELECT b.sail_number, h.heat_name FROM Heat_Boat hb
       JOIN Heats h ON h.heat_id = hb.heat_id JOIN Boats b ON b.boat_id = hb.boat_id
       WHERE h.event_id = ? AND h.heat_type = 'Final'`,
    )
      .all(eventId)
      .forEach((row: any) =>
        actualFleet.set(Number(row.sail_number), row.heat_name),
      );
    expect({
      seed,
      fleets: sails.map((sail) => [sail, actualFleet.get(sail)]),
    }).toEqual({
      seed,
      fleets: sails.map((sail) => [
        sail,
        `Final ${FLEETS[fleetOf.get(sail)!]}`,
      ]),
    });

    // SHRS 4.4/4.5: each fleet sails its own races, not all the same number.
    const largestFleet = Math.max(
      ...Array.from({ length: fleetCount }, (_, f) => fleetSails(f).length),
    );
    const finals = new Map<number, number[]>(sails.map((sail) => [sail, []]));
    for (let f = 0; f < fleetCount; f += 1) {
      const heat = db
        .prepare(
          'SELECT heat_id, heat_name FROM Heats WHERE event_id = ? AND heat_name = ?',
        )
        .get(eventId, `Final ${FLEETS[f]}`);
      const races = 1 + Math.floor(rand() * 5);
      for (let r = 0; r < races; r += 1) {
        const heatSails = fleetSails(f);
        const outcome = randomOutcome(rand, heat.heat_name, heatSails);
        // eslint-disable-next-line no-await-in-loop
        const result = await call('submitHeatRaceScoresAtomic', {
          heat_id: heat.heat_id,
          placeNumbers: payloadFor(outcome, heatSails),
        });
        expect(result?.ok).toBe(true);
        // SHRS 5.2 in the Final Series: the largest final fleet + 1.
        const points = oraclePoints(outcome, largestFleet, heatSails);
        heatSails.forEach((sail) => finals.get(sail)!.push(points.get(sail)!));
      }
    }

    const finalNet = (sail: number) => {
      const scores = finals.get(sail)!;
      const worstFirst = [...scores].sort((a, b) => b - a);
      return tenth(
        worstFirst
          .slice(excludeCount(scores.length))
          .reduce((sum, points) => sum + points, 0),
      );
    };
    const overall = await call('readOverallLeaderboard', eventId);
    const overallBySail = new Map<number, any>(
      overall.map((row: any) => [Number(row.boat_number), row]),
    );
    // SHRS 5.5: qualifying + final score; Gold before Silver before Bronze.
    const expectedOverall = (sail: number) =>
      tenth(netOf(series.get(sail)!) + finalNet(sail));
    sails.forEach((sail) => {
      const row = overallBySail.get(sail);
      expect({ seed, sail, points: tenth(Number(row.overall_points)) }).toEqual(
        {
          seed,
          sail,
          points: expectedOverall(sail),
        },
      );
    });
    const order = [...sails].sort(
      (a, b) =>
        fleetOf.get(a)! - fleetOf.get(b)! ||
        expectedOverall(a) - expectedOverall(b),
    );
    let blockStart = 0;
    while (blockStart < order.length) {
      let blockEnd = blockStart;
      const key = (sail: number) =>
        `${fleetOf.get(sail)}:${expectedOverall(sail)}`;
      while (
        blockEnd + 1 < order.length &&
        key(order[blockEnd + 1]) === key(order[blockStart])
      ) {
        blockEnd += 1;
      }
      for (let k = blockStart; k <= blockEnd; k += 1) {
        const rank = Number(overallBySail.get(order[k]).overall_rank);
        expect({
          seed,
          sail: order[k],
          inBlock: rank >= blockStart + 1 && rank <= blockEnd + 1,
        }).toEqual({ seed, sail: order[k], inBlock: true });
      }
      blockStart = blockEnd + 1;
    }
    db.close();
  });
});
