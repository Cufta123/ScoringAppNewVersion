/**
 * What replay refuses that the types alone would let through, and what it
 * no longer refuses: a settings form saving values already in force.
 */
import { replay, type Decision } from '../src';

const boat = (i: number): Decision => ({
  type: 'boatEntered',
  boat: { id: `b${i}`, nat: 'CRO', sail: String(i) },
});
const raced: Decision[] = [
  boat(1),
  boat(2),
  { type: 'heatsCreated', heatCount: 1 },
  {
    type: 'raceScored',
    race: { heat: 'A1', race: 1 },
    lines: [{ boat: 'b1' }, { boat: 'b2' }],
  },
];
const reason = (log: Decision[]) => {
  const result = replay(log);
  return result.ok ? null : result.reason;
};
// Files can hold what the types do not: cast to test replay's own checks.
const odd = (decision: unknown) => decision as Decision;

describe('settings saved again after racing started', () => {
  it('are accepted when nothing changes, in any key order', () => {
    expect(
      reason([
        {
          type: 'settingsChanged',
          settings: { qualifyingMode: 'progressive' },
        },
        {
          type: 'settingsChanged',
          settings: {
            discards: {
              qualifying: { kind: 'custom', first: 3, second: 6, every: 4 },
              final: { kind: 'standard' },
            },
          },
        },
        ...raced,
        {
          type: 'settingsChanged',
          settings: {
            qualifyingMode: 'progressive',
            finalOverflow: 'add-fleets',
            discards: {
              qualifying: { every: 4, second: 6, first: 3, kind: 'custom' },
              final: { kind: 'standard' },
            },
          },
        },
      ]),
    ).toBeNull();
  });

  it('are refused when a locked value changes', () => {
    expect(
      reason([
        ...raced,
        {
          type: 'settingsChanged',
          settings: { qualifyingMode: 'pre-assigned' },
        },
      ]),
    ).toMatch(/assignment method is fixed/);
    expect(
      reason([
        ...raced,
        {
          type: 'settingsChanged',
          settings: {
            discards: {
              qualifying: { kind: 'none' },
              final: { kind: 'standard' },
            },
          },
        },
      ]),
    ).toMatch(/SHRS 5.4/);
  });
});

describe('refused values', () => {
  const protest = (outcome: unknown) =>
    odd({
      type: 'protestDecided',
      race: { heat: 'A1', race: 1 },
      boat: 'b1',
      outcome,
    });

  it.each([0, -1, 99.5, 4.25, Number.NaN, '5'])('DPI points %p', (points) => {
    expect(reason([...raced, protest({ kind: 'DPI', points })])).toMatch(
      /more than 0 and at most 99/,
    );
  });

  it.each([0.1, 4.5, 99])('DPI points %p are fine', (points) => {
    expect(reason([...raced, protest({ kind: 'DPI', points })])).toBeNull();
  });

  it('RDG3 points are checked the same way', () => {
    expect(reason([...raced, protest({ kind: 'RDG3', points: 120 })])).toMatch(
      /RDG3 points/,
    );
  });

  it('an unknown protest decision', () => {
    expect(reason([...raced, protest({ kind: 'DSQX' })])).toMatch(
      /Unknown protest decision/,
    );
  });

  it.each([
    [{ code: 'XYZ' }, /unknown code XYZ/],
    [{ code: 'RAF' }, /unknown code RAF/],
    [{ penalty: 'ZZZ' }, /unknown penalty ZZZ/],
  ])('a sheet line %p', (extra, message) => {
    expect(
      reason([
        boat(1),
        boat(2),
        { type: 'heatsCreated', heatCount: 1 },
        odd({
          type: 'raceScored',
          race: { heat: 'A1', race: 1 },
          lines: [{ boat: 'b1' }, { boat: 'b2', ...extra }],
        }),
      ]),
    ).toMatch(message);
  });

  it.each([
    { kind: 'custom', first: 4, second: 4, every: 8 },
    { kind: 'custom', first: 0, second: 8, every: 8 },
    { kind: 'custom', first: 4, second: 8, every: 0 },
    { kind: 'custom', first: 4.5, second: 8, every: 8 },
    { kind: 'thresholds', at: [4, 4] },
    { kind: 'thresholds', at: [8, 4] },
    { kind: 'thresholds', at: [0] },
    { kind: 'sometimes' },
  ])('discards %p', (profile) => {
    expect(
      reason([
        odd({
          type: 'settingsChanged',
          settings: {
            discards: { qualifying: profile, final: { kind: 'standard' } },
          },
        }),
      ]),
    ).toMatch(/Discards|Unknown discard/);
  });

  it.each([{ qualifyingMode: 'random' }, { finalOverflow: 'squeeze' }])(
    'settings %p',
    (settings) => {
      expect(reason([odd({ type: 'settingsChanged', settings })])).toMatch(
        /Unknown/,
      );
    },
  );

  it.each([
    { id: '', nat: 'CRO', sail: '1' },
    { id: 'a', nat: ' ', sail: '1' },
    { id: 'a', nat: 'CRO', sail: '' },
  ])('a boat %p', (b) => {
    expect(reason([odd({ type: 'boatEntered', boat: b })])).toMatch(
      /needs an id/,
    );
  });
});
