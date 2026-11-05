import { readFileSync } from 'fs';
import { join } from 'path';
import { main, validateEventFile } from '../src/cli';

const example = (name: string) => join(__dirname, '..', 'examples', name);
const run = (args: string[], stdin = '') => main(args, () => stdin);

describe('regatta-core <file>', () => {
  it('prints the results as JSON and exits 0', () => {
    const { code, out, err } = run([example('one-fleet.json')]);
    expect(code).toBe(0);
    expect(err).toBe('');
    const r = JSON.parse(out);
    expect(r.name).toBe('Club race, one fleet');
    expect(r.refused).toBeUndefined();
    expect(r.qualifying.completedRaces).toBe(5);
    expect(
      r.qualifying.standings.map((s: { place: number }) => s.place),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('reads the event from stdin with -', () => {
    const file = readFileSync(example('one-fleet.json'), 'utf8');
    expect(run(['-'], file).out).toBe(run([example('one-fleet.json')]).out);
  });

  it('exits 1 on a refused decision, with the results before it', () => {
    const { code, out, err } = run([example('refused.json')]);
    expect(code).toBe(1);
    expect(err).toMatch(/Decision 6 refused: .* is listed twice\./);
    const r = JSON.parse(out);
    expect(r.refused).toMatchObject({
      at: 6,
      decision: { type: 'raceScored' },
    });
    expect(r.qualifying.completedRaces).toBe(1);
  });

  it('prints tables with --text', () => {
    const { code, out } = run(['--text', example('heats-and-final.json')]);
    expect(code).toBe(0);
    expect(out).toContain('Qualifying (4 races)');
    expect(out).toContain('Final, Gold (3 races)');
    expect(out).toContain('Final, Silver (3 races)');
    expect(out).toContain('Overall');
    expect(out).toContain('9 OCS');
    expect(out).toContain('(9 DSQ)');
  });

  it('marks a refusal in the tables', () => {
    expect(run(['--text', example('refused.json')]).out).toContain(
      'REFUSED decision 6 (raceScored)',
    );
  });
});

describe('bad input exits 2', () => {
  it('usage without a file', () => {
    expect(run([])).toMatchObject({
      code: 2,
      err: expect.stringContaining('Usage'),
    });
  });
  it('a missing file', () => {
    expect(run(['nope.json'])).toMatchObject({
      code: 2,
      err: expect.stringContaining('Cannot read nope.json'),
    });
  });
  it('not JSON', () => {
    expect(run(['-'], '{')).toMatchObject({
      code: 2,
      err: expect.stringContaining('Not JSON'),
    });
  });
  it('not an event file', () => {
    expect(run(['-'], '[]')).toMatchObject({
      code: 2,
      err: expect.stringContaining('Not a valid event file'),
    });
  });
});

describe('schema errors name the decision', () => {
  it('an unknown type', () => {
    expect(validateEventFile({ decisions: [{ type: 'boatSank' }] })).toEqual([
      expect.stringMatching(
        /^decision 0: "type" must be one of settingsChanged, /,
      ),
    ]);
  });
  it('a missing field, under the decision it belongs to', () => {
    const problems = validateEventFile({
      decisions: [
        { type: 'boatEntered', boat: { id: 'a', nat: 'CRO', sail: '1' } },
        { type: 'heatsCreated' },
      ],
    });
    expect(problems).toEqual([
      'decision 1 (heatsCreated):',
      "    / must have required property 'heatCount'",
    ]);
  });
  it('an unknown field at the top', () => {
    expect(validateEventFile({ decisions: [], extra: 1 })).toEqual([
      '  / must NOT have additional properties: extra',
    ]);
  });
  it('a valid file has none', () => {
    expect(validateEventFile({ decisions: [] })).toEqual([]);
  });
});
