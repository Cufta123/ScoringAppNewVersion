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
 * Additional scoring-input edge cases that complement scoring.spec.ts:
 *  - partial scoring is blocked and names the still-missing boats;
 *  - a penalty can be added, swapped, and cleared (clearing turns the boat back
 *    into a finisher rather than dropping it);
 *  - a non-position-keeping penalty (DNS) sinks below the finishers;
 *  - reordering renumbers every place, and moving a boat down then up restores
 *    the original order (the "wrong place, fix it up/down" flow).
 *
 * They share one event + heat and run serially; each test starts from a fresh
 * scoring screen (remounting the scoring component clears its internal state).
 */
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let window: Page;

async function enterFreshScoring(): Promise<void> {
  await dismissToasts(window);

  const back = window.getByRole('button', { name: /Back to Heats/i });
  if (await back.count()) {
    await back.first().click();
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

  const eventName = uniqueName('Scoring Edge E2E');
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

test('partial scoring is blocked and names the boats still missing', async () => {
  await enterFreshScoring();

  // Score only one of the three boats.
  await window.getByRole('row', { name: /101/ }).click();
  await expect(window.getByText(/1 of 3 boats scored/i)).toBeVisible();

  // Submitting now is blocked; the message must name the unscored boats.
  await window
    .getByRole('button', { name: /Submit Scores/i })
    .click({ force: true });
  const stillMissing = window.getByText(/Still missing/i);
  await expect(stillMissing).toBeVisible();
  await expect(stillMissing).toContainText('102');
  await expect(stillMissing).toContainText('103');
});

test('a penalty can be added, swapped, then cleared back to a finisher', async () => {
  await enterFreshScoring();

  const item = window.locator('.finish-list li', { hasText: 'Sail #101' });

  // Add DNS — the boat joins the finish order showing the DNS code.
  await window.getByLabel('Penalty for sail 101').selectOption('DNS');
  await expect(item.locator('.finish-place')).toContainText('DNS');
  await expect(window.getByText(/1 of 3 boats scored/i)).toBeVisible();

  // Swap the penalty to RET — the code updates in place.
  await window.getByLabel('Penalty for sail 101').selectOption('RET');
  await expect(item.locator('.finish-place')).toContainText('RET');

  // Clear the penalty (None). The boat stays in the order, now as a ranked
  // finisher (place 1.) rather than being removed.
  await window.getByLabel('Penalty for sail 101').selectOption('');
  await expect(item.locator('.finish-place')).toContainText('1.');
  await expect(item.locator('.finish-place')).not.toContainText('RET');
  await expect(window.getByText(/1 of 3 boats scored/i)).toBeVisible();
});

test('a non-position-keeping penalty (DNS) sinks below the finishers', async () => {
  await enterFreshScoring();

  // Two finishers first, then DNS the third boat.
  await window.getByRole('row', { name: /101/ }).click();
  await window.getByRole('row', { name: /102/ }).click();
  await window.getByLabel('Penalty for sail 103').selectOption('DNS');

  const items = window.locator('.finish-list li');
  await expect(items).toHaveCount(3);

  // Finishers keep places 1 and 2; the DNS boat is ranked last.
  await expect(items.nth(0)).toContainText('Sail #101');
  await expect(items.nth(0).locator('.finish-place')).toContainText('1.');
  await expect(items.nth(1)).toContainText('Sail #102');
  const last = items.nth(2);
  await expect(last).toContainText('Sail #103');
  await expect(last.locator('.finish-place')).toContainText('DNS');
});

test('reordering renumbers places and moving down then up restores order', async () => {
  await enterFreshScoring();

  await window.getByRole('row', { name: /101/ }).click();
  await window.getByRole('row', { name: /102/ }).click();
  await window.getByRole('row', { name: /103/ }).click();

  const item101 = window.locator('.finish-list li', { hasText: 'Sail #101' });
  const item102 = window.locator('.finish-list li', { hasText: 'Sail #102' });

  // Initial: 101 is first (place 1).
  await expect(item101.locator('.finish-place')).toContainText('1.');

  // Move 101 down: 102 becomes place 1, 101 becomes place 2 (places renumber).
  await window.getByRole('button', { name: 'Move sail 101 down' }).click();
  await expect(window.locator('.finish-list li').first()).toContainText(
    'Sail #102',
  );
  await expect(item102.locator('.finish-place')).toContainText('1.');
  await expect(item101.locator('.finish-place')).toContainText('2.');

  // Move 101 back up: original order and place 1 are restored.
  await window.getByRole('button', { name: 'Move sail 101 up' }).click();
  await expect(window.locator('.finish-list li').first()).toContainText(
    'Sail #101',
  );
  await expect(item101.locator('.finish-place')).toContainText('1.');
});
