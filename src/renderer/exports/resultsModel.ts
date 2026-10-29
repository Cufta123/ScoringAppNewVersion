/**
 * The results sheet as plain data: which rows, in which fleets, with which
 * cells. Every results format (PDF/HTML, Excel, CSV, text, Markdown) is drawn
 * from this one model, so they cannot disagree about a score.
 *
 * Exports always read the SAVED leaderboard (`leaderboard`, `eventLeaderboard`
 * as loaded from the database), never the leaderboard's edit draft: a
 * mid-edit export must not leak unsaved values. The caller passes the saved
 * rows in; nothing here can see the draft.
 */
import {
  FLEET_COLORS,
  PENALTY_CODES,
  RDG_TYPES,
  compareFleetGroups,
  getExcludeCount,
  getPenaltyPointsText,
  getRaceCellDisplay,
  grossPointValues,
  hasMixedBoatTypes,
} from '../utils/leaderboardUtils';
import { capExcludeCountForBoat } from '../../shared/scoring/discards';
import { sumPoints } from '../../shared/points';
import { sailorFullName } from '../utils/sailorName';
import type { LeaderboardEntry } from '../types';

export type ResultsSeries = 'qualifying' | 'final' | 'both';

export interface ResultsOptions {
  /** Which series to show; 'final' and 'both' need the final series started. */
  series: ResultsSeries;
  /** Fleets to include; null = every fleet. Ignored for qualifying. */
  fleets: string[] | null;
  columns: {
    country: boolean;
    club: boolean;
    total: boolean;
    net: boolean;
    races: boolean;
  };
  /** "ZFP 5.2" instead of "ZFP". */
  showPenaltyPoints: boolean;
  /** "(7)" for a discarded score. */
  showDiscards: boolean;
  legend: boolean;
  /** The "10 races sailed, 1 discard" line. */
  raceSummary: boolean;
  /** Each fleet starts on a new page. */
  fleetPerPage: boolean;
}

export const DEFAULT_RESULTS_OPTIONS: ResultsOptions = {
  series: 'both',
  fleets: null,
  columns: { country: true, club: false, total: true, net: true, races: true },
  showPenaltyPoints: true,
  showDiscards: true,
  legend: true,
  raceSummary: true,
  fleetPerPage: false,
};

/** What the leaderboard page knows, as plain data. */
export interface ResultsInput {
  finalSeriesStarted: boolean;
  /** Saved rows of the series on screen (the final fleets once started). */
  leaderboard: LeaderboardEntry[];
  /** Saved qualifying rows. */
  eventLeaderboard: LeaderboardEntry[];
  discardProfiles: { qualifying: string; final: string };
  /** Club name by boat id, for the optional Club column. */
  clubs: Record<number, string>;
}

export type ResultCellKind = 'place' | 'penalty' | 'redress';

export interface ResultCell {
  /** What is printed: "3", "(7)", "DNF", "ZFP 5.2", "RDG (3.4)". */
  text: string;
  /** The status code of a penalty or redress cell. */
  code: string | null;
  kind: ResultCellKind;
  discarded: boolean;
}

export interface ResultRow {
  rank: number | null;
  name: string;
  country: string;
  club: string;
  sail: string;
  boatType: string;
  total: number | null;
  net: number | null;
  /** Qualifying races, then final races. */
  cells: ResultCell[];
}

export interface RaceCount {
  races: number;
  discards: number;
}

export interface ResultSection {
  /** The fleet's name ("Gold"); null for a series without fleets. */
  fleet: string | null;
  color: { border: string; thead: string } | null;
  /** Final races sailed in this fleet and the discards that follow. */
  finalCount: RaceCount | null;
  rows: ResultRow[];
}

export interface ResultsModel {
  /** The series shown (never 'final' / 'both' without a final series). */
  series: ResultsSeries;
  qualifyingRaces: number;
  finalRaces: number;
  /** Header labels: Q1..Qn then F1..Fm (only the races shown). */
  raceHeaders: string[];
  showType: boolean;
  showCountry: boolean;
  showClub: boolean;
  showTotal: boolean;
  showNet: boolean;
  sections: ResultSection[];
  /** Qualifying series figures; null when its races are not shown. */
  qualifyingCount: RaceCount | null;
  /** Final figures when every fleet sailed the same number; else null. */
  finalCount: RaceCount | null;
  /** Rank is the place within the fleet (final series on its own). */
  rankInFleet: boolean;
  /** Status codes in the cells, in the legend's order. */
  codes: string[];
  hasDiscards: boolean;
  options: ResultsOptions;
}

const countOf = (profile: string, races: number): RaceCount => ({
  races,
  discards: capExcludeCountForBoat(getExcludeCount(races, profile), races),
});

const maxRaces = (rows: ReadonlyArray<LeaderboardEntry>): number =>
  Math.max(0, ...rows.map((row) => row.races?.length ?? 0));

/** The cell of one race: what the screen shows, minus what the options hide. */
const buildCell = (
  entry: LeaderboardEntry | undefined,
  raceIndex: number,
  options: ResultsOptions,
): ResultCell => {
  const race = entry?.races?.[raceIndex];
  if (race === undefined) {
    return { text: '', code: null, kind: 'place', discarded: false };
  }
  const status = entry?.race_statuses?.[raceIndex] || 'FINISHED';
  const display = getRaceCellDisplay(String(race), status);
  // The screen's text without the brackets of a discard: "(DNF)" -> "DNF".
  let core = display.isExcluded
    ? display.displayText.slice(1, -1)
    : display.displayText;
  const points = options.showPenaltyPoints
    ? getPenaltyPointsText(entry, raceIndex, status)
    : null;
  if (points !== null) core = `${status} ${points}`;

  let kind: ResultCellKind = 'place';
  if (RDG_TYPES.includes(status)) kind = 'redress';
  else if (PENALTY_CODES.includes(status)) kind = 'penalty';

  return {
    text: display.isExcluded && options.showDiscards ? `(${core})` : core,
    code: kind === 'place' ? null : status,
    kind,
    discarded: display.isExcluded,
  };
};

const netOf = (value: unknown): number | null =>
  typeof value === 'number' && !Number.isNaN(value) ? value : null;

const grossOf = (...parts: ReadonlyArray<number[]>): number | null => {
  const total = sumPoints(parts.flat());
  return total > 0 ? total : null;
};

const groupByFleet = (
  rows: ReadonlyArray<LeaderboardEntry>,
): Array<[string, LeaderboardEntry[]]> => {
  const fleets = new Map<string, LeaderboardEntry[]>();
  rows.forEach((entry) => {
    const fleet = entry.placement_group || 'General';
    fleets.set(fleet, [...(fleets.get(fleet) ?? []), entry]);
  });
  return [...fleets.entries()].sort(([a], [b]) => compareFleetGroups(a, b));
};

const fleetColor = (fleet: string) =>
  FLEET_COLORS[fleet] ?? FLEET_COLORS.General;

const identity = (entry: LeaderboardEntry, clubs: Record<number, string>) => ({
  name: sailorFullName(entry),
  country: String(entry.country ?? ''),
  club: clubs[entry.boat_id] ?? '',
  sail: String(entry.boat_number ?? ''),
  boatType: String(entry.boat_type ?? ''),
});

/** The fleets of the final series on screen, in SHRS 5.5 order. */
export const finalFleetNames = (input: ResultsInput): string[] =>
  input.finalSeriesStarted
    ? groupByFleet(input.leaderboard).map(([fleet]) => fleet)
    : [];

const distinctCodes = (sections: ResultSection[]): string[] => {
  const present = new Set<string>();
  sections.forEach((section) =>
    section.rows.forEach((row) =>
      row.cells.forEach((cell) => cell.code && present.add(cell.code)),
    ),
  );
  return PENALTY_CODES.filter((code) => present.has(code));
};

export const buildResultsModel = (
  input: ResultsInput,
  options: ResultsOptions,
): ResultsModel => {
  const { eventLeaderboard, leaderboard, clubs } = input;
  // Without a final series there is only the qualifying standing to show.
  const series: ResultsSeries = input.finalSeriesStarted
    ? options.series
    : 'qualifying';
  const showQualifying = series !== 'final';
  const showFinal = series !== 'qualifying';

  const qualifyingRaces = showQualifying ? maxRaces(eventLeaderboard) : 0;
  // Decided over the whole event, as on screen, so every table has the same
  // columns.
  const everyone = [...eventLeaderboard, ...(showFinal ? leaderboard : [])];
  const showType = hasMixedBoatTypes(everyone);
  const racesOn = options.columns.races;

  const sections: ResultSection[] = [];

  if (series === 'qualifying') {
    const rows = eventLeaderboard.map<ResultRow>((entry, index) => ({
      rank: entry.place ?? index + 1,
      ...identity(entry, clubs),
      total: grossOf(grossPointValues(entry)),
      net: netOf(entry.computed_total ?? entry.total_points_event),
      cells: racesOn
        ? Array.from({ length: qualifyingRaces }, (_, i) =>
            buildCell(entry, i, options),
          )
        : [],
    }));
    sections.push({ fleet: null, color: null, finalCount: null, rows });
  } else {
    const chosen = options.fleets;
    const fleets = groupByFleet(leaderboard).filter(
      ([fleet]) => !chosen || chosen.includes(fleet),
    );
    const finalRacesAll = Math.max(
      0,
      ...fleets.map(([, entries]) => maxRaces(entries)),
    );
    const byBoat = new Map(eventLeaderboard.map((e) => [e.boat_id, e]));

    fleets.forEach(([fleet, entries]) => {
      const rows = entries.map<ResultRow>((entry, index) => {
        const qualifying = byBoat.get(entry.boat_id);
        const qualifyingGross = showQualifying
          ? grossPointValues(qualifying)
          : [];
        const cells: ResultCell[] = [];
        if (racesOn) {
          for (let i = 0; i < qualifyingRaces; i += 1) {
            cells.push(buildCell(qualifying, i, options));
          }
          for (let i = 0; i < finalRacesAll; i += 1) {
            cells.push(buildCell(entry, i, options));
          }
        }
        const both = series === 'both';
        return {
          rank: both ? (entry.overall_rank ?? index + 1) : index + 1,
          ...identity(entry, clubs),
          total: grossOf(qualifyingGross, grossPointValues(entry)),
          net: both
            ? netOf(entry.total_points_combined)
            : netOf(entry.computed_total),
          cells,
        };
      });
      sections.push({
        fleet,
        color: fleetColor(fleet),
        finalCount: countOf(input.discardProfiles.final, maxRaces(entries)),
        rows,
      });
    });
  }

  const finalRacesShown =
    showFinal && sections.length > 0
      ? Math.max(0, ...sections.map((s) => s.finalCount?.races ?? 0))
      : 0;
  const finalCounts = sections
    .map((section) => section.finalCount)
    .filter((count): count is RaceCount => count !== null);
  const sameFinalCount =
    finalCounts.length > 0 &&
    finalCounts.every(
      (count) =>
        count.races === finalCounts[0].races &&
        count.discards === finalCounts[0].discards,
    );

  return {
    series,
    qualifyingRaces: racesOn ? qualifyingRaces : 0,
    finalRaces: racesOn ? finalRacesShown : 0,
    raceHeaders: racesOn
      ? [
          ...Array.from({ length: qualifyingRaces }, (_, i) => `Q${i + 1}`),
          ...Array.from({ length: finalRacesShown }, (_, i) => `F${i + 1}`),
        ]
      : [],
    showType,
    showCountry: options.columns.country,
    showClub:
      options.columns.club &&
      sections.some((section) => section.rows.some((row) => row.club !== '')),
    showTotal: options.columns.total,
    showNet: options.columns.net,
    sections,
    qualifyingCount:
      showQualifying && qualifyingRaces > 0
        ? countOf(input.discardProfiles.qualifying, qualifyingRaces)
        : null,
    finalCount: sameFinalCount && finalRacesShown > 0 ? finalCounts[0] : null,
    rankInFleet: series === 'final',
    codes: distinctCodes(sections),
    hasDiscards: sections.some((section) =>
      section.rows.some((row) => row.cells.some((cell) => cell.discarded)),
    ),
    options,
  };
};
