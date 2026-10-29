/**
 * The results sheet as a self-contained HTML document: the one source of the
 * PDF, the printout, the HTML file and the preview in the export dialog.
 */
import escapeHtml from '../utils/escapeHtml';
import {
  contentWidthMm,
  countryCell,
  flagStyles,
  pageFooterTexts,
  renderHeader,
  renderScreenFooter,
  renderSignatures,
  safeFileName,
  wrapDocument,
} from './documentShell';
import { fleetLabel, penaltyDescription, stringsFor } from './i18n';
import {
  fleetSummary,
  legendItems,
  raceSummaryLine,
  resultsTitle,
  statusLabel,
} from './resultsCopy';
import type {
  ResultCell,
  ResultRow,
  ResultSection,
  ResultsModel,
} from './resultsModel';
import type {
  BuiltDocument,
  CommonDocumentOptions,
  DocumentContext,
  Orientation,
  OrientationChoice,
} from './types';

const FILE_SUFFIX = {
  qualifying: 'qualifying_results',
  final: 'final_series_results',
  both: 'overall_results',
} as const;

/** "Event_overall_results_Q10_F4": what the sheet covers is in its name. */
const resultsFileBase = (
  model: ResultsModel,
  context: DocumentContext,
): string => {
  const races = [
    model.qualifyingRaces > 0 ? `Q${model.qualifyingRaces}` : '',
    model.finalRaces > 0 ? `F${model.finalRaces}` : '',
  ].filter(Boolean);
  return [
    safeFileName(context.event.name),
    FILE_SUFFIX[model.series],
    ...races,
  ].join('_');
};

/** Seven race columns still fit a portrait page; more want landscape. */
const PORTRAIT_RACE_LIMIT = 7;

/** The page orientation for a choice; "auto" looks at how wide the table is. */
export const resolveResultsOrientation = (
  choice: OrientationChoice,
  model: ResultsModel,
): Orientation => {
  if (choice !== 'auto') return choice;
  const races = model.raceHeaders.length;
  const wide = races > PORTRAIT_RACE_LIMIT || (model.showClub && races > 4);
  return wide ? 'landscape' : 'portrait';
};

interface ColumnWidths {
  rank: number;
  name: number;
  country: number;
  club: number;
  sail: number;
  type: number;
  total: number;
  net: number;
  race: number;
  compact: boolean;
}

/**
 * Millimetre widths of every column, so the table can use a fixed layout:
 * races share what the identity columns leave, a long name is cut with an
 * ellipsis instead of pushing the table off the page.
 */
export const layoutColumns = (
  model: ResultsModel,
  widthMm: number,
  hasFlags: boolean,
): ColumnWidths => {
  const countryWidth = hasFlags ? 20 : 15;
  const widths = {
    rank: 10,
    country: model.showCountry ? countryWidth : 0,
    club: model.showClub ? 32 : 0,
    sail: 17,
    type: model.showType ? 17 : 0,
    total: model.showTotal ? 15 : 0,
    net: model.showNet ? 13 : 0,
  };
  const fixed = Object.values(widths).reduce((sum, value) => sum + value, 0);
  const races = model.raceHeaders.length;
  const nameMin = 38;
  const room = widthMm - fixed - nameMin;
  const race = races > 0 ? Math.max(7, Math.min(16, room / races)) : 0;
  return {
    ...widths,
    race,
    name: Math.max(nameMin, widthMm - fixed - race * races),
    compact: races > 0 && race < 13.5,
  };
};

const mm = (value: number): string => `${Math.round(value * 100) / 100}mm`;

const PENALTY_WITH_POINTS = /^(\(?)([A-Z0-9]+) ([0-9][0-9.]*)(\)?)$/;

const renderCell = (
  cell: ResultCell,
  language: CommonDocumentOptions['language'],
  firstOfGroup: boolean,
): string => {
  const classes = ['r', `r-${cell.kind}`];
  if (cell.discarded) classes.push('discarded');
  if (firstOfGroup) classes.push('group-start');
  const description = cell.code
    ? penaltyDescription(cell.code, language)
    : null;
  const title = description
    ? ` title="${escapeHtml(`${cell.code} — ${description}`)}"`
    : '';
  const points = PENALTY_WITH_POINTS.exec(cell.text);
  const text = points
    ? `${escapeHtml(points[1])}<b>${escapeHtml(points[2])}</b> <span class="pp">${escapeHtml(points[3])}</span>${escapeHtml(points[4])}`
    : escapeHtml(cell.text);
  return `<td class="${classes.join(' ')}"${title}>${text}</td>`;
};

const renderRow = (
  row: ResultRow,
  model: ResultsModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
): string => {
  const missing = '<span class="missing">–</span>';
  const number = (value: number | null) =>
    value === null ? missing : String(value);
  const bothSeries = model.qualifyingRaces > 0 && model.finalRaces > 0;
  const cells = row.cells
    .map((cell, index) =>
      renderCell(
        cell,
        common.language,
        bothSeries && index === model.qualifyingRaces,
      ),
    )
    .join('');
  return `<tr>
<td class="rank">${row.rank === null ? missing : row.rank}</td>
<td class="name" title="${escapeHtml(row.name)}">${row.name ? escapeHtml(row.name) : missing}</td>
${model.showCountry ? `<td class="country">${countryCell(row.country, context.flags)}</td>` : ''}
${model.showClub ? `<td class="club" title="${escapeHtml(row.club)}">${row.club ? escapeHtml(row.club) : missing}</td>` : ''}
<td class="sail">${row.sail ? escapeHtml(row.sail) : missing}</td>
${model.showType ? `<td class="type">${row.boatType ? escapeHtml(row.boatType) : missing}</td>` : ''}
${model.showTotal ? `<td class="total">${number(row.total)}</td>` : ''}
${model.showNet ? `<td class="net">${number(row.net)}</td>` : ''}
${cells}
</tr>`;
};

const renderTable = (
  section: ResultSection,
  model: ResultsModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
  widths: ColumnWidths,
): string => {
  const strings = stringsFor(common.language);
  const cols = [
    `<col style="width:${mm(widths.rank)}">`,
    `<col>`,
    model.showCountry ? `<col style="width:${mm(widths.country)}">` : '',
    model.showClub ? `<col style="width:${mm(widths.club)}">` : '',
    `<col style="width:${mm(widths.sail)}">`,
    model.showType ? `<col style="width:${mm(widths.type)}">` : '',
    model.showTotal ? `<col style="width:${mm(widths.total)}">` : '',
    model.showNet ? `<col style="width:${mm(widths.net)}">` : '',
    ...model.raceHeaders.map(() => `<col style="width:${mm(widths.race)}">`),
  ].join('');

  const grouped = model.qualifyingRaces > 0 && model.finalRaces > 0;
  const rowSpan = grouped ? ' rowspan="2"' : '';
  const identity = [
    `<th class="left"${rowSpan}>${escapeHtml(strings.rank)}</th>`,
    `<th class="left"${rowSpan}>${escapeHtml(strings.name)}</th>`,
    model.showCountry
      ? `<th class="left"${rowSpan}>${escapeHtml(strings.country)}</th>`
      : '',
    model.showClub
      ? `<th class="left"${rowSpan}>${escapeHtml(strings.club)}</th>`
      : '',
    `<th class="left"${rowSpan}>${escapeHtml(strings.sailNumber)}</th>`,
    model.showType
      ? `<th class="left"${rowSpan}>${escapeHtml(strings.boatType)}</th>`
      : '',
    model.showTotal ? `<th${rowSpan}>${escapeHtml(strings.total)}</th>` : '',
    model.showNet
      ? `<th class="net-head"${rowSpan}>${escapeHtml(strings.net)}</th>`
      : '',
  ].join('');

  const raceHead = (label: string, index: number) =>
    `<th class="race${grouped && index === model.qualifyingRaces ? ' group-start' : ''}">${escapeHtml(label)}</th>`;
  let head: string;
  if (grouped) {
    head = `<tr>${identity}<th class="group" colspan="${model.qualifyingRaces}">${escapeHtml(strings.qualifyingShort)}</th><th class="group group-start" colspan="${model.finalRaces}">${escapeHtml(strings.finalShort)}</th></tr>
<tr>${model.raceHeaders.map(raceHead).join('')}</tr>`;
  } else {
    head = `<tr>${identity}${model.raceHeaders.map(raceHead).join('')}</tr>`;
  }

  return `<table class="results${widths.compact ? ' compact' : ''}">
<colgroup>${cols}</colgroup>
<thead>${head}</thead>
<tbody>
${section.rows.map((row) => renderRow(row, model, common, context)).join('\n')}
</tbody>
</table>`;
};

const renderLegend = (
  model: ResultsModel,
  common: CommonDocumentOptions,
): string => {
  const items = legendItems(model, common.language);
  if (items.length === 0) return '';
  const strings = stringsFor(common.language);
  const list = items
    .map(
      (item) =>
        `<li><span class="code ${item.kind}">${escapeHtml(item.term)}</span> ${escapeHtml(item.meaning)}</li>`,
    )
    .join('\n');
  return `<section class="legend">
<h3>${escapeHtml(strings.legend)}</h3>
<ul>
${list}
</ul>
</section>`;
};

const renderSection = (
  section: ResultSection,
  index: number,
  model: ResultsModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
  widths: ColumnWidths,
): string => {
  const pageBreak = model.options.fleetPerPage && index > 0 ? ' new-page' : '';
  if (!section.fleet) {
    return `<section class="fleet${pageBreak}">\n${renderTable(section, model, common, context, widths)}\n</section>`;
  }
  const color = section.color ?? { border: '#6b7c93', thead: '#566575' };
  const meta = model.finalCount
    ? ''
    : fleetSummary(section.finalCount, common.language);
  const label = fleetLabel(section.fleet, common.language);
  return `<section class="fleet${pageBreak}">
<div class="fleet-band" style="background:${color.thead};border-left-color:${color.border}">
<span class="fleet-name">${escapeHtml(label)}</span>
${meta ? `<span class="fleet-meta">${escapeHtml(meta)}</span>` : ''}
</div>
${renderTable(section, model, common, context, widths)}
</section>`;
};

const RESULTS_CSS = `
table.results {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 8.8pt;
}
table.results thead { display: table-header-group; }
table.results th {
  background: var(--navy);
  color: #fff;
  font-weight: 600;
  padding: 1.7mm 1.3mm;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}
table.results th.left { text-align: left; }
table.results th.group {
  padding: 0.9mm 1mm;
  font-size: 7.8pt;
  letter-spacing: 0.4pt;
  background: #24385c;
  border-bottom: 0.25mm solid rgba(255, 255, 255, 0.35);
}
table.results th.race { font-weight: 600; background: #1c2e4e; }
table.results th.group-start,
table.results td.group-start { border-left: 0.5mm solid #8fa3c4; }
table.results th.net-head { background: #0b6b57; }
table.results tbody tr { break-inside: avoid; page-break-inside: avoid; }
table.results td {
  padding: 1.1mm 1.3mm;
  border-bottom: 0.2mm solid var(--soft);
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
}
table.results tbody tr:nth-child(even) td { background: var(--zebra); }
table.results td.rank { text-align: left; font-weight: 700; color: var(--navy); }
table.results td.name {
  text-align: left;
  font-weight: 600;
  text-overflow: ellipsis;
}
table.results td.country,
table.results td.club,
table.results td.sail,
table.results td.type { text-align: left; }
table.results td.club,
table.results td.type { color: var(--muted); text-overflow: ellipsis; }
table.results td.sail { font-weight: 600; }
table.results td.total { color: var(--muted); }
table.results td.net {
  font-weight: 700;
  color: var(--navy);
  background: #e9f4f0 !important;
  border-left: 0.3mm solid #b5d9cf;
  border-right: 0.3mm solid #b5d9cf;
}
table.results td.r { padding-left: 0.4mm; padding-right: 0.4mm; font-size: 0.97em; }
table.results td.r-penalty,
table.results td.r-redress { font-weight: 600; }
table.results.compact td.r-penalty,
table.results.compact td.r-redress { white-space: normal; line-height: 1.12; }
table.results td.r-penalty { color: var(--danger); }
table.results td.r-redress { color: var(--accent); }
table.results td .pp { font-size: 0.88em; }
table.results td.discarded,
table.results td.discarded .pp { color: var(--discard); font-weight: 400; }
table.results td .pp { font-weight: 400; }
.fleet { margin-bottom: 6mm; }
.fleet.new-page { break-before: page; page-break-before: always; }
.fleet-band {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 1.7mm 3mm;
  border-left: 2.2mm solid;
  color: #fff;
  font-size: 10.5pt;
  font-weight: 700;
  break-after: avoid;
  page-break-after: avoid;
}
.fleet-meta { font-size: 8pt; font-weight: 400; opacity: 0.92; }
`;

/** The whole results sheet. */
export const buildResultsDocument = (
  model: ResultsModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
  orientationChoice: OrientationChoice,
): BuiltDocument => {
  const orientation = resolveResultsOrientation(orientationChoice, model);
  const strings = stringsFor(common.language);
  const title = resultsTitle(model, common);
  const widths = layoutColumns(
    model,
    contentWidthMm(orientation),
    Object.keys(context.flags).length > 0,
  );
  const usedCountries = model.sections.flatMap((section) =>
    section.rows.map((row) => row.country),
  );
  const footer = pageFooterTexts(common, context);

  const tables =
    model.sections.length > 0 &&
    model.sections.some((section) => section.rows.length > 0)
      ? model.sections
          .map((section, index) =>
            renderSection(section, index, model, common, context, widths),
          )
          .join('\n')
      : `<p class="empty-note">${escapeHtml(strings.noResults)}</p>`;

  const body = [
    renderHeader({
      common,
      context,
      title,
      asOf: true,
      statusLabel: statusLabel(common, 'results'),
      summary: raceSummaryLine(model, common.language),
    }),
    tables,
    renderLegend(model, common),
    renderSignatures(common),
    context.target === 'screen' ? renderScreenFooter(common, context) : '',
  ].join('\n');

  return {
    html: wrapDocument({
      language: common.language,
      title: `${context.event.name} – ${title}`,
      orientation,
      footerLeft: footer.left,
      footerCenter: footer.center,
      pageLabel: footer.page,
      ofLabel: footer.of,
      body,
      extraCss: `${RESULTS_CSS}\n${flagStyles(context.flags, usedCountries)}`,
      context,
    }),
    orientation,
    fileBase: resultsFileBase(model, context),
    footer,
  };
};
