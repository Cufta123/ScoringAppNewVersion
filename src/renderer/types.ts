// Domain types for the renderer. The rows and results the main process
// returns over IPC are defined once in `src/shared/rows.ts` (the contract is
// `src/shared/ipc.ts`); the names below are the renderer's aliases for them,
// plus the renderer's own shapes (display rows, edit state).

// --- Scoring vocabulary -----------------------------------------------------

/** Penalty / redress status codes a score can carry (SHRS + RRS Appendix A). */
import type { PendingRace } from '../shared/raceProgress';
import type {
  TieBreakComparison,
  TieBreakExplanation,
  TieBreakRaceGridCell,
  TieBreakRacePair,
  TieBreakRoute,
  TieBreakStep,
} from '../shared/scoring/tieBreakTypes';
import type {
  CategoryRow,
  ClubRow,
  EventBoatRow,
  EventRow,
  HeatBoatRow,
  HeatRow,
  HeatType,
  InsertResult,
  LeaderboardEditPreview,
  PlacementGroup,
  RaceRow,
  SailorWithDetails,
} from '../shared/rows';

export type {
  CategoryRow,
  ClubRow,
  EventBoatRow,
  EventRow,
  HeatBoatRow,
  HeatRow,
  HeatType,
  InsertResult,
  LeaderboardEditPreview,
  PlacementGroup,
  RaceRow,
  SailorWithDetails,
};

// --- Leaderboard shapes -----------------------------------------------------

/**
 * Minimal shape the compare-mode helpers operate on: any leaderboard-like entry
 * that has a boat id and (in final series) a placement group. The numeric
 * "total" is supplied by the caller via a `getTotal` accessor so the helpers
 * stay agnostic to qualifying vs final vs overall totals.
 */
export interface CompareEntry {
  boat_id: number;
  placement_group?: PlacementGroup | null;
}

/**
 * A raw leaderboard row: what `readLeaderboard` / `readFinalLeaderboard`
 * return (`QualifyingLeaderboardRow` / `FinalLeaderboardRow` in
 * shared/rows.ts, both assignable to this), or a partial row built by a test
 * — identity + display columns joined with comma-separated race columns
 * (`race_positions` etc.). `processLeaderboardEntry` turns this into a
 * `LeaderboardEntry`. The sailor is LEFT JOINed, so her name can be null.
 */
export interface RawLeaderboardEntry {
  boat_id: number;
  name?: string | null;
  surname?: string | null;
  country?: string | null;
  boat_number?: number | string | null;
  boat_type?: string | null;
  place?: number | null;
  placement_group?: PlacementGroup | null;
  race_positions?: string | null;
  race_points?: string | null;
  race_ids?: string | null;
  race_statuses?: string | null;
  /** RRS A6.2: the place each RDG / DPI cell kept ('' for none), as CSV. */
  race_held_places?: string | null;
  /** 1 where the score is excluded (SHRS 5.4, decided by regatta-core). */
  race_excluded?: string | null;
  total_points_final?: number | null;
  total_points_event?: number | null;
  /** Results of a qualifying round still being sailed (not counted). */
  pending_races?: PendingRace[];
  [key: string]: unknown;
}

/**
 * A display-ready leaderboard row as produced by `processLeaderboardEntry` and
 * carried through the `useLeaderboard` hook. The CSV string columns from the DB
 * (`race_positions` etc.) are split into arrays here; `computed_total` is the
 * series total. Extra DB columns are retained via the index signature, so reads
 * of un-modelled columns are `unknown` (callers must narrow) rather than `any`.
 */
export interface LeaderboardEntry {
  boat_id: number;
  name?: string | null;
  surname?: string | null;
  country?: string | null;
  boat_number?: number | string | null;
  boat_type?: string | null;
  place?: number | null;
  placement_group?: PlacementGroup | null;
  races: string[];
  race_points: string[];
  race_ids: string[];
  race_statuses: string[];
  /**
   * Per race: the finishing place an RDG / DPI boat kept (RRS A6.2), '' for
   * none. Absent on rows built without it (treated as none).
   */
  race_held_places?: string[];
  computed_total: number | null;
  total_points_event?: number | null;
  total_points_final?: number | null;
  total_points_combined?: number | null;
  qualifying_points?: number | null;
  overall_rank?: number | null;
  /** Results of a qualifying round still being sailed (not counted). */
  pending_races?: PendingRace[];
  [key: string]: unknown;
}

/**
 * A row of `readOverallLeaderboard` (qualifying + final combined standings;
 * `OverallLeaderboardRow` in shared/rows.ts is assignable to this), or a
 * partial row built by a test.
 */
export interface OverallLeaderboardEntry {
  boat_id: number;
  overall_points?: number | null;
  qualifying_points?: number | null;
  overall_rank?: number | null;
  [key: string]: unknown;
}

// --- Tie-break (SHRS 5.7) explanation, from `explainTieBreak` ----------------
// Defined once in src/shared/scoring/tieBreakTypes.ts (the main process builds
// it); these are the renderer's names for the same types.

export type {
  TieBreakComparison,
  TieBreakRacePair,
  TieBreakRoute,
  TieBreakStep,
};
export type RaceGridCell = TieBreakRaceGridCell;
export type TieBreakResult = TieBreakExplanation;

// --- Leaderboard edit-mode UI state (shared by the hook and its components) --

/** Per-cell RDG redress metadata, keyed by `${boatId}-${raceIndex}`. */
export interface RdgMetaEntry {
  type: string;
  selectedRaceLabels?: string[];
}

export type RdgMeta = Record<string, RdgMetaEntry>;

/** Signature of the edit-mode race-cell change handler (from useLeaderboard). */
export type RaceChangeHandler = (
  boatId: number,
  raceIndex: number,
  newRaceValue: string | number | null,
  newStatus?: string,
) => void;

/** Open state of the RDG2 multi-race selector for one cell.
 *
 * SHRS 5.6 requires redress averages to be calculated separately for the
 * Qualifying and Final Series, so the selection only ever covers races in the
 * SAME series as the cell being scored — there is no cross-series index set. */
export interface Rdg2PickerState {
  boatId: number;
  raceIndex: number;
  selectedIndices?: Set<number>;
  // Anchor rect of the triggering <select>, used to position the popover.
  anchorRect?: DOMRect;
}

/** Assembled tie-break comparison shown in the compare panel. */
export interface CompareInfo {
  boatA: LeaderboardEntry;
  boatB: LeaderboardEntry;
  totalA: number;
  totalB: number;
  tied?: boolean;
  tieBreak: {
    steps: TieBreakStep[];
    winner: LeaderboardEntry | null;
    rule: string;
    detail: string;
  } | null;
  routeStep: TieBreakRoute | null;
  raceGrid: RaceGridCell[];
  sharedRacePairs: TieBreakRacePair[];
  sharedQualRacePairs: TieBreakRacePair[];
  sharedIds: Set<string>;
  sharedQualIds: Set<string>;
  otherTiedCount: number;
  tiedGroupEntries: LeaderboardEntry[];
}
