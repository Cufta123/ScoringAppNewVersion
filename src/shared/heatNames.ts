/**
 * Heat-name conventions shared by the main process and the renderer.
 *
 * Qualifying heats are named "Heat <letters><round>" ("Heat B3" = group B,
 * round 3); each round of a progressive or pre-assigned series is a fresh set
 * of heats. Final fleets are "Final <fleet>".
 */

/**
 * The qualifying round a heat belongs to: the numeric suffix of its name
 * ("Heat B3" -> 3). This — not `Races.race_number`, which counts races WITHIN
 * one heat and is therefore 1 for nearly every qualifying race — is what tells
 * two rounds apart. Returns null for a name that is not a qualifying heat.
 */
export function getHeatRoundFromName(heat_name: string): number | null {
  const match = String(heat_name).match(/Heat\s+([A-Z]+)(\d*)/);
  if (!match) {
    return null;
  }
  return match[2] ? parseInt(match[2], 10) : 0;
}

/** The group letters of a qualifying heat ("Heat B3" -> "B"), or null. */
export function getHeatGroupFromName(heat_name: string): string | null {
  const match = String(heat_name).match(/Heat\s+([A-Z]+)/);
  return match ? match[1] : null;
}
