/* eslint-disable no-console */
// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

/**
 * Every sqlite channel, grouped exactly as the renderer consumes them
 * (`window.electron.sqlite.<group>.<channel>`).
 *
 * This list is the single source: the `Channels` union and the invoker map
 * below are both derived from it, so they cannot disagree. Adding a channel
 * means adding one string here, plus its `handle()` registration in
 * `src/main/ipcHandlers` and its typed signature in `src/renderer/api/db.ts`.
 */
const SQLITE_CHANNELS = {
  sailorDB: [
    'readAllSailors',
    'updateSailor',
    'insertSailor',
    'insertClub',
    'insertBoat',
    'readAllCategories',
    'readAllClubs',
    'readAllBoats',
    'importSailors',
  ],
  eventDB: [
    'readAllEvents',
    'insertEvent',
    'associateBoatWithEvent',
    'readBoatsByEvent',
    'removeBoatFromEvent',
    'updateEvent',
    'deleteEvent',
  ],
  heatRaceDB: [
    'readAllHeats',
    'insertHeat',
    'deleteHeatsByEvent',
    'insertHeatBoat',
    'createInitialHeatsAtomic',
    'recreateInitialHeatsAtomic',
    'readBoatsByHeat',
    'readAllRaces',
    'insertRace',
    'readAllScores',
    'insertScore',
    'updateScore',
    'deleteScore',
    'updateEventLeaderboard',
    'createNewHeatsBasedOnLeaderboard',
    'undoLastScoredRaceForHeat',
    'undoLastScoredRace',
    'undoLatestHeatRedistribution',
    'transferBoatBetweenHeats',
    'readLeaderboard',
    'updateFinalLeaderboard',
    'updateRaceResult',
    'saveLeaderboardRaceResultsAtomic',
    'submitHeatRaceScoresAtomic',
    'readFinalLeaderboard',
    'readOverallLeaderboard',
    'startFinalSeriesAtomic',
    'getMaxHeatSize',
    'explainTieBreak',
    'getFinalSeriesEligibility',
    'exportEventSnapshotToFile',
    'restoreEventSnapshotFromFile',
  ],
} as const;

type SqliteChannelGroups = typeof SQLITE_CHANNELS;
type SqliteChannel = SqliteChannelGroups[keyof SqliteChannelGroups][number];

/**
 * Channels the renderer may invoke. `dialog:openFile` is registered in
 * `main.ts` rather than a sqlite handler, so it is listed separately.
 */
export type Channels = 'dialog:openFile' | SqliteChannel;

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

type Invoker = (...args: unknown[]) => Promise<any>;

type SqliteApi = {
  [Group in keyof SqliteChannelGroups]: {
    [Channel in SqliteChannelGroups[Group][number]]: Invoker;
  };
};

const sqlite = Object.fromEntries(
  Object.entries(SQLITE_CHANNELS).map(([group, channels]) => [
    group,
    Object.fromEntries(
      (channels as readonly Channels[]).map((channel) => [
        channel,
        makeInvoker(channel),
      ]),
    ),
  ]),
) as SqliteApi;

// Special-cased: callers render the returned summary object even on failure,
// so this resolves a zero-result shape instead of throwing.
sqlite.sailorDB.importSailors = async (...args: unknown[]) => {
  try {
    return await invokeChannel('importSailors', ...args);
  } catch (error) {
    console.error('Error invoking importSailors IPC:', error);
    return { imported: 0, skipped: 0, errors: [toErrorMessage(error)] };
  }
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
  sqlite,
};

const wrappedElectronHandler = {
  ...electronHandler,
  sqlite: wrapSqliteApi(electronHandler.sqlite),
};

contextBridge.exposeInMainWorld('electron', wrappedElectronHandler);

export type ElectronHandler = typeof wrappedElectronHandler;
