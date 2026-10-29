import fs from 'fs';
import os from 'os';
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

/**
 * A private, empty database file for one app launch.
 *
 * The app creates the file and its schema on first use, so it is enough to hand
 * it a path inside a fresh temp directory. Each launch therefore starts from
 * zero events and zero boats: tests no longer inherit the sail numbers, clubs
 * and finished races left behind by earlier runs, and no run can write into the
 * developer database. The directory is left for the OS to reap so a failed run's
 * data is still there to inspect.
 */
function freshDatabasePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iom-e2e-'));
  return path.join(dir, 'scoring_app.db');
}

/**
 * Launch the real Electron app in production mode and return the first window.
 *
 * Unsaved scoring entries and unsaved leaderboard edits both arm a native
 * `beforeunload` prompt. Playwright leaves such a dialog open, which blocks
 * `app.close()` and fails the run in worker teardown rather than in a test, so
 * every launched window auto-accepts native dialogs. In-app confirmations are a
 * separate, ordinary DOM modal — see `confirmModal` below — and are never
 * auto-dismissed, so tests still assert on them.
 */
export async function launchApp(): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SCORING_APP_DB_PATH: freshDatabasePath(),
      // Locally, keep the window invisible so a test run works in the
      // background without stealing focus; E2E_SHOW_WINDOW=1 shows it, to
      // watch a test. CI runs on a virtual display nobody sees, and window
      // transparency is not available there, so it uses a normal window.
      SCORING_APP_HIDDEN:
        process.env.CI || process.env.E2E_SHOW_WINDOW === '1' ? '' : '1',
    },
  });
  const window = await app.firstWindow();
  window.on('dialog', (dialog) => {
    dialog.accept().catch(() => {});
  });
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

/**
 * Shut the app down without letting teardown swallow the run.
 *
 * `app.close()` can block indefinitely when the renderer still has something to
 * say — an unsaved finish order arming `beforeunload`, or a modal left open by
 * a failing test. Playwright then reports "worker teardown timeout" and marks
 * every remaining test in the file as never run, which hides the real failure
 * behind an unrelated one. Give the graceful close a bounded window, then take
 * the process down.
 */
export async function closeApp(app: ElectronApplication): Promise<void> {
  const pid = app.process()?.pid;
  const closed = app
    .close()
    .then(() => true)
    .catch(() => false);
  const gaveUp = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), 15_000).unref?.();
  });
  if (await Promise.race([closed, gaveUp])) return;
  if (pid) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone — nothing to clean up.
    }
  }
}

/** Unique-per-run name so repeated runs never collide on the name-keyed route. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Best-effort dismissal of any visible toasts.
 *
 * The app's ToastContainer is bottom-left with `pauseOnFocusLoss` /
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

/**
 * The app's confirmation dialog (<AppModal /> via `confirmAction`). It is a
 * regular DOM modal, not a native one, so it must be answered by clicking a
 * button — nothing dismisses it implicitly, and while it is open it covers the
 * page and swallows every other click.
 */
export function confirmModal(window: Page, title?: string | RegExp) {
  return title === undefined
    ? window.getByRole('dialog')
    : window.getByRole('dialog', { name: title });
}

/**
 * Answer a confirmation dialog if one is open, and report whether it was.
 *
 * Best-effort by design: helpers call this on paths where the guard *may*
 * appear (it depends on whether there is unsaved work), so an absent dialog is
 * a normal outcome rather than a failure. Use `confirmModal` directly when a
 * test means to assert that a particular dialog appeared.
 *
 * Waits for THIS dialog to close, identified by its own title, rather than for
 * the page to have no dialog at all: answering one confirmation often opens the
 * next (declining the recovery backup goes straight on to the Rule 4.3
 * question), and a wait for "no dialogs" never comes true on those paths.
 */
export async function answerConfirm(
  window: Page,
  button: string | RegExp,
  { title }: { title?: string | RegExp } = {},
): Promise<boolean> {
  const dialog = confirmModal(window, title).first();
  if (!(await dialog.count())) return false;
  // The dialog labels itself with its title; use that to wait it out.
  const label = await dialog.getAttribute('aria-label');
  await dialog.getByRole('button', { name: button }).click({ timeout: 5000 });
  await expect(
    label ? window.getByRole('dialog', { name: label }) : dialog,
  ).toHaveCount(0);
  return true;
}

/**
 * Leave the scoring view via "Back to Heats", discarding an unsubmitted finish
 * order if the app asks.
 *
 * Entering a finish order and then leaving without submitting is guarded by
 * HeatRacePage's `confirmDiscardEntry`. Tests that reset to a clean scoring
 * screen genuinely do want the entry thrown away, so they answer "Discard";
 * without answering, the modal stays up and every later step times out.
 * No-ops when the scoring view is not open.
 */
export async function leaveScoring(window: Page): Promise<void> {
  await dismissToasts(window);
  const back = window.getByRole('button', { name: /Back to Heats/i });
  if (!(await back.count())) return;
  await back.first().click();
  await answerConfirm(window, /^Discard$/, { title: /Discard finish order/i });
  // Wait until the scoring view has fully torn down before the caller
  // re-selects a heat, so `Heat A1` resolves to the heat card rather than the
  // scoring panel title.
  await expect(
    window.getByRole('button', { name: /Submit Scores/i }),
  ).toHaveCount(0);
}

/** Navigate back to the landing page via the navbar brand button. */
export async function gotoHome(window: Page): Promise<void> {
  await dismissToasts(window);
  await window.getByRole('button', { name: 'Go to home page' }).click();
  // The brand button is guarded the same way "Back to Heats" is.
  await answerConfirm(window, /^Discard$/, { title: /Discard finish order/i });
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
  // The club Autosuggest dropdown can overlay the submit button, so it must be
  // dismissed before clicking. Blur the field rather than pressing Escape:
  // react-autosuggest reverts the input value to empty on Escape, which left
  // the required Club field blank and silently blocked form submission.
  await window.getByLabel('Club').blur();
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
