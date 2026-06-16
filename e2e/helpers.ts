import path from 'path';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

// Path to the built main bundle. Production mode makes resolveHtmlPath load the
// built renderer from disk (file://) instead of the dev server, so these tests
// require a production build at `release/app/dist` (run `npm run build` first,
// or use `npm run test:smoke`).
export const MAIN_ENTRY = path.join(
  __dirname,
  '..',
  'release',
  'app',
  'dist',
  'main',
  'main.js',
);

export interface LaunchedApp {
  app: ElectronApplication;
  window: Page;
}

/** Launch the real Electron app in production mode and return the first window. */
export async function launchApp(): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: { ...process.env, NODE_ENV: 'production' },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

/** Unique-per-run name so repeated runs never collide on the name-keyed route. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Best-effort dismissal of any visible toasts.
 *
 * The app's ToastContainer is bottom-right with `pauseOnFocusLoss` /
 * `pauseOnHover`; under automation the window often isn't OS-focused, so toasts
 * don't auto-close and accumulate over the interactive area, intercepting
 * clicks. Clearing them between steps keeps the UI deterministic. Never throws.
 */
export async function dismissToasts(window: Page): Promise<void> {
  const toasts = window.locator('.Toastify__toast');
  // Sequential by design: each dismissal shrinks the toast list, so the steps
  // must run in order rather than in parallel.
  /* eslint-disable no-await-in-loop */
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if ((await toasts.count()) === 0) return;
    const closeButtons = window.locator('.Toastify__close-button');
    const count = await closeButtons.count();
    if (count === 0) break;
    for (let i = 0; i < count; i += 1) {
      // Always target the first remaining close button; the list shrinks as
      // toasts exit.
      await closeButtons
        .first()
        .click({ force: true, timeout: 1000 })
        .catch(() => {});
    }
    await window.waitForTimeout(150);
  }
  /* eslint-enable no-await-in-loop */
  // Give any exit animations a moment; don't fail the test if one lingers.
  await toasts
    .first()
    .waitFor({ state: 'detached', timeout: 4000 })
    .catch(() => {});
}

/** Navigate back to the landing page via the navbar brand button. */
export async function gotoHome(window: Page): Promise<void> {
  await dismissToasts(window);
  await window.getByRole('button', { name: 'Go to home page' }).click();
  await expect(window.getByText(/Create a New Event/i)).toBeVisible();
}

export interface EventDates {
  location?: string;
  start?: string;
  end?: string;
}

/** Fill and submit the create-event form on the landing page. */
export async function createEvent(
  window: Page,
  name: string,
  {
    location = 'Test Marina',
    start = '2026-06-01',
    end = '2026-06-02',
  }: EventDates = {},
): Promise<void> {
  await window.getByLabel('Event Name').fill(name);
  await window.getByLabel('Location').fill(location);
  await window.getByLabel('Start Date').fill(start);
  await window.getByLabel('End Date').fill(end);
  await window.getByRole('button', { name: /Create Event/i }).click();
  // The new event appears in the "Your Events" list once refreshEvents resolves.
  await expect(window.getByText(name)).toBeVisible();
}

/** Open an event from the landing-page list and wait for its page heading. */
export async function openEvent(window: Page, name: string): Promise<void> {
  await window.getByText(name).click();
  await expect(window.getByRole('heading', { name })).toBeVisible();
}

export interface SailorInput {
  name: string;
  surname: string;
  sail: string;
  country?: string;
}

/** Add a sailor + boat on the event page (single-add form). */
export async function addSailor(
  window: Page,
  { name, surname, sail, country = 'CRO' }: SailorInput,
): Promise<void> {
  await window.getByLabel('First Name').fill(name);
  await window.getByLabel('Surname').fill(surname);
  await window.getByLabel('Subgroup').selectOption('L');
  await window.getByLabel('Sail Number').fill(sail);
  await window.getByLabel('Country').selectOption(country);
  await window.getByLabel('Boat Model').fill('ILCA');
  await window.getByLabel('Club').fill('Test YC');
  // The club Autosuggest dropdown overlays the submit button — dismiss it first.
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: 'Add Sailor' }).click();
  // Exact match: a unique event name can contain the sail digits as a substring.
  await expect(window.getByText(sail, { exact: true })).toBeVisible();
}

/** Create N qualifying heats on the event/heat page. */
export async function createHeats(window: Page, count: number): Promise<void> {
  await window.getByLabel('Number of heats').selectOption(String(count));
  await window.getByRole('button', { name: 'Create Heats' }).click();
  await expect(window.getByText(/Heat A1/i)).toBeVisible();
}
