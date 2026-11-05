/**
 * A race corrected on the leaderboard (Save sends it whole) as regatta-core
 * decisions: the race office's corrected sheet (raceCorrected) and the
 * protest committee's decisions that changed (protestDecided, or cleared).
 *
 * The cells are checked and scored as the edit screen scored them
 * (checkedRaceColumn), then the sheet is rebuilt from them exactly as the
 * conversion rebuilds it from stored rows (raceSheet.ts), so the library
 * scores what the screen showed.
 *
 * Who decided (SHRS 3.1(5)): RDG and DPI are always the committee's. A DSQ,
 * DNE or DGM is the committee's when it already was, or when the officer
 * typed it in this save; otherwise it is the race office's code (an
 * umpire's DSQ, 3.1(iii)), as the old app read it.
 */
import {
  noPlacePoints,
  scoreRace,
  type BoatId,
  type Decision,
  type EventState,
  type ProtestOutcome,
  type RaceLine,
  type RaceRef,
} from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import { checkedRaceColumn, type RaceColumnCell } from './raceScoring';
import { coreHeatId } from './eventLog';
import { normalizeScoreStatus } from './scoreStatus';
import { boatLabel, raceLabel } from './labels';
import {
  COMMITTEE_DSQ,
  REDRESS,
  sheetFromRows,
  type SheetRow,
} from './raceSheet';

/** The library's name for an app race. */
export function raceRefOf(raceId: number): RaceRef | undefined {
  const row = db
    .prepare(
      `SELECT h.heat_name, r.race_number FROM Races r
       JOIN Heats h ON h.heat_id = r.heat_id WHERE r.race_id = ?`,
    )
    .get(raceId) as { heat_name: string; race_number: number } | undefined;
  return row
    ? { heat: coreHeatId(row.heat_name), race: Number(row.race_number) }
    : undefined;
}

const lineKey = (line: RaceLine) =>
  `${line.boat}|${line.code ?? ''}|${line.penalty ?? ''}|${line.tied ? 1 : 0}`;

/** RDG2: the races sent, or the ones chosen before. */
function chosenRaces(
  sent: RaceColumnCell | undefined,
  before: ProtestOutcome | undefined,
): RaceRef[] {
  if (Array.isArray(sent?.rdgRaceIds)) {
    return (sent!.rdgRaceIds as unknown[])
      .map((id) => raceRefOf(Number(id)))
      .filter((r): r is RaceRef => r !== undefined);
  }
  return before?.kind === 'RDG2' ? before.races : [];
}

const sameOutcome = (a?: ProtestOutcome, b?: ProtestOutcome) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The decisions one saved race makes, against the event as it is. */
export function correctionDecisions(
  eventId: number,
  state: EventState,
  raceId: number,
  sentCells: RaceColumnCell[],
): Decision[] {
  const { raceRows, sentByIndex, scored, maxBoats } = checkedRaceColumn(
    eventId,
    raceId,
    sentCells,
  );
  const ref = raceRefOf(raceId)!;
  const heat = [...state.rounds.flat(), ...(state.fleets ?? [])].find(
    (h) => h.id === ref.heat,
  );
  const race = heat?.races[ref.race - 1];
  if (!race) {
    throw new Error(
      'One of the edited races is no longer part of this event (it may have been undone in the meantime). Reload the leaderboard and make the change again.',
    );
  }

  // Each boat's line on the sheet as it stands: her slot, or her code.
  const was = new Map<BoatId, { position: number | null; status: string }>();
  let slot = 0;
  let finishers = 0;
  race.lines.forEach((line) => {
    if (line.code) {
      was.set(line.boat, { position: null, status: line.code });
      return;
    }
    finishers += 1;
    if (!line.tied) slot = finishers;
    was.set(line.boat, {
      position: slot,
      status: line.penalty ?? 'FINISHED',
    });
  });

  // A boat with no heat in this race has her DNC filed under it: she is
  // not on the sheet, and only redress can change it (RRS A9, parity R12).
  const sailed = new Set(race.lines.map((line) => line.boat));
  const noHeat: Decision[] = [];
  scored.forEach((cell, i) => {
    const boat = String(raceRows[i].boat_id);
    if (sailed.has(boat)) return;
    const status = normalizeScoreStatus(cell.status);
    const before = race.protests[boat];
    let outcome: ProtestOutcome | undefined;
    if (status === 'RDG1') outcome = { kind: 'RDG1' };
    else if (status === 'RDG3')
      outcome = { kind: 'RDG3', points: Number(cell.points) };
    else if (status === 'RDG2') {
      const sent = sentByIndex.get(i);
      outcome = { kind: 'RDG2', races: chosenRaces(sent, before) };
    } else if (status === 'DNC') {
      if (before) outcome = { kind: 'cleared' };
    } else {
      throw new Error(
        `${boatLabel(raceRows[i].boat_id)} had no heat in ${raceLabel(raceId)}: she is DNC there, and only redress from the protest committee can change that.`,
      );
    }
    if (outcome && !sameOutcome(outcome, before)) {
      noHeat.push({ type: 'protestDecided', race: ref, boat, outcome });
    }
  });

  const rows: SheetRow[] = scored.flatMap((cell, i) => {
    const boat = String(raceRows[i].boat_id);
    if (!sailed.has(boat)) return [];
    const status = normalizeScoreStatus(cell.status);
    const before = race.protests[boat];
    const sent = sentByIndex.get(i);
    const changed = status !== normalizeScoreStatus(raceRows[i].status);
    // The officer typed it (older clients send no flag: a changed status).
    let typed = false;
    if (sent) typed = typeof sent.edited === 'boolean' ? sent.edited : changed;
    const committee =
      REDRESS.has(status) ||
      status === 'DPI' ||
      (COMMITTEE_DSQ.has(status) &&
        ((before !== undefined && COMMITTEE_DSQ.has(before.kind)) ||
          (typed && changed)));
    return [
      {
        boat,
        status,
        position: Number(cell.position),
        points: Number(cell.points),
        heldPlace: cell.heldPlace ?? null,
        ...(committee && was.has(boat) ? { frozen: was.get(boat)! } : {}),
      },
    ];
  });

  const sheet = sheetFromRows(
    rows,
    noPlacePoints(maxBoats),
    `${ref.heat} race ${ref.race}`,
  );
  const decisions: Decision[] = [];

  const decided = new Map<BoatId, ProtestOutcome>();
  sheet.committee.forEach((row) => {
    const before = race.protests[row.boat];
    const i = raceRows.findIndex((r) => String(r.boat_id) === row.boat);
    const sent = sentByIndex.get(i);
    let outcome: ProtestOutcome;
    switch (row.status) {
      case 'RDG1':
        outcome = { kind: 'RDG1' };
        break;
      case 'RDG2': {
        const chosen = chosenRaces(sent, before);
        outcome = { kind: 'RDG2', races: chosen };
        break;
      }
      case 'RDG3':
      case 'DPI':
        outcome = { kind: row.status, points: row.points };
        break;
      default:
        outcome = { kind: row.status as 'DSQ' | 'DNE' | 'DGM' };
    }
    decided.set(row.boat, outcome);
    if (!sameOutcome(outcome, before)) {
      decisions.push({
        type: 'protestDecided',
        race: ref,
        boat: row.boat,
        outcome,
      });
    }
  });
  Object.keys(race.protests).forEach((boat) => {
    if (sailed.has(boat) && !decided.has(boat)) {
      decisions.push({
        type: 'protestDecided',
        race: ref,
        boat,
        outcome: { kind: 'cleared' },
      });
    }
  });

  // Did the race office change the sheet? If every boat shows exactly what
  // the sheet as it stands gives with the committee's decisions as saved,
  // only the committee decided: the sheet stays as it is (with its ties,
  // which the places alone cannot tell from a move-up). Otherwise the
  // corrected sheet comes first.
  const protests = Object.fromEntries(decided);
  const expected = new Map(
    scoreRace({ ...race, protests }, maxBoats).map((result) => [
      result.boat,
      result,
    ]),
  );
  const unchanged = scored.every((cell, i) => {
    const boat = String(raceRows[i].boat_id);
    if (!sailed.has(boat)) return true;
    const line = race.lines.find((l) => l.boat === boat)!;
    const result = expected.get(boat)!;
    if (decided.has(boat)) {
      const { kind } = decided.get(boat)!;
      if (['DSQ', 'DNE', 'DGM'].includes(kind)) return true;
      return (
        (cell.heldPlace ?? null) === (line.code ? null : (result.place ?? null))
      );
    }
    const status = normalizeScoreStatus(cell.status);
    if (status !== (line.code ?? line.penalty ?? 'FINISHED')) return false;
    return line.code ? true : Number(cell.position) === result.place;
  });
  if (
    !unchanged &&
    sheet.lines.map(lineKey).join(',') !== race.lines.map(lineKey).join(',')
  ) {
    decisions.unshift({ type: 'raceCorrected', race: ref, lines: sheet.lines });
  }
  decisions.push(...noHeat);
  return decisions;
}
