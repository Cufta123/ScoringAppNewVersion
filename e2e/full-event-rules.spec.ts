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
  createHeats,
  dismissToasts,
  uniqueName,
} from './helpers';

/**
 * Big end-to-end rule-correlation test.
 *
 * Goal: prove the advanced event-creation settings actually drive program
 * behaviour, and that the SHRS milestones hold across a full qualifying series.
 *
 * It creates an event with non-default advanced settings, registers 8 boats
 * across 2 qualifying heats, then runs 7 redistribution rounds (scoring both
 * heats each round). After 7 completed qualifying races it verifies:
 *
 *  - the chosen assignment mode + overflow policy persisted (event row labels);
 *  - the custom discard profile (3,6,9) drives the leaderboard — exactly 2
 *    scores are discarded at 7 races, where standard SHRS 5.4 would discard 1;
 *  - SHRS Rule 4.3 is offered (its 6–7 completed-race window) when starting the
 *    Final Series;
 *  - the Final Series creates one fleet per qualifying heat group (Gold +
 *    Silver, and no Bronze) per SHRS 4.1.
 */

// This is a long single flow that drives the real app; give it room.
test.setTimeout(240_000);

let app: ElectronApplication;
let window: Page;

const EVENT_NAME = uniqueName('Big SHRS Regatta');
const HEAT_GROUPS = 2;
const BOATS = 8;
const ROUNDS = 7;

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
  // Back on the heat list, the heat card for this round is visible again.
  await expect(
    window.locator('.heat-column', { hasText: label }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
});

test.afterAll(async () => {
  await app?.close();
});

test('advanced settings drive scoring and a 7-race series reaches the final series', async () => {
  // ── Create an event with non-default advanced settings ────────────────────
  await window.getByLabel('Event Name').fill(EVENT_NAME);
  await window.getByLabel('Location').fill('Rules Bay');
  await window.getByLabel('Start Date').fill('2026-06-01');
  await window.getByLabel('End Date').fill('2026-06-10');
  await window.getByLabel(/Advanced SHRS options/i).check();
  await window
    .getByLabel('Qualifying Assignment Mode')
    .selectOption('pre-assigned');
  await window
    .getByLabel('Heat Overflow Policy')
    .selectOption('confirm-allow-oversize');
  await window.getByLabel('Qualifying Discards').selectOption('custom');
  await window.getByPlaceholder('e.g. 4,8,16,24').fill('3,6,9');
  await window.getByRole('button', { name: /Create Event/i }).click();
  await expect(window.getByText(EVENT_NAME)).toBeVisible();

  // The settings must persist and be reflected on the event row.
  const eventRow = window.locator('.event-row', { hasText: EVENT_NAME });
  await expect(eventRow).toContainText('Pre-Assignments');
  await expect(eventRow).toContainText('Oversize with confirm');

  // ── Register 8 boats spanning 2 heats ─────────────────────────────────────
  await openEvent(window, EVENT_NAME);
  const countries = ['CRO', 'ITA', 'GER', 'FRA', 'ESP', 'GBR', 'USA', 'AUS'];
  for (let i = 0; i < BOATS; i += 1) {
    await dismissToasts(window);
    // eslint-disable-next-line no-await-in-loop
    await addSailor(window, {
      name: `Sailor${i}`,
      surname: `Crew${i}`,
      sail: String(201 + i),
      country: countries[i],
    });
  }

  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await createHeats(window, HEAT_GROUPS);

  // ── Run 7 rounds: redistribute from the leaderboard, then score both heats ─
  for (let round = 1; round <= ROUNDS; round += 1) {
    if (round > 1) {
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
    // eslint-disable-next-line no-await-in-loop
    await scoreHeat(`Heat A${round}`);
    // eslint-disable-next-line no-await-in-loop
    await scoreHeat(`Heat B${round}`);
  }

  // ── Verify the custom discard profile drives the leaderboard ──────────────
  await dismissToasts(window);
  await window.locator('.breadcrumbs-link', { hasText: EVENT_NAME }).click();
  await window.getByRole('button', { name: 'Open leaderboard' }).click();

  // Exactly 7 qualifying races were completed (Q1..Q7, no Q8).
  await expect(window.getByText('Q7')).toBeVisible();
  await expect(window.getByText('Q8')).toHaveCount(0);

  // Custom thresholds 3,6,9 ⇒ 2 discards at 7 races (standard 5.4 would be 1).
  // Discarded scores render in parentheses, e.g. "(4)".
  const rows = window.locator('.leaderboard tbody tr');
  await expect(rows).toHaveCount(BOATS);
  const excludedRe = /^\(\d+(\.\d+)?\)$/;
  await expect(rows.first().getByText(excludedRe)).toHaveCount(2);
  await expect(rows.last().getByText(excludedRe)).toHaveCount(2);

  // ── Back to scoring and start the Final Series ────────────────────────────
  await window.locator('.breadcrumbs-link', { hasText: EVENT_NAME }).click();
  await window.getByRole('button', { name: /Go to Scoring/i }).click();

  await dismissToasts(window);
  await window.getByRole('button', { name: /Start Final Series/i }).click();

  // Snapshot offer first — skip it.
  await expect(
    window.getByRole('heading', { name: /Save recovery snapshot/i }),
  ).toBeVisible();
  await window
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();

  // SHRS Rule 4.3 must be offered: 7 completed races is inside its 6–7 window.
  await expect(
    window.getByRole('heading', { name: /Rule 4\.3/i }),
  ).toBeVisible();
  await window.getByRole('button', { name: /Apply Rule 4\.3/i }).click();

  // Confirmation announces one fleet per qualifying heat group (2 here).
  const confirmDialog = window.getByRole('dialog');
  await expect(confirmDialog.getByText(/final fleet/i)).toBeVisible();
  await window
    .getByRole('button', { name: /Yes, Start Final Series/i })
    .click();

  // ── The Final Series is created with Gold + Silver only (SHRS 4.1) ────────
  await expect(
    window.getByText('Final Series started successfully!'),
  ).toBeVisible();
  await expect(
    window.locator('.heat-column', { hasText: 'Gold' }),
  ).toBeVisible();
  await expect(
    window.locator('.heat-column', { hasText: 'Silver' }),
  ).toBeVisible();
  // Two qualifying heat groups ⇒ exactly two final fleets, no Bronze.
  await expect(
    window.locator('.heat-column', { hasText: 'Bronze' }),
  ).toHaveCount(0);
});
