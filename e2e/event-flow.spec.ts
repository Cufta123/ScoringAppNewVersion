import path from 'path';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const MAIN_ENTRY = path.join(
  __dirname,
  '..',
  'release',
  'app',
  'dist',
  'main',
  'main.js',
);

// Unique per run so repeated runs against the same dev DB never collide on the
// name-keyed event route.
const EVENT_NAME = `E2E Regatta ${Date.now()}`;

let app: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app?.close();
});

async function addSailor(opts: {
  name: string;
  surname: string;
  sail: string;
  country: string;
}) {
  await window.getByLabel('First Name').fill(opts.name);
  await window.getByLabel('Surname').fill(opts.surname);
  await window.getByLabel('Subgroup').selectOption('L');
  await window.getByLabel('Sail Number').fill(opts.sail);
  await window.getByLabel('Country').selectOption(opts.country);
  await window.getByLabel('Boat Model').fill('ILCA');
  await window.getByLabel('Club').fill('Test YC');
  // The club Autosuggest dropdown overlays the submit button — dismiss it first.
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: 'Add Sailor' }).click();
  // Exact match: the unique event name can contain the sail digits as a substring.
  await expect(window.getByText(opts.sail, { exact: true })).toBeVisible();
}

// Full happy path: create an event, register two boats, build a heat, score a
// race, and confirm the leaderboard reflects it.
test('create event, score a race, and see it on the leaderboard', async () => {
  // ── Create the event ──────────────────────────────────────────────────────
  await window.getByLabel('Event Name').fill(EVENT_NAME);
  await window.getByLabel('Location').fill('Test Marina');
  await window.getByLabel('Start Date').fill('2026-06-01');
  await window.getByLabel('End Date').fill('2026-06-02');
  await window.getByRole('button', { name: /Create Event/i }).click();

  // ── Open it ───────────────────────────────────────────────────────────────
  await window.getByText(EVENT_NAME).click();
  await expect(window.getByRole('heading', { name: EVENT_NAME })).toBeVisible();

  // ── Register two boats ────────────────────────────────────────────────────
  await addSailor({
    name: 'Alice',
    surname: 'Skipper',
    sail: '101',
    country: 'CRO',
  });
  await addSailor({
    name: 'Bob',
    surname: 'Helm',
    sail: '102',
    country: 'CRO',
  });

  // ── Build a single heat with both boats ───────────────────────────────────
  await window.getByLabel('Number of heats').selectOption('1');
  await window.getByRole('button', { name: 'Create Heats' }).click();
  await expect(window.getByText(/Heat A1/i)).toBeVisible();

  // ── Go to scoring and score the race ──────────────────────────────────────
  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await window
    .getByText(/Heat A1/i)
    .first()
    .click();
  await window
    .getByRole('button', { name: 'Start Scoring', exact: true })
    .click();

  // Click both boat rows to add them to the finish order, then submit.
  await window.getByRole('row', { name: /101/ }).click();
  await window.getByRole('row', { name: /102/ }).click();
  const submit = window.getByRole('button', { name: /Submit Scores/i });
  await expect(submit).toBeEnabled();
  await submit.click();

  // ── Navigate back to the event, then open the leaderboard ─────────────────
  await window.getByRole('button', { name: EVENT_NAME }).click();
  // The navbar button's accessible name comes from its aria-label.
  await window.getByRole('button', { name: 'Open leaderboard' }).click();

  // ── Confirm the leaderboard reflects the scored boats ─────────────────────
  await expect(window.getByText('Alice')).toBeVisible();
  await expect(window.getByText('Bob')).toBeVisible();
});
