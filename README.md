

---

```markdown
# IOM SailScore (Electron + React)

A modern, fast desktop application for managing and scoring International One Metre (IOM) sailing regattas.

## Prerequisites

- Node.js 20+
- npm 10+
- macOS / Linux / Windows

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

From the project root:

```bash
npm start

```

> **Note:** Do not run `npm start` inside the `release/app` subfolder (that subfolder does not define a `start` script).

## Building for Production

To create a standalone executable (`.exe`) with your custom app name and icon, run the following command from the project root:

```bash
npm run package

```

Once the build finishes, you can find your compiled application in the `release/build/` folder.

* **Portable version:** Look inside the `win-unpacked` folder for your `.exe`.
* **Installer:** Look for the generated `Setup.exe` file in the `release/build/` folder.
*(Remember to move these files out of any cloud-synced folders like OneDrive before running them to prevent database lock errors).*

## Testing

Run tests from the project root.

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

* **`calculateBoatScores`**:
* Score exclusion thresholds
* A81 and A82 tie-breaking rules
* Ranking/place assignment


* **`calculateFinalBoatScores`**:
* Final-group ranking (Gold/Silver/Bronze)
* A81 and A82 tie-breaking inside groups
* Large-group stress tests


* **`creatingNewHeatsUtls`**:
* Zig-zag and round-robin heat assignment
* Heat suffix parsing / next-heat name generation
* Race-count consistency checks



## Large group scenarios (20+ participants)

The final leaderboard tests include high-participant scenarios to guard complex group logic:

* 25 participants in each of Gold, Silver, and Bronze groups
* 24 participants in Gold with tie-break verification under load

These checks verify:

* Stable sorting by points
* Consecutive places (`1..N`) with no gaps
* Correct A81/A82 tie resolution in large groups

### Optional full Jest run

```bash
npm run test:full

```

This uses the default Jest config and may require extra build/transpile compatibility for renderer dependencies.

```

***

Now that you have a working, branded executable, would you like to test building an actual installer (`Setup.exe`) so you can distribute it easily to other race committee members?

```
