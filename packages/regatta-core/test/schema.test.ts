/**
 * The JSON Schemas describe what the library reads and writes: they are
 * generated from the types, every example is a valid event file, and every
 * result is a valid results document.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import Ajv from 'ajv';
import { SCHEMAS, generate, schemaPath } from '../scripts/schema';
import { EXAMPLES, exampleNames } from '../scripts/examples';
import { results, type EventFile } from '../src';

const load = (file: string) =>
  JSON.parse(readFileSync(schemaPath(file), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validEvent = ajv.compile(load('event.schema.json'));
const validResults = ajv.compile(load('results.schema.json'));

it.each(SCHEMAS.map((s) => [s.file, s] as const))(
  'schema/%s is up to date with the types (npm run schema)',
  (_file, { type, file, title }) => {
    expect(JSON.parse(readFileSync(schemaPath(file), 'utf8'))).toEqual(
      JSON.parse(generate(type, title)),
    );
  },
  30000,
);

describe.each(exampleNames())('examples/%s', (name) => {
  const event = JSON.parse(readFileSync(join(EXAMPLES, name), 'utf8'));
  it('is a valid event file', () => {
    const ok = validEvent(event);
    expect(validEvent.errors ?? ok).toBe(true);
  });
  it('gives a valid results document', () => {
    const ok = validResults(results(event as EventFile));
    expect(validResults.errors ?? ok).toBe(true);
  });
});

describe('the event schema refuses', () => {
  it.each([
    ['no decisions', {}],
    ['an unknown field', { decisions: [], extra: 1 }],
    ['an unknown decision', { decisions: [{ type: 'boatSank' }] }],
    [
      'a boat without sail number',
      { decisions: [{ type: 'boatEntered', boat: { id: 'a', nat: 'CRO' } }] },
    ],
    [
      'an unknown code',
      {
        decisions: [
          {
            type: 'raceScored',
            heat: 'A1',
            lines: [{ boat: 'a', code: 'XYZ' }],
          },
        ],
      },
    ],
    [
      'a DPI without points',
      {
        decisions: [
          {
            type: 'protestDecided',
            race: { heat: 'A1', race: 1 },
            boat: 'a',
            outcome: { kind: 'DPI' },
          },
        ],
      },
    ],
  ])('%s', (_what, file) => {
    expect(validEvent(file)).toBe(false);
  });
});
