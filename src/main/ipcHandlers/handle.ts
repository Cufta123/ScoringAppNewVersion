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
export default function handle(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: any[]) => {
    try {
      return await listener(event, ...args);
    } catch (error) {
      console.error(`IPC "${channel}" failed:`, error);
      throw error;
    }
  });
}
