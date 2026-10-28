/**
 * Random race outcomes entered the way the scoring screen enters them, and
 * their points computed from the rule text alone (no app scoring code), for
 * the oracle tests.
 */
import {
  buildPlaceNumbers,
  buildScoredRace,
  getOrderedBoatNumbers,
  tieKey,
} from '../../renderer/utils/finishOrder';

// ── Random numbers (deterministic per seed) ───────────────────────────────
export const prng = (seed: number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
};

export const NON_FINISHERS = [
  'DNF',
  'DNS',
  'OCS',
  'DSQ',
  'BFD',
  'RET',
  'UFD',
  'NSC',
];

/** What happened in one heat race, as the race officer saw it. */
export interface HeatOutcome {
  heat: string;
  /** Boats that crossed the line, in order (clean finishers and ZFP/SCP). */
  crossed: number[];
  /** sail -> penalty code. */
  penalty: Map<number, string>;
  /** Sails tied with the boat directly above them in `crossed`. */
  tiedWithAbove: Set<number>;
}

export function randomOutcome(
  rand: () => number,
  heat: string,
  sails: number[],
): HeatOutcome {
  const order = [...sails];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const penalty = new Map<number, string>();
  const crossed: number[] = [];
  order.forEach((sail) => {
    const r = rand();
    if (r < 0.12) {
      penalty.set(
        sail,
        NON_FINISHERS[Math.floor(rand() * NON_FINISHERS.length)],
      );
      return;
    }
    if (r < 0.16) penalty.set(sail, 'ZFP');
    else if (r < 0.18) penalty.set(sail, 'SCP');
    crossed.push(sail);
  });
  const tiedWithAbove = new Set<number>();
  crossed.forEach((sail, i) => {
    if (i === 0) return;
    const above = crossed[i - 1];
    if (penalty.has(sail) || penalty.has(above)) return;
    if (rand() < 0.08) tiedWithAbove.add(sail);
  });
  return { heat, crossed, penalty, tiedWithAbove };
}

/** The payload the scoring screen submits for this outcome. */
export function payloadFor(outcome: HeatOutcome, sails: number[]) {
  const penalties: Record<string, string> = {};
  outcome.penalty.forEach((code, sail) => {
    penalties[String(sail)] = code;
  });
  const displaced = sails.filter(
    (sail) => outcome.penalty.has(sail) && !outcome.crossed.includes(sail),
  );
  const ordered = getOrderedBoatNumbers(
    [...outcome.crossed, ...displaced],
    penalties,
  );
  const ties = new Set<string>();
  outcome.tiedWithAbove.forEach((sail) => {
    const i = outcome.crossed.indexOf(sail);
    ties.add(tieKey(sail, outcome.crossed[i - 1]));
  });
  const { boatPlaces, missingBoats } = buildScoredRace({
    boatNumbers: ordered,
    penalties,
    placeNumbers: buildPlaceNumbers(ordered, ties),
    validBoats: sails,
  });
  if (missingBoats.length > 0) throw new Error(`unscored: ${missingBoats}`);
  return boatPlaces;
}

// ── The rules, independently ──────────────────────────────────────────────
export const tenth = (x: number) => Math.round(x * 10 + 1e-9) / 10;

/** Points of every boat in one heat race. `largest` = boats in largest heat. */
export function oraclePoints(
  outcome: HeatOutcome,
  largest: number,
  sails: number[],
) {
  const dnf = largest + 1;
  const points = new Map<number, number>();
  const { crossed } = outcome;
  let i = 0;
  while (i < crossed.length) {
    let j = i;
    while (
      j + 1 < crossed.length &&
      outcome.tiedWithAbove.has(crossed[j + 1])
    ) {
      j += 1;
    }
    // places i+1 .. j+1 shared (RRS A7)
    const avg = tenth(((i + 1 + (j + 1)) * (j - i + 1)) / 2 / (j - i + 1));
    for (let k = i; k <= j; k += 1) {
      const sail = crossed[k];
      const code = outcome.penalty.get(sail);
      points.set(sail, code ? Math.min(k + 1 + tenth(0.2 * dnf), dnf) : avg);
    }
    i = j + 1;
  }
  sails.forEach((sail) => {
    if (!points.has(sail)) points.set(sail, dnf);
  });
  return points;
}
