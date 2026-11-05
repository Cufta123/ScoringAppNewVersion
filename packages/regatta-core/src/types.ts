/**
 * The library's vocabulary. Everything here is plain data (JSON in, JSON
 * out), so an event can be saved, sent and replayed anywhere.
 *
 * The one input is the event's DECISION LOG: what the race office and the
 * protest committee decided, in order. Every heat, score and standing is
 * worked out from it; nothing derived is ever stored.
 */

export type BoatId = string;

export interface Boat {
  id: BoatId;
  /** National letters ("CRO"); SHRS 3 / 5.3 order boats by them first. */
  nat: string;
  sail: string;
  name?: string;
}

/**
 * Codes for a boat that has no finishing place, in SHRS 5.3 recording order
 * (DGM is not named in 5.3 and goes last).
 */
export const NO_PLACE_CODES = [
  'DNF',
  'RET',
  'NSC',
  'OCS',
  'DNS',
  'DNC',
  'WTH',
  'UFD',
  'BFD',
  'DSQ',
  'DNE',
  'DGM',
] as const;
export type NoPlaceCode = (typeof NO_PLACE_CODES)[number];

/** Penalties that keep the boat's finishing place (RRS 44.3(c), T1). */
export const PENALTY_CODES = ['ZFP', 'SCP', 'T1'] as const;
export type PenaltyCode = (typeof PENALTY_CODES)[number];

/** Redress: RRS A9 (a) her average (RDG1), (b) chosen races (RDG2), (c) set. */
export const REDRESS_CODES = ['RDG1', 'RDG2', 'RDG3'] as const;

/** Scores the protest committee sets: DPI (RRS A10) and redress (A9). */
export const COMMITTEE_CODES = ['DPI', ...REDRESS_CODES] as const;

/**
 * Every code a result can show, in recording order: the penalties that keep
 * the place (with the finishers), the no-place codes in SHRS 5.3 order, then
 * the protest committee's scores.
 */
export const RESULT_CODES = [
  ...PENALTY_CODES,
  ...NO_PLACE_CODES,
  ...COMMITTEE_CODES,
] as const;

/**
 * One boat's line on the race office's result sheet. The sheet lists the
 * finishers in finishing order; boats with a `code` have no place and can be
 * anywhere in the list.
 */
export interface RaceLine {
  boat: BoatId;
  /** No finishing place. */
  code?: NoPlaceCode;
  /** Finished, with a scoring penalty that keeps her place. */
  penalty?: PenaltyCode;
  /** Finished level with the finisher listed directly above (RRS A7). */
  tied?: boolean;
}

/** A heat is "A1", "B3" (qualifying group + round) or "Gold" (final fleet). */
export type HeatId = string;

/** A race is the n-th race a heat sails. */
export interface RaceRef {
  heat: HeatId;
  race: number;
}

/** What a protest committee decided about one boat in one race. */
export type ProtestOutcome =
  /** Disqualified: out of the finishing order, boats behind move up (A6.1). */
  | { kind: 'DSQ' | 'DNE' | 'DGM' }
  /** Discretionary penalty: the committee sets her score (RRS A10). */
  | { kind: 'DPI'; points: number }
  /** Redress, average of her other races in the series (RRS A9(a)). */
  | { kind: 'RDG1' }
  /** Redress, average of the races the committee chose (RRS A9(b)). */
  | { kind: 'RDG2'; races: RaceRef[] }
  /** Redress, points the committee set (RRS A9(c)). */
  | { kind: 'RDG3'; points: number }
  /** An earlier decision for this boat in this race is withdrawn. */
  | { kind: 'cleared' };

export type QualifyingMode = 'progressive' | 'pre-assigned';

/** SHRS 5.4 as published, or as the race committee changed it. */
export type DiscardProfile =
  | { kind: 'standard' }
  /** One discard after `first` races, two after `second`, +1 per `every`. */
  | { kind: 'custom'; first: number; second: number; every: number }
  /** One more discard at each of these completed-race counts. */
  | { kind: 'thresholds'; at: number[] }
  | { kind: 'none' };

export interface Settings {
  qualifyingMode: QualifyingMode;
  discards: { qualifying: DiscardProfile; final: DiscardProfile };
  /**
   * Final fleets over 20 boats (SHRS 2.3): add fleets, or keep the fleet
   * count and accept the oversize fleets.
   */
  finalOverflow: 'add-fleets' | 'allow-oversize';
}

export const DEFAULT_SETTINGS: Settings = {
  qualifyingMode: 'progressive',
  discards: { qualifying: { kind: 'standard' }, final: { kind: 'standard' } },
  finalOverflow: 'add-fleets',
};

/**
 * Everything that can happen to an event. The log is the event: to undo a
 * decision, take it out of the log and replay.
 */
export type Decision =
  | { type: 'settingsChanged'; settings: Partial<Settings> }
  | { type: 'boatEntered'; boat: Boat }
  | { type: 'boatRemoved'; boat: BoatId }
  /**
   * A boat's details corrected. National letters and sail number order the
   * seeding and every tie SHRS settles by them (3, 3.1(iv), 5.3), so a
   * change is a decision in the log, from where it applies on.
   */
  | {
      type: 'boatChanged';
      boat: BoatId;
      nat?: string;
      sail?: string;
      name?: string;
    }
  /**
   * The first qualifying round. Boats are seeded in `seeding` order, or by
   * national letters and sail number when there is no seeding list (SHRS 3).
   */
  | {
      type: 'heatsCreated';
      heatCount: number;
      seeding?: BoatId[];
      /**
       * The heats as the race office made them, heat A first, instead of
       * the SHRS 3.1(1) draw: a converted record. Checked for shape only:
       * each boat entered and in one heat (a heat
       * over 20, made before SHRS 2.3 was enforced, is kept as sailed).
       */
      heats?: BoatId[][];
    }
  /** A late entry joins a heat of the current round. */
  | { type: 'boatAssigned'; boat: BoatId; heat: HeatId }
  /**
   * The race office moves a boat to another heat of the current qualifying
   * round, before either heat has raced.
   */
  | { type: 'boatMoved'; boat: BoatId; from: HeatId; to: HeatId }
  /**
   * The heat's next race, as the race office recorded it. `race` names it
   * (the heat's race 1, 2, …) and must be the heat's next race, so taking
   * an earlier race out of the log cannot quietly renumber the later ones
   * and re-point their corrections and protest decisions.
   */
  | { type: 'raceScored'; race: RaceRef; lines: RaceLine[] }
  /** The race office corrects a race: the whole sheet again. */
  | { type: 'raceCorrected'; race: RaceRef; lines: RaceLine[] }
  | {
      type: 'protestDecided';
      race: RaceRef;
      boat: BoatId;
      outcome: ProtestOutcome;
    }
  /** The next qualifying round, assigned from the round just sailed. */
  | {
      type: 'roundCreated';
      /**
       * The round's heats as the race office made them, heat A first,
       * instead of the Heat Movement Table: a converted record. Checked
       * for shape only, as for `heatsCreated`.
       */
      heats?: BoatId[][];
    }
  | {
      type: 'finalSeriesStarted';
      /** SHRS 4.3 for the fleet split; on unless the SI say otherwise. */
      rule43?: boolean;
      /**
       * The fleets as the race office made them, Gold first, instead of
       * the split worked out here. For an event converted from records
       * that keep the fleets but not the results they were split from
       * (results corrected after the split). Checked for shape only.
       */
      fleets?: BoatId[][];
    };

export type DecisionType = Decision['type'];
