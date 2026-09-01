/* eslint-disable camelcase */
import { db } from '../../../public/Database/DBManager';
import {
  DiscardConfig,
  getExcludeCountForConfig,
  normalizeDiscardConfig,
  normalizeDiscardConfigString,
} from '../../shared/discardProfile';

// SHRS 5.4 profile parsing and the exclusion count itself are PURE and live in
// src/shared/discardProfile so the renderer's edit-mode preview computes the
// discard count from the same implementation instead of its own copy.
// Re-exported here to keep this module the single import surface for the main
// process's discard logic.
export type { DiscardConfig };
export {
  getExcludeCountForConfig,
  normalizeDiscardConfig,
  normalizeDiscardConfigString,
};

export function getEventDiscardConfig(
  event_id: any,
  series: 'qualifying' | 'final',
): DiscardConfig {
  const column =
    series === 'qualifying'
      ? 'shrs_discard_profile_qualifying'
      : 'shrs_discard_profile_final';

  const row = db
    .prepare(
      `SELECT ${column} as discard_profile FROM Events WHERE event_id = ?`,
    )
    .get(event_id) as { discard_profile?: string } | undefined;

  return normalizeDiscardConfig(row?.discard_profile ?? 'standard');
}
