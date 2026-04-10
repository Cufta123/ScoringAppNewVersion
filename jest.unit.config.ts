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
  testPathIgnorePatterns: ['release/app/dist', '.erb/dll'],
  transform: {
    '\\.(ts|tsx|js|jsx)$': 'ts-jest',
  },
  // Run only unit tests (scoring logic + utilities)
  testMatch: [
    '**/src/__tests__/App.routing.test.tsx',
    '**/src/__tests__/LandingPage.test.jsx',
    '**/src/__tests__/EventPage.test.jsx',
    '**/src/__tests__/LeaderboardPage.test.jsx',
    '**/src/__tests__/SailorForm.test.jsx',
    '**/src/__tests__/useLeaderboard.scoring.test.jsx',
    '**/src/__tests__/useLeaderboard.rdg.property.test.jsx',
    '**/src/__tests__/leaderboard.property.test.jsx',
    '**/src/__tests__/backendUiTieBreak.property.test.jsx',
    '**/src/__tests__/ScoringInputComponent.test.jsx',
    '**/src/__tests__/calculateBoatScores.test.ts',
    '**/src/__tests__/calculateFinalBoatScores.test.ts',
    '**/src/__tests__/creatingNewHeatsUtils.test.ts',
    '**/src/__tests__/HeatRaceHandler.createNewHeats.test.ts',
    '**/src/__tests__/SHRS_comprehensive.test.ts',
    '**/src/__tests__/compareUtils.test.ts',
    '**/src/__tests__/leaderboardStatusCodes.test.ts',
    '**/src/__tests__/HeatRaceHandler.overallTieBreak.test.ts',
  ],
};

export default config;
