/* eslint-disable camelcase */

// Score-status vocabulary and the pure helpers that normalise statuses, rank
// them for SHRS 5.3 seeding order, and compute scoring-penalty points. Kept in
// its own module so the scoring rules have one home and can be unit-tested
// independently of the IPC handler wiring.

// Scoring-penalty math lives in src/shared so the renderer's edit-mode preview
// can score these penalties identically. Re-exported here to keep this module
// the single import surface for the scoring vocabulary.
export {
  scoringPenaltyStatuses,
  roundHalfUp,
  getScoringPenaltyPoints,
} from '../../shared/scoringPenalty';

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

  return buildAlphanumericKey(left.country, left.sail_number).localeCompare(
    buildAlphanumericKey(right.country, right.sail_number),
  );
}

export function getHeatBaseFromName(heat_name: string): string {
  const match = heat_name.match(/Heat\s+([A-Z]+)/);
  if (!match) {
    throw new Error(`Invalid heat name format: ${heat_name}`);
  }
  return match[1];
}
