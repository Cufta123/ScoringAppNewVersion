/**
 * Where the installed app keeps its data folder (database, backups, logs).
 *
 * The app used to be built under the template's name, so Electron put its
 * data in `<appData>/electron-react-boilerplate`. It is now named
 * "IOM Regatta Manager", which moves Electron's default folder. A computer
 * that already has results in an old folder keeps using that folder, so an
 * update never shows an empty app with the results seemingly gone.
 */
import path from 'path';

export const DB_FILE = 'scoring_app.db';

/** Folder names earlier builds used, newest first. */
export const LEGACY_FOLDERS = ['electron-react-boilerplate', 'ElectronReact'];

export interface DataLocation {
  /** Electron's data folder for this build (`app.getPath('userData')`). */
  userData: string;
  /** The folder the data folders of all apps live in (`app.getPath('appData')`). */
  appData: string;
  exists: (file: string) => boolean;
}

/**
 * The data folder to use: the current one when it already has a database
 * (or when no old one has), else the old folder that has one.
 */
export function resolveDataDir({
  userData,
  appData,
  exists,
}: DataLocation): string {
  if (exists(path.join(userData, DB_FILE))) return userData;
  const legacy = LEGACY_FOLDERS.map((name) => path.join(appData, name)).find(
    (dir) => dir !== userData && exists(path.join(dir, DB_FILE)),
  );
  return legacy || userData;
}

/**
 * Where `npm start` (the app run from this repository, unpackaged) keeps its
 * database, relative to the repository: git-ignored, because it holds real
 * names.
 */
export const DEV_DATA_DIR = path.join('public', 'Database', 'data');

/**
 * Where the webpack dev build (before electron-vite, Nov 2026) kept it: next
 * to its main bundle in .erb/dll, so in practice there and not in
 * DEV_DATA_DIR.
 */
export const LEGACY_DEV_DATA_DIRS = [
  path.join('.erb', 'dll', 'public', 'Database', 'data'),
];

/**
 * The developer's data folder: DEV_DATA_DIR when it has a database (or when
 * no earlier dev folder has), else the earlier one that has, so switching
 * build tools does not hide the developer's data.
 */
export function resolveDevDataDir({
  repoRoot,
  exists,
}: {
  repoRoot: string;
  exists: (file: string) => boolean;
}): string {
  const current = path.join(repoRoot, DEV_DATA_DIR);
  if (exists(path.join(current, DB_FILE))) return current;
  const legacy = LEGACY_DEV_DATA_DIRS.map((dir) =>
    path.join(repoRoot, dir),
  ).find((dir) => exists(path.join(dir, DB_FILE)));
  return legacy || current;
}
