/**
 * A log with its boats given other ids: the same event, as another program
 * (or another database) names the boats. Nothing about the rules changes:
 * every decision that names a boat names the new id, and every other field
 * is copied as it is.
 *
 * Refused, in words, when the renaming is not one-to-one over the log: a
 * boat the log names that has no new id, or two boats given the same id
 * (the log would then say one boat sailed twice).
 */
import clone from '../clone';
import type { BoatId, Decision } from '../types';

export type RenameResult =
  | { ok: true; log: Decision[] }
  | { ok: false; reason: string };

/** `decision` with every boat it names passed through `to` (a copy). */
function withBoats(decision: Decision, to: (id: BoatId) => BoatId): Decision {
  const d = clone(decision);
  const all = (ids: BoatId[]) => ids.map(to);
  switch (d.type) {
    case 'settingsChanged':
      return d;
    case 'boatEntered':
      return { ...d, boat: { ...d.boat, id: to(d.boat.id) } };
    case 'boatRemoved':
    case 'boatChanged':
    case 'boatAssigned':
    case 'boatMoved':
    case 'protestDecided':
      return { ...d, boat: to(d.boat) };
    case 'heatsCreated':
      return {
        ...d,
        ...(d.seeding ? { seeding: all(d.seeding) } : {}),
        ...(d.heats ? { heats: d.heats.map(all) } : {}),
      };
    case 'raceScored':
    case 'raceCorrected':
      return {
        ...d,
        lines: d.lines.map((line) => ({ ...line, boat: to(line.boat) })),
      };
    case 'roundCreated':
      return d.heats ? { ...d, heats: d.heats.map(all) } : d;
    case 'finalSeriesStarted':
      return d.fleets ? { ...d, fleets: d.fleets.map(all) } : d;
    default: {
      // A new decision type must say here which of its fields name boats.
      const unknown: never = d;
      return unknown;
    }
  }
}

/** Every boat the log names, in the order it first names them. */
export function boatsNamed(log: readonly Decision[]): BoatId[] {
  const seen = new Set<BoatId>();
  log.forEach((decision) =>
    withBoats(decision, (id) => {
      seen.add(id);
      return id;
    }),
  );
  return [...seen];
}

/**
 * The log with each boat `b` named `names[b]`. Every boat the log names
 * needs a new id, and no two boats may get the same one.
 */
export function renameBoats(
  log: readonly Decision[],
  names: Readonly<Record<BoatId, BoatId>>,
): RenameResult {
  // How the log itself names a boat, for the refusal.
  const label = (id: BoatId) => {
    const entered = log.find(
      (d) => d.type === 'boatEntered' && d.boat.id === id,
    );
    return entered?.type === 'boatEntered'
      ? `${entered.boat.nat} ${entered.boat.sail}`.trim() || `“${id}”`
      : `“${id}”`;
  };
  const has = (id: BoatId) => Object.prototype.hasOwnProperty.call(names, id);

  const missing = boatsNamed(log).find((id) => !has(id));
  if (missing !== undefined) {
    return {
      ok: false,
      reason: `Boat ${label(missing)} has no new id, so the boats were not renamed.`,
    };
  }
  const firstWith = new Map<BoatId, BoatId>();
  let clash: [BoatId, BoatId] | undefined;
  Object.keys(names).some((id) => {
    const other = firstWith.get(names[id]);
    if (other !== undefined) clash = [other, id];
    firstWith.set(names[id], id);
    return clash !== undefined;
  });
  if (clash !== undefined) {
    const [first, second] = clash;
    return {
      ok: false,
      reason: `Boats ${label(first)} and ${label(second)} would both be “${names[second]}”, so the boats were not renamed.`,
    };
  }
  return { ok: true, log: log.map((d) => withBoats(d, (id) => names[id])) };
}
