/* eslint-disable camelcase */

// Score-status vocabulary and the pure helpers that normalise statuses, rank
// them for SHRS 5.3 seeding order, and compute scoring-penalty points. Kept in
// its own module so the scoring rules have one home and can be unit-tested
// independently of the IPC handler wiring.

// Scoring-penalty math lives in src/shared so the renderer's edit-mode preview
// can score these penalties identically. Imported for local use and re-exported
// to keep this module the single import surface for the scoring vocabulary.
import {
  scoringPenaltyStatuses,
  roundHalfUp,
  getScoringPenaltyPoints,
} from '../../shared/scoringPenalty';

export { scoringPenaltyStatuses, roundHalfUp, getScoringPenaltyPoints };

// SHRS 2026-1 (5.3) is source-of-truth for displacement order.
// Appendix-only statuses are appended as fallback when SHRS text is silent.
export const shrsPrimaryStatusOrder = [
  'DNF',
  'RET',
  'NSC',
  'OCS',
  'DNS',
  'DNC',
  'WTH',
  'UFD',
  'BFD',
  'DSQ',
  'DNE',
];
export const appendixFallbackStatusOrder = ['DGM', 'DPI'];
export const statusOrder = [
  ...shrsPrimaryStatusOrder,
  ...appendixFallbackStatusOrder,
];

export const statusRankMap = new Map<string, number>(
  statusOrder.map((status, index) => [status, index]),
);

export const rdgStatuses = ['RDG1', 'RDG2', 'RDG3'];
export const mandatoryDisplaceStatuses = new Set(['DSQ', 'RET', 'DNE', 'DGM']);
export const penaltyStatuses = [
  'DNF',
  'DNS',
  'DSQ',
  'OCS',
  'ZFP',
  'T1',
  'RET',
  'SCP',
  'BFD',
  'UFD',
  'DNC',
  'NSC',
  'WTH',
  'DNE',
  'DGM',
  'DPI',
];
export const allowedScoreStatuses = new Set<string>([
  'FINISHED',
  ...penaltyStatuses,
  ...rdgStatuses,
]);

// SHRS 5.2 / RRS 44.3(c): derive the points a non-finisher status should carry
// given the current largest-heat size. Mirrors the write-time logic in
// applyRaceResultUpdate so a leaderboard recompute can re-derive frozen scores
// against the current series-wide largest heat (fixing stale DNF/DNS points).
// Returns null for statuses whose points are NOT a function of the largest heat
// (FINISHED keeps its place-based points; RDG keeps its redress value).
export function deriveNonFinisherPoints(
  status: string,
  position: number,
  maxBoats: number,
): number | null {
  if (rdgStatuses.includes(status)) {
    return null;
  }
  // RRS A10: DPI (discretionary penalty imposed) points are SET BY THE PROTEST
  // COMMITTEE, not a function of the largest heat. Keep the stored (PC-entered)
  // value — never auto-derive it and never renormalize it (unlike DSQ et al.).
  if (status === 'DPI') {
    return null;
  }
  if (!penaltyStatuses.includes(status)) {
    return null; // FINISHED
  }
  if (scoringPenaltyStatuses.has(status)) {
    return getScoringPenaltyPoints(position, maxBoats, status);
  }
  return maxBoats + 1;
}

export function normalizeScoreStatus(status: unknown): string {
  if (typeof status !== 'string' || status.trim() === '') {
    return 'FINISHED';
  }
  const normalized = status.trim().toUpperCase();
  if (normalized === 'RAF') {
    return 'RET';
  }
  if (normalized === 'FINISHED') {
    return 'FINISHED';
  }
  if (!allowedScoreStatuses.has(normalized)) {
    throw new Error(`Unsupported score status: ${status}`);
  }
  return normalized;
}

export function normalizeStatus(status: unknown): string {
  if (typeof status !== 'string') {
    return '';
  }
  const normalized = status.trim().toUpperCase();
  return normalized === 'RAF' ? 'RET' : normalized;
}

export function buildAlphanumericKey(
  country: unknown,
  sail_number: unknown,
): string {
  const countryCode = String(country ?? '').toUpperCase();
  const sail = String(sail_number ?? '').toUpperCase();
  return `${countryCode}-${sail}`;
}

export type SeededRow = {
  position: number | null;
  status: string;
  country: string | null;
  sail_number: string | number | null;
};

// SHRS 5.3 seeding order: finishers by position, then penalised boats by
// status displacement rank, with alphanumeric sail key as final tie-break.
export function compareSeededRows(left: SeededRow, right: SeededRow): number {
  const leftStatusRank = statusRankMap.get(left.status);
  const rightStatusRank = statusRankMap.get(right.status);
  const leftIsFinisher = leftStatusRank === undefined;
  const rightIsFinisher = rightStatusRank === undefined;

  if (leftIsFinisher && rightIsFinisher) {
    const leftPosition = left.position ?? Number.MAX_SAFE_INTEGER;
    const rightPosition = right.position ?? Number.MAX_SAFE_INTEGER;
    if (leftPosition !== rightPosition) {
      return leftPosition - rightPosition;
    }
  } else if (leftIsFinisher !== rightIsFinisher) {
    return leftIsFinisher ? -1 : 1;
  } else {
    const leftRank = leftStatusRank ?? Number.MAX_SAFE_INTEGER;
    const rightRank = rightStatusRank ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
  }

  // SHRS 5.3 / 3.1(iv): break ties on national letter, then by NUMERICAL order
  // of sail number (SHRS rule 3 preamble). A plain string compare would sort
  // "10" before "9"; the numeric collator keeps them in sailing order.
  const leftCountry = String(left.country ?? '').toUpperCase();
  const rightCountry = String(right.country ?? '').toUpperCase();
  const byCountry = leftCountry.localeCompare(rightCountry);
  if (byCountry !== 0) {
    return byCountry;
  }
  return String(left.sail_number ?? '').localeCompare(
    String(right.sail_number ?? ''),
    undefined,
    { numeric: true, sensitivity: 'base' },
  );
}

export function getHeatBaseFromName(heat_name: string): string {
  const match = heat_name.match(/Heat\s+([A-Z]+)/);
  if (!match) {
    throw new Error(`Invalid heat name format: ${heat_name}`);
  }
  return match[1];
}
