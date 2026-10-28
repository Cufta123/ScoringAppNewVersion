/**
 * Form-side helpers for the SHRS 5.4 discard profile: turning a stored profile
 * string into the two values the UI edits (a mode and a threshold list),
 * validating what the user types, and turning it back into a profile string.
 *
 * The rule itself lives in shared/discardProfile.ts and is used by the backend
 * too; this module is only the editing/preview layer. It was defined inside
 * EventForm.tsx, where both the create form and the inline edit form reached
 * for it.
 */
import {
  DEFAULT_DISCARD_CONFIG,
  normalizeDiscardConfig,
  normalizeDiscardConfigString,
} from '../../shared/discardProfile';
import type { DiscardConfig } from '../../shared/discardProfile';
import type { EventRow } from '../types';

export interface DiscardModeAndConfig {
  mode: string;
  thresholdsInput: string;
}

export const DEFAULT_THRESHOLD_PREVIEW = '4,8,16,24';

const isStandardArithmetic = (config: DiscardConfig): boolean =>
  config.firstDiscardAt === DEFAULT_DISCARD_CONFIG.firstDiscardAt &&
  config.secondDiscardAt === DEFAULT_DISCARD_CONFIG.secondDiscardAt &&
  config.additionalEvery === DEFAULT_DISCARD_CONFIG.additionalEvery;

// A legacy custom first/second/every profile has no threshold list to edit, so
// surface it as the equivalent threshold list. The arithmetic count
// 2 + floor((n - secondDiscardAt) / additionalEvery) matches the thresholds
// [firstDiscardAt, secondDiscardAt, secondDiscardAt + additionalEvery, ...]
// over the first four steps shown in the preview.
const toLegacyThresholdPreview = (config: DiscardConfig): string => {
  return [
    config.firstDiscardAt,
    config.secondDiscardAt,
    config.secondDiscardAt + config.additionalEvery,
    config.secondDiscardAt + config.additionalEvery * 2,
  ].join(',');
};

export const parseThresholdInput = (
  input: unknown,
): { thresholds: number[]; error: string | null } => {
  const cleaned = String(input ?? '').trim();
  if (!cleaned) {
    return {
      thresholds: [],
      error: 'Enter at least one threshold (e.g. 4,8,16).',
    };
  }

  const parts = cleaned
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (parts.length === 0) {
    return {
      thresholds: [],
      error: 'Enter at least one threshold (e.g. 4,8,16).',
    };
  }

  const thresholds = parts.map((entry) => Number(entry));
  if (thresholds.some((value) => !Number.isInteger(value) || value <= 0)) {
    return {
      thresholds: [],
      error: 'Thresholds must be positive whole numbers.',
    };
  }

  for (let index = 1; index < thresholds.length; index += 1) {
    if (thresholds[index] <= thresholds[index - 1]) {
      return {
        thresholds: [],
        error: 'Thresholds must be in strictly increasing order.',
      };
    }
  }

  return { thresholds, error: null };
};

// Parsing and counting are delegated to src/shared/discardProfile.ts so this
// form can never drift from the backend. The form only adds the UI's
// standard/custom/never mode and comma-separated threshold presentation.
export const parseDiscardModeAndConfig = (
  raw: string | null | undefined,
): DiscardModeAndConfig => {
  if (!raw || raw === 'standard') {
    return {
      mode: 'standard',
      thresholdsInput: DEFAULT_THRESHOLD_PREVIEW,
    };
  }

  try {
    const normalized = normalizeDiscardConfig(raw);
    if (normalized.neverDiscard) {
      return { mode: 'never', thresholdsInput: '' };
    }
    if (
      Array.isArray(normalized.thresholds) &&
      normalized.thresholds.length > 0
    ) {
      return {
        mode: 'custom',
        thresholdsInput: normalized.thresholds.join(','),
      };
    }
    // Arithmetic (first/second/every) profile with no threshold list. The
    // standard default reads back as standard; a legacy custom profile becomes
    // an editable threshold list via the preview above.
    if (isStandardArithmetic(normalized)) {
      return {
        mode: 'standard',
        thresholdsInput: DEFAULT_THRESHOLD_PREVIEW,
      };
    }
    return {
      mode: 'custom',
      thresholdsInput: toLegacyThresholdPreview(normalized),
    };
  } catch (_error) {
    return {
      mode: 'standard',
      thresholdsInput: DEFAULT_THRESHOLD_PREVIEW,
    };
  }
};

export const serializeDiscardProfile = (
  mode: string,
  thresholdsInput: string,
): string => {
  if (mode === 'standard') return 'standard';
  if (mode === 'never') {
    return normalizeDiscardConfigString({ thresholds: [] });
  }
  const { thresholds, error } = parseThresholdInput(thresholdsInput);
  if (error) {
    throw new Error(error);
  }
  return normalizeDiscardConfigString({ thresholds });
};

export const getDiscardSummary = (
  mode: string,
  thresholdsInput: string,
): string => {
  if (mode === 'standard') {
    return 'Standard SHRS 5.4 is active: after 4 races exclude 1, after 8 exclude 2, then +1 every 8 races.';
  }
  if (mode === 'never') {
    return 'Never discard is active: no race is ever excluded, regardless of how many races are completed.';
  }

  const { thresholds, error } = parseThresholdInput(thresholdsInput);
  if (error) return error;
  return `Custom list active. Exclusions increase by 1 at each threshold: ${thresholds.join(', ')}.`;
};

export const getDiscardExamples = (
  mode: string,
  thresholdsInput: string,
): string => {
  if (mode === 'standard') {
    return 'Examples: 4 races = 1 discard | 8 races = 2 discards | 16 races = 3 discards | 24 races = 4 discards';
  }
  if (mode === 'never') {
    return 'Examples: 4 races = 0 discards | 8 races = 0 discards | 50 races = 0 discards';
  }

  const { thresholds, error } = parseThresholdInput(thresholdsInput);
  if (error) return '';

  const sampleRaceCounts = thresholds.slice(0, 4);
  if (sampleRaceCounts.length === 0) return '';

  return sampleRaceCounts
    .map((raceCount) => {
      const discardCount = thresholds.filter(
        (threshold) => raceCount >= threshold,
      ).length;
      return `${raceCount} races = ${discardCount} discard${discardCount === 1 ? '' : 's'}`;
    })
    .join(' | ');
};

export const getAssignmentLabel = (event: EventRow): string =>
  event.shrs_qualifying_assignment_mode === 'pre-assigned'
    ? 'Pre-Assignments'
    : 'Progressive';

export const getOverflowPolicyLabel = (event: EventRow): string =>
  event.shrs_heat_overflow_policy === 'confirm-allow-oversize'
    ? 'Oversize with confirm'
    : 'Auto-increase heats';
