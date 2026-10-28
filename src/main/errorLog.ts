import fs from 'fs';
import path from 'path';

/**
 * A plain-text log of every error, next to the database (logs/errors.log),
 * so a problem met at the regatta can be looked at afterwards: the screen
 * shows the user a reference code, the log holds the details under it.
 *
 * Nothing is sent anywhere. The file is capped at about 1 MB; the previous
 * one is kept as errors.1.log. Logging must never fail the action it
 * describes, so every write is best effort.
 */

const MAX_BYTES = 1024 * 1024;

let logDir: string | null = null;
let appVersion = '';

export function setErrorLogDir(dir: string, version = ''): void {
  logDir = dir;
  appVersion = version;
}

export function errorLogDir(): string | null {
  return logDir;
}

export function errorLogFile(): string | null {
  return logDir ? path.join(logDir, 'errors.log') : null;
}

function detailOf(error: unknown): string {
  if (error instanceof Error) {
    const { code } = error as { code?: unknown };
    return `${error.stack || `${error.name}: ${error.message}`}${
      code ? `\n  code: ${String(code)}` : ''
    }`;
  }
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/** Append one entry. `where` says what was going on ("IPC \"x\"", "window"). */
export function logError(
  where: string,
  error: unknown,
  { ref, kind }: { ref?: string; kind?: string } = {},
): void {
  // eslint-disable-next-line no-console
  console.error(`${where}${ref ? ` [${ref}]` : ''}:`, error);
  const file = errorLogFile();
  if (!file || !logDir) return;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    try {
      if (fs.statSync(file).size > MAX_BYTES) {
        fs.renameSync(file, path.join(logDir, 'errors.1.log'));
      }
    } catch {
      // No log yet.
    }
    const head = [
      new Date().toISOString(),
      ref ? `ref ${ref}` : null,
      kind ?? null,
      appVersion ? `v${appVersion}` : null,
      where,
    ]
      .filter(Boolean)
      .join(' | ');
    fs.appendFileSync(file, `${head}\n${detailOf(error)}\n\n`, 'utf8');
  } catch (writeError) {
    // eslint-disable-next-line no-console
    console.error('Could not write the error log:', writeError);
  }
}
