/** boatMoved: the race office moves a boat between heats of the round. */
import { replay, type Decision } from '../src';

const boat = (i: number): Decision => ({
  type: 'boatEntered',
  boat: { id: `b${i}`, nat: 'CRO', sail: String(i) },
});
// SHRS 3: A1 = CRO 1, 4; B1 = CRO 2, 3.
const start: Decision[] = [
  boat(1),
  boat(2),
  boat(3),
  boat(4),
  { type: 'heatsCreated', heatCount: 2 },
];
const move = (b: string, from: string, to: string): Decision => ({
  type: 'boatMoved',
  boat: b,
  from,
  to,
});
const scored = (heat: string, race: number, ...boats: string[]): Decision => ({
  type: 'raceScored',
  race: { heat, race },
  lines: boats.map((id) => ({ boat: id })),
});
const reason = (log: Decision[]) => {
  const result = replay(log);
  return result.ok ? null : result.reason;
};

it('moves the boat', () => {
  const result = replay([...start, move('b4', 'A1', 'B1')]);
  expect(result.ok).toBe(true);
  expect(result.state.rounds[0].map((heat) => heat.boats)).toEqual([
    ['b1'],
    ['b2', 'b3', 'b4'],
  ]);
});

it('then the heats sail as moved', () => {
  expect(
    reason([
      ...start,
      move('b4', 'A1', 'B1'),
      scored('A1', 1, 'b1'),
      scored('B1', 1, 'b4', 'b2', 'b3'),
    ]),
  ).toBeNull();
});

it.each([
  [
    'from a heat that has raced',
    [scored('A1', 1, 'b1', 'b4')],
    move('b4', 'A1', 'B1'),
    /A1 has raced/,
  ],
  [
    'into a heat that has raced',
    [scored('B1', 1, 'b2', 'b3')],
    move('b4', 'A1', 'B1'),
    /B1 has raced/,
  ],
  ['a boat not in that heat', [], move('b2', 'A1', 'B1'), /CRO 2 is not in A1/],
  ['into her own heat', [], move('b1', 'A1', 'A1'), /already in A1/],
  ['into a heat that does not exist', [], move('b1', 'A1', 'C1'), /no heat C1/],
  ['a boat not entered', [], move('b9', 'A1', 'B1'), /b9 is not entered/],
])('refuses a move %s', (_what, before, decision, message) => {
  expect(
    reason([...start, ...(before as Decision[]), decision as Decision]),
  ).toMatch(message as RegExp);
});

it('refuses a heat of an earlier round', () => {
  const log: Decision[] = [
    ...start,
    scored('A1', 1, 'b1', 'b4'),
    scored('B1', 1, 'b2', 'b3'),
    { type: 'roundCreated' },
  ];
  // Round 2: A2 = b1, b3; B2 = b2, b4. A1 is closed (and has raced).
  expect(reason([...log, move('b1', 'A2', 'A1')])).toMatch(
    /A1 is not in the current round/,
  );
  expect(reason([...log, move('b1', 'A2', 'B2')])).toBeNull();
});

it('refuses once the Final Series has started', () => {
  const log: Decision[] = [
    ...start,
    scored('A1', 1, 'b1', 'b4'),
    scored('B1', 1, 'b2', 'b3'),
    { type: 'finalSeriesStarted' },
  ];
  expect(reason([...log, move('b1', 'Gold', 'Silver')])).toMatch(/SHRS 4.1/);
});

it('refuses a 21st boat (SHRS 2.3)', () => {
  const entries = Array.from({ length: 40 }, (_v, i) => boat(i + 1));
  const log: Decision[] = [...entries, { type: 'heatsCreated', heatCount: 2 }];
  const heats = replay(log).state.rounds[0];
  expect(heats.map((h) => h.boats.length)).toEqual([20, 20]);
  expect(reason([...log, move(heats[0].boats[0], 'A1', 'B1')])).toMatch(
    /B1 already has 20 boats/,
  );
});
