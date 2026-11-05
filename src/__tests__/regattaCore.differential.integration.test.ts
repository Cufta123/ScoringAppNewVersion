/** @jest-environment node */
export {};

/**
 * regatta-core against the app. Each seed is a random event run twice: once
 * through the app's real handlers on a real SQLite database, once as a
 * decision log replayed by packages/regatta-core. After every step the two
 * must agree on every heat's boats and on the qualifying, final and overall
 * standings (totals and places).
 *
 * The steps: entries (some late), first heats, scoring (finishers, codes,
 * ties, ZFP/SCP) with the heats of a round and the final fleets in any
 * order, rounds by the Heat Movement Table or pre-assignment, race-office
 * corrections (also of a race with protest decisions in it), protest
 * decisions (DSQ, DPI, RDG1, RDG2 with the races the committee picks, RDG3;
 * on finishers and on boats with a code on the sheet), undoing a heat's
 * last race, the Final Series split and its races.
 *
 * Not generated: a second race in a heat of a several-heat qualifying
 * round (the scoring page offers no Score there, SHRS 3.2; the handler
 * itself does not refuse it), and ties that involve a ZFP/SCP/T1 boat: RRS
 * 44.3(c) 2025-2028 adds the penalty to her shared points (library), the app
 * to her place (docs/parity, "Found while checking the rules").
 *
 * Known differences decided in docs/parity ("library; app at switch") are
 * counted and printed, and end that event, instead of failing it: R8 (a DNC
 * for a boat with no heat in a 5.7 tie-break) and R9 (an RDG1/RDG2 with
 * nothing left to average).
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires, import/order
const { DatabaseSync } = require('node:sqlite');

const handlerRegistry: Record<string, (...args: any[]) => any> = {};

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel: string, callback: (...args: any[]) => any) => {
      handlerRegistry[channel] = callback;
    }),
    on: jest.fn(),
  },
  dialog: { showSaveDialog: jest.fn(), showOpenDialog: jest.fn() },
  app: { getPath: jest.fn(() => '/tmp') },
}));

const mockDbHolder: { current: any } = { current: null };
jest.mock('../../public/Database/DBManager', () => {
  // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
  const { createSqliteDbMock } = require('./fixtures/eventLifecycleSchema');
  // eslint-disable-next-line no-use-before-define
  return { db: createSqliteDbMock(mockDbHolderRef) };
});
const mockDbHolderRef = mockDbHolder;

/* eslint-disable import/first, import/order */
import { invalidateAssignmentSnapshotCache } from '../main/functions/raceAssignmentSnapshot';
import applyRaceColumnEdit from '../shared/raceColumnEdit';
import { payloadFor, prng, randomOutcome } from './fixtures/scoringOracle';
// The library is not an installed package; import its source.
// eslint-disable-next-line import/no-relative-packages
import * as core from '../../packages/regatta-core/src';
/* eslint-enable import/first, import/order */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { migrate } = require('../../public/Database/schema');

const call = (channel: string, ...args: any[]) =>
  handlerRegistry[channel]({}, ...args);

const PROFILES: Array<[string, core.DiscardProfile]> = [
  ['standard', { kind: 'standard' }],
  [JSON.stringify({ thresholds: [2, 5] }), { kind: 'thresholds', at: [2, 5] }],
  [
    JSON.stringify({
      firstDiscardAt: 3,
      secondDiscardAt: 6,
      additionalEvery: 3,
    }),
    { kind: 'custom', first: 3, second: 6, every: 3 },
  ],
  [JSON.stringify({ thresholds: [] }), { kind: 'none' }],
];
const NATIONS = ['CRO', 'ITA', 'GBR', 'AUS'];

/** "Heat A2" -> "A2", "Final Gold" -> "Gold". */
const coreHeatId = (name: string) => name.replace(/^(Heat|Final)\s+/, '');

interface AppHeat {
  heat_id: number;
  heat_name: string;
  heat_type: string;
}

/** Standings where SHRS 5.7 went round in a circle (see `settled`). */
const CIRCLES = new Set<string>();
/** Events stopped at parity R9, a stale average redress (`staleRedress`). */
const KNOWN_R9 = new Map<number, string>();
/** Events stopped at parity R8, a no-heat DNC in a tie-break (`settled`). */
const KNOWN_R8 = new Map<number, string>();
/** What the random events covered, so a quiet run is not an empty one. */
const COVERED: Record<string, number> = {};
const cover = (kind: string) => {
  COVERED[kind] = (COVERED[kind] ?? 0) + 1;
};

async function runEvent(seed: number): Promise<string[]> {
  invalidateAssignmentSnapshotCache();
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  mockDbHolder.current = db;
  const rand = prng(seed * 7919);
  const int = (lo: number, hi: number) =>
    lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const log: core.Decision[] = [];
  const problems: string[] = [];

  const eventId = Number(
    (
      await call(
        'insertEvent',
        `Diff ${seed}`,
        'Split',
        '2026-05-01',
        '2026-05-03',
      )
    ).lastInsertRowid,
  );
  const [qApp, qCore] = pick(PROFILES);
  const [fApp, fCore] = pick(PROFILES);
  const mode = rand() < 0.25 ? 'pre-assigned' : 'progressive';
  db.prepare(
    `UPDATE Events SET shrs_discard_profile_qualifying = ?,
       shrs_discard_profile_final = ?, shrs_qualifying_assignment_mode = ?
     WHERE event_id = ?`,
  ).run(qApp, fApp, mode, eventId);
  log.push({
    type: 'settingsChanged',
    settings: {
      qualifyingMode: mode,
      discards: { qualifying: qCore, final: fCore },
    },
  });

  const used = new Set<string>();
  let nextSail = 1;
  const enterBoat = async () => {
    let nat = '';
    let sail = 0;
    do {
      nat = pick(NATIONS);
      if (rand() < 0.15) sail = 5;
      else {
        sail = nextSail;
        nextSail += 1;
      }
    } while (used.has(`${nat} ${sail}`));
    used.add(`${nat} ${sail}`);
    const id = Number(
      db
        .prepare(
          "INSERT INTO Boats (sail_number, country, model) VALUES (?, ?, 'IOM')",
        )
        .run(sail, nat).lastInsertRowid,
    );
    await call('associateBoatWithEvent', id, eventId);
    log.push({
      type: 'boatEntered',
      boat: { id: String(id), nat, sail: String(sail) },
    });
  };

  const heats = () =>
    db
      .prepare(
        'SELECT heat_id, heat_name, heat_type FROM Heats WHERE event_id = ?',
      )
      .all(eventId) as AppHeat[];
  const boatsIn = (heatId: number) =>
    db
      .prepare(
        `SELECT b.boat_id, b.sail_number, b.country FROM Heat_Boat hb
         JOIN Boats b ON b.boat_id = hb.boat_id WHERE hb.heat_id = ? ORDER BY b.boat_id`,
      )
      .all(heatId) as {
      boat_id: number;
      sail_number: number;
      country: string;
    }[];
  const raceCount = (heatId: number) =>
    db.prepare('SELECT COUNT(*) AS n FROM Races WHERE heat_id = ?').get(heatId)
      .n as number;

  const state = () => {
    const result = core.replay(log);
    if (!result.ok)
      throw new Error(`core refused #${result.at}: ${result.reason}`);
    return result.state;
  };

  /** A random race as the scoring screen enters it, and as a core sheet. */
  const randomRace = (heatName: string, rows: ReturnType<typeof boatsIn>) => {
    const count = new Map<number, number>();
    rows.forEach((r) =>
      count.set(r.sail_number, (count.get(r.sail_number) ?? 0) + 1),
    );
    const names = rows.map((r) =>
      count.get(r.sail_number)! > 1
        ? `${r.country} ${r.sail_number}`
        : String(r.sail_number),
    );
    const ids = rows.map((_r, i) => i + 1);
    const outcome = randomOutcome(rand, heatName, ids);
    const payload = payloadFor(outcome, ids).map((p) => ({
      ...p,
      boatNumber: names[Number(p.boatNumber) - 1],
    }));
    const idOf = (i: number) => String(rows[i - 1].boat_id);
    const lines: core.RaceLine[] = outcome.crossed.map((i) => ({
      boat: idOf(i),
      ...(outcome.penalty.has(i)
        ? { penalty: outcome.penalty.get(i) as core.PenaltyCode }
        : {}),
      ...(outcome.tiedWithAbove.has(i) ? { tied: true } : {}),
    }));
    ids.forEach((i) => {
      if (!outcome.crossed.includes(i)) {
        lines.push({
          boat: idOf(i),
          code: outcome.penalty.get(i) as core.NoPlaceCode,
        });
      }
    });
    return { payload, lines };
  };

  const scoreHeat = async (heat: AppHeat) => {
    const rows = boatsIn(heat.heat_id);
    if (rows.length === 0) return;
    const { payload, lines } = randomRace(heat.heat_name, rows);
    await call('submitHeatRaceScoresAtomic', {
      heat_id: heat.heat_id,
      placeNumbers: payload,
    });
    // The app's own number for the race just scored names it in the log, so
    // the two numberings are checked against each other too.
    const { n } = db
      .prepare('SELECT MAX(race_number) AS n FROM Races WHERE heat_id = ?')
      .get(heat.heat_id) as { n: number };
    log.push({
      type: 'raceScored',
      race: { heat: coreHeatId(heat.heat_name), race: n },
      lines,
    });
  };

  const appRaces = () =>
    db
      .prepare(
        `SELECT r.race_id, r.race_number, h.heat_name, h.heat_type FROM Races r
         JOIN Heats h ON h.heat_id = r.heat_id WHERE h.event_id = ?`,
      )
      .all(eventId) as {
      race_id: number;
      race_number: number;
      heat_name: string;
      heat_type: string;
    }[];
  /**
   * A race for a correction or a protest decision: half the time one of the
   * heats still open (the current round, or the final fleets), so undoing
   * a race also meets the decisions about it.
   */
  const someRace = () => {
    const s = state();
    const open = new Set(
      (s.fleets ?? s.rounds[s.rounds.length - 1] ?? []).map((h) => h.id),
    );
    const all = appRaces();
    const recent = all.filter((r) => open.has(coreHeatId(r.heat_name)));
    return pick(recent.length > 0 && rand() < 0.5 ? recent : all);
  };
  /** Both sides must accept a step, or both refuse it. */
  const both = async (
    label: string,
    app: () => Promise<unknown>,
    decision: core.Decision,
  ) => {
    let appError: string | null = null;
    try {
      await app();
    } catch (error) {
      appError = (error as Error).message;
    }
    const coreResult = core.replay([...log, decision]);
    const coreError = coreResult.ok ? null : coreResult.reason;
    if ((appError === null) !== (coreError === null)) {
      problems.push(
        `${label}: app ${appError ?? 'accepted'}, core ${coreError ?? 'accepted'}`,
      );
    }
    if (appError === null && coreError === null) log.push(decision);
    return appError === null && coreError === null;
  };

  const refOf = (race: { heat_name: string; race_number: number }) => ({
    heat: coreHeatId(race.heat_name),
    race: race.race_number,
  });
  /** The library's race (sheet and protest decisions) for an app race. */
  const coreRace = (ref: core.RaceRef) =>
    [...state().rounds.flat(), ...(state().fleets ?? [])].find(
      (h) => h.id === ref.heat,
    )!.races[ref.race - 1];
  const scoreRows = (raceId: number) =>
    (
      db
        .prepare(
          `SELECT boat_id, position, points, COALESCE(status,'FINISHED') AS status,
                  held_place FROM Scores WHERE race_id = ? ORDER BY score_id`,
        )
        .all(raceId) as any[]
    ).map(({ held_place, ...row }) =>
      held_place != null ? { ...row, heldPlace: held_place } : row,
    ) as {
      boat_id: number;
      position: number;
      points: number;
      status: string;
      heldPlace?: number;
    }[];
  const OUT_OF_ORDER = new Set(['DSQ', 'DNE', 'DGM']);

  /**
   * The race office enters a race again: a new sheet for every boat the
   * protest committee has not decided about. A boat with a decision keeps
   * her line where it was on the sheet and her decision (the app keeps her
   * cell as it is; the library keeps `protests` beside the new sheet).
   */
  const correctRace = async () => {
    // Often a race with protest decisions in it.
    const decided = appRaces().filter(
      (r) => Object.keys(coreRace(refOf(r)).protests).length > 0,
    );
    const race =
      decided.length > 0 && rand() < 0.4 ? pick(decided) : someRace();
    if (!race) return '';
    const ref = refOf(race);
    const { lines: sheet, protests } = coreRace(ref);
    // The heat's boats: the race's scores also hold the DNCs the app files
    // there for boats that had no heat.
    const heat = heats().find((h) => h.heat_name === race.heat_name)!;
    const free = boatsIn(heat.heat_id).filter(
      (b) => !(String(b.boat_id) in protests),
    );
    // A race-office sheet: the app takes any DSQ/DNE/DGM it saves for a
    // protest decision (it does not record who decided), so a correction
    // here uses DNF instead; protest decisions are a step of their own.
    const lines: core.RaceLine[] =
      free.length > 0
        ? randomRace(race.heat_name, free).lines.map((line) =>
            line.code === 'DSQ' ? { ...line, code: 'DNF' as const } : line,
          )
        : [];
    sheet.forEach((line, i) => {
      if (line.boat in protests) {
        lines.splice(Math.min(i, lines.length), 0, { ...line });
      }
    });
    // A tie needs a finisher above, and never involves a ZFP/SCP/T1 boat:
    // there RRS 44.3(c) 2025-2028 (library) and the app differ on purpose
    // (see the header).
    let above: core.RaceLine | undefined;
    lines.forEach((line, i) => {
      if (line.code) return;
      if (line.tied && (!above || above.penalty || line.penalty)) {
        const { tied: _dropped, ...rest } = line;
        lines[i] = rest;
      }
      above = lines[i];
    });
    // Places as the edit screen shows them: boats level share a place, the
    // next boat takes the place after all of them (RRS A7); a disqualified
    // boat is out of the order (A6.1); redress and DPI keep their place
    // (A6.2) and their points.
    const slot = new Map<string, number>();
    const groups: string[][] = [];
    lines.forEach((line) => {
      if (line.code) return;
      if (line.tied && groups.length > 0) {
        groups[groups.length - 1].push(line.boat);
      } else groups.push([line.boat]);
    });
    let next = 1;
    groups.forEach((group) => {
      const holders = group.filter(
        (boat) => !OUT_OF_ORDER.has(protests[boat]?.kind ?? ''),
      );
      holders.forEach((boat) => slot.set(boat, next));
      next += holders.length;
    });
    const stored = new Map(
      scoreRows(race.race_id).map((row) => [String(row.boat_id), row]),
    );
    const cells = lines.map((line) => {
      if (line.boat in protests) {
        const kept = stored.get(line.boat)!;
        return {
          boatId: Number(line.boat),
          position: kept.position,
          status: kept.status,
          edited: false,
          ...(/^(RDG|DPI)/.test(kept.status)
            ? { heldPlace: slot.get(line.boat) ?? null }
            : {}),
        };
      }
      return {
        boatId: Number(line.boat),
        position: line.code ? lines.length : slot.get(line.boat)!,
        status: line.code ?? line.penalty ?? 'FINISHED',
        edited: true,
      };
    });
    const label =
      Object.keys(protests).length > 0
        ? 'a correction after a protest'
        : 'a correction';
    await both(
      label,
      () =>
        call(
          'saveLeaderboardRaceResultsAtomic',
          eventId,
          [{ raceId: String(race.race_id), cells }],
          race.heat_type === 'Final',
        ),
      { type: 'raceCorrected', race: ref, lines },
    );
    return label;
  };

  /**
   * A protest committee decision about one boat of the race's heat that has
   * none there yet: a finisher, a ZFP/SCP boat, or a boat with a code on
   * the sheet (DNF, OCS, …). RDG2 averages races the committee picks from
   * the ones her leaderboard row shows (counted races of the same series).
   */
  const decideProtest = async () => {
    const race = someRace();
    if (!race) return '';
    const ref = refOf(race);
    const { lines: sheet, protests } = coreRace(ref);
    const rows = scoreRows(race.race_id);
    const candidates = rows
      .map((row, index) => ({ row, index }))
      .filter(
        ({ row }) =>
          sheet.some((line) => line.boat === String(row.boat_id)) &&
          !(String(row.boat_id) in protests),
      );
    if (candidates.length === 0) return '';
    // Often a boat with a code on the sheet (DNF, OCS, …).
    const coded = candidates.filter(({ row }) =>
      sheet.some((l) => l.boat === String(row.boat_id) && l.code),
    );
    const { row, index } = pick(
      coded.length > 0 && rand() < 0.4 ? coded : candidates,
    );
    const line = sheet.find((l) => l.boat === String(row.boat_id))!;
    const maxBoats = await call('getMaxHeatSize', eventId, race.heat_type);
    let kind = pick(['DSQ', 'DPI', 'RDG3', 'RDG1', 'RDG2'] as const);
    let chosen: {
      race_id: number;
      race_number: number;
      heat_name: string;
    }[] = [];
    if (kind === 'RDG2') {
      const offered = db
        .prepare(
          `SELECT r.race_id, r.race_number, h.heat_name FROM Scores s
           JOIN Races r ON r.race_id = s.race_id
           JOIN Heats h ON h.heat_id = r.heat_id
           JOIN CountedRaces cr ON cr.race_id = r.race_id
           WHERE s.boat_id = ? AND h.event_id = ? AND h.heat_type = ?
             AND r.race_id <> ?
           ORDER BY r.race_id`,
        )
        .all(row.boat_id, eventId, race.heat_type, race.race_id) as {
        race_id: number;
        race_number: number;
        heat_name: string;
      }[];
      chosen = offered.filter(() => rand() < 0.5);
      if (chosen.length === 0 && offered.length > 0) chosen = [pick(offered)];
      if (chosen.length === 0) kind = 'RDG1';
    }
    const given = 1 + int(0, 8);
    const newPosition =
      kind === 'DSQ'
        ? row.position
        : kind === 'RDG1' || kind === 'RDG2'
          ? maxBoats + 1
          : given;
    const cells = applyRaceColumnEdit(
      rows.map((r) => ({
        position: r.position,
        points: r.points,
        status: r.status,
        ...(r.heldPlace != null ? { heldPlace: r.heldPlace } : {}),
      })),
      {
        index,
        previousPosition: row.position,
        previousStatus: row.status,
        newPosition,
        newPoints: newPosition,
        newStatus: kind,
        maxBoats,
      },
    );
    const outcome: core.ProtestOutcome =
      kind === 'DPI' || kind === 'RDG3'
        ? { kind, points: given }
        : kind === 'RDG2'
          ? { kind, races: chosen.map(refOf) }
          : { kind };
    const label = `a protest decision${line.code ? ' on a non-finisher' : ''}${
      kind === 'RDG2' ? ' (RDG2)' : ''
    }`;
    await both(
      label,
      () =>
        call(
          'saveLeaderboardRaceResultsAtomic',
          eventId,
          [
            {
              raceId: String(race.race_id),
              cells: cells.map((cell, i) => ({
                boatId: rows[i].boat_id,
                position: cell.position,
                status: cell.status,
                edited: i === index,
                ...(/^(RDG|DPI)/.test(cell.status)
                  ? { heldPlace: cell.heldPlace ?? null }
                  : {}),
                ...(i === index && kind === 'RDG2'
                  ? { rdgRaceIds: chosen.map((c) => c.race_id) }
                  : {}),
              })),
            },
          ],
          race.heat_type === 'Final',
        ),
      {
        type: 'protestDecided',
        race: ref,
        boat: String(row.boat_id),
        outcome,
      },
    );
    return label;
  };

  /**
   * Undo the last race of a heat (the scoring page's Undo race N). In the
   * library: that `raceScored` leaves the log with every later decision
   * about the race (corrections, protest decisions); an RDG2 that averaged
   * it keeps its other races, as the app keeps the stored race ids and
   * finds no race for the deleted one.
   */
  const undoRace = async () => {
    const s = state();
    const open = new Set(
      (s.fleets ?? s.rounds[s.rounds.length - 1] ?? []).map((h) => h.id),
    );
    const raced = heats().filter((h) => raceCount(h.heat_id) > 0);
    const openRaced = raced.filter((h) => open.has(coreHeatId(h.heat_name)));
    // Often a race with decisions about it (corrections, protests, RDG2
    // choices); now and then a closed heat, where both must refuse.
    const lastRef = (h: AppHeat) => ({
      heat: coreHeatId(h.heat_name),
      race: raceCount(h.heat_id),
    });
    const about = (r: core.RaceRef) => (d: core.Decision) =>
      ((d.type === 'raceCorrected' || d.type === 'protestDecided') &&
        d.race.heat === r.heat &&
        d.race.race === r.race) ||
      (d.type === 'protestDecided' &&
        d.outcome.kind === 'RDG2' &&
        d.outcome.races.some((x) => x.heat === r.heat && x.race === r.race));
    const withDecisions = openRaced.filter((h) => log.some(about(lastRef(h))));
    const roll = rand();
    const heat = pick(
      withDecisions.length > 0 && roll < 0.7
        ? withDecisions
        : openRaced.length > 0 && roll < 0.93
          ? openRaced
          : raced,
    );
    if (!heat) return '';
    const ref = {
      heat: coreHeatId(heat.heat_name),
      race: raceCount(heat.heat_id),
    };
    const sameRef = (r: core.RaceRef) =>
      r.heat === ref.heat && r.race === ref.race;
    let at = -1;
    log.forEach((d, i) => {
      if (d.type === 'raceScored' && sameRef(d.race)) at = i;
    });
    if (at < 0) {
      problems.push(
        `seed ${seed}: ${heat.heat_name} race ${ref.race} not in the log`,
      );
      return '';
    }
    const undone = log.flatMap((d, i): core.Decision[] => {
      if (i <= at) return i === at ? [] : [d];
      if (
        (d.type === 'raceCorrected' || d.type === 'protestDecided') &&
        sameRef(d.race)
      ) {
        return [];
      }
      if (d.type === 'protestDecided' && d.outcome.kind === 'RDG2') {
        return [
          {
            ...d,
            outcome: {
              kind: 'RDG2',
              races: d.outcome.races.filter((r) => !sameRef(r)),
            },
          },
        ];
      }
      return [d];
    });
    const label = `an undo${open.has(ref.heat) ? '' : ' of a closed heat'}`;
    let appError: string | null = null;
    try {
      await call('undoLastScoredRaceForHeat', heat.heat_id);
    } catch (error) {
      appError = (error as Error).message;
    }
    const coreResult = core.replay(undone);
    const coreError = coreResult.ok ? null : coreResult.reason;
    if ((appError === null) !== (coreError === null)) {
      problems.push(
        `seed ${seed}: undo ${heat.heat_name} race ${ref.race}: app ${appError ?? 'accepted'}, core ${coreError ?? 'accepted'}`,
      );
    }
    if (appError === null && coreError === null) {
      const later = log.slice(at + 1);
      const dropped = later.length - (undone.length - at);
      if (dropped > 0) cover('undo: decisions on the race dropped');
      if (
        later.some(
          (d) =>
            d.type === 'protestDecided' &&
            d.outcome.kind === 'RDG2' &&
            !sameRef(d.race) &&
            d.outcome.races.some(sameRef),
        )
      ) {
        cover('undo: race taken out of an RDG2');
      }
      log.splice(0, log.length, ...undone);
    }
    return label;
  };

  /**
   * Parity R9 (docs/parity, "library; app at switch"): an RDG1/RDG2 with
   * no race left to average. The library scores it as no place (largest
   * heat + 1) on every read; the app keeps the points it stored last (an
   * average of races since undone or no longer counted, or the DNF score
   * of a smaller largest heat). Returns those redress scores where the two
   * differ.
   */
  const staleRedress = (s: core.EventState) => {
    const raceIn = (ref: core.RaceRef) =>
      [...s.rounds.flat(), ...(s.fleets ?? [])].find((h) => h.id === ref.heat)!
        .races[ref.race - 1];
    const averaged = (code?: string) => code === 'RDG1' || code === 'RDG2';
    const found: string[] = [];
    [
      core.qualifyingStandings(s).standings,
      ...(s.fleets ? core.finalStandings(s).map((f) => f.standings) : []),
    ].forEach((standings) =>
      standings.forEach(({ boat, scores }) =>
        scores.forEach((score) => {
          const { ref } = score;
          if (!ref || !averaged(score.code)) return;
          const outcome = raceIn(ref).protests[boat];
          const chosen = outcome?.kind === 'RDG2' ? outcome.races : null;
          const pool = scores.filter(
            (other) =>
              other.race !== score.race &&
              !averaged(other.code) &&
              (!chosen ||
                chosen.some(
                  (r) =>
                    other.ref?.heat === r.heat && other.ref?.race === r.race,
                )),
          );
          if (pool.length > 0) return;
          const app = db
            .prepare(
              `SELECT s.points FROM Scores s JOIN Races r ON r.race_id = s.race_id
               JOIN Heats h ON h.heat_id = r.heat_id
               WHERE h.event_id = ? AND h.heat_name IN (?, ?)
                 AND r.race_number = ? AND s.boat_id = ?`,
            )
            .get(
              eventId,
              `Heat ${ref.heat}`,
              `Final ${ref.heat}`,
              ref.race,
              Number(boat),
            ) as { points: number } | undefined;
          if (app && app.points !== score.points) {
            found.push(
              `${boat} ${score.code} in ${ref.heat} race ${ref.race}: app ${app.points}, core ${score.points}`,
            );
          }
        }),
      ),
    );
    return found;
  };

  /** False when the standings were not compared (a known difference). */
  const compare = async (step: string) => {
    const s = state();
    const where = `seed ${seed}, after ${step}`;
    const stale = staleRedress(s);
    if (stale.length > 0) {
      KNOWN_R9.set(seed, `after ${step}: ${stale.join('; ')}`);
      return false;
    }
    const diff = (
      name: string,
      a: Map<string, string>,
      b: Map<string, string>,
      known: (boat: string) => boolean = () => false,
    ) => {
      const boats = new Set([...a.keys(), ...b.keys()]);
      const wrong = [...boats].filter((boat) => a.get(boat) !== b.get(boat));
      if (wrong.length === 0) return false;
      const text = `${name} ${wrong
        .map((boat) => `${boat} app ${a.get(boat)} core ${b.get(boat)}`)
        .join('; ')}`;
      if (wrong.every(known)) {
        KNOWN_R8.set(seed, `after ${step}: ${text}`);
        return true;
      }
      problems.push(`${where}: ${text}`);
      return false;
    };

    /**
     * Parity R8 (docs/parity, "library; app at switch"): a boat with no
     * heat in a qualifying race is scored DNC; the app files the row under
     * a heat of that round, and its SHRS 5.7(ii) tie-break then counts the
     * race as one she sailed with that heat's boats. The library shares it
     * with nobody (5.7(ii)(1)). Pairs of boats that "met" only that way.
     */
    const metOnlyInTheApp = new Set(
      (
        db
          .prepare(
            `SELECT s.boat_id AS a, hb.boat_id AS b FROM Scores s
             JOIN Races r ON r.race_id = s.race_id
             JOIN Heats h ON h.heat_id = r.heat_id
             JOIN Heat_Boat hb ON hb.heat_id = h.heat_id
             WHERE h.event_id = ? AND NOT EXISTS (
               SELECT 1 FROM Heat_Boat x
               WHERE x.heat_id = h.heat_id AND x.boat_id = s.boat_id)`,
          )
          .all(eventId) as { a: number; b: number }[]
      ).flatMap(({ a, b }) => [`${a}|${b}`, `${b}|${a}`]),
    );

    /**
     * Places compared exactly. Where SHRS 5.7 goes round in a circle (A
     * ahead of B ahead of C ahead of A) both settle it the same way: the
     * boat no tied boat beats first, a true circle by plain RRS A8. Circles
     * are counted; outside one, an order that puts a boat above one that
     * beats her head-to-head is an error. A difference only among boats
     * tied with an R8 pair is counted as R8 (returns true).
     */
    type Row = { boat: string; total: number; place: number; group: string };
    const settled = (
      name: string,
      appRows: Row[],
      coreRows: Array<Row & { circular?: boolean }>,
      tie: (a: string, b: string) => number,
    ) => {
      const groupsOf = (rows: Row[]) => {
        const groups = new Map<string, Row[]>();
        rows.forEach((row) =>
          groups.set(row.group, [...(groups.get(row.group) ?? []), row]),
        );
        return groups;
      };
      const groups = groupsOf(appRows);
      const coreGroups = groupsOf(coreRows);
      const r8 = (group: Row[] = []) =>
        group.some((x) =>
          group.some((y) => metOnlyInTheApp.has(`${x.boat}|${y.boat}`)),
        );
      const r8Groups = new Set(
        [...groups, ...coreGroups]
          .filter(([, group]) => r8(group))
          .map(([key]) => key),
      );
      // In a true circle every order puts someone above a boat that beats
      // her; elsewhere no order may.
      const circular = new Set(
        coreRows.filter((r) => r.circular).map((r) => r.group),
      );
      groups.forEach((group, key) => {
        if (circular.has(key) || r8Groups.has(key)) return;
        group.forEach((x) =>
          group.forEach((y) => {
            if (x.place < y.place && tie(y.boat, x.boat) < 0) {
              problems.push(
                `${where}: ${name} app puts ${x.boat} above ${y.boat}, who beats her under 5.7`,
              );
            }
          }),
        );
      });
      if (coreRows.some((row) => row.circular)) CIRCLES.add(`${seed}:${name}`);
      const view = (rows: Row[]) =>
        new Map(rows.map((row) => [row.boat, `${row.total}@${row.place}`]));
      const groupOf = (rows: Row[], boat: string) =>
        rows.find((row) => row.boat === boat)?.group ?? '';
      return diff(
        name,
        view(appRows),
        view(coreRows),
        (boat) =>
          r8Groups.has(groupOf(appRows, boat)) &&
          r8Groups.has(groupOf(coreRows, boat)),
      );
    };

    await call('readLeaderboard', eventId);
    const qTie = core.qualifyingTieBreak(s);
    const r8InQualifying = settled(
      'qualifying',
      (
        db
          .prepare(
            'SELECT boat_id, total_points_event, place FROM Leaderboard WHERE event_id = ?',
          )
          .all(eventId) as any[]
      ).map((r) => ({
        boat: String(r.boat_id),
        total: r.total_points_event,
        place: r.place,
        group: String(r.total_points_event),
      })),
      core
        .qualifyingStandings(s)
        .standings.map((r) => ({ ...r, group: String(r.total) })),
      qTie,
    );
    // The fleet split ranks the qualifying standings: an R8 difference
    // there can move boats between fleets, so the event stops here.
    if (r8InQualifying) return false;

    if (s.fleets) {
      await call('readFinalLeaderboard', eventId);
      const fleets = core.finalStandings(s);
      const raced = new Set(
        fleets.filter((f) => f.races > 0).map((f) => f.fleet),
      );
      const appF = new Map(
        (
          db
            .prepare(
              'SELECT boat_id, total_points_final, placement_group, place FROM FinalLeaderboard WHERE event_id = ?',
            )
            .all(eventId) as any[]
        ).map((r) => [
          String(r.boat_id),
          `${r.placement_group} ${r.total_points_final}${raced.has(r.placement_group) ? `@${r.place}` : ''}`,
        ]),
      );
      const coreF = new Map(
        fleets.flatMap((f) =>
          f.standings.map((r) => [
            r.boat,
            `${f.fleet} ${r.total}${f.races > 0 ? `@${r.place}` : ''}`,
          ]),
        ),
      );
      diff('final', appF, coreF);
    }

    const finalRaced = (s.fleets ?? []).some((f) => f.races.length > 0);
    const r8InOverall = settled(
      'overall',
      ((await call('readOverallLeaderboard', eventId)) as any[]).map((r) => ({
        boat: String(r.boat_id),
        total: r.overall_points,
        place: r.overall_rank ?? r.place,
        group: finalRaced
          ? `${r.placement_group} ${r.overall_points}`
          : String(r.overall_points),
      })),
      core.overallStandings(s).map((r) => ({
        ...r,
        group: finalRaced ? `${r.fleet} ${r.total}` : String(r.total),
      })),
      finalRaced ? core.overallTieBreak(s) : qTie,
    );
    if (r8InOverall) return false;

    // Heats last: a difference in the standings explains one in the fleets.
    heats().forEach((heat) => {
      const appBoats = boatsIn(heat.heat_id)
        .map((b) => String(b.boat_id))
        .sort();
      const found = s.rounds
        .flat()
        .concat(s.fleets ?? [])
        .find((h) => h.id === coreHeatId(heat.heat_name));
      const coreBoats = [...(found?.boats ?? [])].sort();
      if (appBoats.join() !== coreBoats.join()) {
        problems.push(
          `${where}: ${heat.heat_name} app [${appBoats}] core [${coreBoats}]`,
        );
      }
    });

    return true;
  };

  try {
    for (let i = int(4, 26); i > 0; i -= 1) {
      // eslint-disable-next-line no-await-in-loop
      await enterBoat();
    }
    const boatCount = log.filter((d) => d.type === 'boatEntered').length;
    const heatCount = Math.max(
      Math.ceil(boatCount / 20),
      Math.min(boatCount, int(1, 3)),
    );
    await call('createInitialHeatsAtomic', eventId, heatCount);
    log.push({ type: 'heatsCreated', heatCount });
    await compare('the first heats');

    const steps = int(12, 34);
    for (let step = 0; step < steps && problems.length === 0; step += 1) {
      const s = state();
      const next = core.nextStep(s);
      const r = rand();
      let label = '';
      if (r < 0.07 && !s.fleets) {
        label = 'a late entry';
        // eslint-disable-next-line no-await-in-loop
        await enterBoat();
      } else if (r < 0.15) {
        // eslint-disable-next-line no-await-in-loop
        label = await correctRace();
      } else if (r < 0.24) {
        // eslint-disable-next-line no-await-in-loop
        label = await decideProtest();
      } else if (r < 0.32) {
        // eslint-disable-next-line no-await-in-loop
        label = await undoRace();
      } else if (next.kind === 'createRound') {
        if (s.rounds.length >= 2 && rand() < 0.4) {
          label = 'the final split';
          // eslint-disable-next-line no-await-in-loop
          await both(
            label,
            () => call('startFinalSeriesAtomic', eventId, false, true),
            {
              type: 'finalSeriesStarted',
            },
          );
        } else {
          label = `round ${next.round}`;
          // eslint-disable-next-line no-await-in-loop
          await both(
            label,
            () => call('createNewHeatsBasedOnLeaderboard', eventId),
            {
              type: 'roundCreated',
            },
          );
        }
      } else if (next.kind === 'score') {
        // Not always the heat the library would name next: the heats of a
        // qualifying round in any order, and any final fleet (SHRS 4.5).
        const round = s.rounds[s.rounds.length - 1];
        const open = (
          s.fleets ??
          (round.length > 1 ? round.filter((h) => h.races.length === 0) : round)
        ).filter((h) => h.boats.length > 0);
        const id = open.length > 1 && rand() < 0.6 ? pick(open).id : next.heat;
        const heat = heats().find((h) => coreHeatId(h.heat_name) === id)!;
        label = `scoring${id === next.heat ? '' : ' out of order'} ${heat.heat_name} race ${raceCount(heat.heat_id) + 1}`;
        // eslint-disable-next-line no-await-in-loop
        await scoreHeat(heat);
      }
      if (label) {
        const kind = label
          .replace(/ (\d+|Heat.*|Final.*)$/, '')
          .replace(/^(scoring( out of order)?).*/, '$1');
        COVERED[kind] = (COVERED[kind] ?? 0) + 1;
        // A known difference (R9) ends the event: what follows can depend
        // on it (the final split ranks the qualifying standings).
        // eslint-disable-next-line no-await-in-loop
        if (!(await compare(label))) break;
      }
    }
  } catch (error) {
    problems.push(`seed ${seed}: ${(error as Error).stack}`);
  } finally {
    if (problems.length > 0 && process.env.DIFF_DUMP) {
      // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
      require('fs').writeFileSync(
        `${process.env.DIFF_DUMP}/seed-${seed}.json`,
        JSON.stringify(
          {
            problems,
            log,
            appSeries: (
              db
                .prepare('SELECT boat_id FROM Boat_Event WHERE event_id = ?')
                .all(eventId) as any[]
            ).map((r) => ({
              boat: r.boat_id,
              // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
              scores:
                require('../main/functions/calculateBoatScores').getScoresForA81(
                  eventId,
                  r.boat_id,
                ),
            })),
            scores: db
              .prepare(
                `SELECT h.heat_name, r.race_number, s.boat_id, s.position, s.points, s.status
                 FROM Scores s JOIN Races r ON r.race_id = s.race_id
                 JOIN Heats h ON h.heat_id = r.heat_id ORDER BY r.race_id, s.position`,
              )
              .all(),
            // SHRS 3.1(5): the places the app froze for protest decisions.
            frozen: db
              .prepare(
                `SELECT h.heat_name, r.race_number, f.rank, f.boat_id,
                        f.frozen_position, f.frozen_status
                 FROM RaceAssignmentSnapshots f
                 JOIN Races r ON r.race_id = f.race_id
                 JOIN Heats h ON h.heat_id = r.heat_id ORDER BY f.race_id, f.rank`,
              )
              .all(),
          },
          null,
          1,
        ),
      );
    }
    db.close();
  }
  return problems;
}

describe('regatta-core agrees with the app', () => {
  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../main/ipcHandlers/EventHandler');
    require('../main/ipcHandlers/HeatRaceHandler');
  });
  afterAll(() => {
    jest.restoreAllMocks();
    process.stdout.write(
      `regatta-core vs app: 5.7 circles in ${CIRCLES.size} standings\n` +
        `parity R9 (stale RDG1/RDG2 average, known): ${KNOWN_R9.size} events stopped${[
          ...KNOWN_R9,
        ]
          .map(([seed, what]) => `\n  seed ${seed} ${what}`)
          .join('')}\n` +
        `parity R8 (no-heat DNC in a 5.7 tie-break, known): ${KNOWN_R8.size} events stopped${[
          ...KNOWN_R8,
        ]
          .map(([seed, what]) => `\n  seed ${seed} ${what}`)
          .join('')}\n` +
        `steps compared: ${JSON.stringify(COVERED)}\n`,
    );
  });

  const SEEDS = Array.from(
    { length: Number(process.env.DIFF_SEEDS || 60) },
    (_v, i) => i + 1,
  );

  it.each(SEEDS)('event %i', async (seed) => {
    expect(await runEvent(seed)).toEqual([]);
  });
});
