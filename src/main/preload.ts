// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { explainError } from '../shared/errors/explainError';
import type {
  BackupStatus,
  IpcApi,
  IpcChannel,
  IpcContract,
  IpcGroup,
  MainToWindowMessages,
  WindowErrorEntry,
  WindowToMainMessages,
} from '../shared/ipc';

/** Each group's channel names, as the contract has them. */
type ChannelNamesByGroup = {
  [G in IpcGroup]: readonly (keyof IpcContract[G])[];
};

/**
 * Every invoke channel, grouped exactly as the renderer consumes them
 * (`window.electron.sqlite.<group>.<channel>`): the runtime copy of the
 * contract's names (src/shared/ipc.ts), which the bridge is built from. The
 * check below makes it list exactly the contract's channels, group by group.
 */
const SQLITE_CHANNELS = {
  sailorDB: [
    'readAllSailors',
    'updateSailor',
    'readAllCategories',
    'readAllClubs',
    'readAllBoats',
    'importSailors',
    'previewSailorImport',
    'enterSailorInEvent',
  ],
  eventDB: [
    'readAllEvents',
    'insertEvent',
    'associateBoatWithEvent',
    'readBoatsByEvent',
    'removeBoatFromEvent',
    'updateEvent',
    'deleteEvent',
    'readEventHistory',
    'revertHistoryAction',
    'restoreEventToHistoryPoint',
    'readEventExportLogo',
    'saveEventExportLogo',
    'readConversionReport',
    'markConversionReportSeen',
  ],
  heatRaceDB: [
    'readAllHeats',
    'insertHeatBoat',
    'createInitialHeatsAtomic',
    'recreateInitialHeatsAtomic',
    'readBoatsByHeat',
    'readAllRaces',
    'createNewHeatsBasedOnLeaderboard',
    'undoLastScoredRaceForHeat',
    'undoLatestHeatRedistribution',
    'transferBoatBetweenHeats',
    'readLeaderboard',
    'saveLeaderboardRaceResultsAtomic',
    'previewLeaderboardEdit',
    'submitHeatRaceScoresAtomic',
    'readFinalLeaderboard',
    'readOverallLeaderboard',
    'startFinalSeriesAtomic',
    'getMaxHeatSize',
    'explainTieBreak',
    'explainBoatScore',
    'getFinalSeriesEligibility',
    'exportEventSnapshotToFile',
    'restoreEventSnapshotFromFile',
    'importEventSnapshotFromFile',
  ],
  exportDB: ['exportDocumentPdf', 'exportDocumentFile', 'printDocument'],
  problemReportDB: ['captureProblemScreenshot', 'sendProblemReport'],
} as const satisfies ChannelNamesByGroup;

type Listed<G extends IpcGroup> = (typeof SQLITE_CHANNELS)[G][number];

/**
 * Compile-time check: a channel of the contract that is not listed above
 * (it would not be exposed), or listed but not in the contract, names
 * itself in a "does not satisfy the constraint 'never'" error here.
 */
type ExactlyTheContract<Problem extends never> = Problem;
type _ChannelListCheck = ExactlyTheContract<
  {
    [G in IpcGroup]:
      | Exclude<keyof IpcContract[G], Listed<G>>
      | Exclude<Listed<G>, keyof IpcContract[G]>;
  }[IpcGroup]
>;

/** Channels the renderer may invoke. */
export type Channels = IpcChannel;

/** The import summary says why, in words the user can act on. */
const toErrorMessage = (error: unknown): string => explainError(error).message;

// The bridge forwards arguments and results untouched; their types are the
// contract's (`SqliteApi` below).
type Invoker = (...args: unknown[]) => Promise<unknown>;

// Typed wrapper around ipcRenderer.invoke. Restricting the channel to the
// `Channels` union makes the contract compile-time enforced: invoking a channel
// that no main-process handler registers becomes a type error.
const invokeChannel = (
  channel: Channels,
  ...args: unknown[]
): Promise<unknown> => ipcRenderer.invoke(channel, ...args);

// Factory for the common case: forward args to a channel and let any IPC
// rejection propagate to the caller. Centralising this removes ~40 copies of
// identical try/catch boilerplate and keeps error handling consistent (callers
// always see a thrown error, never a `false` sentinel).
const makeInvoker =
  (channel: Channels): Invoker =>
  (...args) =>
    invokeChannel(channel, ...args);

// Wraps every exposed sqlite method so a resolved `false` (legacy failure
// signal from some handlers) is converted to a thrown error. Failures are
// logged once, in the main process, by `handle()`.
const wrapSqliteApi = <T extends object>(api: T): T => {
  const wrapped: Record<string, unknown> = {};

  Object.entries(api).forEach(([groupName, groupValue]) => {
    if (!groupValue || typeof groupValue !== 'object') {
      wrapped[groupName] = groupValue;
      return;
    }

    const wrappedGroup: Record<string, unknown> = {};
    Object.entries(groupValue as Record<string, unknown>).forEach(
      ([methodName, methodValue]) => {
        if (typeof methodValue !== 'function') {
          wrappedGroup[methodName] = methodValue;
          return;
        }

        wrappedGroup[methodName] = async (...args: unknown[]) => {
          const result = await (methodValue as Invoker)(...args);
          if (result === false) {
            throw new Error(`Operation failed: ${groupName}.${methodName}`);
          }
          return result;
        };
      },
    );

    wrapped[groupName] = wrappedGroup;
  });

  return wrapped as T;
};

/** Every channel as an async method, typed by the contract. */
type SqliteApi = IpcApi;

const sqlite = Object.fromEntries(
  Object.entries(SQLITE_CHANNELS).map(([group, channels]) => [
    group,
    Object.fromEntries(
      (channels as readonly IpcChannel[]).map((channel) => [
        channel,
        makeInvoker(channel),
      ]),
    ),
  ]),
) as SqliteApi;

// Special-cased: callers render the returned summary object even on failure,
// so this resolves a zero-result shape (ImportSailorsFailure) instead of
// throwing.
const invokeImportSailors = sqlite.sailorDB.importSailors;
sqlite.sailorDB.importSailors = async (...args) => {
  try {
    return await invokeImportSailors(...args);
  } catch (error) {
    return { imported: 0, skipped: 0, errors: [toErrorMessage(error)] };
  }
};

/** Send one of the window's one-way messages (shared/ipc.ts). */
const sendToMain = <M extends keyof WindowToMainMessages>(
  message: M,
  ...args: Parameters<WindowToMainMessages[M]>
) => ipcRenderer.send(message, ...args);

/** Listen to one message from the main process; returns the unsubscribe. */
const onMainMessage = <M extends keyof MainToWindowMessages>(
  message: M,
  listener: (...args: Parameters<MainToWindowMessages[M]>) => void,
) => {
  const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
    listener(...(args as Parameters<MainToWindowMessages[M]>));
  ipcRenderer.on(message, subscription);
  return () => {
    ipcRenderer.removeListener(message, subscription);
  };
};

/**
 * Messages between the window and the app that are not database calls: the
 * window's own errors go to the error log (src/main/errorLog.ts), and the app
 * tells the window when the automatic backups stop working (or work again).
 */
const appEvents = {
  logError(entry: WindowErrorEntry) {
    sendToMain('app:logError', entry);
  },
  onBackupStatus(listener: (status: BackupStatus) => void) {
    return onMainMessage('app:backupStatus', (status) => listener(status));
  },
  /** Help > Report a Problem… in the app menu. */
  onOpenProblemReport(listener: () => void) {
    return onMainMessage('app:openProblemReport', () => listener());
  },
};

const electronHandler = {
  appEvents,
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
