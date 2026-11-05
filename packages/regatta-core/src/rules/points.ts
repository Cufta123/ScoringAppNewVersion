/**
 * Point arithmetic. Scores can be halves (RRS A7 ties) and tenths (A9
 * redress, 44.3(c) penalties); tenths are not exact in binary, so every
 * total that is compared goes through `exact`, or two equal totals could
 * compare unequal and skip the tie-break.
 */
import type { PenaltyCode } from '../types';

export function exact(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function sum(values: readonly number[]): number {
  return exact(values.reduce((total, value) => total + value, 0));
}

/** Nearest tenth, 0.05 rounded upward (RRS 44.3(c), A9). */
export function toTenth(value: number): number {
  return Math.floor(value * 10 + 0.5 + 1e-9) / 10;
}

/**
 * SHRS 5.2 changes RRS A5.2: a boat with no finishing place scores the
 * number of boats in the largest heat of the series, plus one.
 */
export function noPlacePoints(largestHeat: number): number {
  return largestHeat + 1;
}

/**
 * RRS 44.3(c) (2025-2028) / T1(b): "the score she would have received
 * without that penalty" (so a tied boat's shared points, A7) plus 20% (ZFP,
 * SCP) or 30% (T1) of the DNF score, to the tenth (0.05 up), never worse
 * than the DNF score. Before 2025 it was the place, rounded to a whole
 * number.
 */
export function penaltyPoints(
  score: number,
  largestHeat: number,
  code: PenaltyCode,
): number {
  const dnf = noPlacePoints(largestHeat);
  const share = code === 'T1' ? 0.3 : 0.2;
  return Math.min(exact(score + toTenth(dnf * share)), dnf);
}

/**
 * RRS A9 average-points redress over the races given (the redressed race
 * already left out). Races that are themselves average redress do not
 * count. Null when nothing is left to average.
 */
export function redressAverage(
  races: ReadonlyArray<{ points: number; averaged: boolean }>,
): number | null {
  const pool = races.filter((race) => !race.averaged);
  if (pool.length === 0) return null;
  return toTenth(sum(pool.map((race) => race.points)) / pool.length);
}
