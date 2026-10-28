/**
 * In the real app, a refused action shows the app's own reason — not
 * Electron's "Error invoking remote method …" wrapping — and every failure is
 * written to logs/errors.log next to the data file (Help > Open Error Log).
 */
import fs from 'fs';
import path from 'path';
import { test, expect } from '@playwright/test';
import {
  launchApp,
  closeApp,
  createEvent,
  openEvent,
  uniqueName,
} from './helpers';

test('a refusal says why, in plain words, and is in the error log', async () => {
  const { app, window } = await launchApp();
  try {
    const name = uniqueName('Errors');
    await createEvent(window, name);
    await openEvent(window, name);

    // No boats entered yet: the main process refuses to create heats.
    await window.getByRole('button', { name: 'Create Heats' }).click();
    const toast = window.locator('.Toastify__toast').filter({
      hasText: /No boats are registered for this event yet/,
    });
    await expect(toast).toBeVisible();
    await expect(toast).not.toContainText('Error invoking');
    await expect(toast).not.toContainText('remote method');

    const dbPath = await app.evaluate(
      () => process.env.SCORING_APP_DB_PATH as string,
    );
    const logFile = path.join(path.dirname(dbPath), 'logs', 'errors.log');
    await expect
      .poll(() =>
        fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '',
      )
      .toContain('No boats are registered for this event yet');
    expect(fs.readFileSync(logFile, 'utf8')).toContain(
      'IPC "createInitialHeatsAtomic"',
    );
  } finally {
    await closeApp(app);
  }
});
