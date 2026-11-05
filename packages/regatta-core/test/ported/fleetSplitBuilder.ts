/**
 * Qualifying series with chosen scores for a few boats, for the SHRS 4.2 /
 * 4.3 fleet split scenarios ported from the app's fleetAssignment tests.
 *
 * Heats are pre-assigned (SHRS 3.2), so every boat keeps her heat. Each heat
 * has `heatSize` boats: the featured boats and fillers, which take the
 * finishing places the featured boats leave free.
 */
import {
  replay,
  type Decision,
  type DiscardProfile,
  type EventState,
  type NoPlaceCode,
} from '../../src';
import { stateOf } from './helpers';

/** A finishing place, a code, or a place scored with RDG3 points. */
export type Planned = number | NoPlaceCode | { place: number; points: number };

export interface Featured {
  /** Heat index (0 = A); null: entered after the heats, never in one. */
  heat: number | null;
  /** One entry per race; a late boat's races before she joins are null. */
  scores: (Planned | null)[];
  /** Entered after the heats were made; joins her heat from this round. */
  joinsRound?: number;
}

export interface SplitPlan {
  heats: number;
  heatSize: number;
  races: number;
  featured: Record<string, Featured>;
  discards?: DiscardProfile;
  rule43?: boolean;
}

export function splitLog(plan: SplitPlan): Decision[] {
  const ids = Object.keys(plan.featured);
  const log: Decision[] = [
    {
      type: 'settingsChanged',
      settings: {
        qualifyingMode: 'pre-assigned',
        ...(plan.discards
          ? {
              discards: {
                qualifying: plan.discards,
                final: { kind: 'standard' },
              },
            }
          : {}),
      },
    },
  ];
  let sail = 1;
  const enter = (id: string) => {
    sail += 1;
    log.push({
      type: 'boatEntered',
      boat: { id, nat: 'CRO', sail: String(sail) },
    });
  };

  const early = ids.filter(
    (id) => plan.featured[id].heat !== null && !plan.featured[id].joinsRound,
  );
  const heats: string[][] = Array.from({ length: plan.heats }, (_v, h) => {
    const own = early.filter((id) => plan.featured[id].heat === h);
    const fillers = Array.from(
      { length: plan.heatSize - own.length },
      (_w, i) => `f${h}-${i + 1}`,
    );
    return [...own, ...fillers];
  });
  heats.flat().forEach(enter);
  log.push({ type: 'heatsCreated', heatCount: plan.heats, heats });
  ids.filter((id) => !early.includes(id)).forEach(enter);

  for (let race = 1; race <= plan.races; race += 1) {
    if (race > 1) log.push({ type: 'roundCreated' });
    ids
      .filter((id) => plan.featured[id].joinsRound === race)
      .forEach((id) =>
        log.push({
          type: 'boatAssigned',
          boat: id,
          heat: `${String.fromCharCode(65 + plan.featured[id].heat!)}${race}`,
        }),
      );
    // The heats as they stand now (late boats included).
    const round = stateOf(log).rounds[race - 1];
    round.forEach((heat) => {
      const planned = new Map<string, Planned>();
      heat.boats.forEach((id) => {
        const score = plan.featured[id]?.scores[race - 1];
        if (score !== undefined && score !== null) planned.set(id, score);
      });
      const coded = [...planned].filter(([, s]) => typeof s === 'string');
      const finishers = heat.boats.length - coded.length;
      const slots: (string | undefined)[] = Array(finishers).fill(undefined);
      planned.forEach((score, id) => {
        if (typeof score === 'string') return;
        const place = typeof score === 'number' ? score : score.place;
        if (place > finishers || slots[place - 1] !== undefined) {
          throw new Error(`race ${race} ${heat.id}: place ${place} for ${id}`);
        }
        slots[place - 1] = id;
      });
      const free = heat.boats.filter((id) => !planned.has(id));
      const order = slots.map((id) => id ?? free.shift()!);
      log.push({
        type: 'raceScored',
        race: { heat: heat.id, race: 1 },
        lines: [
          ...order.map((boat) => ({ boat })),
          ...coded.map(([boat, code]) => ({ boat, code: code as NoPlaceCode })),
        ],
      });
      planned.forEach((score, boat) => {
        if (typeof score === 'object') {
          log.push({
            type: 'protestDecided',
            race: { heat: heat.id, race: 1 },
            boat,
            outcome: { kind: 'RDG3', points: score.points },
          });
        }
      });
    });
  }
  log.push({ type: 'finalSeriesStarted', rule43: plan.rule43 ?? true });
  return log;
}

export function splitEvent(plan: SplitPlan): EventState {
  const result = replay(splitLog(plan));
  if (!result.ok) throw new Error(`#${result.at}: ${result.reason}`);
  return result.state;
}

/** The given boats in the order the split ranked them (Gold first). */
export const splitOrder = (state: EventState, boats: string[]) =>
  state
    .fleets!.flatMap((fleet) => fleet.boats)
    .filter((b) => boats.includes(b));
