/**
 * Writes the JSON Schemas for the event file and the results from the
 * TypeScript types in src/results.ts. `--check` fails instead of writing
 * when a schema is out of date (the tests run it that way).
 */
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createGenerator } from 'ts-json-schema-generator';

const root = join(__dirname, '..');

const SCHEMAS = [
  {
    type: 'EventFile',
    file: 'event.schema.json',
    title: 'regatta-core event file',
  },
  {
    type: 'Results',
    file: 'results.schema.json',
    title: 'regatta-core results',
  },
] as const;

export function generate(type: string, title: string): string {
  const schema = createGenerator({
    path: join(root, 'src/results.ts'),
    tsconfig: join(root, 'tsconfig.json'),
    type,
    additionalProperties: false,
    sortProps: true,
    skipTypeCheck: true,
  }).createSchema(type);
  return `${JSON.stringify({ title, ...schema }, null, 2)}\n`;
}

export function schemaPath(file: string) {
  return join(root, 'schema', file);
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  let stale = false;
  SCHEMAS.forEach(({ type, file, title }) => {
    const text = generate(type, title);
    const path = schemaPath(file);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : '';
    if (current === text) return;
    if (check) {
      stale = true;
      process.stderr.write(
        `schema/${file} is out of date: run npm run schema\n`,
      );
    } else {
      writeFileSync(path, text);
      process.stdout.write(`wrote schema/${file}\n`);
    }
  });
  if (stale) process.exit(1);
}

export { SCHEMAS };
