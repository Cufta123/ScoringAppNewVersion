import type { HeatBoatRow } from '../types';
import {
  getHeatGroupFromName,
  getHeatRoundFromName,
} from '../../shared/heatNames';

/** A heat with its boats and current race count, as displayed by the heats view. */
export interface HeatWithBoats {
  heat_id: number;
  event_id?: number;
  heat_name: string;
  heat_type: string;
  boats: HeatBoatRow[];
  raceNumber: number;
}

/** The heat-count dropdown matches the backend's 1-26 limit (RULE-M24). */
export const MAX_HEAT_COUNT = 26;

/** Whether any heat is a Final Series fleet. */
export const hasFinalHeats = (
  heats: Array<Pick<HeatWithBoats, 'heat_type'>>,
): boolean => heats.some((heat) => heat.heat_type === 'Final');

/** Whether any listed heat has had a race scored. */
export const hasScoredRace = (
  heats: Array<Pick<HeatWithBoats, 'raceNumber'>>,
): boolean => heats.some((heat) => heat.raceNumber > 0);

/**
 * SHRS 1.1: the number of distinct qualifying heat letter groups ("Heat B3" ->
 * "B"). A Final Series needs at least two. Full base letters, consistent with
 * the main-process group count.
 */
export function countQualifyingGroups(
  heats: Array<Pick<HeatWithBoats, 'heat_name' | 'heat_type'>>,
): number {
  const groups = new Set<string>();
  heats.forEach((heat) => {
    if (heat.heat_type !== 'Qualifying') return;
    const group = getHeatGroupFromName(heat.heat_name);
    if (group) groups.add(group);
  });
  return groups.size;
}

/**
 * The heats that are "current": every final fleet once the Final Series has
 * started, otherwise the latest round of each qualifying group.
 */
export function getLastHeats<
  T extends Pick<HeatWithBoats, 'heat_name' | 'heat_type'>,
>(heats: T[]): T[] {
  const finalHeats = heats.filter(
    (heat) => heat.heat_type.toLowerCase() === 'final',
  );
  if (finalHeats.length > 0) return finalHeats;

  const latestRoundOfGroup = new Map<string, number>();
  heats.forEach((heat) => {
    const group = getHeatGroupFromName(heat.heat_name);
    const round = getHeatRoundFromName(heat.heat_name);
    if (group === null || round === null) return;
    const known = latestRoundOfGroup.get(group);
    if (known === undefined || known < round) {
      latestRoundOfGroup.set(group, round);
    }
  });

  return heats.filter((heat) => {
    const group = getHeatGroupFromName(heat.heat_name);
    return (
      group !== null &&
      getHeatRoundFromName(heat.heat_name) === latestRoundOfGroup.get(group)
    );
  });
}

/**
 * The main process words its own validation refusals for heat creation in
 * plain language (no boats, the SHRS per-heat cap, an out-of-range count);
 * those are shown verbatim instead of as a generic failure.
 */
export const isHeatSetupRefusal = (message: string): boolean =>
  message.includes('boats per heat') ||
  message.includes('No boats are registered') ||
  message.includes('Number of heats must be') ||
  message.includes('Cannot create heats:');

/** Recreating can also be refused because a race has been scored meanwhile. */
export const isHeatRecreateRefusal = (message: string): boolean =>
  isHeatSetupRefusal(message) ||
  message.includes('races have already been scored');

export const BOAT_DRAG_MIME = 'application/json';

/** The payload a dragged boat row carries. */
export const serializeBoatDrag = (
  boat: HeatBoatRow,
  fromHeatId: number,
): string => JSON.stringify({ boat, fromHeatId });

/**
 * Read a drop back. Only payloads created by `serializeBoatDrag` are
 * accepted: anything foreign (text, files) or malformed gives null instead of
 * throwing.
 */
export function parseBoatDrop(
  raw: string,
): { boat: HeatBoatRow; fromHeatId: number } | null {
  let data: { boat?: HeatBoatRow; fromHeatId?: number } | null;
  try {
    data = JSON.parse(raw);
  } catch (_error) {
    return null;
  }
  const { boat, fromHeatId } = data ?? {};
  if (!boat?.boat_id || fromHeatId == null) return null;
  return { boat, fromHeatId };
}

/** The question asked before a drag-and-drop reassigns a competitor's heat. */
export const boatMoveQuestion = (
  boat: Pick<HeatBoatRow, 'sail_number' | 'name' | 'surname'>,
  fromHeatName: string | undefined,
  toHeatName: string | undefined,
): string =>
  `Move boat ${boat.sail_number} (${boat.name} ${boat.surname}) from ` +
  `${fromHeatName ?? 'its heat'} to ${toHeatName ?? 'this heat'}?`;
