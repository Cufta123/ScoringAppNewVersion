/**
 * Edge cases found by the parity inventory against the app (Nov 2026).
 * Each one was a crash or a wrong result before its fix.
 */
import { finalStandings, replay, type Decision } from '../src';

const boat = (i: number): Decision => ({
  type: 'boatEntered',
  boat: { id: `b${i}`, nat: 'CRO', sail: String(i) },
});
const sheet = (heat: string, ...boats: string[]): Decision => ({
  type: 'raceScored',
  heat,
  lines: boats.map((id) => ({ boat: id })),
});

describe('a boat removed after the fleets are made', () => {
  // b5 entered late, never had a heat, and went into a fleet with DNCs.
  const log: Decision[] = [
    boat(1),
    boat(2),
    boat(3),
    boat(4),
    { type: 'heatsCreated', heatCount: 2 },
    boat(5),
    sheet('A1', 'b1', 'b4'),
    sheet('B1', 'b2', 'b3'),
    { type: 'finalSeriesStarted' },
    { type: 'boatRemoved', boat: 'b5' },
  ];

  it('leaves her fleet too', () => {
    const result = replay(log);
    expect(result.ok).toBe(true);
    expect(result.state.fleets!.flatMap((fleet) => fleet.boats)).not.toContain(
      'b5',
    );
  });

  it('is not on any final sheet and not in the largest heat', () => {
    const result = replay(log);
    const fleet = result.state.fleets!.find((f) => f.boats.length > 0)!;
    const after = replay([...log, sheet(fleet.id, ...fleet.boats)]);
    expect(after.ok).toBe(true);
    const standings = finalStandings(after.state).flatMap((f) => f.standings);
    expect(standings.map((s) => s.boat)).not.toContain('b5');
  });

  it('is refused once her fleet has raced', () => {
    const before = replay(log.slice(0, -1));
    const fleet = before.state.fleets!.find((f) => f.boats.includes('b5'))!;
    const result = replay([
      ...log.slice(0, -1),
      sheet(fleet.id, ...fleet.boats),
      { type: 'boatRemoved', boat: 'b5' },
    ]);
    expect(result.ok).toBe(false);
  });
});

describe('a heat left with no boats', () => {
  // Three heats, the only boat of B1 withdraws before racing.
  const start: Decision[] = [
    boat(1),
    boat(2),
    boat(3),
    { type: 'heatsCreated', heatCount: 3 },
    { type: 'boatRemoved', boat: 'b2' },
    sheet('A1', 'b1'),
    sheet('C1', 'b3'),
  ];

  it.each(['progressive', 'pre-assigned'] as const)(
    'does not stop the next round (%s)',
    (mode) => {
      const log: Decision[] = [
        { type: 'settingsChanged', settings: { qualifyingMode: mode } },
        ...start,
        { type: 'roundCreated' },
      ];
      const result = replay(log);
      expect(result.ok).toBe(true);
      const round2 = result.state.rounds[1];
      expect(round2.flatMap((heat) => heat.boats).sort()).toEqual(['b1', 'b3']);
    },
  );

  it('does not stop the Final Series', () => {
    const result = replay([...start, { type: 'finalSeriesStarted' }]);
    expect(result.ok).toBe(true);
  });
});
