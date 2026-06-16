import path from 'path';
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

// Path to the built main bundle. Production mode makes resolveHtmlPath load the
// built renderer from disk (file://) instead of the dev server.
const MAIN_ENTRY = path.join(
  __dirname,
  '..',
  'release',
  'app',
  'dist',
  'main',
  'main.js',
);

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

test('global leaderboard is reachable from the navbar', async () => {
  await window.getByRole('button', { name: /Global Leaderboard/i }).click();
  // We left the landing page…
  await expect(window.getByText(/Create a New Event/i)).toBeHidden();
  // …and the global-leaderboard view rendered one of its valid states
  // (loading, empty, or a populated table) regardless of DB contents.
  await expect(
    window.getByText(
      /Loading global leaderboard|No global results|Total Points/i,
    ),
  ).toBeVisible();
});
