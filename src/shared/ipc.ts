/**
 * The IPC contract: every channel between the window and the main process,
 * with what it takes and what it gives back. This is the one place a
 * channel's name and shape are written; everything else is checked against
 * it by the compiler:
 *
 * - main: `handle(channel, listener)` (main/ipcHandlers/handle.ts) only
 *   accepts a channel named here, and its listener must take the channel's
 *   arguments and return its result.
 * - preload: `SQLITE_CHANNELS` (main/preload.ts), the runtime list the
 *   bridge is built from, must list exactly the channels of each group here.
 * - renderer: `api/db.ts` derives every method (`eventDB.readAllEvents()` …)
 *   from `IpcApi` below.
 *
 * The arguments come from the window and are NOT trusted at runtime: a
 * handler still converts them (`Number(raw_event_id)`) and checks them. The
 * types say what a correct caller sends.
 *
 * Adding a channel: one entry here, its name in `SQLITE_CHANNELS`, its
 * `handle()` registration. The compiler points at whichever is missing.
 */
import type { ConversionReport } from './conversionReport';
import type { HeatOverflowPolicy } from './eventSettings';
import type {
  ExportFileRequest,
  ExportPdfRequest,
  ExportResult,
  PrintDocumentRequest,
} from './exportTypes';
import type { FinalSeriesEligibility } from './finalSeriesEligibility';
import type { HistoryAction } from './history/describe';
import type {
  ImportOwnerConflict,
  ImportSailorRow,
  ImportSailorsOptions,
  ImportSailorsResult,
} from './importSailors';
import type {
  ProblemReportRequest,
  ProblemReportResult,
} from './problemReport';
import type {
  CategoryRow,
  ClubRow,
  EntryInput,
  EntryResult,
  EventBoatRow,
  EventRow,
  FinalLeaderboardRow,
  HeatBoatRow,
  HeatRaceScores,
  HeatRaceScoresResult,
  HeatRow,
  HeatType,
  InsertResult,
  LeaderboardEditPreview,
  OverallLeaderboardRow,
  QualifyingLeaderboardRow,
  RaceRow,
  SailorEdit,
  SailorWithDetails,
  SaveRaceOperation,
  SnapshotFileResult,
  SnapshotImportResult,
} from './rows';
import type { BoatScoreExplanation } from './scoring/explain';
import type { TieBreakExplanation } from './scoring/tieBreakTypes';

/** Written as a function type: its parameters and return are the channel's. */
type Channel = (...args: never[]) => unknown;

/** Sailors, clubs, categories and boats (main/ipcHandlers/SailorHandler.ts). */
export interface SailorChannels {
  readAllSailors(): SailorWithDetails[];
  /** The sailor is found through the boat (boat_id), not by name. */
  updateSailor(edit: SailorEdit): {
    sailorChanges: number;
    boatChanges: number;
  };
  readAllCategories(): CategoryRow[];
  readAllClubs(): ClubRow[];
  readAllBoats(): EventBoatRow[];
  /**
   * The preload resolves an `ImportSailorsFailure` instead of throwing when
   * the call fails (the import screen shows it in its summary).
   */
  importSailors(
    rows: ImportSailorRow[],
    options?: ImportSailorsOptions,
  ): ImportSailorsResult;
  /** The rows whose boat is registered to someone else. Reads only. */
  previewSailorImport(rows: ImportSailorRow[]): {
    conflicts: ImportOwnerConflict[];
  };
  /** Club, sailor, boat and entry in one step (main/functions/sailorEntry). */
  enterSailorInEvent(
    entry: EntryInput,
    eventId: number,
    options?: { useRegisteredSailor?: boolean },
  ): EntryResult;
}

/** Events, their entries and history (main/ipcHandlers/EventHandler.ts). */
export interface EventChannels {
  readAllEvents(): EventRow[];
  /** The four settings are normalized; a missing one takes its default. */
  insertEvent(
    name: string,
    location: string,
    startDate: string,
    endDate: string,
    assignmentMode?: string,
    qualifyingDiscardProfile?: string,
    finalDiscardProfile?: string,
    heatOverflowPolicy?: string,
  ): InsertResult;
  /** `lastInsertRowid` is the Boat_Event row (0 if none). */
  associateBoatWithEvent(boatId: number, eventId: number): InsertResult;
  readBoatsByEvent(eventId: number): EventBoatRow[];
  removeBoatFromEvent(boatId: number, eventId: number): void;
  updateEvent(
    eventId: number,
    name: string,
    location: string,
    startDate: string,
    endDate: string,
    assignmentMode?: string,
    qualifyingDiscardProfile?: string,
    finalDiscardProfile?: string,
    heatOverflowPolicy?: string,
  ): { success: true };
  deleteEvent(eventId: number): { success: true };
  /** The event's change history, newest action first. */
  readEventHistory(eventId: number): HistoryAction[];
  /** Undo one result change from the history (refused if overwritten since). */
  revertHistoryAction(
    eventId: number,
    actionId: number,
  ): { success: true; actionId: number | null };
  /**
   * Take the event back to how it was right after one history entry: every
   * later change is put back, all or nothing (a backup is saved first).
   */
  restoreEventToHistoryPoint(
    eventId: number,
    actionId: number,
  ): { success: true; actionId: number | null; undoneActions: number };
  /** The event's logo for the exported documents (a data URL), or null. */
  readEventExportLogo(eventId: number): string | null;
  /** Store (or with null remove) the event's logo. */
  saveEventExportLogo(eventId: number, logo: string | null): { success: true };
  /** What moving the event to regatta-core changed; null: nothing to tell. */
  readConversionReport(eventId: number): ConversionReport | null;
  markConversionReportSeen(eventId: number): { success: true };
}

/**
 * Heats, races, scoring, standings, the Final Series and backups
 * (main/ipcHandlers/HeatRaceHandler.ts and the five files it imports).
 */
export interface HeatRaceChannels {
  readAllHeats(eventId: number): HeatRow[];
  /** A late entry into a heat of the current round; the Heat_Boat rowid. */
  insertHeatBoat(heatId: number, boatId: number): InsertResult;
  createInitialHeatsAtomic(
    eventId: number,
    numHeats: number,
  ): { success: true; createdHeats: number; assignedBoats: number };
  /** Throw the first round away and draw it again, in one transaction. */
  recreateInitialHeatsAtomic(
    eventId: number,
    numHeats: number,
  ): { success: true; createdHeats: number; assignedBoats: number };
  readBoatsByHeat(heatId: number): HeatBoatRow[];
  readAllRaces(heatId: number): RaceRow[];
  /** The next qualifying round (SHRS 3.1 / 3.2), with an SHRS advisory. */
  createNewHeatsBasedOnLeaderboard(eventId: number): {
    success: true;
    advisory?: string;
  };
  undoLastScoredRaceForHeat(heatId: number): {
    success: true;
    heatName: string;
    raceNumber: number;
    removedScores: number;
  };
  undoLatestHeatRedistribution(eventId: number): {
    success: true;
    removedAssignments: number;
    removedHeats: number;
    removedHeatNames: string[];
  };
  transferBoatBetweenHeats(
    fromHeatId: number,
    toHeatId: number,
    boatId: number,
  ): { success: true };
  readLeaderboard(eventId: number): QualifyingLeaderboardRow[];
  /**
   * Each touched race, whole. `updateFinalLeaderboard` is ignored (the
   * standings are worked out on every read).
   */
  saveLeaderboardRaceResultsAtomic(
    eventId: number,
    operations: SaveRaceOperation[],
    updateFinalLeaderboard?: boolean,
  ): { success: true; updatedCount: number };
  /**
   * The rows Save would give for these races (saved, read back, rolled
   * back), or the rules' refusal in words.
   */
  previewLeaderboardEdit(
    eventId: number,
    operations: SaveRaceOperation[],
  ): LeaderboardEditPreview;
  submitHeatRaceScoresAtomic(scores: HeatRaceScores): HeatRaceScoresResult;
  readFinalLeaderboard(eventId: number): FinalLeaderboardRow[];
  readOverallLeaderboard(eventId: number): OverallLeaderboardRow[];
  startFinalSeriesAtomic(
    eventId: number,
    allowOversizeConfirm?: boolean,
    applyShrs43TemporarySecondDiscard?: boolean,
  ): {
    success: true;
    createdHeats: number;
    assignedBoats: number;
    overflowPolicy: HeatOverflowPolicy;
  };
  /** SHRS 5.2: the boats in the largest heat of the series (or of both). */
  getMaxHeatSize(eventId: number, heatType?: HeatType): number;
  explainTieBreak(
    eventId: number,
    boatAId: number,
    boatBId: number,
    finalSeries: boolean,
  ): TieBreakExplanation;
  explainBoatScore(eventId: number, boatId: number): BoatScoreExplanation;
  getFinalSeriesEligibility(eventId: number): FinalSeriesEligibility;
  exportEventSnapshotToFile(eventId: number): SnapshotFileResult;
  restoreEventSnapshotFromFile(eventId: number): SnapshotFileResult;
  /** A backup file added as a new event (another computer, a deleted event). */
  importEventSnapshotFromFile(): SnapshotImportResult;
}

/** Saving and printing the exported documents (main/ipcHandlers/ExportHandler). */
export interface ExportChannels {
  exportDocumentPdf(request: ExportPdfRequest): ExportResult;
  exportDocumentFile(request: ExportFileRequest): ExportResult;
  printDocument(request: PrintDocumentRequest): ExportResult;
}

/** Help > Report a problem (main/ipcHandlers/ProblemReportHandler.ts). */
export interface ProblemReportChannels {
  /** A JPEG data URL of the window, or null. */
  captureProblemScreenshot(): string | null;
  sendProblemReport(request: ProblemReportRequest): ProblemReportResult;
}

/**
 * The invoke channels, grouped as the renderer uses them
 * (`window.electron.sqlite.<group>.<channel>`). A channel name is unique
 * across groups (`ipcMain.handle` knows only the name).
 */
export interface IpcContract {
  sailorDB: SailorChannels;
  eventDB: EventChannels;
  heatRaceDB: HeatRaceChannels;
  exportDB: ExportChannels;
  problemReportDB: ProblemReportChannels;
}

export type IpcGroup = keyof IpcContract;

/** Every invoke channel, whatever its group. */
export interface IpcChannels
  extends
    SailorChannels,
    EventChannels,
    HeatRaceChannels,
    ExportChannels,
    ProblemReportChannels {}

export type IpcChannel = keyof IpcChannels;

/** What a channel takes, after the IPC event. */
export type ChannelArgs<C extends IpcChannel> = Parameters<IpcChannels[C]>;

/** What a channel's handler returns (the window receives it as a promise). */
export type ChannelResult<C extends IpcChannel> = ReturnType<IpcChannels[C]>;

/** The window's view of one group: every channel as an async method. */
export type IpcGroupApi<G extends IpcGroup> = {
  [C in keyof IpcContract[G]]: IpcContract[G][C] extends Channel
    ? (
        ...args: Parameters<IpcContract[G][C]>
      ) => Promise<ReturnType<IpcContract[G][C]>>
    : never;
};

/** `window.electron.sqlite`: every group. */
export type IpcApi = { [G in IpcGroup]: IpcGroupApi<G> };

// --- Messages that are not calls (ipcRenderer.send / webContents.send) -------

/** A window error for the error log (renderer/utils/userFeedback.ts). */
export interface WindowErrorEntry {
  where: string;
  message: string;
  stack?: string;
  ref?: string;
}

/** Whether the automatic backups work; the reason when they do not. */
export interface BackupStatus {
  ok: boolean;
  reason?: string;
}

/** One-way messages the window sends (ipcRenderer.send). The main process
 * reads them as untrusted input. */
export interface WindowToMainMessages {
  'app:logError': (entry: WindowErrorEntry) => void;
}

/** One-way messages the main process sends to the window (webContents.send). */
export interface MainToWindowMessages {
  /** The automatic backups stopped (or work again). */
  'app:backupStatus': (status: BackupStatus) => void;
  /** Help > Report a Problem… in the app menu. */
  'app:openProblemReport': () => void;
}
