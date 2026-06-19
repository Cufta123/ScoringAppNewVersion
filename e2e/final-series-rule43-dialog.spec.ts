import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  launchApp,
  openEvent,
  addSailor,
  createEvent,
  createHeats,
  dismissToasts,
  uniqueName,
} from './helpers';

/**
 * Regression test for the contradictory Final-Series confirmation dialogs.
 *
 * Reported scenario: a 6–7 race qualifying series where a NEW round of heats
 * (e.g. Heat A7/B7) has been created but not yet sailed (0 races in that round).
 *
 * The bug: `getFinalSeriesEligibility` derived `noRacesCompleted` from the
 * latest round's race count only, so it reported "no races completed" while at
 * the same time `rule43Applies` (derived from the scored-race count) reported
 * "6–7 completed races". Starting the Final Series then fired two contradictory
 * prompts back-to-back:
 *
 *   1. "No qualifying races have been completed yet. Boats will be assigned to
 *       fleets based on their initial seeding only."
 *   2. "SHRS 2026-1 Rule 4.3 applies for 6-7 completed qualifying races."
 *
 * This test scores 6 rounds, creates a 7th (unsailed) round, then starts the
 * Final Series and asserts the bogus "no races completed" prompt never appears,
 * while the legitimate Rule 4.3 prompt does.
 */

// Long single flow that drives the real app end-to-end; give it room.
test.setTimeout(240_000);

let app: ElectronApplication;
let window: Page;

const EVENT_NAME = uniqueName('Rule43 Dialog Regression');
const HEAT_GROUPS = 2;
const BOATS = 8;
// Score 6 rounds (lands inside the SHRS 4.3 6–7 window), then create a 7th
// round of heats WITHOUT scoring it (the 0-races-in-the-new-round case).
const SCORED_ROUNDS = 6;

// Score every boat in the named heat (click each sail cell to add it to the
// finish order, then submit). Returns to the heat list when done.
async function scoreHeat(label: string): Promise<void> {
  await dismissToasts(window);
  await window.locator('.heat-column', { hasText: label }).first().click();
  await window
    .getByRole('button', { name: 'Start Scoring', exact: true })
    .click();
  await expect(
    window.getByRole('button', { name: /Submit Scores/i }),
  ).toBeVisible();

  const sailCells = window.locator(
    '.scoring-table tbody tr .scoring-sail-cell',
  );
  const count = await sailCells.count();
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sailCells.nth(i).click();
  }

  await window.getByRole('button', { name: /Submit Scores/i }).click();
  await expect(
    window.locator('.heat-column', { hasText: label }),
  ).toBeVisible();
}

// Redistribute the fleet from the current leaderboard, creating the next round
// of qualifying heats. Confirms the dialog and waits for the new round's cards.
async function createNextRoundOfHeats(round: number): Promise<void> {
  await dismissToasts(window);
  await window
    .getByRole('button', { name: 'Create New Heats from Leaderboard' })
    .click();
  await window
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm' })
    .click();
  await expect(
    window.locator('.heat-column', { hasText: `Heat A${round}` }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
});

test.afterAll(async () => {
  await app?.close();
});

test('starting the Final Series with an unsailed new round does not claim "no races completed"', async () => {
  // ── Set up the event, boats, and the first round of heats ─────────────────
  await createEvent(window, EVENT_NAME);
  await openEvent(window, EVENT_NAME);

  const countries = ['CRO', 'ITA', 'GER', 'FRA', 'ESP', 'GBR', 'USA', 'AUS'];
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < BOATS; i += 1) {
    await dismissToasts(window);
    await addSailor(window, {
      name: `Sailor${i}`,
      surname: `Crew${i}`,
      sail: String(301 + i),
      country: countries[i],
    });
  }
  /* eslint-enable no-await-in-loop */

  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await createHeats(window, HEAT_GROUPS);

  // ── Score 6 full rounds (6 completed qualifying races) ────────────────────
  for (let round = 1; round <= SCORED_ROUNDS; round += 1) {
    if (round > 1) {
      // eslint-disable-next-line no-await-in-loop
      await createNextRoundOfHeats(round);
    }
    // eslint-disable-next-line no-await-in-loop
    await scoreHeat(`Heat A${round}`);
    // eslint-disable-next-line no-await-in-loop
    await scoreHeat(`Heat B${round}`);
  }

  // ── Create a 7th round of heats but DO NOT score it (0 races in round 7) ───
  await createNextRoundOfHeats(SCORED_ROUNDS + 1);
  await expect(
    window.locator('.heat-column', { hasText: 'Heat A7' }),
  ).toBeVisible();

  // ── Start the Final Series ────────────────────────────────────────────────
  await dismissToasts(window);
  await window.getByRole('button', { name: /Start Final Series/i }).click();

  // The FIRST dialog must be the informative "latest round not sailed" prompt,
  // NOT the bogus "no races completed" one. With the bug, the wrong prompt
  // appears and this wait times out — the UI/UX error we are guarding against.
  await expect(
    window.getByRole('heading', { name: /Latest round not sailed/i }),
  ).toBeVisible();

  // It must explain that the last completed round is used (6 races), and must
  // NOT claim that no qualifying races have been completed.
  const unsailedDialog = window.getByRole('dialog');
  await expect(unsailedDialog).toContainText(/last completed round/i);
  await expect(unsailedDialog).toContainText(/6 qualifying race/i);
  await expect(
    window.getByText(/No qualifying races have been completed yet/i),
  ).toHaveCount(0);

  // Continue past the informative prompt.
  await unsailedDialog.getByRole('button', { name: 'Confirm' }).click();

  // Next is the recovery-snapshot offer — skip it.
  await expect(
    window.getByRole('heading', { name: /Save recovery snapshot/i }),
  ).toBeVisible();
  await window
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();

  // The legitimate Rule 4.3 prompt must still be offered (6 completed races is
  // inside its 6–7 window).
  await expect(
    window.getByRole('heading', { name: /Rule 4\.3/i }),
  ).toBeVisible();

  // And it must never be accompanied by the contradictory "no races" copy.
  await expect(
    window.getByText(/No qualifying races have been completed yet/i),
  ).toHaveCount(0);
});
