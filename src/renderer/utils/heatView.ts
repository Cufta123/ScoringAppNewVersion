import { MAX_HEATS } from 'regatta-core';
import type { HeatBoatRow } from '../types';
import { sailorFullName } from './sailorName';

/** A heat with its boats and current race count, as displayed by the heats view. */
export interface HeatWithBoats {
  heat_id: number;
  event_id?: number;
  heat_name: string;
  heat_type: string;
  boats: HeatBoatRow[];
  raceNumber: number;
}

/** The heat-count dropdown offers what the library allows (RULE-M24). */
export const MAX_HEAT_COUNT = MAX_HEATS;

/** Whether any heat is a Final Series fleet. */
export const hasFinalHeats = (
  heats: ReadonlyArray<Pick<HeatWithBoats, 'heat_type'>>,
): boolean => heats.some((heat) => heat.heat_type === 'Final');

/** Whether any listed heat has had a race scored. */
export const hasScoredRace = (
  heats: Array<Pick<HeatWithBoats, 'raceNumber'>>,
): boolean => heats.some((heat) => heat.raceNumber > 0);

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
  `Move boat ${boat.sail_number} (${sailorFullName(boat)}) from ` +
  `${fromHeatName ?? 'its heat'} to ${toHeatName ?? 'this heat'}?`;
