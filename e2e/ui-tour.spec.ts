import fs from 'fs';
import path from 'path';
import { test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, closeApp, dismissToasts } from './helpers';

/**
 * Visual tour: seeds a realistic event through IPC and saves a screenshot of
 * every screen, to review the UI by eye. Not a test of behaviour: it only runs
 * when UI_TOUR=1 (npm run test:smoke skips it).
 *
 *   UI_TOUR=1 npx playwright test e2e/ui-tour.spec.ts
 *
 * Screenshots go to UI_TOUR_DIR (default e2e-ui-tour/).
 *
 * UI_TOUR_EXTRA_ROUNDS=N (default 0) scores N more qualifying rounds before the
 * half-sailed last one, i.e. a 4+N round qualifying series, so the leaderboard
 * has enough race columns to scroll sideways. Only then does the tour also
 * save the leaderboards scrolled to the right (view, edit, RDG2 popover), to
 * check that Rank / Name / Sail # stay put. Try UI_TOUR_EXTRA_ROUNDS=6 (a
 * 10-round qualifying series). With 0 the tour is unchanged.
 *
 * The tour also opens the export dialog of every document type (screenshots)
 * and saves real sample files next to the screenshots: results as PDF, Excel,
 * HTML, CSV, text and Markdown (English), the results PDF in Croatian, the
 * starting list PDF, the heats PDF and the scoring-sheets PDF. The app writes
 * them without a save dialog because the tour launches it with
 * SCORING_APP_EXPORT_DIR (honoured only together with SCORING_APP_HIDDEN=1,
 * which launchApp sets); the tour then renames each file to a fixed name.
 */
test.skip(process.env.UI_TOUR !== '1', 'Visual tour runs only with UI_TOUR=1');
test.setTimeout(300_000);

const OUT =
  process.env.UI_TOUR_DIR || path.join(__dirname, '..', 'e2e-ui-tour');
const WIDTH = Number(process.env.UI_TOUR_WIDTH || 1366);
const HEIGHT = Number(process.env.UI_TOUR_HEIGHT || 768);
const EXTRA_ROUNDS = Math.max(
  0,
  Math.floor(Number(process.env.UI_TOUR_EXTRA_ROUNDS || 0)) || 0,
);
/** The qualifying round that is left half sailed, then finished. */
const LAST_ROUND = 4 + EXTRA_ROUNDS;

/** Where the app drops exports (no save dialog) before the tour renames them. */
const EXPORT_TMP = path.join(OUT, '.export-tmp');

let app: ElectronApplication;
let window: Page;
let shot = 0;

async function snap(name: string, fullPage = false) {
  shot += 1;
  await window.waitForTimeout(250);
  await window.screenshot({
    path: path.join(OUT, `${String(shot).padStart(2, '0')}-${name}.png`),
    fullPage,
  });
}

const EVENT = 'Kup Kvarnera 2026';
const BOATS = 30;
const HEATS = 3;

async function seed() {
  return window.evaluate(
    async ({ name, boats, heats }) => {
      const api = (window as any).electron.sqlite;
      const first = [
        'Ivan',
        'Marko',
        'Ana',
        'Petra',
        'Luka',
        'Josip',
        'Nikola',
        'Tomislav',
        'Maja',
        'Karlo',
      ];
      const last = [
        'Horvat',
        'Kovačević',
        'Babić',
        'Marić',
        'Jurić',
        'Novak',
        'Knežević',
        'Vuković',
        'Perić',
        'Matić',
      ];
      const countries = [
        'CRO',
        'ITA',
        'GER',
        'SLO',
        'AUT',
        'GBR',
        'FRA',
        'HUN',
      ];
      const ev = await api.eventDB.insertEvent(
        name,
        'Rijeka',
        '2026-06-01',
        '2026-06-03',
        'progressive',
        'standard',
        'standard',
        'auto-increase',
      );
      const eventId = Number(ev.lastInsertRowid);
      const club = await api.sailorDB.insertClub('JK Galeb', 'CRO');
      for (let i = 0; i < boats; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const s = await api.sailorDB.insertSailor(
          first[i % 10],
          `${last[(i * 3) % 10]}${i > 9 ? ` ${i}` : ''}`,
          `1965-04-0${(i % 9) + 1}`,
          4,
          Number(club.lastInsertRowid),
        );
        // eslint-disable-next-line no-await-in-loop
        const b = await api.sailorDB.insertBoat(
          String(100 + i * 7),
          countries[i % 8],
          'IOM',
          Number(s.lastInsertRowid),
        );
        // eslint-disable-next-line no-await-in-loop
        await api.eventDB.associateBoatWithEvent(
          Number(b.lastInsertRowid),
          eventId,
        );
      }
      await api.heatRaceDB.createInitialHeatsAtomic(eventId, heats);
      return eventId;
    },
    { name: EVENT, boats: BOATS, heats: HEATS },
  );
}

/** Score every latest heat of the event once (a full round). */
async function scoreRound(eventId: number, round: number, onlyHeats?: number) {
  await window.evaluate(
    async ({ id, r, only }) => {
      const api = (window as any).electron.sqlite;
      const heats = await api.heatRaceDB.readAllHeats(id);
      const latest = heats.filter(
        (h: any) =>
          /\d+$/.test(h.heat_name) &&
          Number(h.heat_name.match(/(\d+)$/)[1]) ===
            Math.max(
              ...heats.map((x: any) =>
                Number((x.heat_name.match(/(\d+)$/) || [0, 0])[1]),
              ),
            ),
      );
      const list = only ? latest.slice(0, only) : latest;
      for (const heat of list) {
        // eslint-disable-next-line no-await-in-loop
        const boats = await api.heatRaceDB.readBoatsByHeat(heat.heat_id);
        const order = boats
          .map((b: any) => b.sail_number)
          .sort(
            (a: number, b: number) =>
              ((a * (r + 3)) % 17) - ((b * (r + 3)) % 17),
          );
        // eslint-disable-next-line no-await-in-loop
        await api.heatRaceDB.submitHeatRaceScoresAtomic({
          heat_id: heat.heat_id,
          placeNumbers: order.map((sail: number, i: number) => ({
            boatNumber: sail,
            place: i + 1,
            status: i === order.length - 1 && r === 2 ? 'DNF' : 'FINISHED',
          })),
        });
      }
    },
    { id: eventId, r: round, only: onlyHeats },
  );
}

async function redistribute(eventId: number) {
  await window.evaluate(
    (id) =>
      (
        window as any
      ).electron.sqlite.heatRaceDB.createNewHeatsBasedOnLeaderboard(id),
    eventId,
  );
}

/** Scroll every leaderboard table to its right end (0 = back to the left). */
async function scrollTables(toEnd: boolean) {
  await window.evaluate((end) => {
    document.querySelectorAll('.leaderboard-scroll').forEach((el) => {
      // eslint-disable-next-line no-param-reassign
      el.scrollLeft = end ? el.scrollWidth : 0;
    });
  }, toEnd);
}

/** RDG2 popover of the last race cell in the first row, shot, then closed. */
async function openRdg2PickerOfFirstRow(name: string) {
  const select = window
    .locator('.leaderboard-scroll')
    .first()
    .locator('tbody tr')
    .first()
    .locator('select.race-cell-status')
    .last();
  await select.selectOption('RDG2', { timeout: 3000 }).catch(() => {});
  if (await window.getByRole('dialog', { name: /RDG2/ }).count()) {
    await snap(name);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(200);
  }
}

/** The export dialog that is open now. */
const exportDialog = () => window.getByRole('dialog', { name: /^Export / });

/**
 * Press one of the dialog's "Save as ..." buttons and keep the file the app
 * wrote: it appears in EXPORT_TMP under its suggested name and is moved to
 * OUT/<name>, so a second export of the same kind never overwrites the first.
 */
async function saveExport(format: string, name: string) {
  fs.readdirSync(EXPORT_TMP).forEach((file) =>
    fs.rmSync(path.join(EXPORT_TMP, file), { force: true }),
  );
  await exportDialog()
    .getByRole('button', { name: `Save as ${format}` })
    .click();
  const deadline = Date.now() + 30_000;
  let written = '';
  while (Date.now() < deadline && !written) {
    // eslint-disable-next-line no-await-in-loop
    await window.waitForTimeout(250);
    written = fs.readdirSync(EXPORT_TMP)[0] ?? '';
  }
  if (!written) {
    const toasts = await window.locator('.Toastify__toast').allInnerTexts();
    throw new Error(
      `${format} export was not written. Messages on screen: ${toasts.join(' | ')}`,
    );
  }
  await window.waitForTimeout(300);
  fs.copyFileSync(path.join(EXPORT_TMP, written), path.join(OUT, name));
}

/**
 * Wait for the export dialog, and keep toasts out of its way: a toast closed
 * by a click that lands on the dimmed backdrop would close the dialog too.
 */
let toastStyle: Awaited<ReturnType<Page['addStyleTag']>> | null = null;
async function dialogOpened() {
  await exportDialog().waitFor();
  toastStyle = await window.addStyleTag({
    content: '.Toastify { visibility: hidden !important; }',
  });
  // The dialog remembers its options per event in localStorage, which outlives
  // a run: start every document from English.
  await exportDialog()
    .getByLabel('Language of the document')
    .selectOption('en');
}

/** Close the export dialog without exporting. */
async function closeExportDialog() {
  await exportDialog()
    .getByRole('button', { name: 'Close', exact: true })
    .click();
  await exportDialog().waitFor({ state: 'hidden' });
  await toastStyle?.evaluate((node) => (node as HTMLElement).remove());
  toastStyle = null;
  await dismissToasts(window);
}

/** Wait for the preview to be rebuilt after an option changed (debounced). */
const settlePreview = () => window.waitForTimeout(700);

/** Give the event a logo, as the dialog's "Choose logo" would store it. */
async function giveEventALogo(eventId: number) {
  await window.evaluate(async (id) => {
    const canvas = document.createElement('canvas');
    canvas.width = 420;
    canvas.height = 160;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#14407a';
    g.fillRect(8, 8, 404, 144);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(24, 110);
    g.bezierCurveTo(100, 40, 160, 150, 230, 80);
    g.bezierCurveTo(290, 30, 340, 120, 396, 60);
    g.lineWidth = 12;
    g.strokeStyle = '#ffffff';
    g.stroke();
    await (window as any).electron.sqlite.eventDB.saveEventExportLogo(
      id,
      canvas.toDataURL('image/png'),
    );
  }, eventId);
}

async function home() {
  await dismissToasts(window);
  await window.getByRole('button', { name: 'Go to home page' }).click();
  await window.getByText(/Create a New Event/i).waitFor();
}

async function openEventPage() {
  await home();
  await window.getByText(EVENT).first().click();
  await window.getByRole('heading', { name: EVENT }).waitFor();
}

test.beforeAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(EXPORT_TMP, { recursive: true, force: true });
  fs.mkdirSync(EXPORT_TMP, { recursive: true });
  process.env.SCORING_APP_EXPORT_DIR = EXPORT_TMP;
  ({ app, window } = await launchApp());
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setContentSize(size.w, size.h);
    },
    { w: WIDTH, h: HEIGHT },
  );
});

test.afterAll(async () => {
  await closeApp(app);
  fs.rmSync(EXPORT_TMP, { recursive: true, force: true });
});

test('tour', async () => {
  await snap('landing-empty');
  await window.getByLabel(/Advanced SHRS options/i).check();
  await snap('landing-advanced');
  await window.getByLabel(/Advanced SHRS options/i).uncheck();

  const eventId = await seed();
  await scoreRound(eventId, 1);
  await redistribute(eventId);
  await scoreRound(eventId, 2);
  await redistribute(eventId);
  await scoreRound(eventId, 3);
  // Extra full qualifying rounds (UI_TOUR_EXTRA_ROUNDS), rounds 4 .. 3+N.
  for (let extra = 0; extra < EXTRA_ROUNDS; extra += 1) {
    // eslint-disable-next-line no-await-in-loop
    await redistribute(eventId);
    // eslint-disable-next-line no-await-in-loop
    await scoreRound(eventId, 4 + extra);
  }
  await redistribute(eventId);
  // The last round half-sailed: one heat of three.
  await scoreRound(eventId, LAST_ROUND, 1);

  // Reload so the landing page lists the seeded event.
  await window.reload();
  await window.getByText(EVENT).first().waitFor();
  await snap('landing-with-event');

  await window.getByText(EVENT).first().click();
  await window.getByRole('heading', { name: EVENT }).waitFor();
  await snap('event-page');
  await snap('event-page-full', true);

  // Export dialogs of the starting list and the heats, with the event's logo.
  await giveEventALogo(eventId);
  await window
    .getByRole('button', { name: 'Export starting list…', exact: true })
    .click();
  await dialogOpened();
  await settlePreview();
  // Remembered options outlive a run: start from the plain list.
  await exportDialog()
    .getByLabel('Group by country, with entry counts')
    .uncheck();
  await settlePreview();
  await snap('export-starting-list-dialog');
  await saveExport('PDF', 'sample-starting-list.pdf');
  await exportDialog()
    .getByLabel('Group by country, with entry counts')
    .check();
  await settlePreview();
  await snap('export-starting-list-grouped');
  await saveExport('PDF', 'sample-starting-list-grouped.pdf');
  await closeExportDialog();

  await window
    .getByRole('button', { name: 'Export heats…', exact: true })
    .click();
  await dialogOpened();
  await settlePreview();
  await exportDialog()
    .getByLabel('Scoring sheets (blank Place/Notes columns)')
    .uncheck();
  await settlePreview();
  await snap('export-heats-dialog');
  await saveExport('PDF', 'sample-heats.pdf');
  await exportDialog()
    .getByLabel('Scoring sheets (blank Place/Notes columns)')
    .check();
  await settlePreview();
  await snap('export-heats-scoring-sheets-dialog');
  await saveExport('PDF', 'sample-heats-scoring-sheets.pdf');
  await closeExportDialog();

  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await window.waitForTimeout(800);
  await snap('heats');
  await snap('heats-full', true);

  // Open a heat that has not sailed round 4 yet and start scoring.
  const cards = window.locator('.heat-column');
  await cards.nth((await cards.count()) - 1).click();
  await snap('heat-selected');
  await window
    .getByRole('button', { name: 'Start Scoring', exact: true })
    .click();
  await window.getByRole('button', { name: /Submit Scores/i }).waitFor();
  await snap('scoring-empty');
  const sails = window.locator('.scoring-table tbody tr .scoring-sail-cell');
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sails.nth(i).click();
  }
  await snap('scoring-partial');
  await snap('scoring-partial-full', true);
  await window.getByRole('button', { name: /Submit Scores/i }).click();
  await window.waitForTimeout(400);
  await snap('scoring-submit-incomplete');
  await dismissToasts(window);
  // Close any dialog without changing data.
  const dlg = window.getByRole('dialog');
  if (await dlg.count()) {
    await dlg
      .getByRole('button')
      .last()
      .click()
      .catch(() => {});
  }
  await window
    .getByRole('button', { name: /Back to Heats/i })
    .click()
    .catch(() => {});
  const discard = window.getByRole('dialog');
  if (await discard.count()) await snap('discard-dialog');
  await window
    .getByRole('button', { name: /^Discard$/ })
    .click()
    .catch(() => {});

  await openEventPage();
  await window.getByRole('button', { name: 'Open leaderboard' }).click();
  await window
    .getByText(/Qualifying Series/i)
    .first()
    .waitFor();
  await snap('leaderboard');
  await snap('leaderboard-full', true);
  if (EXTRA_ROUNDS > 0) {
    await scrollTables(true);
    await snap('leaderboard-scrolled-right');
    await scrollTables(false);
  }

  await window.getByRole('button', { name: 'Export…', exact: true }).click();
  await dialogOpened();
  await settlePreview();
  await snap('export-results-dialog-qualifying');
  await closeExportDialog();

  await window.getByRole('button', { name: 'Edit Results' }).click();
  await snap('leaderboard-edit');
  if (EXTRA_ROUNDS > 0) {
    await scrollTables(true);
    await snap('leaderboard-edit-scrolled-right');
    await openRdg2PickerOfFirstRow('leaderboard-edit-rdg2-scrolled-right');
    await scrollTables(false);
  }
  const v = window.getByLabel('Race 1 value').first();
  await v.fill('15');
  await snap('leaderboard-edit-15');
  await window.getByRole('button', { name: /Save Changes/i }).click();
  await snap('leaderboard-edit-save-invalid');
  await dismissToasts(window);
  await v.fill('2');
  await window.getByLabel('Race 1 status').nth(3).selectOption('DSQ');
  await snap('leaderboard-edit-valid');
  await window.getByRole('button', { name: /Save Changes/i }).click();
  await window.waitForTimeout(400);
  await snap('leaderboard-save-dialog');
  await window.waitForTimeout(600);
  await snap('leaderboard-after-save');
  await dismissToasts(window);

  // Explain a total.
  await window.locator('.score-explain-btn').first().click();
  await snap('explain');
  await window.keyboard.press('Escape');
  await window.waitForTimeout(200);

  // History dialog from the navbar.
  await window
    .getByRole('button', { name: /History/i })
    .first()
    .click();
  await snap('history');
  await window
    .getByRole('button', { name: /^Go back to here/ })
    .nth(2)
    .click();
  await snap('history-go-back-question');
  await window.keyboard.press('Escape');
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: /Help/i }).first().click();
  await snap('help');
  await window.keyboard.press('Escape');

  // Finish round 4, start the final series, score one final race per fleet.
  await window.evaluate(
    async ({ id, last }) => {
      const api = (window as any).electron.sqlite;
      const heats = await api.heatRaceDB.readAllHeats(id);
      const pending = heats.filter(
        (h: any) => Number((h.heat_name.match(/(\d+)$/) || [0, 0])[1]) === last,
      );
      for (const heat of pending) {
        // eslint-disable-next-line no-await-in-loop
        const races = await api.heatRaceDB.readAllRaces(heat.heat_id);
        if (races.length === 0) {
          // eslint-disable-next-line no-await-in-loop
          const boats = await api.heatRaceDB.readBoatsByHeat(heat.heat_id);
          // eslint-disable-next-line no-await-in-loop
          await api.heatRaceDB.submitHeatRaceScoresAtomic({
            heat_id: heat.heat_id,
            placeNumbers: boats.map((b: any, i: number) => ({
              boatNumber: b.sail_number,
              place: i + 1,
              status: 'FINISHED',
            })),
          });
        }
      }
      await api.heatRaceDB.startFinalSeriesAtomic(id, true, null);
      const all = await api.heatRaceDB.readAllHeats(id);
      for (const heat of all.filter((h: any) => h.heat_type === 'Final')) {
        // eslint-disable-next-line no-await-in-loop
        const boats = await api.heatRaceDB.readBoatsByHeat(heat.heat_id);
        // eslint-disable-next-line no-await-in-loop
        await api.heatRaceDB.submitHeatRaceScoresAtomic({
          heat_id: heat.heat_id,
          placeNumbers: boats.map((b: any, i: number) => ({
            boatNumber: b.sail_number,
            place: i + 1,
            status: i === 2 ? 'ZFP' : 'FINISHED',
          })),
        });
      }
    },
    { id: eventId, last: LAST_ROUND },
  );
  await openEventPage();
  await snap('event-page-final');
  await window.getByRole('button', { name: /Go to Scoring/i }).click();
  await window.waitForTimeout(600);
  await snap('heats-final', true);
  await openEventPage();
  await window.getByRole('button', { name: 'Open leaderboard' }).click();
  await window.waitForTimeout(800);
  await snap('final-leaderboard');
  await snap('final-leaderboard-full', true);
  if (EXTRA_ROUNDS > 0) {
    await scrollTables(true);
    await snap('final-leaderboard-scrolled-right');
    await scrollTables(false);
  }
  await window.getByRole('button', { name: 'Export…', exact: true }).click();
  await dialogOpened();
  await exportDialog().getByLabel('Include signature lines').check();
  await settlePreview();
  await snap('export-results-dialog-final');
  await saveExport('PDF', 'sample-results-en.pdf');
  await saveExport('Excel', 'sample-results-en.xlsx');
  await saveExport('HTML', 'sample-results-en.html');
  await saveExport('CSV', 'sample-results-en.csv');
  await saveExport('Text', 'sample-results-en.txt');
  await saveExport('Markdown', 'sample-results-en.md');
  await exportDialog()
    .getByLabel('Language of the document')
    .selectOption('hr');
  await settlePreview();
  await snap('export-results-dialog-croatian');
  await saveExport('PDF', 'sample-results-hr.pdf');
  await closeExportDialog();

  await window.getByRole('button', { name: 'Edit Results' }).click();
  await snap('final-leaderboard-edit');
  if (EXTRA_ROUNDS > 0) {
    await scrollTables(true);
    await snap('final-leaderboard-edit-scrolled-right');
  }
});
