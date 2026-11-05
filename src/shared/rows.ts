/**
 * The rows and results the IPC channels carry (see `shared/ipc.ts`), defined
 * once: the main process returns them, the renderer reads them.
 *
 * Rows read straight from SQL describe the columns the handler selects
 * (`src/main/ipcHandlers/*`), with the schema's nullability
 * (`src/main/database/schema.ts`): a column reached through a LEFT JOIN can be
 * null even when the table declares it NOT NULL. The database layer is
 * untyped (plain JavaScript), so these types are what the SQL promises, not
 * something the compiler can check against the query.
 */
import type {
  HeatOverflowPolicy,
  QualifyingAssignmentMode,
} from './eventSettings';
import type { PendingRace } from './raceProgress';

export type HeatType = 'Qualifying' | 'Final';

/** Final-series fleet labels (SHRS 4.1), plus 'General' for single-fleet events. */
export type PlacementGroup =
  | 'Gold'
  | 'Silver'
  | 'Bronze'
  | 'Copper'
  | 'General'
  | string;

// --- Tables -----------------------------------------------------------------

/** readAllEvents: every Events column except the export logo, plus two facts. */
export interface EventRow {
  event_id: number;
  event_name: string;
  event_location: string;
  start_date: string;
  end_date: string;
  shrs_version: string;
  /** Stored normalized (every write goes through normalizeQualifyingAssignmentMode). */
  shrs_qualifying_assignment_mode: QualifyingAssignmentMode;
  shrs_discard_profile_qualifying: string;
  shrs_discard_profile_final: string;
  /** EXISTS: the series has a race (SHRS 5.4 fixes its discards). */
  shrs_discard_locked_qualifying: 0 | 1;
  shrs_discard_locked_final: 0 | 1;
  /** Stored normalized (every write goes through normalizeHeatOverflowPolicy). */
  shrs_heat_overflow_policy: HeatOverflowPolicy;
  /** 1 once a qualifying race was scored. */
  qualifying_started: 0 | 1;
  /** 1 once the Final Series was split into fleets. */
  final_series_started: 0 | 1;
}

/** readAllClubs: SELECT * FROM Clubs. */
export interface ClubRow {
  club_id: number;
  club_name: string;
  country: string;
}

/** readAllCategories: SELECT * FROM Categories. */
export interface CategoryRow {
  category_id: number;
  category_name: string;
}

/** readAllHeats: SELECT * FROM Heats. */
export interface HeatRow {
  heat_id: number;
  event_id: number;
  heat_name: string;
  heat_type: HeatType;
}

/** readAllRaces: SELECT * FROM Races. */
export interface RaceRow {
  race_id: number;
  heat_id: number;
  race_number: number;
}

// --- Joined read shapes ------------------------------------------------------

/**
 * A boat joined with its sailor, club and category, as returned by
 * `readBoatsByEvent` / `readAllBoats`. Column names follow the SQL aliases:
 * `name` is the sailor's first name, `boat_country` the boat's registered
 * country, `club_country` the club's. Sailor, club and category are LEFT
 * JOINed (a boat with no sailor is still listed), so their columns can be
 * null; there is no `sailor_id`, so it is not a plain row of Boats.
 */
export interface EventBoatRow {
  boat_id: number;
  sail_number: number;
  boat_country: string;
  model: string;
  name: string | null;
  surname: string | null;
  club_name: string | null;
  club_country: string | null;
  category_name: string | null;
}

/**
 * A boat of a heat joined with its sailor and category (`readBoatsByHeat`).
 * The boat's country comes as `country` (no alias) and there are no club
 * columns, so it differs from `EventBoatRow`. Sailor and category are LEFT
 * JOINed.
 */
export interface HeatBoatRow {
  boat_id: number;
  sail_number: number;
  country: string;
  model: string;
  name: string | null;
  surname: string | null;
  category_name: string | null;
}

/**
 * A sailor joined with club, category and boat (`readAllSailors`). All three
 * are LEFT JOINs: a sailor may have no boat, club or category yet.
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

/** The id of the row an insert-like call made (or found). */
export interface InsertResult {
  lastInsertRowid: number;
}

// --- Leaderboard reads (main/functions/libraryStandings.ts) ------------------

/** The boat columns of every leaderboard row (sailor LEFT JOINed). */
export type LeaderboardBoatColumns = {
  boat_id: number;
  boat_number: string | number | null;
  boat_type: string | null;
  name: string | null;
  surname: string | null;
  country: string | null;
};

/**
 * Per race, comma-joined in race order (null when the boat has no race):
 * place ('' for none), points, race id, status, kept place ('' for none, RRS
 * A6.2) and 1 where the score is excluded (SHRS 5.4).
 */
export type LeaderboardRaceColumns = {
  race_positions: string | null;
  race_points: string | null;
  race_ids: string | null;
  race_statuses: string | null;
  race_held_places: string | null;
  race_excluded: string | null;
};

/** readLeaderboard: the Qualifying Series (or the one-fleet event). */
export type QualifyingLeaderboardRow = LeaderboardBoatColumns &
  LeaderboardRaceColumns & {
    total_points_event: number;
    place: number;
    /** Results of a qualifying round still being sailed (not counted). */
    pending_races: PendingRace[];
  };

/** readFinalLeaderboard: every fleet, Gold first, each in its order. */
export type FinalLeaderboardRow = LeaderboardBoatColumns &
  LeaderboardRaceColumns & {
    total_points_final: number;
    /** Her place in the fleet. */
    place: number;
    event_id: number;
    placement_group: PlacementGroup;
    qualifying_points: number;
  };

/**
 * readOverallLeaderboard: the qualifying ranking until a final race is
 * sailed (SHRS 1.5), then qualifying + final (SHRS 5.5).
 */
export type OverallLeaderboardRow = LeaderboardBoatColumns &
  (
    | {
        overall_points: number;
        place: number;
        placement_group: 'Qualifying';
      }
    | {
        qualifying_points: number;
        final_points: number;
        overall_points: number;
        /** '' for a boat with no fleet. */
        placement_group: PlacementGroup;
        final_place: number | null;
        overall_rank: number;
      }
  );

/**
 * What the leaderboard edit would save (previewLeaderboardEdit): the three
 * reads as they would be after Save, or the rules' refusal.
 */
export type LeaderboardEditPreview =
  | {
      ok: true;
      eventResults: QualifyingLeaderboardRow[];
      finalResults: FinalLeaderboardRow[];
      overallResults: OverallLeaderboardRow[];
    }
  | { ok: false; reason: string };

// --- Writes ------------------------------------------------------------------

/** One touched race, saved whole as the leaderboard edit screen shows it. */
export interface SaveRaceOperation {
  raceId: string;
  cells: {
    boatId: number;
    position: number;
    status: string;
    /** RDG2: the races whose average was granted, so it stays live. */
    rdgRaceIds?: number[];
    /**
     * RDG / DPI: the finishing place she keeps (RRS A6.2), null for none.
     * Absent for every other status.
     */
    heldPlace?: number | null;
    /**
     * The user typed in this cell this session. A boat that only moved because
     * of another cell (RRS A6.1 promotion, place ripple) is false. SHRS 3.1.5:
     * only edited cells are protest decisions or race-office corrections.
     */
    edited: boolean;
  }[];
}

/** One race scored from the scoring screen (submitHeatRaceScoresAtomic). */
export interface HeatRaceScores {
  /**
   * Not trusted: the event is read from the heat (a stale screen could
   * send the wrong one); a mismatch is only logged.
   */
  event_id?: number;
  heat_id: number;
  placeNumbers: Array<{
    boatNumber: string | number;
    place: number;
    status: string;
  }>;
  /** Ignored: the series is read from the heat. */
  isFinalSeries?: boolean;
}

/** The scored race, or the sail numbers that match no boat of the heat. */
export type HeatRaceScoresResult =
  | { ok: true; raceNumber: number; raceId: number }
  | {
      ok: false;
      reason: 'UNMATCHED_SAILS';
      unmatched: Array<string | number>;
    };

/** What the sailor edit form sends (updateSailor). */
export interface SailorEdit {
  name: string;
  surname: string;
  category_name: string;
  club_name: string;
  originalClubName: string;
  boat_id: number;
  sail_number: string | number;
  country: string;
  model: string;
}

/** What the add form sends (enterSailorInEvent; main/functions/sailorEntry). */
export interface EntryInput {
  name: string;
  surname: string;
  birthday?: string;
  clubName: string;
  country: string;
  sailNumber: string | number;
  model?: string;
  /**
   * Categories.category_id (the subgroup); null when not given (an import
   * without the column): a sailor found keeps hers, a new one is SENIOR.
   */
  categoryId: number | null;
}

export type EntryResult =
  | {
      status: 'entered';
      boatId: number;
      sailorId: number;
      createdBoat: boolean;
      createdSailor: boolean;
    }
  | { status: 'alreadyEntered'; boatId: number }
  /** The boat is registered to someone else; nothing was written. */
  | { status: 'ownerConflict'; boatId: number; ownerName: string };

/** What the recovery-backup file dialogs report: cancelled, or where it went. */
export type SnapshotFileResult =
  | { canceled: true; success?: never; filePath?: never }
  | { canceled?: never; success: true; filePath: string };

/** A backup file added as a new event (importEventSnapshotFromFile). */
export type SnapshotImportResult =
  | {
      canceled: true;
      success?: never;
      filePath?: never;
      eventId?: never;
      eventName?: never;
    }
  | {
      canceled?: never;
      success: true;
      filePath: string;
      eventId: number;
      eventName: string;
    };
