import {
  type NoPlaceCode,
  type PenaltyCode,
  type RaceLine,
  type RaceRef,
} from 'regatta-core';
import { db } from '../../../public/Database/DBManager';
import handle from './handle';
import { applyToEvent, previewOnEvent } from '../functions/libraryWrite';
import { correctionDecisions } from '../functions/libraryCorrection';
import { sanitizePositiveInteger } from '../functions/validation';
import { coreHeatId } from '../functions/eventLog';
import {
  normalizeScoreStatus,
  scoringPenaltyStatuses,
} from '../functions/scoreStatus';
import { logError } from '../errorLog';
import { explainError } from '../../shared/errors/explainError';
import {
  finalRows,
  overallRows,
  qualifyingRows,
} from '../functions/libraryStandings';
import { getLatestRaceForHeat, requireHeat } from '../functions/heatQueries';
import { lockDiscardProfileForRace } from '../functions/eventSettings';
import { assertQualifyingHeatIsOpen } from '../functions/seriesGuards';
import {
  boatsByEntryName,
  describeIndistinguishable,
  findIndistinguishableBoats,
  normalizeEntryKey,
} from '../../shared/boatKeys';

// Atomically score a whole race: create the next race for the heat, apply the
// SHRS 5.2 / RRS 44.3(c)/T1 penalty math, persist every boat's score in a
// single transaction, then recompute the relevant leaderboard. Previously this
// lived in the renderer as N sequential IPC calls, so a mid-loop failure could
// leave a half-scored race. Keeping it here makes scoring all-or-nothing and
// keeps the domain logic in the main process.
handle('submitHeatRaceScoresAtomic', async (_event, payload) => {
  const { event_id: payloadEventId, heat_id, placeNumbers } = payload;
  // HRH M4: event_id may arrive from the renderer but is NOT trusted — the
  // authoritative event is read from the heat row below. Trusting a stale/
  // wrong payload event_id would compute getMaxHeatSize for the wrong event
  // (mis-scoring SHRS 5.2 penalties) and recompute the wrong leaderboard.
  // isFinalSeries may still arrive from older callers but is ignored: the
  // series is derived from the heat row below, so a stale renderer flag can
  // never mis-score penalties or skip the final-leaderboard recompute.

  const heatRow = requireHeat(heat_id);
  // HRH M4: derive the event from the heat itself; ignore the payload value.
  const { event_id } = heatRow;
  if (payloadEventId != null && Number(payloadEventId) !== event_id) {
    logError(
      'submitHeatRaceScoresAtomic',
      `HRH M4: submitHeatRaceScoresAtomic payload event_id ${payloadEventId} does not match heat ${heat_id}'s event ${event_id}; using the heat's event.`,
    );
  }
  assertQualifyingHeatIsOpen(heatRow, 'score a race');

  const boats = db
    .prepare(
      `SELECT b.boat_id, b.sail_number, b.country
         FROM Heat_Boat hb
         JOIN Boats b ON hb.boat_id = b.boat_id
         WHERE hb.heat_id = ?`,
    )
    .all(heat_id) as Array<{
    boat_id: number;
    sail_number: string | number;
    country: string | null;
  }>;

  // Boats are named by sail number, or by national letters + number where
  // the number is not unique in the heat (ITA 12 and CRO 12, see
  // shared/boatKeys). Only boats no one could tell apart stop scoring.
  const indistinguishable = findIndistinguishableBoats(boats);
  if (indistinguishable.length > 0) {
    throw new Error(
      `Cannot score ${heatRow.heat_name}: ${describeIndistinguishable(indistinguishable)}.`,
    );
  }

  const boatsByName = boatsByEntryName(boats);
  const boatFor = (boatNumber: unknown) =>
    boatsByName.get(normalizeEntryKey(boatNumber));

  // The same boat named twice would score her twice; refuse rather than
  // keep whichever came last.
  const named = new Set<number>();
  placeNumbers.forEach(({ boatNumber }) => {
    const boat = boatFor(boatNumber);
    if (!boat) return;
    if (named.has(boat.boat_id)) {
      throw new Error(
        `Cannot score ${heatRow.heat_name}: sail ${String(boatNumber)} is in the result twice.`,
      );
    }
    named.add(boat.boat_id);
  });

  const unmatched = placeNumbers
    .map((entry) => entry.boatNumber)
    .filter((boatNumber) => !boatFor(boatNumber));

  // Surface a structured result so the renderer can show a targeted message
  // instead of throwing. Nothing has been written at this point.
  if (unmatched.length > 0) {
    return { ok: false as const, reason: 'UNMATCHED_SAILS', unmatched };
  }

  // The race office's sheet: finishers (and ZFP / SCP / T1, which keep
  // their place) by place, boats on one place tied (RRS A7); codes after;
  // a boat of the heat not on the sheet is DNS, as the screen shows her.
  const keepsPlace = (status: string) =>
    status === 'FINISHED' || scoringPenaltyStatuses.has(status);
  const entries = placeNumbers.map((entry) => {
    const status = normalizeScoreStatus(entry.status);
    return {
      boat: String(boatFor(entry.boatNumber)!.boat_id),
      // BK-6: a place that keeps its slot must be a whole number from 1;
      // a code's place is not used.
      place: keepsPlace(status)
        ? sanitizePositiveInteger(
            entry.place,
            `The place of sail ${String(entry.boatNumber)}`,
          )
        : 0,
      status,
    };
  });
  const finishers = entries
    .filter((entry) => keepsPlace(entry.status))
    .sort((a, b) => a.place - b.place);
  const lines: RaceLine[] = [
    ...finishers.map((entry, i) => ({
      boat: entry.boat,
      ...(entry.status !== 'FINISHED'
        ? { penalty: entry.status as PenaltyCode }
        : {}),
      ...(i > 0 && finishers[i - 1].place === entry.place
        ? { tied: true }
        : {}),
    })),
    ...entries
      .filter((entry) => !keepsPlace(entry.status))
      .map((entry) => ({
        boat: entry.boat,
        code: entry.status as NoPlaceCode,
      })),
    ...boats
      .filter((boat) => !named.has(boat.boat_id))
      .map((boat) => ({ boat: String(boat.boat_id), code: 'DNS' as const })),
  ];

  // regatta-core scores the heat's next race (raceScored).
  const ref = coreHeatId(heatRow.heat_name);
  let nextRaceNumber = 0;
  applyToEvent(event_id, {
    decide: (state) => {
      const heat = [...state.rounds.flat(), ...(state.fleets ?? [])].find(
        (h) => h.id === ref,
      );
      nextRaceNumber = (heat?.races.length ?? 0) + 1;
      return [
        {
          type: 'raceScored',
          race: { heat: ref, race: nextRaceNumber },
          lines,
        },
      ];
    },
  });
  const raceId = Number(
    (
      db
        .prepare(
          'SELECT race_id FROM Races WHERE heat_id = ? AND race_number = ?',
        )
        .get(heat_id, nextRaceNumber) as { race_id: number }
    ).race_id,
  );
  lockDiscardProfileForRace(raceId);

  return { ok: true as const, raceNumber: nextRaceNumber, raceId };
});

handle('undoLastScoredRaceForHeat', async (event, raw_heat_id) => {
  const heat_id = Number(raw_heat_id);
  const heatRow = requireHeat(heat_id);
  const lastRace = getLatestRaceForHeat(heat_id);

  if (!lastRace) {
    throw new Error(
      `No scored races found for heat "${heatRow.heat_name}". There is nothing to undo.`,
    );
  }

  assertQualifyingHeatIsOpen(heatRow, 'undo the last race');

  // The race leaves the log with what was decided about it (corrections,
  // protest decisions); an RDG2 that averaged it keeps its other races.
  const removedScores = (
    db
      .prepare('SELECT COUNT(*) AS n FROM Scores WHERE race_id = ?')
      .get(lastRace.race_id) as { n: number }
  ).n;
  const ref = {
    heat: coreHeatId(heatRow.heat_name),
    race: Number(lastRace.race_number),
  };
  const same = (other: RaceRef) =>
    other.heat === ref.heat && other.race === ref.race;
  applyToEvent(heatRow.event_id, {
    rewrite: (log) =>
      log
        .filter(
          (decision) =>
            !(
              (decision.type === 'raceScored' ||
                decision.type === 'raceCorrected' ||
                decision.type === 'protestDecided') &&
              same(decision.race)
            ),
        )
        .map((decision) =>
          decision.type === 'protestDecided' && decision.outcome.kind === 'RDG2'
            ? {
                ...decision,
                outcome: {
                  ...decision.outcome,
                  races: decision.outcome.races.filter((r) => !same(r)),
                },
              }
            : decision,
        ),
  });

  return {
    success: true,
    heatName: heatRow.heat_name,
    raceNumber: lastRace.race_number,
    removedScores,
  };
});

handle(
  'saveLeaderboardRaceResultsAtomic',
  async (
    _event,
    raw_event_id: number | string,
    operations,
    // The final standings are worked out on every read now.
    _updateFinalLeaderboard = false,
  ) => {
    const event_id = Number(raw_event_id);
    const safeOperations = Array.isArray(operations) ? operations : [];
    // The leaderboard edit screen sends each touched race whole, as shown
    // (see applyRaceColumnState); nothing else is accepted.
    if (safeOperations.some((operation) => !Array.isArray(operation?.cells))) {
      throw new Error(
        'This change did not include the whole race it belongs to, so it was not saved. Reload the leaderboard and make the change again.',
      );
    }

    // Each saved race becomes the race office's corrected sheet and the
    // committee's decisions that changed; regatta-core works the event out
    // again and the tables follow, all in one transaction.
    applyToEvent(event_id, {
      decide: (state) =>
        safeOperations.flatMap((operation) =>
          correctionDecisions(
            event_id,
            state,
            Number(operation.raceId),
            operation.cells,
          ),
        ),
    });
    safeOperations.forEach((operation) =>
      lockDiscardProfileForRace(Number(operation.raceId)),
    );
    return { success: true, updatedCount: safeOperations.length };
  },
);

/**
 * The leaderboard edit preview: the races as the edit screen shows them,
 * saved exactly as Save saves them, read back, and rolled back. The screen
 * shows these rows, so what is shown before Save is what Save stores. A
 * change the rules refuse comes back as `{ ok: false, reason }` (the words
 * Save would refuse with), not as an error.
 */
handle('previewLeaderboardEdit', async (_event, raw_event_id, operations) => {
  const event_id = Number(raw_event_id);
  const safeOperations = (Array.isArray(operations) ? operations : []).filter(
    (operation) => Array.isArray(operation?.cells),
  );
  try {
    return previewOnEvent(
      event_id,
      {
        decide: (state) =>
          safeOperations.flatMap((operation) =>
            correctionDecisions(
              event_id,
              state,
              Number(operation.raceId),
              operation.cells,
            ),
          ),
      },
      () => ({
        ok: true as const,
        eventResults: qualifyingRows(event_id),
        finalResults: finalRows(event_id),
        overallResults: overallRows(event_id),
      }),
    );
  } catch (error) {
    // The rules' refusal is the answer; anything else is a failure (handle()
    // logs and words it).
    const explained = explainError(error);
    if (explained.kind !== 'refusal') throw error;
    return { ok: false as const, reason: explained.message };
  }
});
