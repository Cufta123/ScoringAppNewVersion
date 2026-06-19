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
 * Full coverage of the editable leaderboard.
 *
 * Setup: a single-fleet event (1 heat, 4 boats), scored for 3 races with a
 * fixed finish order (101 < 102 < 103 < 104 every race). With < 4 races there
 * are no discards, so the qualifying totals are simply the summed places:
 *   101 → 3, 102 → 6, 103 → 9, 104 → 12.
 *
 * The tests then exercise the edit workflow end to end:
 *  - read-mode baseline ranks/scores;
 *  - entering edit mode reveals the per-race inputs/selects;
 *  - a penalty edit updates the live preview and is reverted by Cancel/Discard;
 *  - a numeric edit + a penalty edit persist through Save and recompute;
 *  - leaving the page with unsaved edits is guarded.
 *
 * Shared event, serial execution. Only the "Save" test persists changes.
 */
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let window: Page;

const EVENT_NAME = uniqueName('Leaderboard Edit E2E');

// Score a heat with the boats clicked in ascending sail order (101..104), so
// each boat's place equals its rank in every race. Returns to the heat list.
async function scoreHeatInOrder(): Promise<void> {
  await dismissToasts(window);
  await window.locator('.heat-column', { hasText: 'Heat A1' }).first().click();
  await window
    .getByRole('button', { name: 'Start Scoring', exact: true })
    .click();
  await expect(
    window.getByRole('button', { name: /Submit Scores/i }),
  ).toBeVisible();

  // The left table lists boats in roster order (101..104); click top to bottom.
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

// Return to the event page from wherever we are (scoring page, leaderboard
// page, or the landing page), then open the leaderboard from there.
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

// The Overall (net) column is the 7th cell in each data row:
// Rank | Name | Country | Sail # | Type | Gross | Overall | R1 | R2 | R3
function overallCell(rowName: RegExp) {
  return window.getByRole('row', { name: rowName }).getByRole('cell').nth(6);
}

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
  // Unsaved edits arm a native `beforeunload` prompt; auto-accept it so app
  // teardown never blocks on a dialog Playwright would otherwise have to handle.
  window.on('dialog', (dialog) => dialog.accept().catch(() => {}));

  await createEvent(window, EVENT_NAME);
  await openEvent(window, EVENT_NAME);

  await addSailor(window, { name: 'Alice', surname: 'Skipper', sail: '101' });
  await addSailor(window, { name: 'Bob', surname: 'Helm', sail: '102' });
  await addSailor(window, { name: 'Cara', surname: 'Crew', sail: '103' });
  await addSailor(window, { name: 'Dan', surname: 'Bow', sail: '104' });

  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await createHeats(window, 1);

  // Three identical-order races ⇒ deterministic, discard-free totals.
  await scoreHeatInOrder();
  await scoreHeatInOrder();
  await scoreHeatInOrder();
});

test.afterAll(async () => {
  await app?.close();
});

test('read-mode leaderboard shows the expected ranks and net totals', async () => {
  await openLeaderboard();

  // Alice is first with three 1st places (net 3); Dan last with three 4ths (12).
  const aliceRow = window.getByRole('row', { name: /Alice/ });
  await expect(aliceRow.getByLabel('Race cell: 1')).toHaveCount(3);
  await expect(overallCell(/Alice/)).toHaveText('3');
  await expect(overallCell(/Dan/)).toHaveText('12');
});

test('entering edit mode reveals per-race inputs and the save controls', async () => {
  await openLeaderboard();

  // No inputs in read mode.
  await expect(window.getByLabel('Race 1 value')).toHaveCount(0);

  await window.getByRole('button', { name: 'Edit Results' }).click();

  // Edit chrome appears: numeric inputs, status selects, Save + cancel controls.
  await expect(window.getByLabel('Race 1 value').first()).toBeVisible();
  await expect(window.getByLabel('Race 1 status').first()).toBeVisible();
  await expect(
    window.getByRole('button', { name: 'Save Changes' }),
  ).toBeVisible();
  await expect(
    window.getByRole('button', { name: 'Cancel Editing' }),
  ).toBeVisible();

  // Leave cleanly (no changes ⇒ no discard prompt).
  await window.getByRole('button', { name: 'Cancel Editing' }).click();
  await expect(
    window.getByRole('button', { name: 'Edit Results' }),
  ).toBeVisible();
});

test('a penalty edit updates the live total and Cancel discards it', async () => {
  await openLeaderboard();
  await window.getByRole('button', { name: 'Edit Results' }).click();

  // Apply DNS to Cara's first race. Heat has 4 boats ⇒ DNS scores 4+1 = 5, so
  // Cara's live net rises from 9 to 5+3+3 = 11.
  const caraRow = window.getByRole('row', { name: /Cara/ });
  await caraRow.getByLabel('Race 1 status').selectOption('DNS');

  // The race input is disabled for a non-position-keeping penalty.
  await expect(caraRow.getByLabel('Race 1 value')).toBeDisabled();
  // Live preview total reflects the edit immediately (before saving).
  await expect(overallCell(/Cara/)).toHaveText('11');

  // Cancel editing ⇒ discard confirmation ⇒ the edit is thrown away.
  await window.getByRole('button', { name: 'Cancel Editing' }).click();
  await expect(
    window.getByRole('heading', { name: /Discard changes/i }),
  ).toBeVisible();
  await window
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm' })
    .click();

  // Back in read mode, Cara is unchanged: no DNS, net still 9.
  await expect(
    window.getByRole('button', { name: 'Edit Results' }),
  ).toBeVisible();
  await expect(
    window.getByRole('row', { name: /Cara/ }).getByText('DNS'),
  ).toHaveCount(0);
  await expect(overallCell(/Cara/)).toHaveText('9');
});

test('numeric and penalty edits persist through Save and recompute', async () => {
  await openLeaderboard();
  await window.getByRole('button', { name: 'Edit Results' }).click();

  // Numeric edit: type 9 into Bob's Race 3. "Shift other boats" is OFF (the
  // default), so this is a pure manual override: only Bob changes. The input is
  // capped at the heat size, so 9 clamps to last place (4) and Bob's net updates
  // to 2 + 2 + 4 = 8. Cara and Dan are left untouched (Dan keeps his 4, so the
  // race now has two boats on 4 — a deliberate tie that the user can fix later).
  const bobR3 = window
    .getByRole('row', { name: /Bob/ })
    .getByLabel('Race 3 value');
  await bobR3.fill('9');
  await expect(bobR3).toHaveValue('4');
  await expect(overallCell(/Bob/)).toHaveText('8');

  // Penalty edit: Cara's Race 1 → DNS. The input disables for a hard penalty.
  // With shifting off only Cara changes, so her net is 5 + 3 + 3 = 11 (her other
  // races are not pulled up).
  await window
    .getByRole('row', { name: /Cara/ })
    .getByLabel('Race 1 status')
    .selectOption('DNS');
  await expect(
    window.getByRole('row', { name: /Cara/ }).getByLabel('Race 1 value'),
  ).toBeDisabled();
  await expect(overallCell(/Cara/)).toHaveText('11');

  // Save and wait for the recompute + return to read mode.
  await window.getByRole('button', { name: 'Save Changes' }).click();
  await expect(
    window.getByRole('button', { name: 'Edit Results' }),
  ).toBeVisible();

  // Both edits survived the DB recompute, with no cascade onto other boats:
  //  - Bob's Race 3 is now last place (4); his net is 2 + 2 + 4 = 8.
  //  - Cara's Race 1 is DNS (scores 4+1 = 5); her other races are unchanged so
  //    her net settles at 11.
  await expect(
    window.getByRole('row', { name: /Bob/ }).getByLabel('Race cell: 4'),
  ).toHaveCount(1);
  await expect(overallCell(/Bob/)).toHaveText('8');
  await expect(
    window.getByRole('row', { name: /Cara/ }).getByLabel('Race cell: DNS'),
  ).toHaveCount(1);
  await expect(overallCell(/Cara/)).toHaveText('11');
});

test('leaving the page with unsaved edits is guarded', async () => {
  await openLeaderboard();
  await window.getByRole('button', { name: 'Edit Results' }).click();

  // Make an unsaved change.
  await window
    .getByRole('row', { name: /Bob/ })
    .getByLabel('Race 3 value')
    .fill('7');

  // Attempt to navigate home ⇒ unsaved-changes guard appears.
  await window.getByRole('button', { name: 'Go to home page' }).click();
  await expect(
    window.getByRole('heading', { name: /Unsaved changes/i }),
  ).toBeVisible();

  // Cancel the navigation ⇒ stay on the leaderboard, still editing.
  await window
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(
    window.getByRole('button', { name: 'Save Changes' }),
  ).toBeVisible();

  // Discard the pending edit so the app can close without a beforeunload prompt.
  await window.getByRole('button', { name: 'Cancel Editing' }).click();
  await window
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirm' })
    .click();
  await expect(
    window.getByRole('button', { name: 'Edit Results' }),
  ).toBeVisible();
});
