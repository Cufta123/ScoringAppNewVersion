/**
 * Seeded random events, built decision by decision through replay so every
 * decision is one the rules accept: entries (some late), heats, rounds, the
 * Final Series, codes, penalties, ties at the finish and protest decisions.
 */
import {
  nextStep,
  replay,
  type Decision,
  type EventState,
  type NoPlaceCode,
  type RaceLine,
} from '../../src';

/* eslint-disable no-bitwise -- mulberry32, a small seeded generator */
export function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
/* eslint-enable no-bitwise */

const NATS = ['CRO', 'ITA', 'SLO', 'AUT', 'GER'];
const CODES: NoPlaceCode[] = ['DNF', 'RET', 'OCS', 'DNS', 'UFD', 'BFD', 'NSC'];

export function randomEvent(seed: number): Decision[] {
  const rnd = prng(seed);
  const int = (lo: number, hi: number) =>
    lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)];
  const shuffle = <T>(items: readonly T[]) => {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = int(0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const log: Decision[] = [];
  const state = (): EventState => {
    const result = replay(log);
    if (!result.ok) {
      throw new Error(
        `seed ${seed}: decision ${result.at} refused: ${result.reason}`,
      );
    }
    return result.state;
  };
  let nextId = 1;
  const enter = () => {
    const id = nextId;
    nextId += 1;
    log.push({
      type: 'boatEntered',
      boat: { id: `b${id}`, nat: pick(NATS), sail: String(id * 3 + int(0, 2)) },
    });
  };

  const boats = int(4, 24);
  const heatCount = Math.max(
    Math.ceil(boats / 20),
    boats >= 6 ? int(1, Math.min(4, Math.floor(boats / 3))) : 1,
  );
  for (let i = 0; i < boats; i += 1) enter();
  log.push({ type: 'heatsCreated', heatCount });
  if (rnd() < 0.4) enter(); // late: no heat in round 1

  const rounds = int(1, 7);
  const finalRaces = int(1, 5);
  for (let step = 0; step < 80; step += 1) {
    const now = state();
    const next = nextStep(now);
    if (next.kind === 'createRound') {
      if (now.rounds.length >= rounds) {
        log.push({ type: 'finalSeriesStarted', rule43: rnd() < 0.8 });
      } else {
        log.push({ type: 'roundCreated' });
        const late = now.boats.filter(
          (b) => !now.rounds.at(-1)!.some((h) => h.boats.includes(b.id)),
        );
        const fresh = state();
        late.forEach((b) => {
          const heat = pick(
            fresh.rounds.at(-1)!.filter((h) => h.boats.length < 20),
          );
          log.push({ type: 'boatAssigned', boat: b.id, heat: heat.id });
        });
      }
    } else if (next.kind === 'score') {
      if (now.fleets && now.fleets.every((f) => f.races.length >= finalRaces))
        break;
      if (
        !now.fleets &&
        heatCount === 1 &&
        now.rounds[0][0].races.length >= rounds
      )
        break;
      const heat = [...now.rounds.flat(), ...(now.fleets ?? [])].find(
        (h) => h.id === next.heat,
      )!;
      const order = shuffle(heat.boats);
      const lines: RaceLine[] = order.map((boat, i) => {
        const roll = rnd();
        if (roll < 0.08) return { boat, code: pick(CODES) };
        if (roll < 0.12)
          return { boat, penalty: pick(['ZFP', 'SCP', 'T1'] as const) };
        if (roll < 0.17 && i > 0) return { boat, tied: true };
        return { boat };
      });
      // A tie needs a finisher above; drop the ones that have none.
      const fixed = lines.map((line, i) =>
        line.tied && !lines.slice(0, i).some((l) => !l.code)
          ? { boat: line.boat }
          : line,
      );
      log.push({
        type: 'raceScored',
        race: { heat: heat.id, race: next.race },
        lines: fixed,
      });
      if (rnd() < 0.25) {
        const boat = pick(heat.boats);
        const kind = pick(['DSQ', 'DNE', 'RDG1', 'RDG3', 'DPI'] as const);
        log.push({
          type: 'protestDecided',
          race: { heat: heat.id, race: next.race },
          boat,
          outcome:
            kind === 'RDG3' || kind === 'DPI'
              ? { kind, points: int(10, 80) / 10 }
              : { kind },
        });
      }
    } else {
      break;
    }
  }
  state(); // the whole log must replay
  return log;
}
