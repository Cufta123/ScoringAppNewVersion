/**
 * The values an event's SHRS settings can take, stated once. The main process
 * writes them (EventHandler), reads them back (functions/eventSettings) and
 * the renderer types its event rows with them, so the three cannot drift.
 */

/** SHRS 3.1 (each round re-seeded from the last) / 3.2 (fixed pre-assignment). */
export const QUALIFYING_ASSIGNMENT_MODES = [
  'progressive',
  'pre-assigned',
] as const;
export type QualifyingAssignmentMode =
  (typeof QUALIFYING_ASSIGNMENT_MODES)[number];
export const DEFAULT_QUALIFYING_ASSIGNMENT_MODE: QualifyingAssignmentMode =
  'progressive';

/** SHRS 2.3: what to do when the boats do not fit the heat count within 20 a heat. */
export const HEAT_OVERFLOW_POLICIES = [
  'auto-increase',
  'confirm-allow-oversize',
] as const;
export type HeatOverflowPolicy = (typeof HEAT_OVERFLOW_POLICIES)[number];
export const DEFAULT_HEAT_OVERFLOW_POLICY: HeatOverflowPolicy = 'auto-increase';

function pickAllowed<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  const normalized = String(value ?? fallback)
    .trim()
    .toLowerCase();
  return allowed.find((candidate) => candidate === normalized) ?? fallback;
}

/** Anything that is not a known mode (missing, misspelt, any case) is `progressive`. */
export function normalizeQualifyingAssignmentMode(
  value: unknown,
): QualifyingAssignmentMode {
  return pickAllowed(
    value,
    QUALIFYING_ASSIGNMENT_MODES,
    DEFAULT_QUALIFYING_ASSIGNMENT_MODE,
  );
}

/** Anything that is not a known policy is `auto-increase`. */
export function normalizeHeatOverflowPolicy(
  value: unknown,
): HeatOverflowPolicy {
  return pickAllowed(
    value,
    HEAT_OVERFLOW_POLICIES,
    DEFAULT_HEAT_OVERFLOW_POLICY,
  );
}
