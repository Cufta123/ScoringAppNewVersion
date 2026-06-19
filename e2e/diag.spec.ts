import { test, expect } from '@playwright/test';
import {
  launchApp,
  createEvent,
  openEvent,
  addSailor,
  createHeats,
  dismissToasts,
  uniqueName,
} from './helpers';

test.setTimeout(180000);

test('full advanced-settings -> 7 rounds -> final series', async () => {
  const { app, window } = await launchApp();
  window.on('pageerror', (e) => console.log('### PAGEERROR', e.message));

  async function scoreHeat(label: string) {
    await dismissToasts(window);
    await window.locator('.heat-column', { hasText: label }).first().click();
    await window
      .getByRole('button', { name: 'Start Scoring', exact: true })
      .click();
    await expect(
      window.getByRole('button', { name: /Submit Scores/i }),
    ).toBeVisible();
    const sailCells = window.locator(
      '.scoring-table tbody tr .scoring-sail-cell',
    );
    const n = await sailCells.count();
    for (let i = 0; i < n; i++) await sailCells.nth(i).click();
    await window.getByRole('button', { name: /Submit Scores/i }).click();
    await expect(
      window.locator('.heat-column', { hasText: label }),
    ).toBeVisible();
  }

  // ── advanced event ──
  const name = uniqueName('Big SHRS');
  await window.getByLabel('Event Name').fill(name);
  await window.getByLabel('Location').fill('Rules Bay');
  await window.getByLabel('Start Date').fill('2026-06-01');
  await window.getByLabel('End Date').fill('2026-06-10');
  await window.getByLabel(/Advanced SHRS options/i).check();
  await window
    .getByLabel('Qualifying Assignment Mode')
    .selectOption('pre-assigned');
  await window
    .getByLabel('Heat Overflow Policy')
    .selectOption('confirm-allow-oversize');
  await window.getByLabel('Qualifying Discards').selectOption('custom');
  await window.getByPlaceholder('e.g. 4,8,16,24').fill('3,6,9');
  await window.getByRole('button', { name: /Create Event/i }).click();
  await expect(window.getByText(name)).toBeVisible();
  console.log(
    '### event created; labels:',
    await window.locator('.event-row', { hasText: name }).innerText(),
  );

  await openEvent(window, name);
  const countries = ['CRO', 'ITA', 'GER', 'FRA', 'ESP', 'GBR', 'USA', 'AUS'];
  for (let i = 0; i < 8; i++) {
    await dismissToasts(window);
    await addSailor(window, {
      name: `S${i}`,
      surname: `L${i}`,
      sail: String(201 + i),
      country: countries[i],
    });
  }
  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await createHeats(window, 2);

  for (let r = 1; r <= 7; r++) {
    console.log('### ROUND', r);
    if (r > 1) {
      await dismissToasts(window);
      await window
        .getByRole('button', { name: 'Create New Heats from Leaderboard' })
        .click();
      await window
        .getByRole('dialog')
        .getByRole('button', { name: 'Confirm' })
        .click();
      await expect(
        window.locator('.heat-column', { hasText: `Heat A${r}` }),
      ).toBeVisible();
    }
    await scoreHeat(`Heat A${r}`);
    await scoreHeat(`Heat B${r}`);
  }
  console.log('### 7 rounds done');

  // ── verify custom discard profile correlates on the leaderboard ──
  await dismissToasts(window);
  await window.locator('.breadcrumbs-link', { hasText: name }).click();
  await window.getByRole('button', { name: 'Open leaderboard' }).click();
  await expect(window.getByText('Q7')).toBeVisible();
  const firstRow = window.locator('.leaderboard tbody tr').first();
  const excluded = firstRow.getByText(/^\(\d+(\.\d+)?\)$/);
  console.log('### excluded cells in row 1:', await excluded.count());

  // back to scoring to start the final series
  await window.locator('.breadcrumbs-link', { hasText: name }).click();
  await window.getByRole('button', { name: /Go to Scoring/i }).click();

  // ── start final series: snapshot prompt -> 4.3 prompt -> confirm ──
  await dismissToasts(window);
  await window.getByRole('button', { name: /Start Final Series/i }).click();
  await expect(
    window.getByRole('heading', { name: /Save recovery snapshot/i }),
  ).toBeVisible();
  await window
    .getByRole('dialog')
    .getByRole('button', { name: 'Cancel' })
    .click();
  await expect(
    window.getByRole('heading', { name: /Rule 4\.3/i }),
  ).toBeVisible();
  await window.getByRole('button', { name: /Apply Rule 4\.3/i }).click();
  await expect(
    window.getByRole('dialog').getByText(/final fleet/i),
  ).toBeVisible();
  await window
    .getByRole('button', { name: /Yes, Start Final Series/i })
    .click();

  await expect(window.getByText(/Gold/i)).toBeVisible();
  await expect(window.getByText(/Silver/i)).toBeVisible();
  console.log('### FINAL SERIES STARTED OK');
  await app.close();
});
