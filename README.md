## Scoring App (Electron + React)

## Prerequisites

- Node.js 20+
- npm 10+
- macOS/Linux/Windows

## First-time setup (recommended)

Run these commands from the project root (the folder that contains `package.json`):

```bash
npm install --ignore-scripts
npm run postinstall
npm run build:dll
```

Then start development:

```bash
npm start
```

## Daily start

From project root:

```bash
npm start
```

Do not run `npm start` inside `release/app` (that subfolder does not define a `start` script).

## Testing

Run tests from project root.

### Recommended (unit tests)

```bash
npm test
```

`npm test` runs the unit test configuration (`jest.unit.config.ts`) and does not require a full Electron build.

You can run the same suite explicitly with:

```bash
npm run test:unit
```

### Run one test file

```bash
npx jest --config jest.unit.config.ts src/__tests__/calculateBoatScores.test.ts --no-coverage
npx jest --config jest.unit.config.ts src/__tests__/calculateFinalBoatScores.test.ts --no-coverage
npx jest --config jest.unit.config.ts src/__tests__/creatingNewHeatsUtils.test.ts --no-coverage
```

## What is covered

- `calculateBoatScores`:
	- score exclusion thresholds
	- A81 and A82 tie-breaking rules
	- ranking/place assignment
- `calculateFinalBoatScores`:
	- final-group ranking (Gold/Silver/Bronze)
	- A81 and A82 tie-breaking inside groups
	- large-group stress tests
- `creatingNewHeatsUtls`:
	- zig-zag and round-robin heat assignment
	- heat suffix parsing / next-heat name generation
	- race-count consistency checks

## Large group scenarios (20+ participants)

The final leaderboard tests include high-participant scenarios to guard complex group logic:

- 25 participants in each of Gold, Silver, and Bronze groups
- 24 participants in Gold with tie-break verification under load

These checks verify:

- stable sorting by points
- consecutive places (`1..N`) with no gaps
- correct A81/A82 tie resolution in large groups

### Optional full Jest run

```bash
npm run test:full
```

This uses the default Jest config and may require extra build/transpile compatibility for renderer dependencies.
