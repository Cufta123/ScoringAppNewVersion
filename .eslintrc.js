// The SHRS 2026-1 / RRS 2025-2028 Appendix A rules live in
// packages/regatta-core and nowhere else (AGENTS.md §1, §5). These were the
// app's own copies of rules, removed when they moved into the library; they
// must not come back under their old paths.
const REMOVED_RULE_MODULES = {
  group: [
    // By file name, so a relative import from next door is caught too.
    '**/raceColumnEdit',
    '**/scoringPenalty',
    '**/statusPoints',
    '**/scoring/discards',
    '**/redress',
    '**/sailOrder',
    '**/fleetNames',
    '**/heatSizing',
    '**/points',
    '**/penaltyOrder',
    '**/raceSeeding',
  ],
  message:
    'That rule lives in packages/regatta-core: import it from "regatta-core" (AGENTS.md §1). The app must not implement SHRS / RRS scoring.',
};

// Names of the app's former rule copies: declaring one in src/ is a second
// copy of a rule the library already has.
const REIMPLEMENTED_RULES = [
  'applyRaceColumnEdit',
  'scoreRaceColumn',
  'getScoringPenaltyPoints',
  'deriveNonFinisherPoints',
  'getExcludedIndexes',
  'capExcludeCountForBoat',
  'getExcludeCount',
  'getExcludeCountForConfig',
  'getExcludeCountForProfile',
  'applyExclusions',
  'averageRedressPoints',
  'averageRacePoints',
  'averageSelectedRacePoints',
  'refreshSessionRdgAverages',
  'withRedressAverage',
  'rescoreEntry',
  'roundToTenthHalfUp',
  'compareNationalSail',
  'compareSeededRows',
  'orderBoatsByPenalty',
  'fleetRank',
  'fleetNameForIndex',
  'minimumHeatsForEntries',
  'getOddEvenMovementAdvisory',
].join('|');
const RULE_COPY_MESSAGE =
  'This rule is regatta-core\'s: import it from "regatta-core" instead of writing a copy (AGENTS.md §1).';

module.exports = {
  extends: 'erb',
  plugins: ['@typescript-eslint'],
  rules: {
    // A temporary hack related to IDE not resolving correct package.json
    'import/no-extraneous-dependencies': 'off',
    // The SQLite schema is snake_case (event_id, heat_id, total_points_final),
    // and those column names flow through IPC payloads, handler parameters and
    // renderer row types unchanged. Renaming at each boundary would obscure the
    // mapping to the table, so the rule is disabled project-wide instead of via
    // the 39 per-file `/* eslint-disable camelcase */` headers this replaces.
    camelcase: 'off',
    'react/react-in-jsx-scope': 'off',
    'react/jsx-filename-extension': 'off',
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    'import/no-import-module-exports': 'off',
    'no-shadow': 'off',
    '@typescript-eslint/no-shadow': 'error',
    'no-unused-vars': 'off',
    // Allow intentionally-unused identifiers prefixed with `_`
    // (e.g. `_event` IPC args, placeholder destructures).
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // Function declarations are hoisted, so referencing them before their
    // definition is safe at runtime; only flag var/let/const and classes.
    'no-use-before-define': ['error', { functions: false, classes: true }],
    // Several leaderboard components pass through dynamically-shaped DB rows.
    // Exhaustive PropTypes.shape definitions would be brittle and add no
    // bug-catching value, so allow PropTypes.object / PropTypes.array.
    'react/forbid-prop-types': 'off',
    // React is removing defaultProps for function components, so optional props
    // are defaulted via destructuring default parameters instead.
    'react/require-default-props': ['error', { functions: 'defaultArguments' }],
  },
  overrides: [
    {
      // packages/regatta-core is a standalone library: decisions in, results
      // out. It must not import the app, the database or any runtime. Its
      // command line, scripts and tests run on Node (next override).
      files: ['packages/regatta-core/**/*.ts'],
      excludedFiles: [
        'packages/regatta-core/src/cli.ts',
        'packages/regatta-core/scripts/**',
        'packages/regatta-core/test/**',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/src/main/**',
                  '**/src/renderer/**',
                  '**/src/shared/**',
                  '**/public/**',
                ],
                message: 'regatta-core stands alone; pass data in instead.',
              },
              {
                group: [
                  'electron',
                  'react',
                  'react-dom',
                  'better-sqlite3',
                  'node:*',
                  'fs',
                  'path',
                ],
                message: 'regatta-core runs anywhere: no runtime APIs.',
              },
            ],
          },
        ],
      },
    },
    {
      // regatta-core's command line, scripts and tests may use Node, but
      // still not the app: the library is checked on its own.
      files: [
        'packages/regatta-core/src/cli.ts',
        'packages/regatta-core/scripts/**/*.ts',
        'packages/regatta-core/test/**/*.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/src/main/**',
                  '**/src/renderer/**',
                  '**/src/shared/**',
                  '**/public/**',
                ],
                message: 'regatta-core stands alone; pass data in instead.',
              },
            ],
          },
        ],
      },
    },
    {
      // The app keeps storage, projection, the conversion of old records,
      // input checks, display and IPC; every scoring rule is regatta-core's.
      files: ['src/**/*.{js,jsx,ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: [REMOVED_RULE_MODULES] },
        ],
        'no-restricted-syntax': [
          'error',
          // airbnb's own (this list replaces it for src/).
          {
            selector: 'ForInStatement',
            message:
              'for..in loops iterate over the entire prototype chain, which is virtually never what you want. Use Object.{keys,values,entries}, and iterate over the resulting array.',
          },
          {
            selector: 'ForOfStatement',
            message:
              'iterators/generators require regenerator-runtime, which is too heavyweight for this guide to allow them. Separately, loops should be avoided in favor of array iterations.',
          },
          {
            selector: 'LabeledStatement',
            message:
              'Labels are a form of GOTO; using them makes code confusing and hard to maintain and understand.',
          },
          {
            selector: 'WithStatement',
            message:
              '`with` is disallowed in strict mode because it makes code impossible to predict and optimize.',
          },
          {
            selector: `FunctionDeclaration[id.name=/^(${REIMPLEMENTED_RULES})$/]`,
            message: RULE_COPY_MESSAGE,
          },
          {
            selector: `VariableDeclarator[id.name=/^(${REIMPLEMENTED_RULES})$/]`,
            message: RULE_COPY_MESSAGE,
          },
        ],
      },
    },
    {
      // src/shared is plain TypeScript that the main process and the
      // renderer both run (the IPC contract, row types, input parsing), and
      // that a future results viewer can run too; the rules themselves are
      // regatta-core's. It must not reach into either side or into the database, UI or
      // Node APIs, or it stops being shareable.
      files: ['src/shared/**/*.{js,ts}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/main/**', '**/renderer/**', '**/public/**'],
                message:
                  'src/shared must stay free of main-process and renderer code; pass data in instead.',
              },
              REMOVED_RULE_MODULES,
              {
                group: [
                  'electron',
                  'react',
                  'react-dom',
                  'better-sqlite3',
                  'fs',
                  'path',
                  'node:*',
                ],
                message:
                  'src/shared must run anywhere: no Electron, React, database or Node APIs.',
              },
            ],
          },
        ],
      },
    },
    {
      // Playwright specs drive the app step by step, so sequential `await` in a
      // loop is the correct shape rather than a mistake, and index counters are
      // idiomatic. Mirrors the unit-test override below; without it `npm run
      // lint` reports 18 pre-existing errors and cannot be used as a gate.
      files: ['e2e/**/*.{js,ts}'],
      rules: {
        'no-await-in-loop': 'off',
        'no-plusplus': 'off',
        'no-restricted-syntax': 'off',
      },
    },
    {
      // Test files legitimately export helpers, use raw DB column names
      // (snake_case), require() modules lazily, and lean on loops plus bitwise
      // seeded-RNG math and conditional assertions in property-based tests.
      files: ['src/__tests__/**/*.{js,jsx,ts,tsx}'],
      rules: {
        'jest/no-export': 'off',
        camelcase: 'off',
        'global-require': 'off',
        'no-bitwise': 'off',
        'no-plusplus': 'off',
        'no-continue': 'off',
        'no-await-in-loop': 'off',
        'no-loop-func': 'off',
        'no-nested-ternary': 'off',
        'no-restricted-syntax': 'off',
        'jest/no-conditional-expect': 'off',
        'react/prop-types': 'off',
        'react/jsx-props-no-spreading': 'off',
        'func-names': 'off',
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  settings: {
    'import/resolver': {
      // See https://github.com/benmosher/eslint-plugin-import/issues/1396#issuecomment-575727774 for line below
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        moduleDirectory: ['node_modules', 'src/'],
      },
      webpack: {
        config: require.resolve('./.erb/configs/webpack.config.eslint.ts'),
      },
      typescript: {},
    },
    'import/parsers': {
      '@typescript-eslint/parser': ['.ts', '.tsx'],
    },
  },
};
