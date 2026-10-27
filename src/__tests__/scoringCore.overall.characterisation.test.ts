/** @jest-environment node */
export {};

/**
 * Characterisation of the OVERALL standings (SHRS 5.5: qualifying + final,
 * Gold before Silver, SHRS 5.7(ii) tie-break across both series) on the same
 * 150 seeded random events as scoringCore.characterisation.test.ts.
 *
 * The snapshot was recorded from the code as it stood BEFORE the overall
 * standings moved into src/shared/scoring. Like the other characterisation it
 * pins behaviour: a refactor must leave it untouched, a rule fix updates it on
 * purpose in its own commit.
 */

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
import { buildRandomEvent, EVENT_ID } from './fixtures/randomEvents';
// eslint-disable-next-line import/first, import/order
import {
  recomputeEventLeaderboard,
  recomputeFinalLeaderboard,
} from '../main/functions/leaderboardRecompute';

const EVENTS = 150;

const line = (row: any) =>
  [
    row.placement_group,
    `boat ${row.boat_id}`,
    `rank ${row.overall_rank ?? row.place}`,
    `overall ${row.overall_points}`,
    row.qualifying_points != null
      ? `Q ${row.qualifying_points} + F ${row.final_points}`
      : '',
  ]
    .filter(Boolean)
    .join(' | ');

async function overallFor(seed: number): Promise<string[]> {
  const { db, hasFinal } = buildRandomEvent(seed);
  mockDbHolder.current = db;
  try {
    await handlerRegistry.readLeaderboard({}, EVENT_ID);
    recomputeEventLeaderboard(EVENT_ID);
    if (hasFinal) recomputeFinalLeaderboard(EVENT_ID);
    const rows = await handlerRegistry.readOverallLeaderboard({}, EVENT_ID);
    return [`seed ${seed}: overall`, ...rows.map(line)];
  } finally {
    db.close();
  }
}

describe('overall standings characterisation (150 seeded random events)', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    require('../main/ipcHandlers/HeatRaceHandler');
  });

  afterAll(() => jest.restoreAllMocks());

  const GROUP = 25;
  for (let start = 1; start <= EVENTS; start += GROUP) {
    const end = start + GROUP - 1;
    it(`events ${start}-${end} rank exactly as recorded`, async () => {
      const lines: string[] = [];
      for (let seed = start; seed <= end; seed += 1) {
        // eslint-disable-next-line no-await-in-loop
        lines.push(...(await overallFor(seed)));
      }
      expect(lines.join('\n')).toMatchSnapshot();
    });
  }
});
