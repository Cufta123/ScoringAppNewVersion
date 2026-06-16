// Domain types for the renderer, mirroring the SQLite schema defined in
// `public/Database/DBManager.js`. These describe the row shapes the main
// process returns over IPC (see `src/main/preload.ts`). The preload bridge is
// typed as `Promise<any>`, so this module is the renderer's typed view of that
// contract — keep it in sync with the schema and the handler return shapes.

/* eslint-disable camelcase */

// --- Scoring vocabulary -----------------------------------------------------

/** Penalty / redress status codes a score can carry (SHRS + RRS Appendix A). */
export type ScoreStatus =
  | 'FINISHED'
  | 'DNF'
  | 'DNS'
  | 'DSQ'
  | 'OCS'
  | 'ZFP'
  | 'RET'
  | 'SCP'
  | 'BFD'
  | 'UFD'
  | 'DNC'
  | 'NSC'
  | 'WTH'
  | 'DNE'
  | 'DGM'
  | 'DPI'
  | 'T1'
  | 'RDG1'
  | 'RDG2'
  | 'RDG3';

export type HeatType = 'Qualifying' | 'Final';

/** Final-series fleet labels (SHRS 4.1), plus 'General' for single-fleet events. */
export type PlacementGroup =
  | 'Gold'
  | 'Silver'
  | 'Bronze'
  | 'Copper'
  | 'General'
  | string;

// --- Core entities ----------------------------------------------------------

export interface EventRow {
  event_id: number;
  event_name: string;
  event_location: string;
  start_date: string;
  end_date: string;
  shrs_version: string;
  shrs_qualifying_assignment_mode: 'progressive' | 'pre-assigned';
  shrs_discard_profile_qualifying: string;
  shrs_discard_profile_final: string;
  shrs_discard_locked_qualifying: 0 | 1;
  shrs_discard_locked_final: 0 | 1;
  shrs_heat_overflow_policy: string;
}

export interface SailorRow {
  sailor_id: number;
  name: string;
  surname: string;
  birthday: string;
  category_id: number | null;
  club_id: number | null;
}

export interface BoatRow {
  boat_id: number;
  sail_number: number;
  country: string;
  model: string;
  sailor_id: number | null;
}

export interface ClubRow {
  club_id: number;
  club_name: string;
  country: string;
}

export interface CategoryRow {
  category_id: number;
  category_name: string;
}

export interface HeatRow {
  heat_id: number;
  event_id: number;
  heat_name: string;
  heat_type: HeatType;
}

export interface RaceRow {
  race_id: number;
  heat_id: number;
  race_number: number;
}

export interface ScoreRow {
  score_id: number;
  race_id: number;
  boat_id: number;
  position: number;
  points: number;
  status: ScoreStatus;
}

// --- Joined / denormalized read shapes --------------------------------------

/**
 * A boat joined with its sailor, club and category, as returned by
 * `readBoatsByEvent` / `readBoatsByHeat`. Column names follow the SQL aliases
 * the handler selects: `name` is the sailor's first name, `boat_country` the
 * boat's registered country, `club_country` the club's. Note the select aliases
 * `b.country AS boat_country` and does not include `sailor_id`, so this is not a
 * `BoatRow`.
 */
export interface EventBoatRow {
  boat_id: number;
  sail_number: number;
  boat_country: string | null;
  model: string;
  name: string;
  surname: string;
  club_name: string | null;
  club_country: string | null;
  category_name: string | null;
}

/**
 * A sailor joined with club, category and (left-joined) boat, as returned by
 * `readAllSailors`. The boat columns are nullable because the join is a LEFT
 * JOIN — a sailor may not have a boat yet.
 */
export interface SailorWithDetails {
  sailor_id: number;
  name: string;
  surname: string;
  birthday: string;
  category_id: number | null;
  club_id: number | null;
  sail_number: number | null;
  model: string | null;
  club_name: string | null;
  category_name: string | null;
}

/** Shape returned by insert handlers (better-sqlite3 `run()` result). */
export interface InsertResult {
  lastInsertRowid: number;
}

// --- Leaderboard shapes -----------------------------------------------------

export interface LeaderboardRow {
  boat_id: number;
  event_id: number;
  total_points_event: number;
  place: number | null;
}

export interface FinalLeaderboardRow {
  boat_id: number;
  event_id: number;
  total_points_final: number;
  placement_group: PlacementGroup;
  place: number | null;
}

export interface GlobalLeaderboardRow {
  boat_id: number;
  total_points_global: number;
  name?: string;
  surname?: string;
  boat_number?: string | number;
  boat_type?: string;
  country?: string;
  [key: string]: unknown;
}

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
 * A raw leaderboard row as returned by `readLeaderboard` / `readFinalLeaderboard`
 * — identity + display columns joined with comma-separated race columns
 * (`race_positions` etc.). `processLeaderboardEntry` turns this into a
 * `LeaderboardEntry`.
 */
export interface RawLeaderboardEntry {
  boat_id: number;
  name?: string;
  surname?: string;
  country?: string | null;
  boat_number?: number | string | null;
  boat_type?: string | null;
  place?: number | null;
  placement_group?: PlacementGroup | null;
  race_positions?: string | null;
  race_points?: string | null;
  race_ids?: string | null;
  race_statuses?: string | null;
  total_points_final?: number | null;
  total_points_event?: number | null;
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
  name?: string;
  surname?: string;
  country?: string | null;
  boat_number?: number | string | null;
  boat_type?: string | null;
  place?: number | null;
  placement_group?: PlacementGroup | null;
  races: string[];
  race_points: string[];
  race_ids: string[];
  race_statuses: string[];
  computed_total: number | null;
  total_points_event?: number | null;
  total_points_final?: number | null;
  total_points_combined?: number | null;
  qualifying_points?: number | null;
  overall_rank?: number | null;
  [key: string]: unknown;
}

/** Row from `readOverallLeaderboard` (qualifying + final combined standings). */
export interface OverallLeaderboardEntry {
  boat_id: number;
  overall_points?: number | null;
  qualifying_points?: number | null;
  overall_rank?: number | null;
  [key: string]: unknown;
}

// --- Tie-break (SHRS 5.7) explanation, from `explainTieBreak` ----------------

export interface TieBreakRacePair {
  raceId: number | string;
  displayA?: string | number;
  displayB?: string | number;
  [key: string]: unknown;
}

export interface TieBreakRoute {
  rule?: string;
  note?: string;
  [key: string]: unknown;
}

export interface TieBreakComparison {
  mode?: string;
  scoreA?: number;
  scoreB?: number;
  position?: number;
  raceId?: number | string;
  [key: string]: unknown;
}

export interface TieBreakStep {
  rule?: string;
  note?: string;
  subtitle?: string;
  resolved?: boolean;
  comparison?: TieBreakComparison;
  [key: string]: unknown;
}

export interface RaceGridCell {
  key?: string;
  label?: string;
  scoreA?: number | string;
  scoreB?: number | string;
  excludedA?: boolean;
  excludedB?: boolean;
  isBreaker?: boolean;
  [key: string]: unknown;
}

export interface TieBreakResult {
  winnerBoatId?: number | string | null;
  sharedRacePairs?: TieBreakRacePair[];
  sharedQualRacePairs?: TieBreakRacePair[];
  totalA?: number;
  totalB?: number;
  tied?: boolean;
  steps?: TieBreakStep[];
  route?: TieBreakRoute | null;
  raceGrid?: RaceGridCell[];
  [key: string]: unknown;
}

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

/** Open state of the RDG2 multi-race selector for one cell. */
export interface Rdg2PickerState {
  boatId: number;
  raceIndex: number;
  selectedIndices?: Set<number>;
  selectedQualIndices?: Set<number>;
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
