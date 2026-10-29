/**
 * What the three Excel workbooks have in common: the title block, the logo,
 * the header-row style, the page setup and the signature lines.
 */
import type ExcelJS from 'exceljs';
import { formatDateTimeShort, formatEventDate } from '../utils/formatDate';
import { defaultSignatureLabels, stringsFor } from './i18n';
import { imageDimensions } from './logo';
import type {
  CommonDocumentOptions,
  DocumentContext,
  DocumentStatus,
  Orientation,
} from './types';

export const NAVY = 'FF14233F';
export const ZEBRA = 'FFF5F7FB';
export const RULE = 'FFCDD5E0';
export const WHITE = 'FFFFFFFF';
export const INK = 'FF1B2433';
export const MUTED = 'FF566274';
export const DANGER = 'FFB3261E';
export const GREEN = 'FF0B6B57';
export const GREY = 'FF6B7686';

const STATUS_FILL: Record<DocumentStatus, { fill: string; font: string }> = {
  provisional: { fill: 'FFFFF1D6', font: 'FF7A4300' },
  official: { fill: 'FF0B6B57', font: WHITE },
  final: { fill: 'FF111A2B', font: WHITE },
};

/** "FF8A6800" for a "#8a6800" colour. */
export const argb = (hex: string): string =>
  `FF${hex.replace('#', '').toUpperCase()}`;

/** A sheet name Excel accepts: at most 31 characters, none of : \ / ? * [ ]. */
export const sheetName = (value: string): string =>
  value
    .replace(/[:\\/?*[\]]/g, ' ')
    .trim()
    .slice(0, 31) || 'Sheet';

/** Excel's header/footer codes treat "&" specially. */
const footerText = (value: string): string => value.replace(/&/g, '&&');

interface TitleBlock {
  /** Number of columns the table below uses. */
  columns: number;
  title: string;
  statusLabel?: string;
  status: DocumentStatus | null;
  /** Show the "as of" line. */
  asOf: boolean;
  /** Its wording; "Results as of" unless given. */
  asOfLabel?: string;
  summary?: string;
}

/**
 * Event name, venue / dates / class, document title, status and as-of line as
 * merged cells at the top of the sheet; the logo sits at the top right. Returns
 * the row the table may start at.
 */
export const writeTitleBlock = (
  workbook: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  common: CommonDocumentOptions,
  context: DocumentContext,
  block: TitleBlock,
): number => {
  const strings = stringsFor(common.language);
  const { event } = context;
  const last = Math.max(block.columns, 6);
  const logo = event.logo ? imageDimensions(event.logo) : null;
  // Leave the right-hand corner to the logo when there is room for both.
  const textLast = logo && last >= 9 ? last - 3 : last;

  const mergedRow = (
    row: number,
    value: string,
    font: Partial<ExcelJS.Font>,
    height: number,
  ) => {
    sheet.mergeCells(row, 1, row, textLast);
    const cell = sheet.getCell(row, 1);
    cell.value = value;
    cell.font = { name: 'Calibri', ...font };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'left',
      wrapText: false,
    };
    sheet.getRow(row).height = height;
  };

  mergedRow(1, event.name, { size: 18, bold: true, color: { argb: NAVY } }, 27);
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
    .join('  |  ');
  mergedRow(2, meta, { size: 10, color: { argb: MUTED } }, 17);
  mergedRow(3, block.title, { size: 14, bold: true, color: { argb: INK } }, 24);

  // Row 4: the status badge, then the as-of line.
  sheet.getRow(4).height = 20;
  let nextColumn = 1;
  if (block.status && block.statusLabel) {
    const style = STATUS_FILL[block.status];
    sheet.mergeCells(4, 1, 4, 2);
    const badge = sheet.getCell(4, 1);
    badge.value = block.statusLabel.toUpperCase();
    badge.font = {
      name: 'Calibri',
      size: 10,
      bold: true,
      color: { argb: style.font },
    };
    badge.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: style.fill },
    };
    badge.alignment = { horizontal: 'center', vertical: 'middle' };
    nextColumn = 3;
  }
  if (block.asOf) {
    sheet.mergeCells(4, nextColumn, 4, textLast);
    const asOf = sheet.getCell(4, nextColumn);
    asOf.value = `${block.asOfLabel ?? strings.resultsAsOf} ${formatDateTimeShort(context.generatedAt)}`;
    asOf.font = { name: 'Calibri', size: 10, color: { argb: MUTED } };
    asOf.alignment = {
      vertical: 'middle',
      horizontal: nextColumn === 1 ? 'left' : 'left',
      indent: nextColumn === 1 ? 0 : 1,
    };
  }

  let row = 5;
  if (block.summary) {
    mergedRow(row, block.summary, { size: 10, color: { argb: MUTED } }, 17);
    row += 1;
  }

  if (event.logo && logo) {
    const extension = event.logo.startsWith('data:image/png') ? 'png' : 'jpeg';
    const imageId = workbook.addImage({ base64: event.logo, extension });
    // 60 px high at most, as wide as the picture's shape asks, never stretched.
    const height = 60;
    const width = Math.min(
      170,
      Math.round((logo.width / logo.height) * height),
    );
    sheet.addImage(imageId, {
      tl: { col: Math.max(0, last - 2.9), row: 0.15 },
      ext: { width, height: Math.round((width * logo.height) / logo.width) },
    });
  }

  // One empty row between the title block and the table.
  return row + 1;
};

/** The shared look of a table header row. */
export const styleHeaderRow = (
  row: ExcelJS.Row,
  columns: number,
  fill: string = NAVY,
  leftColumns = 0,
): void => {
  row.height = 22;
  for (let column = 1; column <= columns; column += 1) {
    const cell = row.getCell(column);
    cell.font = {
      name: 'Calibri',
      size: 10,
      bold: true,
      color: { argb: WHITE },
    };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.alignment = {
      horizontal: column <= leftColumns ? 'left' : 'center',
      vertical: 'middle',
    };
    cell.border = { bottom: { style: 'thin', color: { argb: RULE } } };
  }
};

/** Thin bottom rule and optional zebra tint of a body row. */
export const styleBodyRow = (
  row: ExcelJS.Row,
  columns: number,
  zebra: boolean,
): void => {
  for (let column = 1; column <= columns; column += 1) {
    const cell = row.getCell(column);
    if (zebra) {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: ZEBRA },
      };
    }
    cell.border = { bottom: { style: 'hair', color: { argb: RULE } } };
  }
};

interface PageSetup {
  orientation: Orientation;
  /** First and last row repeated at the top of every printed page, if any. */
  repeatRows: [number, number] | null;
  lastRow: number;
  lastColumn: number;
}

/** A4, fit to one page wide, header rows repeated, page numbers in the footer. */
export const setupPage = (
  sheet: ExcelJS.Worksheet,
  common: CommonDocumentOptions,
  context: DocumentContext,
  page: PageSetup,
): void => {
  const strings = stringsFor(common.language);
  const letter = (column: number): string => {
    let name = '';
    let rest = column;
    while (rest > 0) {
      const part = (rest - 1) % 26;
      name = String.fromCharCode(65 + part) + name;
      rest = Math.floor((rest - 1) / 26);
    }
    return name;
  };
  sheet.pageSetup = {
    paperSize: 9,
    orientation: page.orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: {
      left: 0.4,
      right: 0.4,
      top: 0.5,
      bottom: 0.7,
      header: 0.3,
      footer: 0.3,
    },
    ...(page.repeatRows
      ? { printTitlesRow: `${page.repeatRows[0]}:${page.repeatRows[1]}` }
      : {}),
    printArea: `A1:${letter(page.lastColumn)}${page.lastRow}`,
  };
  sheet.headerFooter = {
    oddFooter: `&L&8${footerText(context.event.name)}&C&8${footerText(strings.generatedBy)}&R&8${footerText(strings.page)} &P ${footerText(strings.of)} &N`,
  };
};

/** Freeze the title and header rows (and identity columns); hide gridlines. */
export const freezePanes = (
  sheet: ExcelJS.Worksheet,
  columns: number,
  rows: number,
): void => {
  sheet.views = [
    {
      state: 'frozen',
      xSplit: columns,
      ySplit: rows,
      showGridLines: false,
    },
  ];
};

/** Signature lines under the table, as ruled cells with the label below. */
export const writeSignatures = (
  sheet: ExcelJS.Worksheet,
  common: CommonDocumentOptions,
  startRow: number,
  columns: number,
): number => {
  if (!common.signatures.enabled) return startRow;
  const defaults = defaultSignatureLabels(common.language);
  const labels = common.signatures.labels.map(
    (label, index) => label.trim() || defaults[index],
  );
  const half = Math.max(2, Math.floor(columns / 2));
  const spans: Array<[number, number]> = [
    [1, Math.max(1, half - 1)],
    [half + 1, columns],
  ];
  const lineRow = startRow + 2;
  sheet.getRow(lineRow).height = 6;
  spans.forEach(([from, to], index) => {
    sheet.mergeCells(lineRow, from, lineRow, to);
    sheet.getCell(lineRow, from).border = {
      top: { style: 'thin', color: { argb: INK } },
    };
    for (let column = from; column <= to; column += 1) {
      sheet.getCell(lineRow, column).border = {
        top: { style: 'thin', color: { argb: INK } },
      };
    }
    sheet.mergeCells(lineRow + 1, from, lineRow + 1, to);
    const label = sheet.getCell(lineRow + 1, from);
    label.value = labels[index];
    label.font = { name: 'Calibri', size: 9, color: { argb: MUTED } };
  });
  return lineRow + 2;
};
