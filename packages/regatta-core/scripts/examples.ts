/**
 * Writes examples/expected/<name>.json: the results of every example event,
 * as `regatta-core <example>` prints them. test/examples.test.ts fails when
 * the library's results differ from these files.
 *
 * These files are what the library says, not what the rules say: check a
 * changed file by hand (git diff) before committing it.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { results, type EventFile } from '../src';

export const EXAMPLES = join(__dirname, '..', 'examples');
export const EXPECTED = join(EXAMPLES, 'expected');

export const exampleNames = () =>
  readdirSync(EXAMPLES).filter((file) => file.endsWith('.json'));

export const resultsText = (name: string) =>
  `${JSON.stringify(
    results(
      JSON.parse(readFileSync(join(EXAMPLES, name), 'utf8')) as EventFile,
    ),
    null,
    2,
  )}\n`;

if (require.main === module) {
  mkdirSync(EXPECTED, { recursive: true });
  exampleNames().forEach((name) => {
    writeFileSync(join(EXPECTED, name), resultsText(name));
    process.stdout.write(`wrote examples/expected/${name}\n`);
  });
}
