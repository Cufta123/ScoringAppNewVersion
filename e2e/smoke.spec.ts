import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { launchApp, closeApp } from './helpers';

let app: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
});

test.afterAll(async () => {
  await closeApp(app);
});

test('main window opens', async () => {
  expect(await app.windows()).toHaveLength(1);
  const title = await window.title();
  expect(title.length).toBeGreaterThan(0);
});

test('landing page renders the hero and create-event card', async () => {
  await expect(
    window.getByRole('heading', { name: /IOM Regatta Manager/i }),
  ).toBeVisible();
  await expect(window.getByText(/Create a New Event/i)).toBeVisible();
});

test('create-event form exposes its core inputs', async () => {
  // The form is keyed by label text; just assert the essential fields render so
  // a broken bundle / missing renderer is caught.
  await expect(window.getByLabel(/Event Name/i)).toBeVisible();
  await expect(window.getByLabel(/Location/i)).toBeVisible();
});
