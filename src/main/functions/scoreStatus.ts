// The result codes a request may carry, read into the library's vocabulary.
// Which codes exist, and their order, are regatta-core's (RESULT_CODES);
// this only checks and normalises what was sent or stored.
import { FINISHED, RESULT_CODES } from 'regatta-core';

export const allowedScoreStatuses = new Set<string>([
  FINISHED,
  ...RESULT_CODES,
]);

/**
 * A status as sent or stored: blank is a finish, letters are upper-cased,
 * RAF (gone from RRS 2025-2028, A10) is RET. Refuses a code the library
 * does not know, in words.
 */
export function normalizeScoreStatus(status: unknown): string {
  if (typeof status !== 'string' || status.trim() === '') {
    return FINISHED;
  }
  const normalized = status.trim().toUpperCase();
  if (normalized === 'RAF') {
    return 'RET';
  }
  if (!allowedScoreStatuses.has(normalized)) {
    throw new Error(
      `"${status}" is not a result code this app knows. Use a place, or one of: ${[
        ...allowedScoreStatuses,
      ].join(', ')}.`,
    );
  }
  return normalized;
}

// Shared with the renderer (unassigned-entry notice); see shared/heatNames.
export { getHeatRoundFromName } from '../../shared/heatNames';
