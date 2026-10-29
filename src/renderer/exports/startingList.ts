/**
 * The starting list (entry list) of an event: the model, and its HTML, Excel
 * and column definitions. Pure functions from plain rows and options.
 */
import ExcelJS from 'exceljs';
import escapeHtml from '../utils/escapeHtml';
import { toSubgroupLabel } from '../../shared/subgroups';
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
  LIST_CSS,
} from './documentShell';
import {
  GREEN,
  INK,
  MUTED,
  NAVY,
  freezePanes,
  setupPage,
  sheetName,
  styleBodyRow,
  styleHeaderRow,
  writeSignatures,
  writeTitleBlock,
} from './excelShared';
import { countsFor, stringsFor } from './i18n';
import { statusLabel } from './resultsCopy';
import type {
  BuiltDocument,
  CommonDocumentOptions,
  DocumentContext,
  Orientation,
  OrientationChoice,
} from './types';

/** A boat entered in the event, as `readBoatsByEvent` returns it. */
export interface StartingListBoat {
  boat_id?: number;
  name?: string | null;
  surname?: string | null;
  country?: string | null;
  boat_country?: string | null;
  club?: string | null;
  club_name?: string | null;
  sail_number?: number | string | null;
  model?: string | null;
  boat_type?: string | null;
  subgroup?: string | null;
  category?: string | null;
  category_name?: string | null;
}

export type StartingListSort = 'sail' | 'country' | 'surname';

export interface StartingListOptions {
  sort: StartingListSort;
  /** A band per country with its number of entries. */
  groupByCountry: boolean;
  columns: { club: boolean; subgroup: boolean; boatModel: boolean };
  /** The "Total entries: 30" line. */
  totalEntries: boolean;
}

export const DEFAULT_STARTING_LIST_OPTIONS: StartingListOptions = {
  sort: 'sail',
  groupByCountry: false,
  columns: { club: true, subgroup: true, boatModel: true },
  totalEntries: true,
};

export interface StartingListRow {
  /** Running number in the printed order. */
  number: number;
  name: string;
  surname: string;
  country: string;
  club: string;
  sail: string;
  subgroup: string;
  model: string;
}

export interface StartingListSection {
  /** The country of the band, or null when the list is not grouped. */
  country: string | null;
  rows: StartingListRow[];
}

export interface StartingListModel {
  sections: StartingListSection[];
  total: number;
  nations: number;
  options: StartingListOptions;
  showClub: boolean;
  showSubgroup: boolean;
  showModel: boolean;
}

const textOf = (value: string | null | undefined): string =>
  String(value ?? '').trim();

const compareText = (a: string, b: string): number =>
  a.localeCompare(b, 'hr', { sensitivity: 'base' });

const compareSail = (a: StartingListRow, b: StartingListRow): number =>
  a.sail.localeCompare(b.sail, undefined, { numeric: true });

const COMPARERS: Record<
  StartingListSort,
  (a: StartingListRow, b: StartingListRow) => number
> = {
  sail: (a, b) => compareSail(a, b),
  country: (a, b) => compareText(a.country, b.country) || compareSail(a, b),
  surname: (a, b) =>
    compareText(a.surname, b.surname) ||
    compareText(a.name, b.name) ||
    compareSail(a, b),
};

export const buildStartingListModel = (
  boats: ReadonlyArray<StartingListBoat>,
  options: StartingListOptions,
): StartingListModel => {
  const rows: StartingListRow[] = boats.map((boat) => ({
    number: 0,
    name: textOf(boat.name),
    surname: textOf(boat.surname),
    country: textOf(boat.country ?? boat.boat_country).toUpperCase(),
    club: textOf(boat.club ?? boat.club_name),
    sail: textOf(boat.sail_number == null ? '' : String(boat.sail_number)),
    subgroup:
      toSubgroupLabel(boat.subgroup || boat.category || boat.category_name) ??
      '',
    model: textOf(boat.model ?? boat.boat_type),
  }));

  // Grouped by country the countries are in alphabetical order, whatever the
  // sort, and the sort orders the boats inside each country.
  const inside = options.sort === 'country' ? 'sail' : options.sort;
  const sorted = [...rows].sort(
    options.groupByCountry
      ? (a, b) => compareText(a.country, b.country) || COMPARERS[inside](a, b)
      : COMPARERS[options.sort],
  );
  sorted.forEach((row, index) => {
    // eslint-disable-next-line no-param-reassign
    row.number = index + 1;
  });

  const sections: StartingListSection[] = [];
  if (options.groupByCountry) {
    sorted.forEach((row) => {
      const last = sections[sections.length - 1];
      if (last && last.country === row.country) last.rows.push(row);
      else sections.push({ country: row.country, rows: [row] });
    });
  } else if (sorted.length > 0) {
    sections.push({ country: null, rows: sorted });
  }

  return {
    sections,
    total: sorted.length,
    nations: new Set(sorted.map((row) => row.country).filter(Boolean)).size,
    options,
    showClub: options.columns.club && sorted.some((row) => row.club !== ''),
    showSubgroup:
      options.columns.subgroup && sorted.some((row) => row.subgroup !== ''),
    showModel:
      options.columns.boatModel && sorted.some((row) => row.model !== ''),
  };
};

export const startingListTitle = (common: CommonDocumentOptions): string =>
  common.title.trim() || stringsFor(common.language).titleStartingList;

/** "30 entries · 8 nations", or '' when the line is switched off. */
export const totalLine = (
  model: StartingListModel,
  common: CommonDocumentOptions,
): string => {
  if (!model.options.totalEntries) return '';
  const strings = stringsFor(common.language);
  const nations =
    model.nations > 0 ? ` · ${model.nations} ${strings.nations}` : '';
  return `${strings.totalEntries}: ${model.total}${nations}`;
};

interface ListColumn {
  key: string;
  header: string;
  mm: number | null;
  align: 'left' | 'center';
  value: (row: StartingListRow) => string;
}

const columnsOf = (
  model: StartingListModel,
  common: CommonDocumentOptions,
): ListColumn[] => {
  const strings = stringsFor(common.language);
  const columns: ListColumn[] = [
    {
      key: 'no',
      header: strings.entryNumber,
      mm: 11,
      align: 'left',
      value: (r) => String(r.number),
    },
    {
      key: 'country',
      header: strings.country,
      mm: 24,
      align: 'left',
      value: (r) => r.country,
    },
    {
      key: 'sail',
      header: strings.sailNumber,
      mm: 20,
      align: 'left',
      value: (r) => r.sail,
    },
    {
      key: 'sailor',
      header: strings.sailor,
      mm: null,
      align: 'left',
      value: (r) => [r.name, r.surname].filter(Boolean).join(' '),
    },
  ];
  if (model.showClub)
    columns.push({
      key: 'club',
      header: strings.club,
      mm: 46,
      align: 'left',
      value: (r) => r.club,
    });
  if (model.showSubgroup)
    columns.push({
      key: 'subgroup',
      header: strings.subgroup,
      mm: 24,
      align: 'left',
      value: (r) => r.subgroup,
    });
  if (model.showModel)
    columns.push({
      key: 'model',
      header: strings.boatModel,
      mm: 30,
      align: 'left',
      value: (r) => r.model,
    });
  return columns;
};

export const resolveListOrientation = (
  choice: OrientationChoice,
): Orientation => (choice === 'landscape' ? 'landscape' : 'portrait');

const renderRows = (
  rows: StartingListRow[],
  columns: ListColumn[],
  context: DocumentContext,
): string =>
  rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const value = column.value(row);
          let inner: string;
          if (value === '') inner = '<span class="missing">–</span>';
          else if (column.key === 'country')
            inner = countryCell(value, context.flags);
          else inner = escapeHtml(value);
          const title =
            column.key === 'sailor' || column.key === 'club'
              ? ` title="${escapeHtml(value)}"`
              : '';
          return `<td class="c-${column.key}"${title}>${inner}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('\n');

/** The starting list as one HTML document. */
export const buildStartingListDocument = (
  model: StartingListModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
  orientationChoice: OrientationChoice,
): BuiltDocument => {
  const orientation = resolveListOrientation(orientationChoice);
  const strings = stringsFor(common.language);
  const counts = countsFor(common.language);
  const columns = columnsOf(model, common);
  const title = startingListTitle(common);
  const footer = pageFooterTexts(common, context);
  const widthMm = contentWidthMm(orientation);
  const fixed = columns.reduce((sum, column) => sum + (column.mm ?? 0), 0);
  const cols = columns
    .map((column) =>
      column.mm === null
        ? `<col style="width:${Math.max(40, widthMm - fixed)}mm">`
        : `<col style="width:${column.mm}mm">`,
    )
    .join('');
  const head = columns
    .map((column) => `<th class="left">${escapeHtml(column.header)}</th>`)
    .join('');

  // One table (so the header repeats on every page); a grouped list gets one
  // body per country, each opened by a band row with the country's entries.
  const bodies = model.sections
    .map((section) => {
      const band =
        section.country === null
          ? ''
          : `<tr class="band"><td colspan="${columns.length}"><span class="group-name">${countryCell(section.country, context.flags)}</span><span class="group-meta">${escapeHtml(counts.entries(section.rows.length))}</span></td></tr>\n`;
      const keepTogether = section.rows.length <= 14 ? ' class="together"' : '';
      return `<tbody${keepTogether}>\n${band}${renderRows(section.rows, columns, context)}\n</tbody>`;
    })
    .join('\n');

  const tables =
    model.total === 0
      ? `<p class="empty-note">${escapeHtml(strings.noEntries)}</p>`
      : `<table class="list">
<colgroup>${cols}</colgroup>
<thead><tr>${head}</tr></thead>
${bodies}
</table>`;

  const body = [
    renderHeader({
      common,
      context,
      title,
      asOf: true,
      asOfLabel: strings.asOf,
      statusLabel: statusLabel(common, 'startingList'),
      summary: totalLine(model, common),
    }),
    tables,
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
      extraCss: `${LIST_CSS}\n${flagStyles(
        context.flags,
        model.sections.flatMap((section) =>
          section.rows.map((row) => row.country),
        ),
      )}`,
      context,
    }),
    orientation,
    fileBase: `${safeFileName(context.event.name)}_starting_list`,
    footer,
  };
};

/** The starting list as a styled Excel workbook (one sheet). */
export const buildStartingListWorkbook = async (
  model: StartingListModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
  orientationChoice: OrientationChoice,
): Promise<Uint8Array> => {
  const strings = stringsFor(common.language);
  const counts = countsFor(common.language);
  const title = startingListTitle(common);
  const columns = columnsOf(model, common);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IOM Regatta Manager';
  workbook.created = context.generatedAt;
  const sheet = workbook.addWorksheet(sheetName(title));
  const widths: Record<string, number> = {
    no: 6,
    country: 10,
    sail: 11,
    sailor: 34,
    club: 28,
    subgroup: 12,
    model: 16,
  };
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = widths[column.key] ?? 14;
  });

  const firstRow = writeTitleBlock(workbook, sheet, common, context, {
    columns: columns.length,
    title,
    status: common.status === 'final' ? 'official' : common.status,
    statusLabel: statusLabel(common, 'startingList'),
    asOf: true,
    asOfLabel: strings.asOf,
    summary: totalLine(model, common),
  });
  const header = sheet.getRow(firstRow);
  columns.forEach((column, index) => {
    header.getCell(index + 1).value = column.header;
  });
  styleHeaderRow(header, columns.length, NAVY, columns.length);

  let rowNumber = firstRow + 1;
  model.sections.forEach((section) => {
    if (section.country !== null) {
      sheet.mergeCells(rowNumber, 1, rowNumber, columns.length);
      const band = sheet.getCell(rowNumber, 1);
      band.value = `${section.country || '–'}  —  ${counts.entries(section.rows.length)}`;
      band.font = {
        name: 'Calibri',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      band.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: GREEN },
      };
      band.alignment = { vertical: 'middle', indent: 1 };
      sheet.getRow(rowNumber).height = 19;
      rowNumber += 1;
    }
    section.rows.forEach((row, index) => {
      const excelRow = sheet.getRow(rowNumber);
      columns.forEach((column, columnIndex) => {
        const value = column.value(row);
        const cell = excelRow.getCell(columnIndex + 1);
        // Numbers stay numbers (sortable); a missing value stays an empty cell.
        if (value === '') cell.value = null;
        else if (
          column.key === 'no' ||
          (column.key === 'sail' && /^\d+$/.test(value))
        )
          cell.value = Number(value);
        else cell.value = value;
        cell.font = {
          name: 'Calibri',
          size: 10,
          bold: column.key === 'sail' || column.key === 'sailor',
          color: {
            argb: column.key === 'club' || column.key === 'model' ? MUTED : INK,
          },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      });
      excelRow.height = 17;
      styleBodyRow(excelRow, columns.length, index % 2 === 1);
      rowNumber += 1;
    });
  });
  if (model.total === 0) {
    sheet.mergeCells(rowNumber, 1, rowNumber, columns.length);
    sheet.getCell(rowNumber, 1).value = strings.noEntries;
    rowNumber += 1;
  }
  rowNumber = writeSignatures(sheet, common, rowNumber, columns.length);
  freezePanes(sheet, 0, firstRow);
  setupPage(sheet, common, context, {
    orientation: resolveListOrientation(orientationChoice),
    repeatRows: [firstRow, firstRow],
    lastRow: rowNumber,
    lastColumn: columns.length,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
};
