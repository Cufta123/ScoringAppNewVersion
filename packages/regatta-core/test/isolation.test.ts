/**
 * The library runs anywhere: nothing under src/ imports anything but other
 * files of the library. Only the command line (src/cli.ts) may use Node
 * and the schema validator.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });

const library = files(SRC).filter(
  (path) => path.endsWith('.ts') && relative(SRC, path) !== 'cli.ts',
);

it.each(library.map((path) => [relative(SRC, path), path]))(
  'src/%s imports only the library',
  (_name, path) => {
    const imports = [
      ...readFileSync(path, 'utf8').matchAll(
        /from\s+'([^']+)'|require\('([^']+)'\)/g,
      ),
    ].map((m) => m[1] ?? m[2]);
    expect(imports.filter((spec) => !spec.startsWith('.'))).toEqual([]);
  },
);
