import {
  DiscardConfig,
  normalizeDiscardConfig,
  normalizeDiscardConfigString,
  toDiscardProfile,
} from '../../shared/discardProfile';

// The stored SHRS 5.4 setting: parsing and normalisation (src/shared, so the
// event form reads it the same way). The count itself is regatta-core's
// (discardCount on toDiscardProfile's result).
export type { DiscardConfig };
export {
  normalizeDiscardConfig,
  normalizeDiscardConfigString,
  toDiscardProfile,
};
