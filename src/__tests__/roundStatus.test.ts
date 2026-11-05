import { roundStatus } from '../renderer/utils/roundStatus';

// Which heat sails next is regatta-core's (nextInRound, tested there); this
// checks how the round bar words it.
const boats = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ boat_id: i + 1 }) as never);
const q = (heat_name: string, raceNumber: number, count = 5) => ({
  heat_name,
  heat_type: 'Qualifying',
  raceNumber,
  boats: boats(count),
});
const f = (heat_name: string, raceNumber: number) => ({
  heat_name,
  heat_type: 'Final',
  raceNumber,
  boats: boats(5),
});
const qualifying = { finalSeriesStarted: false };

describe('roundStatus', () => {
  it('is null without heats', () => {
    expect(roundStatus([], qualifying)).toBeNull();
  });

  it('points at the first heat of the round still to sail', () => {
    const heats = [
      q('Heat A1', 1),
      q('Heat B1', 1),
      q('Heat C1', 1),
      q('Heat A2', 1),
      q('Heat B2', 0),
      q('Heat C2', 0),
    ];
    const status = roundStatus(heats, qualifying);
    expect(status?.summary).toBe('Round 2 · 1 of 3 heats scored');
    expect(status?.next).toEqual({ kind: 'score', heat: heats[4], race: 1 });
    expect(status?.canUndoRedistribution).toBe(true);
  });

  it('offers the next round once every heat of the round is scored', () => {
    const status = roundStatus(
      [q('Heat A1', 1), q('Heat B1', 1), q('Heat C1', 1)],
      qualifying,
    );
    expect(status?.summary).toBe('Round 1 · 3 of 3 heats scored');
    expect(status?.next).toEqual({ kind: 'createRound', round: 2 });
    // Round 1 was not built from results: nothing to undo.
    expect(status?.canUndoRedistribution).toBe(false);
  });

  it('a heat with no boats does not hold the round up', () => {
    const status = roundStatus(
      [q('Heat A2', 1), q('Heat B2', 0, 0)],
      qualifying,
    );
    expect(status?.next).toEqual({ kind: 'createRound', round: 3 });
  });

  it('in the Final Series sends the fleet that is behind', () => {
    const heats = [
      f('Final Gold', 2),
      f('Final Silver', 1),
      f('Final Bronze', 2),
    ];
    const status = roundStatus(heats, { finalSeriesStarted: true });
    expect(status?.phase).toBe('final');
    expect(status?.summary).toBe('Race 2 · 2 of 3 fleets scored');
    expect(status?.next).toEqual({ kind: 'score', heat: heats[1], race: 2 });
  });

  it('one fleet races on in the same heat', () => {
    const heats = [q('Heat A1', 3)];
    const status = roundStatus(heats, qualifying);
    expect(status?.summary).toBe('Race 4 next');
    expect(status?.next).toEqual({ kind: 'score', heat: heats[0], race: 4 });
  });
});
