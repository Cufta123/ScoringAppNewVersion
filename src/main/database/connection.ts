/**
 * The part of a SQLite connection the schema, journal and backup code use.
 *
 * Only `exec` and `prepare(...).get/all/run`, so the same code runs on
 * better-sqlite3 in the app and on node:sqlite (`DatabaseSync`) in the tests
 * (`schema.migrations.test.ts` and the integration tests run the real
 * migrations). The app's handlers use the full better-sqlite3 type (`Db` in
 * DBManager.ts) instead.
 */
export interface SqlStatement {
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

export interface SqlConnection {
  exec(sql: string): unknown;
  prepare(sql: string): SqlStatement;
}

/** A `PRAGMA table_info` / `PRAGMA index_info` row (the columns used). */
export interface ColumnInfoRow {
  name: string;
}

/** A `PRAGMA index_list` row (the columns used). */
export interface IndexListRow {
  name: string;
  unique: number;
}
