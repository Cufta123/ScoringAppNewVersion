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

// All scoring tests share one event + heat. They run serially; each test resets
// to a fresh scoring screen via `enterFreshScoring` (remounting the scoring
// component clears its internal state).
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let window: Page;

async function enterFreshScoring(): Promise<void> {
  // Clear lingering toasts first — bottom-right toasts can overlay the heat
  // cards / Start Scoring button and intercept the clicks below.
  await dismissToasts(window);

  const back = window.getByRole('button', { name: /Back to Heats/i });
  if (await back.count()) {
    await back.first().click();
    // Wait until the scoring view has fully torn down before re-selecting, so
    // `Heat A1` resolves to the heat card (not the scoring panel title).
    await expect(
      window.getByRole('button', { name: /Submit Scores/i }),
    ).toHaveCount(0);
  }

  await window
    .getByText(/Heat A1/i)
    .first()
    .click();
  await window
    .getByRole('button', { name: 'Start Scoring', exact: true })
    .click();
  await expect(
    window.getByRole('button', { name: /Submit Scores/i }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  ({ app, window } = await launchApp());

  const eventName = uniqueName('Scoring E2E');
  await createEvent(window, eventName);
  await openEvent(window, eventName);

  await addSailor(window, { name: 'Alice', surname: 'Skipper', sail: '101' });
  await addSailor(window, { name: 'Bob', surname: 'Helm', sail: '102' });
  await addSailor(window, { name: 'Cara', surname: 'Crew', sail: '103' });

  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await createHeats(window, 1);
});

test.afterAll(async () => {
  await app?.close();
});

test('submit is guarded until every boat is scored, with live progress', async () => {
  await enterFreshScoring();

  await expect(window.getByText(/0 of 3 boats scored/i)).toBeVisible();

  // Submitting early is blocked with a helpful message. The button is only
  // aria-disabled (still clickable), so force the click to exercise the guard.
  await window
    .getByRole('button', { name: /Submit Scores/i })
    .click({ force: true });
  await expect(window.getByText(/not scored yet|Still missing/i)).toBeVisible();

  // Click boat rows to add them; the progress indicator tracks the count.
  await window.getByRole('row', { name: /101/ }).click();
  await expect(window.getByText(/1 of 3 boats scored/i)).toBeVisible();
  await window.getByRole('row', { name: /102/ }).click();
  await window.getByRole('row', { name: /103/ }).click();
  await expect(
    window.getByText(/All 3 boats scored — ready to submit/i),
  ).toBeVisible();
});

test('selecting a non-finish penalty auto-adds the boat to the finish order', async () => {
  await enterFreshScoring();

  await window.getByLabel('Penalty for sail 101').selectOption('DNS');

  await expect(
    window.locator('.finish-list li', { hasText: 'Sail #101' }),
  ).toBeVisible();
  await expect(window.getByText(/1 of 3 boats scored/i)).toBeVisible();

  // The boat's row reflects the DNS code in the place column.
  await expect(window.getByRole('row', { name: /101/ })).toContainText('DNS');
});

test('a position-keeping penalty (ZFP) keeps the finishing place', async () => {
  await enterFreshScoring();

  await window.getByRole('row', { name: /101/ }).click();
  await window.getByRole('row', { name: /102/ }).click();
  await window.getByLabel('Penalty for sail 101').selectOption('ZFP');

  const item = window.locator('.finish-list li', { hasText: 'Sail #101' });
  await expect(item.locator('.finish-place')).toContainText('ZFP');
  // ZFP retains the boat's finishing place (1.) alongside the code.
  await expect(item.locator('.finish-place')).toContainText('1');
});

test('finish order can be reordered with the up/down controls', async () => {
  await enterFreshScoring();

  await window.getByRole('row', { name: /101/ }).click();
  await window.getByRole('row', { name: /102/ }).click();
  await window.getByRole('row', { name: /103/ }).click();

  await expect(window.locator('.finish-list li').first()).toContainText(
    'Sail #101',
  );

  await window.getByRole('button', { name: 'Move sail 101 down' }).click();
  await expect(window.locator('.finish-list li').first()).toContainText(
    'Sail #102',
  );
});

test('a boat can be removed from the finish order', async () => {
  await enterFreshScoring();

  await window.getByRole('row', { name: /101/ }).click();
  await window.getByRole('row', { name: /102/ }).click();
  await window.getByRole('row', { name: /103/ }).click();
  await expect(window.getByText(/All 3 boats scored/i)).toBeVisible();

  await window
    .getByRole('button', { name: 'Remove sail 102 from finish order' })
    .click();

  await expect(window.getByText('Sail #102')).toHaveCount(0);
  await expect(window.getByText(/2 of 3 boats scored/i)).toBeVisible();
});

test('manual sail-number entry rejects numbers not in the heat', async () => {
  await enterFreshScoring();

  await window.getByLabel('Add sail numbers manually').fill('999');
  await window.getByLabel('Add sail number to finish order').click();

  await expect(
    window.getByText(/Unknown sail numbers|not in Heat/i),
  ).toBeVisible();
  // Nothing was added to the finish order.
  await expect(window.getByText('Sail #999')).toHaveCount(0);
});

test('submitting a complete race records it and locks roster edits', async () => {
  await enterFreshScoring();

  await window.getByRole('row', { name: /101/ }).click();
  await window.getByRole('row', { name: /102/ }).click();
  await window.getByRole('row', { name: /103/ }).click();
  await window.getByRole('button', { name: /Submit Scores/i }).click();

  // Back on the heat list, the heat now shows a completed Race 1.
  await expect(window.getByText(/Heat A1 \(Race 1\)/i)).toBeVisible();

  // SHRS rule: once a race is scored, no more sailors/boats may be added.
  await window.getByRole('button', { name: /Back to Event/i }).click();
  await expect(
    window.getByText(/No more sailors or boats can be added/i),
  ).toBeVisible();
});
