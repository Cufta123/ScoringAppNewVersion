/**
 * Jest configuration for unit tests.
 * Overrides the default config to skip the build-exists check,
 * so scoring/utility tests can run without a full Electron build.
 */
import type { Config } from 'jest';

const config: Config = {
  moduleDirectories: ['node_modules', 'release/app/node_modules', 'src'],
  moduleFileExtensions: ['js', 'jsx', 'ts', 'tsx', 'json'],
  moduleNameMapper: {
    '\\.(jpg|jpeg|png|gif|eot|otf|webp|svg|ttf|woff|woff2|mp4|webm|wav|mp3|m4a|aac|oga)$':
      '<rootDir>/.erb/mocks/fileMock.js',
    '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
  },
  // No setupFiles – we do not require a pre-built Electron bundle for unit tests
  setupFiles: [],
  testEnvironment: 'node',
  testPathIgnorePatterns: [
    'release/app/dist',
    '.erb/dll',
    '<rootDir>/src/__tests__/fixtures/',
    // The template's whole-app render test needs a built bundle (test:full).
    '<rootDir>/src/__tests__/App.test.tsx',
  ],
  transform: {
    '\\.(ts|tsx|js|jsx)$': 'ts-jest',
  },
  // Every test under src/__tests__. This used to be a hand-kept list, and a
  // test missing from it silently never ran here (only under test:full).
  testMatch: ['**/src/__tests__/**/*.test.[jt]s?(x)'],
};

export default config;
