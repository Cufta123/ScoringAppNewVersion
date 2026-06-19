import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  launchApp,
  createEvent,
  openEvent,
  addSailor,
  createHeats,
  dismissToasts,
  uniqueName,
} from './helpers';

/**
 * Advanced edit-leaderboard edge cases, building on leaderboard-edit.spec.ts.
 *
 * Setup: single fleet (1 heat, 4 boats), scored for FOUR races in a fixed order
 * (101 < 102 < 103 < 104 each race), so each boat finishes the same place every
 * race: Alice 1st, Bob 2nd, Cara 3rd, Dan 4th. Four races trigger one SHRS 5.4
 * discard, so one race drops and the nets are 3 / 6 / 9 / 12.
 *
 * Covers:
 *  - the discard is shown (parenthesised) and excluded from the net;
 *  - with "Shift other boats" off, editing a place to a duplicate leaves the
 *    other boat untouched (a manual tie, no automatic A7 averaging);
 *  - a position-keeping penalty (ZFP) keeps the finishing place but scores
 *    penalty points, so Gross and Overall diverge — and it persists on save;
 *  - the "Shift other boats" toggle cascades the surrounding places.
 *
 * Shared event, serial execution. Only the ZFP test (last) persists changes;
 * the others revert via Cancel so the baseline stays intact for their siblings.
 */
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let window: Page;

const EVENT_NAME = uniqueName('Leaderboard Edit Advanced E2E');
const RACES = 4;

async function scoreHeatInOrder(): Promise<void> {
  await dismissToasts(window);
  await window.locator('.heat-column', { hasText: 'Heat A1' }).first().click();
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
    window.locator('.heat-column', { hasText: 'Heat A1' }),
  ).toBeVisible();
}

async function openLeaderboard(): Promise<void> {
  await dismissToasts(window);
  const crumb = window.locator('.breadcrumbs-link', { hasText: EVENT_NAME });
  if (await crumb.count()) {
    await crumb.first().click();
  } else {
    await window.getByText(EVENT_NAME).first().click();
  }
  await expect(
    window.getByRole('button', { name: 'Open leaderboard' }),
  ).toBeVisible();
  await window.getByRole('button', { name: 'Open leaderboard' }).click();
  await expect(window.getByText(/Qualifying Series/i)).toBeVisible();
}

// Row cell layout: Rank | Name | Country | Sail# | Type | Gross | Overall | R…
function grossCell(rowName: RegExp) {
  return window.getByRole('row', { name: rowName }).getByRole('cell').nth(5);
}
function overallCell(rowName: RegExp) {
  return window.getByRole('row', { name: rowName }).getByRole('cell').nth(6);
}

// Cancel out of edit mode, accepting the discard prompt if one is shown.
async function cancelEditing(): Promise<void> {
  await window.getByRole('button', { name: 'Cancel Editing' }).click();
  const dialogConfirm = window
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm' });
  if (await dialogConfirm.count()) {
    await dialogConfirm.click();
  }
  await expect(
    window.getByRole('button', { name: 'Edit Results' }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
  window.on('dialog', (dialog) => dialog.accept().catch(() => {}));

  await createEvent(window, EVENT_NAME);
  await openEvent(window, EVENT_NAME);

  await addSailor(window, { name: 'Alice', surname: 'Skipper', sail: '101' });
  await addSailor(window, { name: 'Bob', surname: 'Helm', sail: '102' });
  await addSailor(window, { name: 'Cara', surname: 'Crew', sail: '103' });
  await addSailor(window, { name: 'Dan', surname: 'Bow', sail: '104' });

  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await createHeats(window, 1);

  for (let r = 0; r < RACES; r += 1) {
    // eslint-disable-next-line no-await-in-loop
    await scoreHeatInOrder();
  }
});

test.afterAll(async () => {
  await app?.close();
});

test('the worst race is discarded (parenthesised) and excluded from the net', async () => {
  await openLeaderboard();

  // Four races ⇒ one discard. Alice (four 1st places) shows one excluded "(1)"
  // and a net of 3 — the discarded race does not count.
  const aliceRow = window.getByRole('row', { name: /Alice/ });
  await expect(aliceRow.getByLabel('Race cell: (1)')).toHaveCount(1);
  await expect(aliceRow.getByLabel('Race cell: 1')).toHaveCount(3);
  await expect(overallCell(/Alice/)).toHaveText('3');
});

test('editing a place to a duplicate leaves the other boat untouched', async () => {
  await openLeaderboard();
  await window.getByRole('button', { name: 'Edit Results' }).click();

  // "Shift other boats" is off (the default). Move Bob into Race 1 first place
  // (where Alice already sits). Only Bob changes — Alice is left exactly as she
  // is, so this is a manual tie at place 1 with no automatic A7 averaging.
  await window
    .getByRole('row', { name: /Bob/ })
    .getByLabel('Race 1 value')
    .fill('1');

  // Both boats now display place 1 for Race 1; Alice's value is unchanged.
  await expect(
    window.getByRole('row', { name: /Alice/ }).getByLabel('Race 1 value'),
  ).toHaveValue('1');
  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race 1 value'),
  ).toHaveValue('1');

  // Bob normally scores 2,2,2,2 (net 6). His Race 1 is now a face-value 1 (no
  // averaging), giving 1,2,2,2 → one 2 is discarded → net 1 + 2 + 2 = 5.
  await expect(overallCell(/Bob/)).toHaveText('5');
  // Alice is untouched: still four 1st places, net 3.
  await expect(overallCell(/Alice/)).toHaveText('3');

  // Revert — leave the baseline untouched for the next test.
  await cancelEditing();
});

test('the Shift other boats toggle cascades the surrounding places', async () => {
  await openLeaderboard();
  await window.getByRole('button', { name: 'Edit Results' }).click();

  // The real checkbox is visually hidden behind the styled `.toggle-track`
  // span (inside the label), which intercepts pointer events — so a plain
  // check() can't reach it. Force the check; the label still toggles the box.
  await window.getByLabel('Shift other boats').check({ force: true });

  // Move Dan to 1st in Race 2; the boats it passes each shift down one place.
  await window
    .getByRole('row', { name: /Dan/ })
    .getByLabel('Race 2 value')
    .fill('1');

  await expect(
    window.getByRole('row', { name: /Dan/ }).getByLabel('Race 2 value'),
  ).toHaveValue('1');
  await expect(
    window.getByRole('row', { name: /Alice/ }).getByLabel('Race 2 value'),
  ).toHaveValue('2');
  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race 2 value'),
  ).toHaveValue('3');
  await expect(
    window.getByRole('row', { name: /Cara/ }).getByLabel('Race 2 value'),
  ).toHaveValue('4');

  await cancelEditing();
});

test('a ZFP keeps the place but scores penalty points (Gross ≠ Overall) and persists', async () => {
  await openLeaderboard();
  await window.getByRole('button', { name: 'Edit Results' }).click();

  // ZFP on Bob's Race 1: keeps finishing place 2, but scores 20% of the 4-boat
  // heat = +1 ⇒ 3 points. Bob normally scores 2,2,2,2; with the penalty it is
  // 3,2,2,2. Gross sums every race = 9 (proving the penalty scored 3, not the
  // place 2 — a plain 2,2,2,2 would be 8). Overall discards the worst (the 3),
  // leaving 2 + 2 + 2 = 6, so Gross and Overall diverge.
  await window
    .getByRole('row', { name: /Bob/ })
    .getByLabel('Race 1 status')
    .selectOption('ZFP');
  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race 1 value'),
  ).toBeDisabled();
  await expect(grossCell(/Bob/)).toHaveText('9');
  await expect(overallCell(/Bob/)).toHaveText('6');

  // Save and confirm the same values persist through the backend recompute.
  await window.getByRole('button', { name: 'Save Changes' }).click();
  await expect(
    window.getByRole('button', { name: 'Edit Results' }),
  ).toBeVisible();

  // The ZFP race (3 pts) is Bob's worst, so it is the discarded one and renders
  // parenthesised — "(ZFP)" — while Gross still counts it and Overall does not.
  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race cell: (ZFP)'),
  ).toHaveCount(1);
  await expect(grossCell(/Bob/)).toHaveText('9');
  await expect(overallCell(/Bob/)).toHaveText('6');
});
