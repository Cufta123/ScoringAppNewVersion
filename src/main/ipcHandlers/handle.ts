import { ipcMain, IpcMainInvokeEvent } from 'electron';

/**
 * Registers an `ipcMain.handle` listener that logs and rethrows on failure.
 *
 * Every handler used to repeat the same five lines:
 *
 *     } catch (error) {
 *       console.error('Error reading all heats:', error);
 *       throw error;
 *     }
 *
 * That was 45 hand-written copies across the three handler files, and it was
 * applied unevenly — some handlers logged the error object, some only
 * `(error as Error).message` (discarding the stack), and several had no catch
 * at all, so whether a failure was logged depended on which file the channel
 * happened to live in.
 *
 * The channel name is logged automatically, so the message is derived rather
 * than hand-written and cannot drift from the channel it describes.
 *
 * Handlers whose catch does more than log-and-rethrow — SQLITE_BUSY retry
 * loops, assignment-snapshot rollback, per-row import error collection — keep
 * their own inner try/catch and register through this wrapper as well, so the
 * rethrow path stays uniform for everything they choose to propagate.
 */
export interface CallObserver<Mark = unknown> {
  before: (channel: string) => Mark;
  after: (mark: Mark, channel: string) => void;
}

let observer: CallObserver<any> | null = null;

/**
 * Watch every IPC call: `before` runs as a call starts and `after` once it has
 * finished, failed or not. The app uses it to group what each call wrote in
 * the change journal (src/main/functions/changeJournal.ts). Unit tests leave
 * it unset, so their mocked databases are never asked about the journal.
 */
export function setCallObserver<Mark>(next: CallObserver<Mark> | null): void {
  observer = next;
}

export default function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: any[]) => {
    const watching = observer;
    const mark = watching?.before(channel);
    try {
      return await listener(event, ...args);
    } catch (error) {
      console.error(`IPC "${channel}" failed:`, error);
      throw error;
    } finally {
      try {
        watching?.after(mark, channel);
      } catch (error) {
        // The call itself went through; a failure to group its history must
        // not turn it into an error for the user.
        console.error(`Journal grouping for "${channel}" failed:`, error);
      }
    }
  });
}
