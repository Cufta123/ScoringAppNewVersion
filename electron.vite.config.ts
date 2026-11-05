/**
 * Build of the three Electron parts with electron-vite (main, preload,
 * renderer). `npm start` = `electron-vite dev --watch`: the renderer from the
 * dev server with hot reload, main and preload built into `out/` and rebuilt
 * on change (a main change restarts the app). `npm run build` = the
 * production build into `release/app/dist`, which electron-builder packages
 * (`npm run package`).
 */
import fs from 'fs';
import path from 'path';
import { defineConfig, type UserConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { dependencies as appDependencies } from './release/app/package.json';

const root = __dirname;
const appDir = path.join(root, 'release', 'app');

/**
 * The scoring library, imported as `regatta-core` from its TypeScript source
 * (tsconfig.json `paths`, jest `moduleNameMapper`), in all three processes.
 */
const alias = [
  {
    find: /^regatta-core$/,
    replacement: path.join(root, 'packages/regatta-core/src/index.ts'),
  },
  {
    find: /^regatta-core\/(.*)$/,
    replacement: path.join(root, 'packages/regatta-core/$1'),
  },
];

/**
 * The problem-report service key (src/main/functions/problemReportConfig.ts):
 * from IOM_REPORT_KEY (CI secret) or the git-ignored .report-key file.
 * Without either the build works, but keeps reports on the computer.
 */
const reportKey = (): string => {
  if (process.env.IOM_REPORT_KEY) return process.env.IOM_REPORT_KEY.trim();
  try {
    return fs.readFileSync(path.join(root, '.report-key'), 'utf8').trim();
  } catch {
    return '';
  }
};

/**
 * Native modules live in release/app (better-sqlite3, rebuilt for Electron by
 * `electron-builder install-app-deps`) and are loaded at run time, never
 * bundled. Everything else the main process imports is bundled, because the
 * packaged app ships release/app/node_modules only.
 */
const nativeModules = Object.keys(appDependencies);

export default defineConfig(({ command }) => {
  const dev = command === 'serve';
  const nodeEnv = dev ? 'development' : 'production';
  // Production goes where electron-builder packages it from; the dev build
  // stays apart in out/ (git-ignored), so it never replaces the build the
  // GUI tests and the packager use.
  const outDir = (part: string) =>
    dev ? path.join(root, 'out', part) : path.join(appDir, 'dist', part);

  const nodeBuild = (part: 'main' | 'preload'): UserConfig['main'] => ({
    resolve: { alias },
    define: {
      // Replaced at build time, as the webpack builds did: the packaged app
      // runs as production whatever NODE_ENV the computer has.
      'process.env.NODE_ENV': JSON.stringify(nodeEnv),
      ...(dev || part !== 'main'
        ? {}
        : {
            'process.env.IOM_REPORT_KEY': JSON.stringify(reportKey()),
            'process.env.DEBUG_PROD': JSON.stringify(
              process.env.DEBUG_PROD ?? false,
            ),
            'process.env.START_MINIMIZED': JSON.stringify(
              process.env.START_MINIMIZED ?? false,
            ),
          }),
    },
    build: {
      outDir: outDir(part),
      emptyOutDir: true,
      sourcemap: dev ? 'inline' : true,
      // Bundle every dependency (the default would leave package.json's
      // dependencies to node_modules, which the packaged app does not have).
      externalizeDeps: false,
      rolldownOptions: {
        input: { [part]: path.join(root, 'src/main', `${part}.ts`) },
        external: nativeModules,
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
          // In dev the bundle runs from out/main, outside release/app: load
          // the native modules from there (packaged and in release/app/dist
          // they resolve from release/app/node_modules by themselves).
          ...(dev && part === 'main'
            ? {
                paths: Object.fromEntries(
                  nativeModules.map((name) => [
                    name,
                    path.join(appDir, 'node_modules', name),
                  ]),
                ),
              }
            : {}),
        },
      },
    },
  });

  return {
    main: nodeBuild('main'),
    preload: nodeBuild('preload'),
    renderer: {
      root: path.join(root, 'src/renderer'),
      resolve: { alias },
      plugins: [react()],
      server: {
        // The port of the webpack dev server before; PORT=4343 npm start
        // picks another. Refuse a port in use rather than move silently.
        port: Number(process.env.PORT) || 1212,
        strictPort: true,
      },
      build: {
        outDir: outDir('renderer'),
        emptyOutDir: true,
        sourcemap: true,
        rolldownOptions: {
          input: path.join(root, 'src/renderer/index.html'),
        },
      },
    },
  };
});
