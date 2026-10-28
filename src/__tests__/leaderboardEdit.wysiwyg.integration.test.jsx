/** @jest-environment jsdom */

/**
 * What the race officer sees in leaderboard edit mode is what Save writes.
 *
 * Random sequences of corrections (new places, penalty codes, ZFP) are made through the real useLeaderboard hook,
 * saved through the real handler into real SQLite, and every boat of every
 * touched race must then hold exactly the place, code and points the edit
 * screen showed before Save.
 *
 * Then single corrections are checked against the rules: correcting one
 * result must give the race exactly the points it would have had if the
 * corrected finish had been entered on the scoring screen in the first place.
 */
import '@testing-library/jest-dom';
import { act, renderHook, waitFor } from '@testing-library/react';

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');

const handlerRegistry = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel, callback) => {
      handlerRegistry[channel] = callback;
    }),
    on: jest.fn(),
  },
  dialog: { showSaveDialog: jest.fn(), showOpenDialog: jest.fn() },
  app: { getPath: jest.fn(() => '/tmp') },
}));

const mockDbHolder = { current: null };
jest.mock('../../public/Database/DBManager', () => {
  // eslint-disable-next-line global-require
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

jest.mock('exceljs', () => jest.fn());
jest.mock('file-saver', () => ({ saveAs: jest.fn() }));
jest.mock('jspdf', () => ({ jsPDF: jest.fn() }));
jest.mock('jspdf-autotable', () => jest.fn());
jest.mock('../renderer/utils/registerPdfUnicodeFont', () => jest.fn());

const mockChoice = { current: 'extra' };
jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn().mockResolvedValue(true),
  confirmChoice: jest.fn(() => Promise.resolve(mockChoice.current)),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
}));

/* eslint-disable import/first */
import useLeaderboard from '../renderer/hooks/useLeaderboard';
import { reportError } from '../renderer/utils/userFeedback';
import { realEvent } from './fixtures/realEvent';
import {
  oraclePoints,
  payloadFor,
  prng,
  randomOutcome,
  tenth,
} from './fixtures/scoringOracle';
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';
/* eslint-enable import/first */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel, ...args) => handlerRegistry[channel]({}, ...args);

const CODES = ['DNF', 'DSQ', 'OCS', 'BFD', 'RET', 'DNS', 'UFD', 'NSC'];

let db;
let outcomesByRace;

beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  require('../main/ipcHandlers/EventHandler');
  require('../main/ipcHandlers/HeatRaceHandler');
  const group = new Proxy(
    {},
    {
      get:
        (_target, method) =>
        (...args) =>
          call(method, ...args),
    },
  );
  window.electron = {
    sqlite: { eventDB: group, heatRaceDB: group, sailorDB: group },
  };
});

afterAll(() => jest.restoreAllMocks());

/** A scored event: `rounds` complete rounds over `heats` heats. */
async function scoredEvent(rand, { boats, heats, rounds }) {
  invalidateAssignmentSnapshotCache();
  db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
  const event = realEvent(db, call);
  const eventId = await event.createEvent('Edit check');
  const sails = Array.from({ length: boats }, (_, i) => 10 + i * 3);
  await event.enterBoats(eventId, sails);
  await call('createInitialHeatsAtomic', eventId, heats);
  outcomesByRace = new Map();
  for (let round = 1; round <= rounds; round += 1) {
    const heatRows = db
      .prepare(
        'SELECT heat_id, heat_name FROM Heats WHERE event_id = ? AND heat_name GLOB ?',
      )
      .all(eventId, `Heat [A-Z]${round}`);
    for (const heat of heatRows) {
      const heatSails = event.sailsIn(heat.heat_id);
      const outcome = randomOutcome(rand, heat.heat_name, heatSails);
      // eslint-disable-next-line no-await-in-loop
      const result = await call('submitHeatRaceScoresAtomic', {
        heat_id: heat.heat_id,
        placeNumbers: payloadFor(outcome, heatSails),
      });
      outcomesByRace.set(Number(result.raceId), {
        outcome,
        sails: heatSails,
      });
    }
    if (round < rounds) {
      // eslint-disable-next-line no-await-in-loop
      await call('createNewHeatsBasedOnLeaderboard', eventId);
    }
  }
  return eventId;
}

const largestHeat = (eventId) =>
  Math.max(
    ...db
      .prepare(
        `SELECT COUNT(*) AS n FROM Heat_Boat hb JOIN Heats h ON h.heat_id = hb.heat_id
         WHERE h.event_id = ? AND h.heat_type = 'Qualifying' GROUP BY hb.heat_id`,
      )
      .all(eventId)
      .map((row) => row.n),
  );

const sailOf = (boatId) =>
  Number(
    db.prepare('SELECT sail_number FROM Boats WHERE boat_id = ?').get(boatId)
      .sail_number,
  );

/** The saved race, per boat: place, code, points. */
const savedRace = (raceId) =>
  Object.fromEntries(
    db
      .prepare(
        "SELECT boat_id, position, points, COALESCE(status, 'FINISHED') AS status FROM Scores WHERE race_id = ?",
      )
      .all(raceId)
      .map((row) => [
        row.boat_id,
        {
          position: tenth(row.position),
          status: row.status,
          points: tenth(row.points),
        },
      ]),
  );

/** What the edit screen shows for one race, per boat. */
const shownRace = (rows, raceId) => {
  const shown = {};
  rows.forEach((entry) => {
    const i = (entry.race_ids || []).findIndex(
      (id) => String(id) === String(raceId),
    );
    if (i === -1) return;
    shown[entry.boat_id] = {
      position: tenth(parseFloat(String(entry.races[i]).replace(/[()]/g, ''))),
      status: entry.race_statuses[i] || 'FINISHED',
      points: tenth(
        parseFloat(String(entry.race_points[i]).replace(/[()]/g, '')),
      ),
    };
  });
  return shown;
};

async function openEditor(eventId) {
  const hook = renderHook(() => useLeaderboard(eventId));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  await act(async () => {
    await hook.result.current.toggleEditMode();
  });
  return hook;
}

/** One random correction, as the edit screen makes it. */
function randomEdit(rand, rows) {
  const entry = rows[Math.floor(rand() * rows.length)];
  const raceIndex = Math.floor(rand() * entry.races.length);
  const raceId = String(entry.race_ids[raceIndex]);
  const boatsInRace = rows.filter(
    (row) => String(row.race_ids[raceIndex]) === raceId,
  ).length;
  const status = entry.race_statuses[raceIndex] || 'FINISHED';
  const r = rand();
  if (r < 0.5) {
    return {
      entry,
      raceIndex,
      raceId,
      value: String(1 + Math.floor(rand() * boatsInRace)),
      status: 'FINISHED',
    };
  }
  if (r < 0.8 || status !== 'FINISHED') {
    return {
      entry,
      raceIndex,
      raceId,
      value: null,
      status: CODES[Math.floor(rand() * CODES.length)],
    };
  }
  return { entry, raceIndex, raceId, value: null, status: 'ZFP' };
}

describe('leaderboard edits: Save writes exactly what the screen shows', () => {
  const SEEDS = Array.from(
    { length: Number(process.env.EDIT_SEEDS || 30) },
    (_, i) => i + 1,
  );

  it.each(SEEDS)('random corrections, seed %i', async (seed) => {
    const rand = prng(seed * 104729);
    const eventId = await scoredEvent(rand, {
      boats: 8 + Math.floor(rand() * 16),
      heats: 2 + Math.floor(rand() * 2),
      rounds: 1 + Math.floor(rand() * 3),
    });
    const { result, unmount } = await openEditor(eventId);

    const touched = new Set();
    const edits = 1 + Math.floor(rand() * 6);
    for (let k = 0; k < edits; k += 1) {
      const edit = randomEdit(rand, result.current.editableLeaderboard);
      touched.add(edit.raceId);
      act(() => {
        result.current.handleRaceChange(
          edit.entry.boat_id,
          edit.raceIndex,
          edit.value,
          edit.status,
        );
      });
    }
    const shown = [...touched].map((raceId) => ({
      raceId,
      boats: shownRace(result.current.editableLeaderboard, raceId),
    }));

    mockChoice.current = 'extra'; // keep a deliberate tie as shown
    await act(async () => {
      await result.current.handleSave();
    });
    expect(reportError).not.toHaveBeenCalled();

    shown.forEach(({ raceId, boats }) => {
      expect({ seed, raceId, race: savedRace(raceId) }).toEqual({
        seed,
        raceId,
        race: boats,
      });
    });
    unmount();
    db.close();
  });
});

describe('a single correction scores the race as if it had been entered so', () => {
  const SEEDS = Array.from(
    { length: Number(process.env.EDIT_SEEDS || 30) },
    (_, i) => i + 1,
  );

  it.each(SEEDS)('seed %i', async (seed) => {
    const rand = prng(seed * 15485863);
    const eventId = await scoredEvent(rand, {
      boats: 8 + Math.floor(rand() * 16),
      heats: 2,
      rounds: 1,
    });
    const { result, unmount } = await openEditor(eventId);
    const rows = result.current.editableLeaderboard;

    // A boat that crossed the line, in a race with at least 3 such boats.
    const races = [...outcomesByRace.entries()].filter(
      ([, { outcome }]) => outcome.crossed.length >= 3,
    );
    if (races.length === 0) return;
    const [raceId, { outcome, sails }] =
      races[Math.floor(rand() * races.length)];
    const boatIdOf = new Map(
      rows.map((row) => [Number(row.boat_number), row.boat_id]),
    );
    const sail = outcome.crossed[Math.floor(rand() * outcome.crossed.length)];
    const entry = rows.find((row) => row.boat_id === boatIdOf.get(sail));
    const raceIndex = entry.race_ids.findIndex(
      (id) => String(id) === String(raceId),
    );

    // The corrected finish, as it would have been entered.
    const corrected = {
      ...outcome,
      crossed: [...outcome.crossed],
      penalty: new Map(outcome.penalty),
      tiedWithAbove: new Set(outcome.tiedWithAbove),
    };
    const kind = rand();
    let value = null;
    let status;
    if (kind < 0.6) {
      // Found later to have had no finishing place: OCS, BFD, DNF, DSQ…
      status = CODES[Math.floor(rand() * CODES.length)];
      corrected.crossed = corrected.crossed.filter((s) => s !== sail);
      corrected.penalty.set(sail, status);
      corrected.tiedWithAbove.delete(sail);
      // The boat below, if tied with her alone, is no longer tied; in a
      // larger dead heat she stays tied with the boat above her.
      const i = outcome.crossed.indexOf(sail);
      const below = outcome.crossed[i + 1];
      if (below != null && !outcome.tiedWithAbove.has(sail)) {
        corrected.tiedWithAbove.delete(below);
      }
    } else {
      // Moved to another place: the boats in between make room.
      const from = outcome.crossed.indexOf(sail);
      let to = Math.floor(rand() * outcome.crossed.length);
      if (to === from) to = (to + 1) % outcome.crossed.length;
      // Keep the check to clean, untied finishes.
      if (
        outcome.penalty.has(sail) ||
        outcome.tiedWithAbove.size > 0 ||
        [...outcome.penalty.keys()].some((s) => outcome.crossed.includes(s))
      ) {
        unmount();
        db.close();
        return;
      }
      status = 'FINISHED';
      value = String(to + 1);
      corrected.crossed.splice(from, 1);
      corrected.crossed.splice(to, 0, sail);
    }

    act(() => {
      result.current.handleRaceChange(entry.boat_id, raceIndex, value, status);
    });
    mockChoice.current = 'extra';
    await act(async () => {
      await result.current.handleSave();
    });

    const expected = oraclePoints(corrected, largestHeat(eventId), sails);
    const saved = savedRace(raceId);
    const savedPoints = Object.fromEntries(
      Object.entries(saved).map(([boatId, cell]) => [
        sailOf(Number(boatId)),
        cell.points,
      ]),
    );
    expect({ seed, sail, status, value, points: savedPoints }).toEqual({
      seed,
      sail,
      status,
      value,
      points: Object.fromEntries(expected),
    });
    unmount();
    db.close();
  });
});

describe('final series edits: Save writes exactly what the screen shows', () => {
  const SEEDS = Array.from(
    { length: Number(process.env.EDIT_SEEDS || 30) },
    (_, i) => i + 1,
  );

  it.each(SEEDS)('random corrections in the fleets, seed %i', async (seed) => {
    const rand = prng(seed * 7727);
    const eventId = await scoredEvent(rand, {
      boats: 8 + Math.floor(rand() * 16),
      heats: 2 + Math.floor(rand() * 2),
      rounds: 1 + Math.floor(rand() * 3),
    });
    await call('startFinalSeriesAtomic', eventId, false, false);
    const fleets = db
      .prepare(
        "SELECT heat_id, heat_name FROM Heats WHERE event_id = ? AND heat_type = 'Final'",
      )
      .all(eventId);
    for (const heat of fleets) {
      const races = 1 + Math.floor(rand() * 3);
      for (let r = 0; r < races; r += 1) {
        const heatSails = db
          .prepare(
            'SELECT b.sail_number FROM Heat_Boat hb JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ?',
          )
          .all(heat.heat_id)
          .map((row) => Number(row.sail_number));
        const outcome = randomOutcome(rand, heat.heat_name, heatSails);
        // eslint-disable-next-line no-await-in-loop
        await call('submitHeatRaceScoresAtomic', {
          heat_id: heat.heat_id,
          placeNumbers: payloadFor(outcome, heatSails),
        });
      }
    }

    const { result, unmount } = await openEditor(eventId);
    await waitFor(() => expect(result.current.finalSeriesStarted).toBe(true));
    await waitFor(() =>
      expect(
        result.current.editableLeaderboard.every((row) => row.races.length > 0),
      ).toBe(true),
    );
    if (!result.current.editMode) {
      await act(async () => {
        await result.current.toggleEditMode();
      });
    }

    const touched = new Set();
    const edits = 1 + Math.floor(rand() * 6);
    for (let k = 0; k < edits; k += 1) {
      const edit = randomEdit(rand, result.current.editableLeaderboard);
      touched.add(edit.raceId);
      act(() => {
        result.current.handleRaceChange(
          edit.entry.boat_id,
          edit.raceIndex,
          edit.value,
          edit.status,
        );
      });
    }
    const shown = [...touched].map((raceId) => ({
      raceId,
      boats: shownRace(result.current.editableLeaderboard, raceId),
    }));
    await act(async () => {
      await result.current.handleSave();
    });
    expect(reportError).not.toHaveBeenCalled();
    shown.forEach(({ raceId, boats }) => {
      expect({ seed, raceId, race: savedRace(raceId) }).toEqual({
        seed,
        raceId,
        race: boats,
      });
    });
    unmount();
    db.close();
  });
});
