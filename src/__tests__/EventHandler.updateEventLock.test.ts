export {};

type PrepareStatement = {
  get?: (...args: any[]) => any;
  all?: (...args: any[]) => any[];
  run?: (...args: any[]) => any;
};

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    on: jest.fn(),
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
  },
}));

let currentEventRow = {
  shrs_discard_profile_qualifying: 'standard',
  shrs_discard_profile_final: 'standard',
  shrs_discard_locked_qualifying: 0,
  shrs_discard_locked_final: 0,
};

const dbMock = {
  prepare: jest.fn((sql: string): PrepareStatement => {
    const compact = sql.replace(/\s+/g, ' ').trim();

    if (
      compact.includes('SELECT') &&
      compact.includes('shrs_discard_profile_qualifying') &&
      compact.includes('FROM Events')
    ) {
      return {
        get: jest.fn(() => ({ ...currentEventRow })),
      };
    }

    if (compact.includes('UPDATE Events')) {
      return {
        run: jest.fn(() => ({ changes: 1 })),
      };
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  }),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

describe('EventHandler updateEvent discard locks', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/EventHandler');
  });

  beforeEach(() => {
    currentEventRow = {
      shrs_discard_profile_qualifying: 'standard',
      shrs_discard_profile_final: 'standard',
      shrs_discard_locked_qualifying: 0,
      shrs_discard_locked_final: 0,
    };
    dbMock.prepare.mockClear();
  });

  it('allows event update when discard profiles are not locked', async () => {
    const handler = handlerRegistry.updateEvent;
    await expect(
      handler(
        {},
        55,
        'Event 2026',
        'Split',
        '2026-05-01',
        '2026-05-03',
        'progressive',
        'standard',
        'standard',
        'auto-increase',
      ),
    ).resolves.toEqual({ success: true });
  });

  it('rejects qualifying discard profile change once qualifying is locked', async () => {
    currentEventRow.shrs_discard_locked_qualifying = 1;
    currentEventRow.shrs_discard_profile_qualifying = JSON.stringify({
      firstDiscardAt: 5,
      secondDiscardAt: 9,
      additionalEvery: 8,
    });

    const handler = handlerRegistry.updateEvent;
    await expect(
      handler(
        {},
        55,
        'Event 2026',
        'Split',
        '2026-05-01',
        '2026-05-03',
        'progressive',
        JSON.stringify({ firstDiscardAt: 4, secondDiscardAt: 8, additionalEvery: 8 }),
        'standard',
        'auto-increase',
      ),
    ).rejects.toThrow(
      'Qualifying discard profile is locked after the first qualifying race.',
    );
  });

  it('rejects final discard profile change once final is locked', async () => {
    currentEventRow.shrs_discard_locked_final = 1;
    currentEventRow.shrs_discard_profile_final = JSON.stringify({
      firstDiscardAt: 6,
      secondDiscardAt: 10,
      additionalEvery: 8,
    });

    const handler = handlerRegistry.updateEvent;
    await expect(
      handler(
        {},
        55,
        'Event 2026',
        'Split',
        '2026-05-01',
        '2026-05-03',
        'progressive',
        'standard',
        JSON.stringify({ firstDiscardAt: 4, secondDiscardAt: 8, additionalEvery: 8 }),
        'auto-increase',
      ),
    ).rejects.toThrow(
      'Final discard profile is locked after the first final race.',
    );
  });
});
