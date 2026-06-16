import {
  test,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { launchApp, createEvent, uniqueName } from './helpers';

// These tests share one app instance and mutate the event list, so they must
// run in order.
test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let window: Page;

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
});

test.afterAll(async () => {
  await app?.close();
});

test.beforeEach(async () => {
  // Reload to the landing page: the EventForm holds state (e.g. the advanced
  // toggle) and is never unmounted by same-route navigation, so a reload is the
  // reliable way to start each test from a clean form. It also clears toasts.
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await expect(window.getByText(/Create a New Event/i)).toBeVisible();
});

test('duplicate event name is rejected (case-insensitive)', async () => {
  const name = uniqueName('Dup Regatta');
  await createEvent(window, name);

  // Re-create with a different case — the name-keyed route must stay unique.
  await window.getByLabel('Event Name').fill(name.toUpperCase());
  await window.getByLabel('Location').fill('Somewhere');
  await window.getByLabel('Start Date').fill('2026-07-01');
  await window.getByLabel('End Date').fill('2026-07-02');
  await window.getByRole('button', { name: /Create Event/i }).click();

  await expect(window.getByText(/already exists/i)).toBeVisible();
  // Only the original event exists — the uppercase variant was not added.
  await expect(
    window.getByText(name.toUpperCase(), { exact: true }),
  ).toHaveCount(0);
});

test('end-date input is constrained to the start date (no end-before-start)', async () => {
  await window.getByLabel('Start Date').fill('2026-08-10');
  // The End Date field guards against earlier dates via a `min` attribute that
  // tracks the chosen start date.
  await expect(window.getByLabel('End Date')).toHaveAttribute(
    'min',
    '2026-08-10',
  );
});

test('advanced custom discard thresholds reject non-increasing input', async () => {
  await window.getByLabel(/Advanced SHRS options/i).check();
  await window.getByLabel('Qualifying Discards').selectOption('custom');

  const thresholdInput = window.getByPlaceholder('e.g. 4,8,16,24');
  // The validation message renders in the dedicated `.form-error` element
  // (the live summary note echoes it too, so scope the assertion).
  const formError = window.locator('.form-error');

  await thresholdInput.fill('8,4');
  await expect(formError).toContainText(/strictly increasing order/i);

  // Non-positive / non-integer values are rejected too.
  await thresholdInput.fill('0,5');
  await expect(formError).toContainText(/positive whole numbers/i);

  // A valid increasing list clears the error and shows the live summary.
  await thresholdInput.fill('3,6,12');
  await expect(formError).toHaveCount(0);
  await expect(window.getByText(/Custom list active/i)).toBeVisible();
});

test('advanced options are hidden until the toggle is enabled', async () => {
  await expect(window.getByLabel('Qualifying Discards')).toHaveCount(0);
  await window.getByLabel(/Advanced SHRS options/i).check();
  await expect(window.getByLabel('Qualifying Discards')).toBeVisible();
  await window.getByLabel(/Advanced SHRS options/i).uncheck();
  await expect(window.getByLabel('Qualifying Discards')).toHaveCount(0);
});

test('renaming an event onto another existing name is rejected', async () => {
  const first = uniqueName('Rename A');
  const second = uniqueName('Rename B');
  await createEvent(window, first);
  await createEvent(window, second);

  // Open the inline editor for the second event and rename it to the first.
  const secondRow = window.locator('.event-row', { hasText: second }).first();
  await secondRow.getByRole('button', { name: 'Edit event' }).click();

  // Scope to the inline edit form — the create form also has an "Event Name"
  // field and sits after it in the DOM.
  const editForm = window.locator('.inline-edit-form');
  await editForm.getByLabel('Event Name').fill(first);
  await editForm.getByRole('button', { name: /^Save$/ }).click();

  await expect(
    window.getByText(/Another event already uses this name/i),
  ).toBeVisible();
});

test('deleting an event: Escape cancels, confirm removes it', async () => {
  const name = uniqueName('Delete Me');
  await createEvent(window, name);

  const row = window.locator('.event-row', { hasText: name }).first();

  // Open the confirm dialog, then dismiss it with Escape — event must survive.
  await row.getByRole('button', { name: 'Delete event' }).click();
  const dialog = window.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await window.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(window.getByText(name)).toBeVisible();

  // Now confirm the deletion for real.
  await row.getByRole('button', { name: 'Delete event' }).click();
  await window.getByRole('button', { name: /Delete permanently/i }).click();
  await expect(window.getByText(name, { exact: true })).toHaveCount(0);
});

test('delete confirm dialog dismisses on backdrop click', async () => {
  const name = uniqueName('Backdrop Keep');
  await createEvent(window, name);

  const row = window.locator('.event-row', { hasText: name }).first();
  await row.getByRole('button', { name: 'Delete event' }).click();

  const overlay = window.locator('.feedback-modal-overlay');
  await expect(overlay).toBeVisible();
  // Click the backdrop itself (top-left corner), not the dialog card.
  await overlay.click({ position: { x: 5, y: 5 } });
  await expect(overlay).toBeHidden();
  await expect(window.getByText(name)).toBeVisible();
});
