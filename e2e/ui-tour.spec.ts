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
 */
test.skip(process.env.UI_TOUR !== '1', 'Visual tour runs only with UI_TOUR=1');
test.setTimeout(300_000);

const OUT =
  process.env.UI_TOUR_DIR || path.join(__dirname, '..', 'e2e-ui-tour');
const WIDTH = Number(process.env.UI_TOUR_WIDTH || 1366);
const HEIGHT = Number(process.env.UI_TOUR_HEIGHT || 768);

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
  await redistribute(eventId);
  // Round 4 half-sailed: one heat of three.
  await scoreRound(eventId, 4, 1);

  // Reload so the landing page lists the seeded event.
  await window.reload();
  await window.getByText(EVENT).first().waitFor();
  await snap('landing-with-event');

  await window.getByText(EVENT).first().click();
  await window.getByRole('heading', { name: EVENT }).waitFor();
  await snap('event-page');
  await snap('event-page-full', true);

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

  await window.getByRole('button', { name: 'Edit Results' }).click();
  await snap('leaderboard-edit');
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
  if (await window.getByRole('dialog').count()) {
    await window
      .getByRole('dialog')
      .getByRole('button', { name: /Switch places/ })
      .click()
      .catch(() => {});
  }
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
  await window.keyboard.press('Escape');
  await window.getByRole('button', { name: /Help/i }).first().click();
  await snap('help');
  await window.keyboard.press('Escape');

  // Finish round 4, start the final series, score one final race per fleet.
  await window.evaluate(async (id) => {
    const api = (window as any).electron.sqlite;
    const heats = await api.heatRaceDB.readAllHeats(id);
    const pending = heats.filter((h: any) => /4$/.test(h.heat_name));
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
  }, eventId);
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
  await window.getByRole('button', { name: 'Edit Results' }).click();
  await snap('final-leaderboard-edit');
});
