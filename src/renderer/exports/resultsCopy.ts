/**
 * The words around a results table, in the document's language: its title,
 * the "10 races sailed, 1 discard" line, the status label and the legend.
 * Shared by the HTML, text and Markdown documents so they say the same thing.
 */
import { countsFor, penaltyDescription, stringsFor } from './i18n';
import type { RaceCount, ResultsModel, ResultsSeries } from './resultsModel';
import type { CommonDocumentOptions, ExportLanguage } from './types';

export interface LegendItem {
  /** "DNF", "(7)" or "Total": printed in bold. */
  term: string;
  meaning: string;
  kind: 'penalty' | 'redress' | 'plain';
}

export const defaultResultsTitle = (
  series: ResultsSeries,
  language: ExportLanguage,
): string => {
  const strings = stringsFor(language);
  if (series === 'qualifying') return strings.titleResultsQualifying;
  if (series === 'final') return strings.titleResultsFinal;
  return strings.titleResultsOverall;
};

const countText = (count: RaceCount, language: ExportLanguage): string => {
  const counts = countsFor(language);
  return `${counts.racesSailed(count.races)}, ${counts.discards(count.discards)}`;
};

/**
 * "10 races sailed, 1 discard". The figures are the ones the standings were
 * computed with (the series' discard profile and the races counted); when a
 * figure is not known there is no line at all, never a guessed number.
 */
export const raceSummaryLine = (
  model: ResultsModel,
  language: ExportLanguage,
): string => {
  if (!model.options.raceSummary) return '';
  const strings = stringsFor(language);
  const parts: string[] = [];
  if (model.qualifyingCount) {
    const text = countText(model.qualifyingCount, language);
    parts.push(
      model.series === 'qualifying'
        ? text
        : `${strings.qualifyingSeries}: ${text}`,
    );
  }
  if (model.finalCount && model.series !== 'qualifying') {
    const text = countText(model.finalCount, language);
    parts.push(
      model.series === 'final' ? text : `${strings.finalSeries}: ${text}`,
    );
  }
  return parts.join('  ·  ');
};

/** The same figures for one fleet, shown in its band. */
export const fleetSummary = (
  count: RaceCount | null,
  language: ExportLanguage,
): string => (count && count.races > 0 ? countText(count, language) : '');

export const statusLabel = (
  common: CommonDocumentOptions,
  kind: 'results' | 'startingList',
): string | undefined => {
  if (!common.status) return undefined;
  const strings = stringsFor(common.language);
  if (kind === 'startingList') {
    return strings.statusStartingList[
      common.status === 'final' ? 'official' : common.status
    ];
  }
  return strings.status[common.status];
};

/** The document's heading: the typed title, or the default for the series. */
export const resultsTitle = (
  model: ResultsModel,
  common: CommonDocumentOptions,
): string =>
  common.title.trim() || defaultResultsTitle(model.series, common.language);

const hasPointsAfterCode = (model: ResultsModel): boolean =>
  model.sections.some((section) =>
    section.rows.some((row) =>
      row.cells.some(
        (cell) => cell.kind === 'penalty' && /[A-Z0-9]+ \d/.test(cell.text),
      ),
    ),
  );

/**
 * What the legend explains: only the status codes that occur in the table,
 * plus the discard brackets, Total and Net when those are on the page.
 */
export const legendItems = (
  model: ResultsModel,
  language: ExportLanguage,
): LegendItem[] => {
  if (!model.options.legend) return [];
  const strings = stringsFor(language);
  const items: LegendItem[] = [];
  model.codes.forEach((code) => {
    const meaning = penaltyDescription(code, language);
    if (!meaning) return;
    items.push({
      term: code,
      meaning,
      kind: code.startsWith('RDG') ? 'redress' : 'penalty',
    });
  });
  if (model.options.showPenaltyPoints && hasPointsAfterCode(model)) {
    items.push({
      term: '#',
      meaning: strings.penaltyPointsNote,
      kind: 'plain',
    });
  }
  if (model.hasDiscards && model.options.showDiscards) {
    items.push({ term: '(n)', meaning: strings.discardedScore, kind: 'plain' });
  }
  if (model.showTotal) {
    items.push({
      term: strings.total,
      meaning: strings.totalMeaning,
      kind: 'plain',
    });
  }
  if (model.showNet) {
    items.push({
      term: strings.net,
      meaning: strings.netMeaning,
      kind: 'plain',
    });
  }
  if (model.rankInFleet) {
    items.push({
      term: strings.rank,
      meaning: strings.rankInFleetNote,
      kind: 'plain',
    });
  }
  return items;
};
