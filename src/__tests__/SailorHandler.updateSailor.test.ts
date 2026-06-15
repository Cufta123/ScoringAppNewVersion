export {};

// Regression tests for updateSailor record resolution:
//  - the sailor is resolved via the unique boat_id, never by name+surname
//    (which could edit the wrong same-named sailor);
//  - a club rename matches an existing club by name AND country before
//    creating a new one (same club name can exist in different countries).

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
const calls = {
  updateSailorArgs: null as any[] | null,
  updateBoatArgs: null as any[] | null,
  insertClubArgs: null as any[] | null,
};
// Per-test control of whether a club already exists for the (name, country).
const state = {
  existingClubByNameCountry: undefined as { club_id: number } | undefined,
};

const dbMock = {
  transaction: jest.fn((fn: (...args: any[]) => any) => fn),
  prepare: jest.fn((sql: string): PrepareStatement => {
    prepareCalls.push(sql);
    const flat = sql.replace(/\s+/g, ' ').trim();

    if (
      flat.includes('FROM Boats b JOIN Sailors s') &&
      flat.includes('WHERE b.boat_id = ?')
    ) {
      return { get: () => ({ sailor_id: 7, club_id: 3 }) };
    }
    if (flat.includes('SELECT category_id FROM Categories')) {
      return { get: () => ({ category_id: 2 }) };
    }
    if (
      flat.includes(
        'SELECT club_id FROM Clubs WHERE club_name = ? AND country = ?',
      )
    ) {
      return { get: () => state.existingClubByNameCountry };
    }
    if (flat.includes('INSERT INTO Clubs')) {
      return {
        run: (...args: any[]) => {
          calls.insertClubArgs = args;
          return { lastInsertRowid: 42, changes: 1 };
        },
      };
    }
    if (flat.startsWith('UPDATE Sailors SET')) {
      return {
        run: (...args: any[]) => {
          calls.updateSailorArgs = args;
          return { changes: 1 };
        },
      };
    }
    if (flat.startsWith('UPDATE Boats SET')) {
      return {
        run: (...args: any[]) => {
          calls.updateBoatArgs = args;
          return { changes: 1 };
        },
      };
    }
    return { get: () => undefined, run: () => ({ changes: 1 }), all: () => [] };
  }),
};

jest.mock('../../public/Database/DBManager', () => ({ db: dbMock }));

describe('SailorHandler updateSailor record resolution', () => {
  beforeAll(() => {
    require('../main/ipcHandlers/SailorHandler');
  });

  beforeEach(() => {
    prepareCalls.length = 0;
    calls.updateSailorArgs = null;
    calls.updateBoatArgs = null;
    calls.insertClubArgs = null;
    state.existingClubByNameCountry = undefined;
  });

  const baseData = {
    originalName: 'John',
    originalSurname: 'Doe',
    name: 'John',
    surname: 'Doe',
    category_name: 'SENIOR',
    club_name: 'YC Split',
    originalClubName: 'YC Split',
    boat_id: 555,
    sail_number: '47',
    country: 'CRO',
    model: 'IOM',
  };

  it('resolves the sailor by boat_id, never by name and surname', async () => {
    await handlerRegistry.updateSailor({}, { ...baseData });

    // The old, ambiguous lookup must be gone.
    const usesNameLookup = prepareCalls.some((sql) =>
      sql.replace(/\s+/g, ' ').includes('WHERE name = ? AND surname = ?'),
    );
    expect(usesNameLookup).toBe(false);

    // Sailor updated using the id resolved from the boat (7), keeping the
    // current club (3) since the club name did not change.
    expect(calls.updateSailorArgs).toEqual(['John', 'Doe', 2, 3, 7]);
    expect(calls.insertClubArgs).toBeNull();
  });

  it('reuses an existing club matched by name AND country on rename', async () => {
    state.existingClubByNameCountry = { club_id: 9 };

    await handlerRegistry.updateSailor(
      {},
      { ...baseData, club_name: 'YC Zagreb' },
    );

    const usesNameCountryLookup = prepareCalls.some((sql) =>
      sql
        .replace(/\s+/g, ' ')
        .includes(
          'SELECT club_id FROM Clubs WHERE club_name = ? AND country = ?',
        ),
    );
    expect(usesNameCountryLookup).toBe(true);
    // Matched existing club 9, did not insert a duplicate.
    expect(calls.insertClubArgs).toBeNull();
    expect(calls.updateSailorArgs).toEqual(['John', 'Doe', 2, 9, 7]);
  });

  it('creates a new club when none matches the name and country', async () => {
    state.existingClubByNameCountry = undefined;

    await handlerRegistry.updateSailor(
      {},
      { ...baseData, club_name: 'YC Rijeka' },
    );

    expect(calls.insertClubArgs).toEqual(['YC Rijeka', 'CRO']);
    // New club id (42) is what the sailor is updated with.
    expect(calls.updateSailorArgs).toEqual(['John', 'Doe', 2, 42, 7]);
  });
});
