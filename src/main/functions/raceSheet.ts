/**
 * The race office's sheet for one race, rebuilt from result rows as the app
 * stores them (or as the leaderboard's edit screen sends them), so that the
 * sheet scores exactly those results under regatta-core:
 *
 * - finishers at their stored places (after any RRS A6.1 move-up), boats
 *   level on a place tied (RRS A7);
 * - an RDG / DPI boat at the place she kept (A6.2), in a tie with the
 *   finishers on that place when their shared points say so;
 * - a boat the protest committee disqualified put back at her place before
 *   the decision (`frozen`), the boats behind her one place down;
 * - the codes in SHRS 5.3 order.
 *
 * What the rules cannot hold exactly (a gap in the places, a kept place a
 * later correction gave to another boat) is reported in `anomalies`.
 * Used by the conversion (functions/eventLog.ts) and the leaderboard save.
 */
import {
  NO_PLACE_CODES,
  PENALTY_CODES,
  REDRESS_CODES,
  holdsPlace,
  toTenth,
  type BoatId,
  type NoPlaceCode,
  type PenaltyCode,
  type RaceLine,
} from 'regatta-core';

const PENALTIES = new Set<string>(PENALTY_CODES);
const NO_PLACE = new Set<string>(NO_PLACE_CODES);
/** The codes a protest committee's disqualification carries (RRS 64). */
export const COMMITTEE_DSQ = new Set(['DSQ', 'DNE', 'DGM']);
export const REDRESS = new Set<string>(REDRESS_CODES);
const finisher = holdsPlace;

/** A stored RDG2 race selection (a JSON array of race ids), or null. */
export function parseRedressRaceIds(raw: unknown): number[] | null {
  if (raw == null || raw === '') return null;
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return null;
    const ids = parsed.map(Number).filter((id) => Number.isFinite(id));
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

export interface SheetRow {
  boat: BoatId;
  /** Normalised status (FINISHED, a code, a penalty, RDG*, DPI). */
  status: string;
  position: number;
  points: number;
  /** RDG / DPI: the finishing place she kept. */
  heldPlace: number | null;
  /** Her sheet row before a committee decision (SHRS 3.1(5) freeze). */
  frozen?: { position: number | null; status: string };
}

export interface Sheet {
  lines: RaceLine[];
  /** Rows that are the protest committee's decisions. */
  committee: SheetRow[];
  notes: string[];
  anomalies: string[];
}

/**
 * `where` names the race in notes and anomalies ("Heat A2, race 1"), `name`
 * a boat in them; `dnf` is the race's no-place score.
 */
export function sheetFromRows(
  rows: SheetRow[],
  dnf: number,
  where: string,
  name: (boat: BoatId) => string = (boat) => boat,
  /**
   * Old records (the conversion): a redressed boat with no kept place
   * recorded kept the place the finishers leave free. Off for a Save,
   * where no kept place is what the race officer chose.
   */
  inferKeptPlaces = false,
): Sheet {
  const notes: string[] = [];
  const anomalies: string[] = [];
  const committeeRows: SheetRow[] = [];
  type Entry = {
    boat: string;
    place: number;
    penalty?: string;
    points: number;
    /** At her stored place (not put back after a committee DSQ). */
    live: boolean;
    /** RDG / DPI: her points are the committee's, not the place's. */
    committee?: boolean;
  };
  const live: Entry[] = [];
  const unplaced: SheetRow[] = [];
  const putBack: Entry[] = [];
  const coded: { boat: string; code: string }[] = [];
  rows.forEach((row) => {
    const { boat: boatId, status, points } = row;
    const ice = row.frozen;
    const was = ice?.status;
    if (COMMITTEE_DSQ.has(status) && ice) {
      if (was && finisher(was)) {
        putBack.push({
          boat: boatId,
          place: Number(ice!.position),
          ...(PENALTIES.has(was) ? { penalty: was } : {}),
          points,
          live: false,
        });
      } else {
        coded.push({
          boat: boatId,
          code: was && NO_PLACE.has(was) ? was : 'DNF',
        });
      }
      committeeRows.push(row);
    } else if (REDRESS.has(status) || status === 'DPI') {
      const kept =
        row.heldPlace ?? (ice && was && finisher(was) ? ice.position : null);
      if (kept != null) {
        live.push({
          boat: boatId,
          place: Number(kept),
          points,
          live: true,
          committee: true,
        });
      } else if (was && NO_PLACE.has(was)) {
        coded.push({ boat: boatId, code: was });
      } else if (inferKeptPlaces) {
        // No place recorded (results saved before kept places were): she
        // may have kept one; decided below from the finishers.
        unplaced.push(row);
      } else {
        notes.push(
          `${where}: ${boatId} has ${status} with no result recorded before it; DNF on the sheet (her points are the committee's).`,
        );
        coded.push({ boat: boatId, code: 'DNF' });
      }
      committeeRows.push(row);
    } else if (finisher(status)) {
      live.push({
        boat: boatId,
        place: Number(row.position),
        ...(PENALTIES.has(status) ? { penalty: status } : {}),
        points,
        live: true,
      });
    } else if (NO_PLACE.has(status)) {
      coded.push({ boat: boatId, code: status });
    } else {
      anomalies.push(
        `${where}: ${name(boatId)} has the unknown result ${status}; she is scored DNF.`,
      );
      coded.push({ boat: boatId, code: 'DNF' });
    }
  });

  // RRS A6.2 / A10: redress and DPI move no other boat, so a place the
  // finishers leave free is the place a redressed boat kept. Older records
  // stored only her points; give each such boat a free place, in the order
  // of the boats (the records cannot say which held which when there are
  // several), and DNF on the sheet when there is none left.
  if (unplaced.length > 0) {
    const sizes = new Map<number, number>();
    live.forEach((entry) =>
      sizes.set(entry.place, (sizes.get(entry.place) ?? 0) + 1),
    );
    const free: number[] = [];
    let next = 1;
    [...sizes.keys()]
      .sort((a, b) => a - b)
      .forEach((place) => {
        while (next < place) {
          free.push(next);
          next += 1;
        }
        next = Math.max(next, place + sizes.get(place)!);
      });
    [...unplaced]
      .sort((a, b) =>
        a.boat.localeCompare(b.boat, undefined, { numeric: true }),
      )
      .forEach((row) => {
        const place = free.shift();
        if (place !== undefined) {
          notes.push(
            `${where}: ${name(row.boat)} has ${row.status} with no kept place recorded; the finishers leave place ${place} free, so she kept it (RRS A6.2).`,
          );
          live.push({
            boat: row.boat,
            place,
            points: row.points,
            live: true,
            committee: true,
          });
        } else {
          notes.push(
            `${where}: ${name(row.boat)} has ${row.status} with no result recorded before it; DNF on the sheet (her points are the committee's).`,
          );
          coded.push({ boat: row.boat, code: 'DNF' });
        }
      });
  }

  // Finishers level on a place tied (RRS A7). An RDG / DPI boat on the
  // same place was in the tie if the finishers' stored points are shared
  // with her; otherwise a later correction gave her kept place to them,
  // and she follows the finishers.
  const byPlace = new Map<number, Entry[]>();
  live.forEach((entry) =>
    byPlace.set(entry.place, [...(byPlace.get(entry.place) ?? []), entry]),
  );
  const tiedWith = new Map<Entry, boolean>();
  const plainPlaces = [
    ...new Set(live.filter((e) => !e.committee).map((e) => e.place)),
  ].sort((a, b) => a - b);
  byPlace.forEach((group, place) => {
    const plain = group.filter((e) => !e.committee);
    const committee = group.filter((e) => e.committee);
    // How many boats share this place: up to the next finisher's place,
    // or, for the last one, from her shared points (a penalty changes
    // them, so only a boat without one tells).
    const next = plainPlaces.find((p) => p > place);
    const scored = plain.find((e) => !e.penalty);
    const penalised = plain.find((e) => e.penalty);
    let size = plain.length;
    if (next !== undefined) {
      size = next - place;
    } else if (scored) {
      size = Math.round(2 * (scored.points - place) + 1);
    } else if (penalised) {
      // Her points are the shared points plus the penalty (RRS 44.3(c)):
      // a share of the DNF score, largest heat + 1 (SHRS 5.2).
      const penalty = toTenth(dnf * (penalised.penalty === 'T1' ? 0.3 : 0.2));
      // Capped at the DNF score, her points say nothing: the boats on
      // the last place finished level.
      size =
        penalised.points < dnf
          ? Math.round(2 * (penalised.points - penalty - place) + 1)
          : group.length;
    }
    const join = Math.max(0, Math.min(committee.length, size - plain.length));
    committee.forEach((entry, i) => {
      if (plain.length > 0 && i >= join) {
        anomalies.push(
          `${where}: the place ${name(entry.boat)} kept (${place}) was given to another boat in a later correction; she is placed after the finishers.`,
        );
        // eslint-disable-next-line no-param-reassign
        entry.place = Number.MAX_SAFE_INTEGER;
      }
    });
    group.forEach((entry) => tiedWith.set(entry, group.length > 1));
  });
  const order: (Entry & { at: number })[] = live
    .sort(
      (a, b) =>
        a.place - b.place ||
        Number(Boolean(a.committee)) - Number(Boolean(b.committee)) ||
        a.boat.localeCompare(b.boat, undefined, { numeric: true }),
    )
    .map((entry) => ({ ...entry, at: entry.place }));
  putBack
    .sort((a, b) => a.place - b.place)
    .forEach((entry) => {
      const index = order.findIndex((other) => other.at >= entry.place);
      const at = index === -1 ? order.length : index;
      order.splice(at, 0, { ...entry, at: entry.place });
      for (let j = at + 1; j < order.length; j += 1) order[j].at += 1;
    });

  // Stored places with a gap the sheet cannot hold (older records).
  let expected = 1;
  order.forEach((entry, i) => {
    const above = order[i - 1];
    if (entry.live && entry.place !== Number.MAX_SAFE_INTEGER) {
      const levelAbove =
        above !== undefined && above.live && above.place === entry.place;
      if (!levelAbove && entry.at !== expected) {
        anomalies.push(
          `${where}: the stored places skip from ${expected - 1} to ${entry.at}; the places are closed up.`,
        );
      }
    }
    expected = i + 2;
  });

  const lines: RaceLine[] = [
    ...order.map((entry, i) => {
      const above = order[i - 1];
      const tied =
        entry.live &&
        above !== undefined &&
        above.live &&
        above.place === entry.place &&
        entry.place !== Number.MAX_SAFE_INTEGER &&
        tiedWith.get(live.find((e) => e.boat === entry.boat)!) === true;
      return {
        boat: entry.boat,
        ...(entry.penalty ? { penalty: entry.penalty as PenaltyCode } : {}),
        ...(tied ? { tied: true } : {}),
      };
    }),
    ...coded.map((line) => ({
      boat: line.boat,
      code: line.code as NoPlaceCode,
    })),
  ];
  return { lines, committee: committeeRows, notes, anomalies };
}

/**
 * The sheet from a whole-race freeze (every boat's sheet row kept beside the
 * results when the protest committee decided something in the race): the
 * places as they were, boats on one place tied. A DSQ / DNE / DGM is the
 * committee's when her sheet row was something else, an RDG / DPI always.
 */
export function sheetFromFrozen(rows: SheetRow[]): Sheet {
  const keepsPlace = holdsPlace;
  const finishers = rows
    .filter((row) => keepsPlace(row.frozen!.status))
    .sort(
      (a, b) =>
        Number(a.frozen!.position) - Number(b.frozen!.position) ||
        a.boat.localeCompare(b.boat, undefined, { numeric: true }),
    );
  const lines: RaceLine[] = [
    ...finishers.map((row, i) => ({
      boat: row.boat,
      ...(row.frozen!.status !== 'FINISHED'
        ? { penalty: row.frozen!.status as PenaltyCode }
        : {}),
      ...(i > 0 && finishers[i - 1].frozen!.position === row.frozen!.position
        ? { tied: true }
        : {}),
    })),
    ...rows
      .filter((row) => !keepsPlace(row.frozen!.status))
      .map((row) => ({
        boat: row.boat,
        code: (NO_PLACE.has(row.frozen!.status)
          ? row.frozen!.status
          : 'DNF') as NoPlaceCode,
      })),
  ];
  const committee = rows.filter(
    (row) =>
      REDRESS.has(row.status) ||
      row.status === 'DPI' ||
      (COMMITTEE_DSQ.has(row.status) && row.frozen!.status !== row.status),
  );
  return { lines, committee, notes: [], anomalies: [] };
}
