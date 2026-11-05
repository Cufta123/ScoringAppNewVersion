import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import {
  launchApp,
  closeApp,
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
  await closeApp(app);
});

test.beforeEach(async () => {
  await gotoHome(window);
});

test('navbar brand returns to the landing page from an event', async () => {
  await openEvent(window, eventName);
  await window.getByRole('button', { name: 'Go to home page' }).click();
  await expect(
    window.getByRole('heading', { name: 'Events', level: 1 }),
  ).toBeVisible();
});

test('reloading an event page resolves the event from the URL (refresh-safe)', async () => {
  await openEvent(window, eventName);

  // Drop the in-memory router state by reloading the renderer; the page must
  // recover the event from the name-keyed hash route rather than bouncing home.
  await window.reload();
  await window.waitForLoadState('domcontentloaded');

  await expect(window.getByRole('heading', { name: eventName })).toBeVisible();
});

test('deep navigation: event → scoring → back via the Entries section', async () => {
  await openEvent(window, eventName);
  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await expect(window.getByRole('heading', { name: eventName })).toBeVisible();

  // The navbar's Entries section returns to the event page.
  await window
    .getByRole('navigation', { name: 'Event sections' })
    .getByRole('button', { name: 'Entries' })
    .click();
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
