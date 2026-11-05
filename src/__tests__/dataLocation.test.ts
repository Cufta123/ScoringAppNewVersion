/** @jest-environment node */
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolveDataDir,
  resolveDevDataDir,
} = require('../main/database/dataLocation');

const appData = path.join('/Users', 'race', 'AppData', 'Roaming');
const userData = path.join(appData, 'IOM Regatta Manager');
const legacy = path.join(appData, 'electron-react-boilerplate');

const withDatabasesIn =
  (...dirs: string[]) =>
  (file: string) =>
    dirs.some((dir) => file === path.join(dir, 'scoring_app.db'));

describe('resolveDataDir', () => {
  it('keeps using the old folder when the results are there', () => {
    expect(
      resolveDataDir({ userData, appData, exists: withDatabasesIn(legacy) }),
    ).toBe(legacy);
  });

  it('uses the new folder once it has a database', () => {
    expect(
      resolveDataDir({
        userData,
        appData,
        exists: withDatabasesIn(userData, legacy),
      }),
    ).toBe(userData);
  });

  it('starts in the new folder on a new computer', () => {
    expect(resolveDataDir({ userData, appData, exists: () => false })).toBe(
      userData,
    );
  });
});

describe('resolveDevDataDir', () => {
  const repoRoot = path.join('/Users', 'dev', 'ScoringApp');
  const current = path.join(repoRoot, 'public', 'Database', 'data');
  const webpackDev = path.join(
    repoRoot,
    '.erb',
    'dll',
    'public',
    'Database',
    'data',
  );

  it('keeps the database the webpack dev build left in .erb/dll', () => {
    expect(
      resolveDevDataDir({ repoRoot, exists: withDatabasesIn(webpackDev) }),
    ).toBe(webpackDev);
  });

  it('uses public/Database/data once it has a database', () => {
    expect(
      resolveDevDataDir({
        repoRoot,
        exists: withDatabasesIn(current, webpackDev),
      }),
    ).toBe(current);
  });

  it('starts in public/Database/data in a fresh checkout', () => {
    expect(resolveDevDataDir({ repoRoot, exists: () => false })).toBe(current);
  });
});
