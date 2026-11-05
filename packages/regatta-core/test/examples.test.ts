/**
 * Every example event gives the results in examples/expected/. When the
 * library changes on purpose, run `npm run examples` and check the diff.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { EXPECTED, exampleNames, resultsText } from '../scripts/examples';

describe.each(exampleNames())('examples/%s', (name) => {
  it('gives the expected results', () => {
    expect(resultsText(name)).toBe(readFileSync(join(EXPECTED, name), 'utf8'));
  });
});
