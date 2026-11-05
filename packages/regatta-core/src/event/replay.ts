/**
 * Replaying the decision log. Each decision is checked against the event as
 * the decisions before it left it; a decision the rules do not allow is
 * refused with the reason, in words for the race officer.
 *
 * Because the log is the event, undo is "take the decision out and replay",
 * and the same checks then tell whether anything later depended on it.
 */
import {
  DEFAULT_SETTINGS,
  type Boat,
  type BoatId,
  type Decision,
  type RaceLine,
  type RaceRef,
} from '../types';
import { MAX_HEAT_SIZE, fleetName, splitIntoFleets } from '../rules/fleets';
import {
  compareBoats,
  compareRecorded,
  nextHeat,
  serpentine,
} from '../rules/seeding';
import {
  boatById,
  currentRound,
  findHeat,
  findRace,
  groupLetter,
  type EventState,
  type Heat,
} from './state';
import { finalSplitRanking } from '../standings/qualifying';

/** The most heats a round can have: they are lettered A to Z. */
export const MAX_HEATS = 26;

class Refusal extends Error {}

function refuse(reason: string): never {
  throw new Refusal(reason);
}

export function emptyEvent(): EventState {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    boats: [],
    rounds: [],
    fleets: null,
  };
}

const label = (state: EventState, id: BoatId) => {
  const boat = boatById(state, id);
  return boat ? `${boat.nat} ${boat.sail}` : id;
};

const qualifyingStarted = (state: EventState) =>
  state.rounds.some((round) => round.some((heat) => heat.races.length > 0));

const finalStarted = (state: EventState) => state.fleets !== null;

/** Every heat of the current round has sailed the same number of races. */
function roundComplete(state: EventState): boolean {
  const counts = currentRound(state)
    .filter((heat) => heat.boats.length > 0)
    .map((heat) => heat.races.length);
  return counts.length > 0 && counts.every((n) => n === counts[0] && n > 0);
}

/** A sheet must list every boat of the heat once, and make sense. */
function checkLines(state: EventState, heat: Heat, lines: RaceLine[]) {
  const seen = new Set<BoatId>();
  lines.forEach((line, index) => {
    if (!heat.boats.includes(line.boat)) {
      refuse(`${label(state, line.boat)} is not in ${heat.id}.`);
    }
    if (seen.has(line.boat)) {
      refuse(`${label(state, line.boat)} is listed twice.`);
    }
    seen.add(line.boat);
    if (line.code && (line.penalty || line.tied)) {
      refuse(
        `${label(state, line.boat)} has ${line.code}, so she has no place to keep or share.`,
      );
    }
    if (line.tied) {
      const above = lines.slice(0, index).filter((l) => !l.code);
      if (above.length === 0) {
        refuse(`${label(state, line.boat)} is tied with no finisher above.`);
      }
    }
  });
  const missing = heat.boats.filter((boat) => !seen.has(boat));
  if (missing.length > 0) {
    refuse(
      `Every boat of ${heat.id} needs a result. Missing: ${missing
        .map((boat) => label(state, boat))
        .join(', ')}.`,
    );
  }
}

function scorableHeat(state: EventState, id: string): Heat {
  const heat = findHeat(state, id) ?? refuse(`There is no heat ${id}.`);
  if (heat.series === 'qualifying') {
    if (finalStarted(state)) {
      refuse('The Final Series has started: qualifying heats are closed.');
    }
    if (!currentRound(state).includes(heat)) {
      refuse(`${id} is from an earlier round; that round is closed.`);
    }
  }
  return heat;
}

function raceOf(state: EventState, ref: RaceRef) {
  return findRace(state, ref) ?? refuse(`${ref.heat} has no race ${ref.race}.`);
}

function enter(state: EventState, boat: Boat) {
  if (finalStarted(state)) {
    refuse('The Final Series has started: no more entries.');
  }
  if (boatById(state, boat.id)) refuse(`${boat.id} is already entered.`);
  if (state.boats.some((other) => compareBoats(other, boat) === 0)) {
    refuse(`${boat.nat} ${boat.sail} is already entered.`);
  }
  state.boats.push({ ...boat });
}

function remove(state: EventState, id: BoatId) {
  if (!boatById(state, id)) refuse(`${id} is not entered.`);
  const sailed = [...state.rounds.flat(), ...(state.fleets ?? [])].some(
    (heat) => heat.boats.includes(id) && heat.races.length > 0,
  );
  if (sailed) {
    refuse(
      `${label(state, id)} has raced; she stays in the results (score her DNC or RET instead).`,
    );
  }
  state.boats = state.boats.filter((boat) => boat.id !== id);
  state.rounds.flat().forEach((heat) => {
    // eslint-disable-next-line no-param-reassign
    heat.boats = heat.boats.filter((boat) => boat !== id);
  });
}

function createHeats(state: EventState, heatCount: number, seeding?: BoatId[]) {
  if (finalStarted(state) || qualifyingStarted(state)) {
    refuse('Racing has started: the first round can no longer be redrawn.');
  }
  if (!Number.isInteger(heatCount) || heatCount < 1 || heatCount > MAX_HEATS) {
    refuse(`The number of heats must be 1 to ${MAX_HEATS}.`);
  }
  const boats = state.boats.length;
  if (boats < heatCount)
    refuse(`${boats} boats cannot fill ${heatCount} heats.`);
  if (Math.ceil(boats / heatCount) > MAX_HEAT_SIZE) {
    refuse(
      `${heatCount} heats would put more than ${MAX_HEAT_SIZE} boats in a heat (SHRS 2.3).`,
    );
  }
  let order: BoatId[];
  if (seeding) {
    const entered = new Set(state.boats.map((boat) => boat.id));
    if (
      seeding.length !== entered.size ||
      new Set(seeding).size !== seeding.length ||
      seeding.some((id) => !entered.has(id))
    ) {
      refuse('The seeding list must list every entered boat once.');
    }
    order = seeding;
  } else {
    order = [...state.boats].sort(compareBoats).map((boat) => boat.id);
  }
  const heats: Heat[] = Array.from({ length: heatCount }, (_v, index) => ({
    id: `${groupLetter(index)}1`,
    series: 'qualifying' as const,
    index,
    round: 1,
    boats: [],
    races: [],
  }));
  serpentine(order.length, heatCount).forEach((heatIndex, i) => {
    heats[heatIndex].boats.push(order[i]);
  });
  // eslint-disable-next-line no-param-reassign
  state.rounds = [heats];
}

function assign(state: EventState, id: BoatId, heatId: string) {
  if (!boatById(state, id)) refuse(`${id} is not entered.`);
  if (finalStarted(state)) refuse('The Final Series has started.');
  const heat = findHeat(state, heatId) ?? refuse(`There is no heat ${heatId}.`);
  const round = currentRound(state);
  if (!round.includes(heat)) refuse(`${heatId} is not in the current round.`);
  if (round.some((other) => other.boats.includes(id))) {
    refuse(`${label(state, id)} is already in a heat of this round.`);
  }
  if (heat.boats.length >= MAX_HEAT_SIZE) {
    refuse(`${heatId} already has ${MAX_HEAT_SIZE} boats (SHRS 2.3).`);
  }
  heat.boats.push(id);
}

/** SHRS 3.1(2)-(4): a heat's boats in the order the movement table reads. */
function movementOrder(state: EventState, heat: Heat): BoatId[] {
  const last = heat.races[heat.races.length - 1];
  let slot = 0;
  const recorded = heat.boats.map((id) => {
    const line = last.lines.find((l) => l.boat === id);
    return { boat: boatById(state, id)!, code: line ? line.code : 'DNC' };
  });
  // Finishing slots follow the sheet's order.
  const slots = new Map<BoatId, number>();
  last.lines.forEach((line) => {
    if (line.code) return;
    if (!line.tied) slot += 1;
    slots.set(line.boat, slot);
  });
  return recorded
    .map((row) => ({ ...row, slot: slots.get(row.boat.id) }))
    .sort(compareRecorded)
    .map((row) => row.boat.id);
}

function createRound(state: EventState) {
  if (finalStarted(state)) refuse('The Final Series has started.');
  const round = currentRound(state);
  if (round.length < 2) {
    refuse(
      round.length === 0
        ? 'Create the heats first.'
        : 'With one heat the fleet sails as one; keep scoring races in it.',
    );
  }
  if (!roundComplete(state)) {
    refuse('Every heat of this round must sail the same races first.');
  }
  const number = state.rounds.length + 1;
  const next: Heat[] = round.map((heat) => ({
    id: `${groupLetter(heat.index)}${number}`,
    series: 'qualifying' as const,
    index: heat.index,
    round: number,
    boats: [],
    races: [],
  }));
  round.forEach((heat) => {
    if (state.settings.qualifyingMode === 'pre-assigned') {
      // SHRS 3.2: the published assignment; boats keep their heat.
      next[heat.index].boats.push(...heat.boats);
      return;
    }
    movementOrder(state, heat).forEach((id, rank) => {
      next[nextHeat(heat.index, rank + 1, round.length)].boats.push(id);
    });
  });
  state.rounds.push(next);
}

function startFinal(state: EventState, rule43: boolean) {
  if (finalStarted(state)) refuse('The Final Series has already started.');
  const round = currentRound(state);
  if (round.length < 2) {
    refuse('With one heat there is no Final Series (SHRS 1.1).');
  }
  if (!roundComplete(state)) {
    refuse('Every heat of this round must sail the same races first.');
  }
  const { ranked, withdrawn } = finalSplitRanking(state, rule43);
  const split = splitIntoFleets(
    ranked,
    (id) => withdrawn.has(id),
    round.length,
    state.settings.finalOverflow,
  );
  if (!split.ok) refuse(split.reason);
  // eslint-disable-next-line no-param-reassign
  state.fleets = split.fleets.map((boats, index) => ({
    id: fleetName(index),
    series: 'final' as const,
    index,
    round: 0,
    boats,
    races: [],
  }));
}

function changeSettings(
  state: EventState,
  change: Decision & { type: 'settingsChanged' },
) {
  const { settings } = change;
  if (settings.qualifyingMode && qualifyingStarted(state)) {
    refuse(
      'The qualifying series has started: its assignment method is fixed.',
    );
  }
  if (settings.discards?.qualifying && qualifyingStarted(state)) {
    refuse(
      'Discards change only before the first race of the series (SHRS 5.4).',
    );
  }
  if (
    settings.discards?.final &&
    (state.fleets ?? []).some((fleet) => fleet.races.length > 0)
  ) {
    refuse(
      'Discards change only before the first race of the series (SHRS 5.4).',
    );
  }
  if (settings.finalOverflow && finalStarted(state)) {
    refuse('The fleets are already made.');
  }
  // eslint-disable-next-line no-param-reassign
  state.settings = {
    ...state.settings,
    ...settings,
    discards: { ...state.settings.discards, ...settings.discards },
  };
}

function decideProtest(
  state: EventState,
  decision: Decision & { type: 'protestDecided' },
) {
  const race = raceOf(state, decision.race);
  if (!race.lines.some((line) => line.boat === decision.boat)) {
    refuse(`${label(state, decision.boat)} did not sail this race.`);
  }
  const { outcome } = decision;
  if (outcome.kind === 'RDG2') {
    const { series } = findHeat(state, decision.race.heat)!;
    outcome.races.forEach((ref) => {
      raceOf(state, ref);
      if (findHeat(state, ref.heat)!.series !== series) {
        refuse('Redress averages stay within one series (SHRS 5.6).');
      }
      if (ref.heat === decision.race.heat && ref.race === decision.race.race) {
        refuse('The redressed race cannot be in its own average.');
      }
    });
  }
  if (outcome.kind === 'cleared') {
    delete race.protests[decision.boat];
  } else {
    race.protests[decision.boat] = structuredClone(outcome);
  }
}

function applyDecision(state: EventState, decision: Decision) {
  switch (decision.type) {
    case 'settingsChanged':
      return changeSettings(state, decision);
    case 'boatEntered':
      return enter(state, decision.boat);
    case 'boatRemoved':
      return remove(state, decision.boat);
    case 'heatsCreated':
      return createHeats(state, decision.heatCount, decision.seeding);
    case 'boatAssigned':
      return assign(state, decision.boat, decision.heat);
    case 'raceScored': {
      const heat = scorableHeat(state, decision.heat);
      checkLines(state, heat, decision.lines);
      heat.races.push({
        ref: { heat: heat.id, race: heat.races.length + 1 },
        lines: structuredClone(decision.lines),
        protests: {},
      });
      return undefined;
    }
    case 'raceCorrected': {
      const race = raceOf(state, decision.race);
      checkLines(state, findHeat(state, decision.race.heat)!, decision.lines);
      race.lines = structuredClone(decision.lines);
      return undefined;
    }
    case 'protestDecided':
      return decideProtest(state, decision);
    case 'roundCreated':
      return createRound(state);
    case 'finalSeriesStarted':
      return startFinal(state, decision.rule43 ?? true);
    default: {
      const unknown: never = decision;
      return refuse(`Unknown decision ${JSON.stringify(unknown)}.`);
    }
  }
}

export type ReplayResult =
  | { ok: true; state: EventState }
  | {
      ok: false;
      /** Index of the refused decision in the log. */
      at: number;
      reason: string;
      /** The event as the decisions before it left it. */
      state: EventState;
    };

/** The event after every decision in `log`, or the first refusal. */
export function replay(log: readonly Decision[]): ReplayResult {
  const state = emptyEvent();
  for (let at = 0; at < log.length; at += 1) {
    try {
      applyDecision(state, log[at]);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      // A refused decision may have half-applied: the event before it is
      // the replay of the decisions before it.
      const before = replay(log.slice(0, at));
      return {
        ok: false,
        at,
        reason: error.message,
        state: before.state,
      };
    }
  }
  return { ok: true, state };
}
