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
  mandatoryDisplaceStatuses,
  roundHalfUp,
  getScoringPenaltyPoints,
  promotesBoatsBehind,
} from '../../shared/scoringPenalty';
import { compareNationalSail } from '../../shared/sailOrder';

export {
  scoringPenaltyStatuses,
  mandatoryDisplaceStatuses,
  roundHalfUp,
  getScoringPenaltyPoints,
  promotesBoatsBehind,
};

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

/**
 * RULE-M14 / SHRS 3.1.5: "Protest committee decisions shall not change heat
 * assignments." Only a PROTEST-COMMITTEE decision freezes the heat assignment;
 * an ordinary race-office scoring correction (a mistyped finishing place, a
 * DNF the RO recorded late) must be free to change it, because the assignment
 * is supposed to follow the corrected result.
 *
 * These are the statuses a protest committee awards:
 *   DSQ  — disqualification from a hearing (RRS 64.1)
 *   DNE  — disqualification not excludable (RRS 90.3(b))
 *   DGM  — gross misconduct (RRS 69)
 *   DPI  — discretionary penalty imposed (RRS A10)
 *   RDG* — redress (RRS 62/64.2)
 *
 * Caveat: the app does not record WHO awarded a status, and a DSQ can also come
 * from the race committee (e.g. scoring an OCS boat) or an umpire (SHRS 3.1.3).
 * Those are treated as protest decisions here, which errs toward preserving a
 * published assignment — the conservative side of 3.1.5.
 */
export const protestCommitteeStatuses = new Set([
  'DSQ',
  'DNE',
  'DGM',
  'DPI',
  ...rdgStatuses,
]);
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

/**
 * SHRS 5.2 / write-path classification: is `status` a non-scoring penalty
 * (DNF, DNS, DSQ, OCS, RET, BFD, UFD, DNC, NSC, WTH, DNE, DGM) whose finishing
 * place is discarded and whose score is fixed at (largest heat + 1)?
 *
 * Mirrors the classification in the IPC handler's `applyRaceResultUpdate` so
 * the write path and any re-derivation agree. RDG and DPI keep their
 * protest-committee-provided value and are NOT non-scoring; ZFP/SCP/T1 are
 * position-keeping scoring penalties and are also NOT non-scoring.
 */
export function isNonScoringPenalty(status: string): boolean {
  const keepsProvidedPoints = rdgStatuses.includes(status) || status === 'DPI';
  return (
    !keepsProvidedPoints &&
    penaltyStatuses.includes(status) &&
    !scoringPenaltyStatuses.has(status)
  );
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
  // of sail number (SHRS rule 3 preamble). Shared with the renderer's
  // data-entry ordering so both sides break a tie the same way.
  return compareNationalSail(left, right);
}

export function getHeatBaseFromName(heat_name: string): string {
  const match = heat_name.match(/Heat\s+([A-Z]+)/);
  if (!match) {
    throw new Error(`Invalid heat name format: ${heat_name}`);
  }
  return match[1];
}
