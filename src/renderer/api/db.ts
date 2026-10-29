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
// The preload bridge types every method as `Promise<any>`; the interfaces below
// are the renderer's typed view of that contract. Keep them in sync with the
// handler return shapes (see `src/main/ipcHandlers/*`). Where a return shape is
// genuinely dynamic / not yet modelled, it is typed `unknown` so callers must
// narrow rather than silently inheriting `any`.

import type { BoatScoreExplanation } from '../../shared/scoring/explain';
import type {
  CategoryRow,
  ClubRow,
  EventBoatRow,
  EventRow,
  HeatBoatRow,
  HeatRow,
  InsertResult,
  OverallLeaderboardEntry,
  RaceRow,
  RawLeaderboardEntry,
  SailorWithDetails,
  TieBreakResult,
} from '../types';
import type { HistoryAction } from '../../shared/history/describe';
import type { ImportSailorsSummary } from '../../shared/importSailors';
import type {
  ExportFileRequest,
  ExportPdfRequest,
  ExportResult,
  PrintDocumentRequest,
} from '../../shared/exportTypes';

/**
 * Result of a bulk sailor import (shared/importSailors). Every field is
 * optional here: the preload's error fallback reports only imported, skipped
 * and errors.
 */
export type ImportSailorsResult = Partial<ImportSailorsSummary>;

export interface SailorDB {
  readAllSailors(): Promise<SailorWithDetails[]>;
  readAllCategories(): Promise<CategoryRow[]>;
  readAllClubs(): Promise<ClubRow[]>;
  readAllBoats(): Promise<EventBoatRow[]>;
  insertSailor(
    name: string,
    surname: string,
    birthday: string,
    categoryId: number | null | undefined,
    clubId: number | null | undefined,
  ): Promise<InsertResult>;
  updateSailor(sailor: Record<string, unknown>): Promise<unknown>;
  insertClub(clubName: string, country: string): Promise<InsertResult>;
  insertBoat(
    sailNumber: string | number,
    country: string,
    model: string,
    sailorId: number | null | undefined,
  ): Promise<InsertResult>;
  importSailors(rows: unknown[]): Promise<ImportSailorsResult>;
}

export interface EventDB {
  readAllEvents(): Promise<EventRow[]>;
  readBoatsByEvent(eventId: number): Promise<EventBoatRow[]>;
  insertEvent(
    name: string,
    location: string,
    startDate: string,
    endDate: string,
    assignmentMode: string,
    qualifyingDiscardProfile: string,
    finalDiscardProfile: string,
    heatOverflowPolicy: string,
  ): Promise<InsertResult>;
  updateEvent(
    eventId: number,
    name: string,
    location: string,
    startDate: string,
    endDate: string,
    assignmentMode: string,
    qualifyingDiscardProfile: string,
    finalDiscardProfile: string,
    heatOverflowPolicy: string,
  ): Promise<unknown>;
  deleteEvent(eventId: number): Promise<unknown>;
  /** The event's change history, newest action first. */
  readEventHistory(eventId: number): Promise<HistoryAction[]>;
  /** Undo one result change from the history (refused if overwritten since). */
  revertHistoryAction(
    eventId: number,
    actionId: number,
  ): Promise<{ success: true; actionId: number | null }>;
  /**
   * Take the event back to how it was right after one history entry: every
   * later change is put back, all or nothing (a backup is saved first).
   */
  restoreEventToHistoryPoint(
    eventId: number,
    actionId: number,
  ): Promise<{
    success: true;
    actionId: number | null;
    undoneActions: number;
  }>;
  associateBoatWithEvent(boatId: number, eventId: number): Promise<unknown>;
  removeBoatFromEvent(boatId: number, eventId: number): Promise<unknown>;
  /** The event's logo for the exported documents (a data URL), or null. */
  readEventExportLogo(eventId: number): Promise<string | null>;
  /** Store (or with null remove) the event's logo. */
  saveEventExportLogo(
    eventId: number,
    logo: string | null,
  ): Promise<{ success: true }>;
}

/** Saving and printing the exported documents (main/ipcHandlers/ExportHandler). */
export interface ExportDB {
  exportDocumentPdf(request: ExportPdfRequest): Promise<ExportResult>;
  exportDocumentFile(request: ExportFileRequest): Promise<ExportResult>;
  printDocument(request: PrintDocumentRequest): Promise<ExportResult>;
}

/** What the recovery-backup file dialogs report: cancelled, or where it went. */
export interface SnapshotFileResult {
  canceled?: boolean;
  filePath?: string;
}

export interface HeatRaceDB {
  readAllHeats(eventId: number): Promise<HeatRow[]>;
  readBoatsByHeat(heatId: number): Promise<HeatBoatRow[]>;
  readAllRaces(heatId: number): Promise<RaceRow[]>;
  readLeaderboard(eventId: number): Promise<RawLeaderboardEntry[]>;
  readFinalLeaderboard(eventId: number): Promise<RawLeaderboardEntry[]>;
  readOverallLeaderboard(eventId: number): Promise<OverallLeaderboardEntry[]>;
  insertHeatBoat(...args: unknown[]): Promise<unknown>;
  createInitialHeatsAtomic(eventId: number, numHeats: number): Promise<unknown>;
  recreateInitialHeatsAtomic(
    eventId: number,
    numHeats: number,
  ): Promise<unknown>;
  createNewHeatsBasedOnLeaderboard(...args: unknown[]): Promise<unknown>;
  undoLastScoredRaceForHeat(...args: unknown[]): Promise<unknown>;
  undoLatestHeatRedistribution(...args: unknown[]): Promise<unknown>;
  transferBoatBetweenHeats(...args: unknown[]): Promise<unknown>;
  saveLeaderboardRaceResultsAtomic(...args: unknown[]): Promise<unknown>;
  submitHeatRaceScoresAtomic(...args: unknown[]): Promise<unknown>;
  startFinalSeriesAtomic(...args: unknown[]): Promise<unknown>;
  getMaxHeatSize(eventId: number, seriesType: string): Promise<number>;
  explainTieBreak(
    eventId: number,
    boatAId: number,
    boatBId: number,
    finalSeries: boolean,
  ): Promise<TieBreakResult | null>;
  explainBoatScore(
    eventId: number,
    boatId: number,
  ): Promise<BoatScoreExplanation>;
  getFinalSeriesEligibility(eventId: number): Promise<unknown>;
  exportEventSnapshotToFile(eventId: number): Promise<SnapshotFileResult>;
  restoreEventSnapshotFromFile(eventId: number): Promise<SnapshotFileResult>;
}

type IpcMethod = (...args: unknown[]) => Promise<unknown>;
type IpcGroups = Record<string, Record<string, IpcMethod>>;

function makeGroup<T extends object>(groupName: string): T {
  return new Proxy({} as T, {
    get(_target, method) {
      return (...args: unknown[]) =>
        (window.electron.sqlite as unknown as IpcGroups)[groupName][
          method as string
        ](...args);
    },
  });
}

export const sailorDB = makeGroup<SailorDB>('sailorDB');
export const eventDB = makeGroup<EventDB>('eventDB');
export const heatRaceDB = makeGroup<HeatRaceDB>('heatRaceDB');
export const exportDB = makeGroup<ExportDB>('exportDB');

/** Whether the preload offers the recovery-backup export (older builds may not). */
export const canExportEventSnapshot = (): boolean =>
  typeof window?.electron?.sqlite?.heatRaceDB?.exportEventSnapshotToFile ===
  'function';
