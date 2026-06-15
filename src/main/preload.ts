/* eslint-disable no-console */
/* eslint-disable camelcase */
// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// Keep this union in sync with the channels registered via `ipcMain.handle`/
// `ipcMain.on` in `src/main` and `src/main/ipcHandlers`. It is enforced on
// every `invokeChannel`/`makeInvoker` call below, so an out-of-sync entry fails
// the build.
export type Channels =
  | 'ipc-example'
  | 'dialog:openFile'
  | 'readAllSailors'
  | 'updateSailor'
  | 'readBoatsByHeat'
  | 'insertSailor'
  | 'readAllCategories'
  | 'readAllClubs'
  | 'insertClub'
  | 'insertBoat'
  | 'readAllBoats'
  | 'readAllEvents'
  | 'insertEvent'
  | 'associateBoatWithEvent'
  | 'readBoatsByEvent'
  | 'removeBoatFromEvent'
  | 'readAllHeats'
  | 'insertHeat'
  | 'insertHeatBoat'
  | 'readAllRaces'
  | 'insertRace'
  | 'readAllScores'
  | 'insertScore'
  | 'updateScore'
  | 'deleteScore'
  | 'deleteHeatsByEvent'
  | 'updateEventLeaderboard'
  | 'updateGlobalLeaderboard'
  | 'createNewHeatsBasedOnLeaderboard'
  | 'undoLastScoredRaceForHeat'
  | 'undoLastScoredRace'
  | 'undoLatestHeatRedistribution'
  | 'transferBoatBetweenHeats'
  | 'readLeaderboard'
  | 'readGlobalLeaderboard'
  | 'updateFinalLeaderboard'
  | 'readFinalLeaderboard'
  | 'readOverallLeaderboard'
  | 'startFinalSeriesAtomic'
  | 'updateEvent'
  | 'deleteEvent'
  | 'updateRaceResult'
  | 'saveLeaderboardRaceResultsAtomic'
  | 'submitHeatRaceScoresAtomic'
  | 'getMaxHeatSize'
  | 'explainTieBreak'
  | 'exportEventSnapshotToFile'
  | 'restoreEventSnapshotFromFile'
  | 'importSailors';

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage;
    }
  }
  return 'Unknown IPC error.';
};

// Typed wrapper around ipcRenderer.invoke. Restricting the channel to the
// `Channels` union makes the contract compile-time enforced: invoking a channel
// that no main-process handler registers becomes a type error.
const invokeChannel = (channel: Channels, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, ...args);

// Factory for the common case: forward args to a channel and let any IPC
// rejection propagate to the caller. Centralising this removes ~40 copies of
// identical try/catch boilerplate and keeps error handling consistent (callers
// always see a thrown error, never a `false` sentinel).
const makeInvoker =
  (channel: Channels) =>
  (...args: unknown[]): Promise<any> =>
    invokeChannel(channel, ...args);

// Wraps every exposed sqlite method so a resolved `false` (legacy failure
// signal from some handlers) is converted to a thrown error, and any failure is
// logged once, centrally, for diagnostics.
const wrapSqliteApi = <T extends Record<string, any>>(api: T): T => {
  const wrapped = {} as T;

  Object.entries(api).forEach(([groupName, groupValue]) => {
    if (!groupValue || typeof groupValue !== 'object') {
      (wrapped as Record<string, any>)[groupName] = groupValue;
      return;
    }

    const wrappedGroup: Record<string, any> = {};
    Object.entries(groupValue as Record<string, any>).forEach(
      ([methodName, methodValue]) => {
        if (typeof methodValue !== 'function') {
          wrappedGroup[methodName] = methodValue;
          return;
        }

        wrappedGroup[methodName] = async (...args: unknown[]) => {
          try {
            const result = await methodValue(...args);
            if (result === false) {
              throw new Error(`Operation failed: ${groupName}.${methodName}`);
            }
            return result;
          } catch (error) {
            console.error(`IPC error in ${groupName}.${methodName}:`, error);
            throw error;
          }
        };
      },
    );

    (wrapped as Record<string, any>)[groupName] = wrappedGroup;
  });

  return wrapped;
};

const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: Channels, ...args: unknown[]) {
      ipcRenderer.send(channel, ...args);
    },
    on(channel: Channels, func: (...args: unknown[]) => void) {
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: Channels, func: (...args: unknown[]) => void) {
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
  },
  sqlite: {
    sailorDB: {
      readAllSailors: makeInvoker('readAllSailors'),
      updateSailor: makeInvoker('updateSailor'),
      insertSailor: makeInvoker('insertSailor'),
      insertClub: makeInvoker('insertClub'),
      insertBoat: makeInvoker('insertBoat'),
      readAllCategories: makeInvoker('readAllCategories'),
      readAllClubs: makeInvoker('readAllClubs'),
      readAllBoats: makeInvoker('readAllBoats'),
      // Special-cased: callers render the returned summary object even on
      // failure, so resolve a zero-result shape instead of throwing.
      async importSailors(rows: unknown[]) {
        try {
          return await invokeChannel('importSailors', rows);
        } catch (error) {
          console.error('Error invoking importSailors IPC:', error);
          return { imported: 0, skipped: 0, errors: [toErrorMessage(error)] };
        }
      },
    },
    eventDB: {
      readAllEvents: makeInvoker('readAllEvents'),
      insertEvent: makeInvoker('insertEvent'),
      associateBoatWithEvent: makeInvoker('associateBoatWithEvent'),
      readBoatsByEvent: makeInvoker('readBoatsByEvent'),
      removeBoatFromEvent: makeInvoker('removeBoatFromEvent'),
      updateEvent: makeInvoker('updateEvent'),
      deleteEvent: makeInvoker('deleteEvent'),
    },
    heatRaceDB: {
      readAllHeats: makeInvoker('readAllHeats'),
      insertHeat: makeInvoker('insertHeat'),
      deleteHeatsByEvent: makeInvoker('deleteHeatsByEvent'),
      insertHeatBoat: makeInvoker('insertHeatBoat'),
      readBoatsByHeat: makeInvoker('readBoatsByHeat'),
      readAllRaces: makeInvoker('readAllRaces'),
      insertRace: makeInvoker('insertRace'),
      readAllScores: makeInvoker('readAllScores'),
      insertScore: makeInvoker('insertScore'),
      updateScore: makeInvoker('updateScore'),
      deleteScore: makeInvoker('deleteScore'),
      updateEventLeaderboard: makeInvoker('updateEventLeaderboard'),
      updateGlobalLeaderboard: makeInvoker('updateGlobalLeaderboard'),
      createNewHeatsBasedOnLeaderboard: makeInvoker(
        'createNewHeatsBasedOnLeaderboard',
      ),
      undoLastScoredRaceForHeat: makeInvoker('undoLastScoredRaceForHeat'),
      undoLastScoredRace: makeInvoker('undoLastScoredRace'),
      undoLatestHeatRedistribution: makeInvoker('undoLatestHeatRedistribution'),
      transferBoatBetweenHeats: makeInvoker('transferBoatBetweenHeats'),
      readLeaderboard: makeInvoker('readLeaderboard'),
      readGlobalLeaderboard: makeInvoker('readGlobalLeaderboard'),
      updateFinalLeaderboard: makeInvoker('updateFinalLeaderboard'),
      updateRaceResult: makeInvoker('updateRaceResult'),
      saveLeaderboardRaceResultsAtomic: makeInvoker(
        'saveLeaderboardRaceResultsAtomic',
      ),
      submitHeatRaceScoresAtomic: makeInvoker('submitHeatRaceScoresAtomic'),
      readFinalLeaderboard: makeInvoker('readFinalLeaderboard'),
      readOverallLeaderboard: makeInvoker('readOverallLeaderboard'),
      startFinalSeriesAtomic: makeInvoker('startFinalSeriesAtomic'),
      getMaxHeatSize: makeInvoker('getMaxHeatSize'),
      explainTieBreak: makeInvoker('explainTieBreak'),
      exportEventSnapshotToFile: makeInvoker('exportEventSnapshotToFile'),
      restoreEventSnapshotFromFile: makeInvoker('restoreEventSnapshotFromFile'),
    },
  },
};

const wrappedElectronHandler = {
  ...electronHandler,
  sqlite: wrapSqliteApi(electronHandler.sqlite),
};

contextBridge.exposeInMainWorld('electron', wrappedElectronHandler);

export type ElectronHandler = typeof wrappedElectronHandler;
