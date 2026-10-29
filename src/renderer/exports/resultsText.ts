/**
 * The results sheet as plain text, Markdown and CSV.
 *
 * Text and Markdown carry the same header block and legend as the PDF, written
 * as text. CSV is a data table and nothing else: one header row, one row per
 * boat, the fleet as a column; no title block, no section rows, no decoration.
 */
import { escapeCsvCell } from '../utils/leaderboardUtils';
import { formatDateTimeShort, formatEventDate } from '../utils/formatDate';
import { fleetLabel, stringsFor } from './i18n';
import {
  fleetSummary,
  legendItems,
  raceSummaryLine,
  resultsTitle,
  statusLabel,
} from './resultsCopy';
import type { ResultRow, ResultsModel } from './resultsModel';
import type {
  CommonDocumentOptions,
  DocumentContext,
  ExportLanguage,
} from './types';

interface TextTable {
  header: string[];
  sections: Array<{
    title: string | null;
    fleet: string | null;
    rows: string[][];
  }>;
}

const headerLabels = (
  model: ResultsModel,
  language: ExportLanguage,
): string[] => {
  const strings = stringsFor(language);
  return [
    strings.rank,
    strings.name,
    ...(model.showCountry ? [strings.country] : []),
    ...(model.showClub ? [strings.club] : []),
    strings.sailNumber,
    ...(model.showType ? [strings.boatType] : []),
    ...(model.showTotal ? [strings.total] : []),
    ...(model.showNet ? [strings.net] : []),
    ...model.raceHeaders,
  ];
};

const rowValues = (
  row: ResultRow,
  model: ResultsModel,
  empty: string,
): string[] => {
  const num = (value: number | null) =>
    value === null ? empty : String(value);
  return [
    row.rank === null ? empty : String(row.rank),
    row.name || empty,
    ...(model.showCountry ? [row.country || empty] : []),
    ...(model.showClub ? [row.club || empty] : []),
    row.sail || empty,
    ...(model.showType ? [row.boatType || empty] : []),
    ...(model.showTotal ? [num(row.total)] : []),
    ...(model.showNet ? [num(row.net)] : []),
    ...row.cells.map((cell) => cell.text),
  ];
};

const buildTable = (
  model: ResultsModel,
  language: ExportLanguage,
  empty: string,
): TextTable => ({
  header: headerLabels(model, language),
  sections: model.sections.map((section) => ({
    fleet: section.fleet,
    title: section.fleet ? fleetLabel(section.fleet, language) : null,
    rows: section.rows.map((row) => rowValues(row, model, empty)),
  })),
});

/**
 * CSV: a clean data table. The fleet is a column, missing values are empty
 * cells (never a dash or a made-up value), and cells are escaped against
 * formula injection (escapeCsvCell).
 */
export const buildResultsCsv = (
  model: ResultsModel,
  language: ExportLanguage,
): string => {
  const strings = stringsFor(language);
  const hasFleets = model.sections.some((section) => section.fleet !== null);
  const header = headerLabels(model, language);
  // The Fleet column sits before the totals, where the fixed columns end.
  const fleetAt =
    header.indexOf(strings.sailNumber) + 1 + (model.showType ? 1 : 0);
  const table = buildTable(model, language, '');
  const withFleet = (cells: string[], fleet: string) =>
    hasFleets
      ? [...cells.slice(0, fleetAt), fleet, ...cells.slice(fleetAt)]
      : cells;
  const lines = [
    withFleet(table.header, strings.fleet).map(escapeCsvCell).join(','),
  ];
  table.sections.forEach((section) => {
    section.rows.forEach((cells) =>
      lines.push(
        withFleet(cells, section.fleet ?? '')
          .map(escapeCsvCell)
          .join(','),
      ),
    );
  });
  return `${lines.join('\n')}\n`;
};

/** The header block of the text formats, one entry per line. */
export const textHeaderLines = (
  common: CommonDocumentOptions,
  context: DocumentContext,
  title: string,
  statusText: string | undefined,
  asOf: boolean,
  summary: string,
): string[] => {
  const strings = stringsFor(common.language);
  const { event } = context;
  const dates = [
    formatEventDate(event.startDate),
    formatEventDate(event.endDate),
  ]
    .filter(Boolean)
    .filter((date, index, all) => index === 0 || date !== all[0])
    .join(' – ');
  const meta = [
    event.venue,
    dates,
    event.boatClass ? `${strings.boatClass} ${event.boatClass}` : '',
  ]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' | ');
  return [
    event.name,
    ...(meta ? [meta] : []),
    '',
    statusText ? `${title} [${statusText.toUpperCase()}]` : title,
    ...(asOf
      ? [`${strings.resultsAsOf} ${formatDateTimeShort(context.generatedAt)}`]
      : []),
    ...(summary ? [summary] : []),
  ];
};

const padRows = (header: string[], rows: string[][]): number[] =>
  header.map((label, column) =>
    Math.max(label.length, ...rows.map((row) => (row[column] ?? '').length)),
  );

const signatureLine = (common: CommonDocumentOptions): string[] => {
  if (!common.signatures.enabled) return [];
  const strings = stringsFor(common.language);
  const labels = [
    common.signatures.labels[0].trim() || strings.raceOfficer,
    common.signatures.labels[1].trim() || strings.juryChair,
  ];
  return [
    '',
    '',
    labels.map((label) => `${'_'.repeat(28)}  ${label}`).join('\n'),
  ];
};

/** Fixed-width plain text, readable in any editor. */
export const buildResultsText = (
  model: ResultsModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
): string => {
  const strings = stringsFor(common.language);
  const table = buildTable(model, common.language, '–');
  const widths = padRows(
    table.header,
    table.sections.flatMap((section) => section.rows),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => (cell ?? '').padEnd(widths[index]))
      .join(' | ')
      .trimEnd();
  const divider = widths.map((width) => '-'.repeat(width)).join('-+-');

  const lines = textHeaderLines(
    common,
    context,
    resultsTitle(model, common),
    statusLabel(common, 'results'),
    true,
    raceSummaryLine(model, common.language),
  );
  if (table.sections.every((section) => section.rows.length === 0)) {
    lines.push('', strings.noResults);
  }
  table.sections.forEach((section, index) => {
    if (section.rows.length === 0) return;
    lines.push('');
    if (section.title) {
      const meta = fleetSummary(
        model.sections[index].finalCount,
        common.language,
      );
      lines.push(
        `=== ${section.title}${meta && !model.finalCount ? ` (${meta})` : ''} ===`,
      );
    }
    lines.push(line(table.header), divider, ...section.rows.map(line));
  });
  const legend = legendItems(model, common.language);
  if (legend.length > 0) {
    lines.push('', strings.legend.toUpperCase());
    legend.forEach((item) =>
      lines.push(`  ${item.term.padEnd(6)} ${item.meaning}`),
    );
  }
  lines.push(
    ...signatureLine(common),
    '',
    `${context.event.name} · ${strings.generatedBy}`,
  );
  return `${lines.join('\n')}\n`;
};

const mdCell = (value: string): string => value.replace(/\|/g, '\\|');

/** GitHub-style Markdown with the same header block and legend. */
export const buildResultsMarkdown = (
  model: ResultsModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
): string => {
  const strings = stringsFor(common.language);
  const table = buildTable(model, common.language, '–');
  const title = resultsTitle(model, common);
  const status = statusLabel(common, 'results');
  const head = textHeaderLines(
    common,
    context,
    title,
    status,
    true,
    raceSummaryLine(model, common.language),
  );
  const lines: string[] = [`# ${head[0]}`, ''];
  const meta = head[1] !== '' ? head[1] : null;
  if (meta) lines.push(`${meta}  `);
  lines.push(
    '',
    `## ${title}${status ? ` — **${status.toUpperCase()}**` : ''}`,
    '',
  );
  lines.push(
    `*${strings.resultsAsOf} ${formatDateTimeShort(context.generatedAt)}*`,
  );
  const summary = raceSummaryLine(model, common.language);
  if (summary) lines.push('', summary);

  const mdLine = (cells: string[]) => `| ${cells.map(mdCell).join(' | ')} |`;
  const separator = `| ${table.header.map(() => '---').join(' | ')} |`;
  if (table.sections.every((section) => section.rows.length === 0)) {
    lines.push('', strings.noResults);
  }
  table.sections.forEach((section, index) => {
    if (section.rows.length === 0) return;
    lines.push('');
    if (section.title) {
      const extra = fleetSummary(
        model.sections[index].finalCount,
        common.language,
      );
      lines.push(
        `### ${section.title}${extra && !model.finalCount ? ` (${extra})` : ''}`,
        '',
      );
    }
    lines.push(mdLine(table.header), separator, ...section.rows.map(mdLine));
  });
  const legend = legendItems(model, common.language);
  if (legend.length > 0) {
    lines.push('', `### ${strings.legend}`, '');
    legend.forEach((item) =>
      lines.push(`- **${mdCell(item.term)}** ${item.meaning}`),
    );
  }
  if (common.signatures.enabled) {
    const labels = [
      common.signatures.labels[0].trim() || strings.raceOfficer,
      common.signatures.labels[1].trim() || strings.juryChair,
    ];
    lines.push(
      '',
      labels.map((label) => `${label}: ${'_'.repeat(28)}`).join('  \n'),
    );
  }
  lines.push('', `---`, `${context.event.name} · ${strings.generatedBy}`);
  return `${lines.join('\n')}\n`;
};
