/**
 * Final Series fleet naming and precedence (SHRS 4.1 / 5.5).
 *
 * SHRS 4.1 names the fleets "Gold, Silver, Bronze and Copper, unless otherwise
 * indicated in the sailing instructions", and 4.1 also allows as many fleets as
 * there were qualifying heats — which can exceed four. SHRS 5.5 then requires a
 * strict precedence between them: "boats in Gold Fleet ranked before boats in
 * Silver Fleet, boats in Silver Fleet before boats in Bronze Fleet and so on."
 *
 * RULE-m2: the app used to name the 5th and later fleets "Fleet 5", "Fleet 6", …
 * but rank them all with a single catch-all value, so those fleets tied on
 * precedence and were then ordered by raw points — letting a Fleet 6 boat
 * outrank a Fleet 5 boat, in direct conflict with 5.5. Precedence must follow
 * the fleet's position in the division order, for every fleet.
 *
 * Shared by the main process (assignment + leaderboard reads) and the renderer
 * so one definition governs naming, ordering and display everywhere.
 */

/** The named fleets, best first (SHRS 4.1). */
export const NAMED_FLEETS = ['Gold', 'Silver', 'Bronze', 'Copper'] as const;

/** Fallback label for the 5th and later fleets. */
export const overflowFleetName = (index: number): string =>
  `Fleet ${index + 1}`;

/**
 * Name of the fleet at `index` in division order (0 = best fleet).
 * Mirrors the naming used when the final heats are created.
 */
export const fleetNameForIndex = (index: number): string =>
  (NAMED_FLEETS as readonly string[])[index] ?? overflowFleetName(index);

/**
 * Precedence of a fleet for SHRS 5.5 ranking: 1 = Gold, 2 = Silver, …
 *
 * Recognises both the named fleets and the "Fleet N" overflow labels, so the
 * 5th fleet ranks 5th, the 6th 6th, and so on. Unknown labels (e.g. a custom
 * name from the sailing instructions that we cannot order) sort last but keep a
 * stable, deterministic order between themselves via the caller's tiebreakers.
 */
export const fleetRank = (placementGroup: unknown): number => {
  const name = String(placementGroup ?? '').trim();
  const namedIndex = (NAMED_FLEETS as readonly string[]).indexOf(name);
  if (namedIndex !== -1) return namedIndex + 1;

  const overflowMatch = name.match(/^Fleet\s+(\d+)$/i);
  if (overflowMatch) return Number(overflowMatch[1]);

  return Number.MAX_SAFE_INTEGER;
};
