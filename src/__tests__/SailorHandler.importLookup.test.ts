export {};

type PrepareStatement = {
  get?: (...args: any[]) => any;
  run?: (...args: any[]) => any;
  all?: (...args: any[]) => any[];
};

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
    on: jest.fn(),
  },
}));

const prepareCalls: string[] = [];
const dbMock = {
  prepare: jest.fn((sql: string): PrepareStatement => {
    prepareCalls.push(sql);

    if (sql.includes('SELECT category_id FROM Categories')) {
      return { get: jest.fn(() => ({ category_id: 3 })) };
    }

    if (sql.includes('SELECT club_id FROM Clubs WHERE club_name = ?')) {
      return { get: jest.fn(() => ({ club_id: 10 })) };
    }

    if (
      sql.includes(
        'SELECT sailor_id FROM Sailors WHERE name = ? AND surname = ? AND birthday = ?',
      )
    ) {
      return { get: jest.fn(() => ({ sailor_id: 99 })) };
    }

    if (
      sql.includes('SELECT boat_id FROM Boats WHERE CAST(sail_number AS TEXT) = ? AND UPPER(country) = UPPER(?)')
    ) {
      return { get: jest.fn(() => ({ boat_id: 555 })) };
    }

    if (sql.includes('SELECT boat_event_id FROM Boat_Event WHERE boat_id = ? AND event_id = ?')) {
      return { get: jest.fn(() => undefined) };
    }

    if (sql.includes('INSERT INTO Boat_Event')) {
      return { run: jest.fn(() => ({ lastInsertRowid: 1, changes: 1 })) };
    }

    if (sql.includes('INSERT INTO Clubs')) {
      return { run: jest.fn(() => ({ lastInsertRowid: 10, changes: 1 })) };
    }

    if (sql.includes('INSERT INTO Sailors')) {
      return { run: jest.fn(() => ({ lastInsertRowid: 99, changes: 1 })) };
    }

    if (sql.includes('INSERT INTO Boats')) {
      return { run: jest.fn(() => ({ lastInsertRowid: 555, changes: 1 })) };
    }

    return {
      get: jest.fn(() => undefined),
      run: jest.fn(() => ({ changes: 1, lastInsertRowid: 1 })),
      all: jest.fn(() => []),
    };
  }),
  transaction: jest.fn((fn: (...args: any[]) => any) => fn),
};

jest.mock('../../public/Database/DBManager', () => ({
  db: dbMock,
}));

describe('SailorHandler import boat lookup safety', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/SailorHandler');
  });

  beforeEach(() => {
    prepareCalls.length = 0;
    dbMock.prepare.mockClear();
  });

  it('matches existing boat by sail number and country during import', async () => {
    const handler = handlerRegistry.importSailors;

    await handler({}, [
      {
        name: 'Ana',
        surname: 'Ivic',
        birthday: '2000-01-01',
        sail_number: '47',
        country: 'CRO',
        model: 'A',
        club_name: 'Split',
        category_name: 'SENIOR',
        eventId: 5,
      },
    ]);

    const hasSafeLookup = prepareCalls.some((sql) =>
      sql.includes(
        'SELECT boat_id FROM Boats WHERE CAST(sail_number AS TEXT) = ? AND UPPER(country) = UPPER(?)',
      ),
    );

    expect(hasSafeLookup).toBe(true);
  });
});
