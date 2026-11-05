/**
 * Builders for Final Series scenarios ported from the app's old final and
 * overall tests: a one-race qualifying series, then fleets as given, then
 * fleet races written as the points each named boat scores.
 */
import { type Decision, type RaceLine, type Settings } from '../../src';
import { enter, stateOf } from './helpers';

/**
 * Every boat entered (CRO, sail numbers in the order given), two heats (more
 * past 40 boats), one qualifying race in each (finishing in heat order), then
 * the Final Series with these fleets, Gold first.
 */
export function finalEvent(
  fleets: string[][],
  settings: Partial<Settings> = {},
): Decision[] {
  const ids = fleets.flat();
  const log: Decision[] = [
    { type: 'settingsChanged', settings },
    ...ids.map((id, i) => enter(id, 'CRO', String(i + 1))),
    {
      type: 'heatsCreated',
      heatCount: Math.max(2, Math.ceil(ids.length / 20)),
    },
  ];
  const heats = stateOf(log).rounds[0];
  heats.forEach((heat) =>
    log.push({
      type: 'raceScored',
      race: { heat: heat.id, race: 1 },
      lines: heat.boats.map((boat) => ({ boat })),
    }),
  );
  log.push({ type: 'finalSeriesStarted', fleets });
  return log;
}

/**
 * A fleet race where each named boat scores the points given (her place),
 * or has a code; the fleet's other boats fill the free places in order.
 */
export function pointsRace(
  fleet: string,
  race: number,
  boats: readonly string[],
  points: Record<string, number | 'DNF' | 'DNC' | 'DNS'>,
): Decision {
  const coded = boats.filter((b) => typeof points[b] === 'string');
  const finishers = boats.filter((b) => !coded.includes(b));
  const slots: (string | undefined)[] = Array(finishers.length).fill(undefined);
  finishers.forEach((b) => {
    if (typeof points[b] === 'number') {
      const at = (points[b] as number) - 1;
      if (slots[at] !== undefined) throw new Error(`place ${at + 1} twice`);
      slots[at] = b;
    }
  });
  const rest = finishers.filter((b) => points[b] === undefined);
  const order = slots.map((s) => s ?? rest.shift()!);
  const lines: RaceLine[] = [
    ...order.map((boat) => ({ boat })),
    ...coded.map((boat) => ({
      boat,
      code: points[boat] as 'DNF' | 'DNC' | 'DNS',
    })),
  ];
  return { type: 'raceScored', race: { heat: fleet, race }, lines };
}

/** Boats f1 … fn (prefix `p`). */
export const named = (p: string, n: number) =>
  Array.from({ length: n }, (_v, i) => `${p}${i + 1}`);
