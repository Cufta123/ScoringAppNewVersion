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

import type {
  BoatRow,
  CategoryRow,
  ClubRow,
  EventBoatRow,
  EventRow,
  GlobalLeaderboardRow,
  HeatRow,
  InsertResult,
  OverallLeaderboardEntry,
  RaceRow,
  RawLeaderboardEntry,
  SailorWithDetails,
  ScoreRow,
  TieBreakResult,
} from '../types';

/**
 * Result of a bulk sailor import. The success path (handler) reports
 * created/associated/alreadyInEvent/invalid counts; the preload's error
 * fallback reports imported/skipped. All fields are therefore optional.
 */
export interface ImportSailorsResult {
  imported?: number;
  skipped?: number;
  created?: number;
  associated?: number;
  alreadyInEvent?: number;
  invalid?: number;
  errors?: string[];
}

export interface SailorDB {
  readAllSailors(): Promise<SailorWithDetails[]>;
  readAllCategories(): Promise<CategoryRow[]>;
  readAllClubs(): Promise<ClubRow[]>;
  readAllBoats(): Promise<BoatRow[]>;
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
  insertEvent(event: Omit<EventRow, 'event_id'>): Promise<InsertResult>;
  updateEvent(event: EventRow): Promise<unknown>;
  deleteEvent(eventId: number): Promise<unknown>;
  associateBoatWithEvent(boatId: number, eventId: number): Promise<unknown>;
  removeBoatFromEvent(boatId: number, eventId: number): Promise<unknown>;
}

export interface HeatRaceDB {
  readAllHeats(eventId: number): Promise<HeatRow[]>;
  readBoatsByHeat(heatId: number): Promise<EventBoatRow[]>;
  readAllRaces(heatId: number): Promise<RaceRow[]>;
  readAllScores(raceId: number): Promise<ScoreRow[]>;
  readLeaderboard(eventId: number): Promise<RawLeaderboardEntry[]>;
  readFinalLeaderboard(eventId: number): Promise<RawLeaderboardEntry[]>;
  readGlobalLeaderboard(): Promise<GlobalLeaderboardRow[]>;
  readOverallLeaderboard(eventId: number): Promise<OverallLeaderboardEntry[]>;
  insertHeat(...args: unknown[]): Promise<InsertResult>;
  insertHeatBoat(...args: unknown[]): Promise<unknown>;
  insertRace(...args: unknown[]): Promise<InsertResult>;
  insertScore(...args: unknown[]): Promise<InsertResult>;
  updateScore(...args: unknown[]): Promise<unknown>;
  deleteScore(scoreId: number): Promise<unknown>;
  deleteHeatsByEvent(eventId: number): Promise<unknown>;
  updateEventLeaderboard(eventId: number): Promise<unknown>;
  updateGlobalLeaderboard(...args: unknown[]): Promise<unknown>;
  updateFinalLeaderboard(...args: unknown[]): Promise<unknown>;
  updateRaceResult(...args: unknown[]): Promise<unknown>;
  createNewHeatsBasedOnLeaderboard(...args: unknown[]): Promise<unknown>;
  undoLastScoredRaceForHeat(...args: unknown[]): Promise<unknown>;
  undoLastScoredRace(...args: unknown[]): Promise<unknown>;
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
  getFinalSeriesEligibility(eventId: number): Promise<unknown>;
  exportEventSnapshotToFile(...args: unknown[]): Promise<unknown>;
  restoreEventSnapshotFromFile(...args: unknown[]): Promise<unknown>;
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
