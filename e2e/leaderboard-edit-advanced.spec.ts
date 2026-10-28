import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  launchApp,
  closeApp,
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
 *  - a new place moves the boat; the boat on that place makes room;
 *  - a position-keeping penalty (ZFP) keeps the finishing place but scores
 *    penalty points, so Total and Net diverge — and it persists on save;
 *  - a move past several boats shifts each of them one place.
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

// The Total (before exclusions) and Net (after) cells of a boat's row, found
// by column rather than position: the Type column only shows with mixed models.
function totalCell(rowName: RegExp) {
  return window
    .getByRole('row', { name: rowName })
    .locator('td[data-col="total"]');
}
function netCell(rowName: RegExp) {
  return window
    .getByRole('row', { name: rowName })
    .locator('td[data-col="net"]');
}

// Cancel out of edit mode, accepting the discard prompt if one is shown.
async function cancelEditing(): Promise<void> {
  await window.getByRole('button', { name: 'Cancel Editing' }).click();
  const dialogConfirm = window
    .getByRole('dialog')
    .getByRole('button', { name: 'Discard' });
  if (await dialogConfirm.count()) {
    await dialogConfirm.click();
  }
  await expect(
    window.getByRole('button', { name: 'Edit Results' }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  ({ app, window } = await launchApp());

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
  await closeApp(app);
});

test('the worst race is discarded (parenthesised) and excluded from the net', async () => {
  await openLeaderboard();

  // Four races ⇒ one discard. Alice (four 1st places) shows one excluded "(1)"
  // and a net of 3 — the discarded race does not count.
  const aliceRow = window.getByRole('row', { name: /Alice/ });
  await expect(aliceRow.getByLabel('Race cell: (1)')).toHaveCount(1);
  await expect(aliceRow.getByLabel('Race cell: 1')).toHaveCount(3);
  await expect(netCell(/Alice/)).toHaveText('3');
});

test('a new place moves the boat; the boat on that place makes room', async () => {
  await openLeaderboard();
  await window.getByRole('button', { name: 'Edit Results' }).click();

  // Bob to 1st in Race 1, where Alice sits: Alice moves to 2nd. Never two
  // boats on one place.
  await window
    .getByRole('row', { name: /Bob/ })
    .getByLabel('Race 1 value')
    .fill('1');

  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race 1 value'),
  ).toHaveValue('1');
  await expect(
    window.getByRole('row', { name: /Alice/ }).getByLabel('Race 1 value'),
  ).toHaveValue('2');

  // Bob 1,2,2,2 → one 2 discarded → 5. Alice 2,1,1,1 → the 2 discarded → 3.
  await expect(netCell(/Bob/)).toHaveText('5');
  await expect(netCell(/Alice/)).toHaveText('3');

  // Revert — leave the baseline untouched for the next test.
  await cancelEditing();
});

test('a move past several boats shifts each of them one place', async () => {
  await openLeaderboard();
  await window.getByRole('button', { name: 'Edit Results' }).click();

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

test('a ZFP keeps the place but scores penalty points (Total ≠ Net) and persists', async () => {
  await openLeaderboard();
  await window.getByRole('button', { name: 'Edit Results' }).click();

  // ZFP on Bob's Race 1: keeps finishing place 2, but scores 20% of the 4-boat
  // heat = +1 ⇒ 3 points. Bob normally scores 2,2,2,2; with the penalty it is
  // 3,2,2,2. Total sums every race = 9 (proving the penalty scored 3, not the
  // place 2 — a plain 2,2,2,2 would be 8). Net discards the worst (the 3),
  // leaving 2 + 2 + 2 = 6, so Total and Net diverge.
  await window
    .getByRole('row', { name: /Bob/ })
    .getByLabel('Race 1 status')
    .selectOption('ZFP');
  // A ZFP keeps its finishing place, and that place drives the penalty points,
  // so the value stays typeable (enabled) — unlike a hard penalty (DNS/DSQ) or a
  // computed RDG cell, which lock the input. The place itself is unchanged (2).
  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race 1 value'),
  ).toBeEnabled();
  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race 1 value'),
  ).toHaveValue('2');
  await expect(totalCell(/Bob/)).toHaveText('9');
  await expect(netCell(/Bob/)).toHaveText('6');

  // Save and confirm the same values persist through the backend recompute.
  await window.getByRole('button', { name: 'Save Changes' }).click();
  await expect(
    window.getByRole('button', { name: 'Edit Results' }),
  ).toBeVisible();

  // The ZFP race (3 pts) is Bob's worst, so it is the discarded one and renders
  // parenthesised — "(ZFP)" — while Total still counts it and Net does not.
  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race cell: (ZFP)'),
  ).toHaveCount(1);
  await expect(totalCell(/Bob/)).toHaveText('9');
  await expect(netCell(/Bob/)).toHaveText('6');
});

test('a boat’s total explains itself, race by race, with the rule behind each number', async () => {
  // After the ZFP test above Bob has 3 (ZFP), 2, 2, 2; the 3 is discarded.
  await openLeaderboard();
  await window
    .getByRole('button', { name: 'How 6 points was calculated for sail 102' })
    .click();

  const dialog = window.getByRole('dialog', {
    name: /score was calculated/,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('heading', { name: 'Qualifying series: 6 points' }),
  ).toBeVisible();
  // 4-boat heat: DNF score 5, 20% of it is 1.
  await expect(
    dialog.getByText(
      'Finished 2 plus a Z flag penalty: 20% of the DNF score (5) is 1, so 2 + 1 = 3.',
    ),
  ).toBeVisible();
  await expect(dialog.getByText('RRS 30.2, 44.3(c)')).toBeVisible();
  await expect(
    dialog.getByText(
      /4 races completed in this series, so 1 worst score is excluded/,
    ),
  ).toBeVisible();
  await expect(
    dialog.getByText('All races 9 − excluded 3 = 6 points.'),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('the event history lists what was done, newest first, and filters by boat', async () => {
  await window.getByRole('button', { name: 'Open event history' }).click();
  const dialog = window.getByRole('dialog', { name: 'Event history' });
  await expect(dialog).toBeVisible();

  // The ZFP edit above is the newest action; the races were scored before it.
  await expect(dialog.locator('.history-entry strong').first()).toHaveText(
    'Results edited on the leaderboard',
  );
  await expect(
    dialog.getByText('Race scored', { exact: true }).first(),
  ).toBeVisible();

  await dialog.getByLabel('Filter by sail, heat or result').fill('ZFP');
  await expect(
    dialog.getByText(
      /102, Heat \w+ race 1: 2 \(2 points\) → 2 ZFP \(3 points\)/,
    ),
  ).toBeVisible();

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('the ZFP edit can be undone from the history, and the leaderboard follows', async () => {
  await expect(totalCell(/Bob/)).toHaveText('9');
  await window.getByRole('button', { name: 'Open event history' }).click();
  const dialog = window.getByRole('dialog', { name: 'Event history' });
  await dialog
    .getByRole('button', { name: /^Undo: Results edited on the leaderboard/ })
    .click();
  await expect(dialog.getByRole('status')).toContainText(
    'Undone: Results edited on the leaderboard.',
  );
  await expect(
    dialog.getByText('Undid “Results edited on the leaderboard”'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Bob is back to 2, 2, 2, 2 without reopening the page.
  await expect(totalCell(/Bob/)).toHaveText('8');
  await expect(netCell(/Bob/)).toHaveText('6');
  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race cell: (ZFP)'),
  ).toHaveCount(0);
});
