// Thin data-access layer over the preload bridge.
//
// Components and hooks import the API group they need (sailorDB / eventDB /
// heatRaceDB) instead of reaching into `window.electron.sqlite.*` directly.
// This keeps the preload shape referenced in exactly one place, so the IPC
// surface can change without touching every call site, and it makes the data
// dependencies of a module obvious from its imports.
//
// Each method is resolved lazily at call time, so the bridge does not need to
// exist at module-load and tests that assign `window.electron` per test still
// work unchanged.
//
// Every method's arguments and result come from the IPC contract
// (src/shared/ipc.ts), the one place a channel is written down; nothing here
// is declared by hand.

import type { IpcApi, IpcGroup, IpcGroupApi } from '../../shared/ipc';

export type { ImportSailorsResult } from '../../shared/importSailors';
export type {
  EntryInput as SailorEntryInput,
  EntryResult as SailorEntryResult,
  SnapshotFileResult,
} from '../../shared/rows';

export type SailorDB = IpcGroupApi<'sailorDB'>;
export type EventDB = IpcGroupApi<'eventDB'>;
export type HeatRaceDB = IpcGroupApi<'heatRaceDB'>;
/** Saving and printing the exported documents (main/ipcHandlers/ExportHandler). */
export type ExportDB = IpcGroupApi<'exportDB'>;
export type ProblemReportDB = IpcGroupApi<'problemReportDB'>;

type UntypedGroup = Record<string, (...args: unknown[]) => Promise<unknown>>;

function makeGroup<G extends IpcGroup>(groupName: G): IpcApi[G] {
  return new Proxy({} as IpcApi[G], {
    get(_target, method) {
      return (...args: unknown[]) =>
        (window.electron.sqlite[groupName] as unknown as UntypedGroup)[
          method as string
        ](...args);
    },
  });
}

export const sailorDB: SailorDB = makeGroup('sailorDB');
export const eventDB: EventDB = makeGroup('eventDB');
export const heatRaceDB: HeatRaceDB = makeGroup('heatRaceDB');
export const exportDB: ExportDB = makeGroup('exportDB');
export const problemReportDB: ProblemReportDB = makeGroup('problemReportDB');

/** Whether the preload offers the recovery-backup export (older builds may not). */
export const canExportEventSnapshot = (): boolean =>
  typeof window?.electron?.sqlite?.heatRaceDB?.exportEventSnapshotToFile ===
  'function';
