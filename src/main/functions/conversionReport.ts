/**
 * The conversion record of an event (decisionStore.conversionRecord) in the
 * words of the screen: sail numbers, heat and race names. Null when the
 * conversion changed nothing and found nothing to tell.
 */
import type { ConversionReport } from '../../shared/conversionReport';
import { conversionRecord } from './decisionStore';
import { boatLabel, raceLabel } from './labels';

const heatName = (heat: string) =>
  /\d/.test(heat) ? `Heat ${heat}` : `${heat} fleet`;

export default function conversionReport(
  eventId: number,
): ConversionReport | null {
  const record = conversionRecord(eventId);
  if (!record) return null;
  const changes = record.changes ?? { refused: null, heats: [], points: [] };
  const report: ConversionReport = {
    convertedAt: record.convertedAt,
    seen: record.seenAt != null,
    points: changes.points.map((point) => {
      const race = raceLabel(point.raceId);
      return {
        race:
          race === 'this race'
            ? `${heatName(point.heat)}, race ${point.race}`
            : race,
        boat: boatLabel(point.boat),
        status: point.status,
        before: point.before,
        after: point.after,
      };
    }),
    heats: changes.heats.map((heat) => {
      const log = heat.log ?? [];
      return {
        heat: heatName(heat.heat),
        added: log.filter((b) => !heat.stored.includes(b)).map(boatLabel),
        removed: heat.stored.filter((b) => !log.includes(b)).map(boatLabel),
      };
    }),
    notes: record.anomalies,
    // The library's reason, without the log's internal decision number.
    refused: changes.refused?.replace(/^Decision \d+ refused: /, '') ?? null,
  };
  const empty =
    report.points.length === 0 &&
    report.heats.length === 0 &&
    report.notes.length === 0 &&
    report.refused === null;
  return empty ? null : report;
}
