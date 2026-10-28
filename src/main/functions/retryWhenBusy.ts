/**
 * Another process (a backup tool, a second window) can hold the database for a
 * moment: SQLite then fails with SQLITE_BUSY. Writes that matter to a person
 * typing into a form retry a few times before giving up.
 */
const MAX_ATTEMPTS = 5;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function isBusy(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'SQLITE_BUSY';
}

/** Run `operation`; if SQLite is busy, wait 100 ms x attempt and try again. */
export default async function retryWhenBusy<T>(
  operation: () => T,
  attempt = 1,
): Promise<T> {
  try {
    return operation();
  } catch (error) {
    if (isBusy(error) && attempt < MAX_ATTEMPTS) {
      await delay(100 * attempt);
      return retryWhenBusy(operation, attempt + 1);
    }
    throw error;
  }
}
