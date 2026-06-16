import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  launchApp,
  gotoHome,
  createEvent,
  openEvent,
  uniqueName,
} from './helpers';

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let window: Page;
let eventName: string;

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
  eventName = uniqueName('Nav E2E');
  await createEvent(window, eventName);
});

test.afterAll(async () => {
  await app?.close();
});

test.beforeEach(async () => {
  await gotoHome(window);
});

test('breadcrumb "Home" returns to the landing page', async () => {
  await openEvent(window, eventName);
  await window.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(window.getByText(/Create a New Event/i)).toBeVisible();
});

test('navbar brand returns to the landing page from an event', async () => {
  await openEvent(window, eventName);
  await window.getByRole('button', { name: 'Go to home page' }).click();
  await expect(window.getByText(/Create a New Event/i)).toBeVisible();
});

test('reloading an event page resolves the event from the URL (refresh-safe)', async () => {
  await openEvent(window, eventName);

  // Drop the in-memory router state by reloading the renderer; the page must
  // recover the event from the name-keyed hash route rather than bouncing home.
  await window.reload();
  await window.waitForLoadState('domcontentloaded');

  await expect(window.getByRole('heading', { name: eventName })).toBeVisible();
});

test('deep navigation: event → heat race → back via breadcrumb', async () => {
  await openEvent(window, eventName);
  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await expect(window.getByRole('heading', { name: eventName })).toBeVisible();

  // The event-name breadcrumb is a link on the heat-race page; it returns to
  // the event page.
  await window.locator('.breadcrumbs-link', { hasText: eventName }).click();
  await expect(window.getByRole('heading', { name: eventName })).toBeVisible();
  await expect(
    window.getByRole('heading', { name: 'Add Sailors' }),
  ).toBeVisible();
});

test('reloading the heat-race page recovers the event (refresh-safe)', async () => {
  await openEvent(window, eventName);
  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await expect(window.getByRole('heading', { name: eventName })).toBeVisible();

  await window.reload();
  await window.waitForLoadState('domcontentloaded');

  await expect(window.getByRole('heading', { name: eventName })).toBeVisible();
});
