module.exports = {
  extends: 'erb',
  plugins: ['@typescript-eslint'],
  rules: {
    // A temporary hack related to IDE not resolving correct package.json
    'import/no-extraneous-dependencies': 'off',
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
