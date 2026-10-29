/**
 * The results sheet as a styled Excel workbook.
 *
 * Layout decision: ONE sheet with a coloured band row per fleet (in the same
 * fleet colours as the screen and the PDF), not one sheet per fleet. A single
 * sheet keeps the title block, the column widths and the print setup in one
 * place, scrolls like the printed document, and prints as one document with
 * the header rows repeated; the data stays one rectangular block per fleet for
 * anyone who wants to copy it out.
 */
import ExcelJS from 'exceljs';
import {
  DANGER,
  GREEN,
  GREY,
  INK,
  MUTED,
  NAVY,
  WHITE,
  argb,
  freezePanes,
  setupPage,
  sheetName,
  styleBodyRow,
  styleHeaderRow,
  writeSignatures,
  writeTitleBlock,
} from './excelShared';
import { fleetLabel, stringsFor } from './i18n';
import {
  fleetSummary,
  legendItems,
  raceSummaryLine,
  resultsTitle,
  statusLabel,
} from './resultsCopy';
import { resolveResultsOrientation } from './resultsDocument';
import type { ResultCell, ResultsModel } from './resultsModel';
import type {
  CommonDocumentOptions,
  DocumentContext,
  OrientationChoice,
} from './types';

const LEGEND_COLOR = { penalty: DANGER, redress: GREEN, plain: INK } as const;

const asNumber = (text: string): number | null => {
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
};

/** A place stays a number so the sheet can be sorted; codes stay text. */
const cellValue = (cell: ResultCell): string | number | null => {
  if (cell.text === '') return null;
  if (cell.kind === 'place' && !cell.discarded)
    return asNumber(cell.text) ?? cell.text;
  return cell.text;
};

const buildResultsWorkbook = async (
  model: ResultsModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
  orientationChoice: OrientationChoice,
): Promise<Uint8Array> => {
  const strings = stringsFor(common.language);
  const title = resultsTitle(model, common);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IOM Regatta Manager';
  workbook.created = context.generatedAt;
  const sheet = workbook.addWorksheet(sheetName(title));

  const columns = [
    { key: 'rank', header: strings.rank, width: 7, left: true },
    { key: 'name', header: strings.name, width: 30, left: true },
    ...(model.showCountry
      ? [{ key: 'country', header: strings.country, width: 10, left: true }]
      : []),
    ...(model.showClub
      ? [{ key: 'club', header: strings.club, width: 24, left: true }]
      : []),
    { key: 'sail', header: strings.sailNumber, width: 10, left: true },
    ...(model.showType
      ? [{ key: 'type', header: strings.boatType, width: 12, left: true }]
      : []),
    ...(model.showTotal
      ? [{ key: 'total', header: strings.total, width: 9, left: false }]
      : []),
    ...(model.showNet
      ? [{ key: 'net', header: strings.net, width: 9, left: false }]
      : []),
  ];
  const identityCount = columns.length;
  const hasPoints = model.sections.some((section) =>
    section.rows.some((row) =>
      row.cells.some(
        (cell) =>
          cell.kind === 'penalty' &&
          /\d$/.test(cell.text) &&
          cell.text.includes(' '),
      ),
    ),
  );
  const raceWidth = hasPoints ? 11 : 7.5;
  const totalColumns = identityCount + model.raceHeaders.length;
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });
  for (let i = 0; i < model.raceHeaders.length; i += 1) {
    sheet.getColumn(identityCount + i + 1).width = raceWidth;
  }

  const firstRow = writeTitleBlock(workbook, sheet, common, context, {
    columns: totalColumns,
    title,
    status: common.status,
    statusLabel: statusLabel(common, 'results'),
    asOf: true,
    summary: raceSummaryLine(model, common.language),
  });

  // Header: a "Qualifying | Final" group row when both series are shown.
  const grouped = model.qualifyingRaces > 0 && model.finalRaces > 0;
  let headerRow = firstRow;
  if (grouped) {
    const groupRow = sheet.getRow(firstRow);
    const qualifyingFrom = identityCount + 1;
    const finalFrom = identityCount + model.qualifyingRaces + 1;
    sheet.mergeCells(firstRow, qualifyingFrom, firstRow, finalFrom - 1);
    sheet.mergeCells(firstRow, finalFrom, firstRow, totalColumns);
    groupRow.getCell(qualifyingFrom).value = strings.qualifyingShort;
    groupRow.getCell(finalFrom).value = strings.finalShort;
    styleHeaderRow(groupRow, totalColumns, 'FF24385C');
    groupRow.height = 16;
    headerRow = firstRow + 1;
  }
  const header = sheet.getRow(headerRow);
  columns.forEach((column, index) => {
    header.getCell(index + 1).value = column.header;
  });
  model.raceHeaders.forEach((label, index) => {
    header.getCell(identityCount + index + 1).value = label;
  });
  styleHeaderRow(
    header,
    totalColumns,
    NAVY,
    columns.filter((c) => c.left).length,
  );
  const netIndex = columns.findIndex((column) => column.key === 'net');
  if (netIndex >= 0) {
    header.getCell(netIndex + 1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: GREEN },
    };
  }

  let rowNumber = headerRow + 1;
  model.sections.forEach((section) => {
    if (section.fleet) {
      const color = section.color ?? { border: '#6b7c93', thead: '#566575' };
      sheet.mergeCells(rowNumber, 1, rowNumber, totalColumns);
      const band = sheet.getCell(rowNumber, 1);
      const meta = model.finalCount
        ? ''
        : fleetSummary(section.finalCount, common.language);
      band.value = meta
        ? `${fleetLabel(section.fleet, common.language)}  —  ${meta}`
        : fleetLabel(section.fleet, common.language);
      band.font = {
        name: 'Calibri',
        size: 11,
        bold: true,
        color: { argb: WHITE },
      };
      band.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: argb(color.thead) },
      };
      band.alignment = { vertical: 'middle', indent: 1 };
      band.border = {
        left: { style: 'thick', color: { argb: argb(color.border) } },
      };
      sheet.getRow(rowNumber).height = 20;
      rowNumber += 1;
    }
    section.rows.forEach((row, index) => {
      const values: Array<string | number | null> = [
        row.rank,
        row.name,
        ...(model.showCountry ? [row.country || null] : []),
        ...(model.showClub ? [row.club || null] : []),
        asNumber(row.sail) ?? (row.sail || null),
        ...(model.showType ? [row.boatType || null] : []),
        ...(model.showTotal ? [row.total] : []),
        ...(model.showNet ? [row.net] : []),
        ...row.cells.map(cellValue),
      ];
      const excelRow = sheet.getRow(rowNumber);
      values.forEach((value, column) => {
        excelRow.getCell(column + 1).value = value;
      });
      excelRow.height = 17;
      styleBodyRow(excelRow, totalColumns, index % 2 === 1);
      excelRow.eachCell({ includeEmpty: true }, (cell, column) => {
        const identity = column <= identityCount;
        cell.font = { name: 'Calibri', size: 10, color: { argb: INK } };
        cell.alignment = {
          vertical: 'middle',
          horizontal: identity && columns[column - 1]?.left ? 'left' : 'center',
        };
      });
      excelRow.getCell(1).font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: NAVY },
      };
      excelRow.getCell(2).font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: INK },
      };
      if (model.showTotal) {
        excelRow.getCell(columns.findIndex((c) => c.key === 'total') + 1).font =
          {
            name: 'Calibri',
            size: 10,
            color: { argb: MUTED },
          };
      }
      if (netIndex >= 0) {
        const net = excelRow.getCell(netIndex + 1);
        net.font = {
          name: 'Calibri',
          size: 10,
          bold: true,
          color: { argb: NAVY },
        };
        net.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE9F4F0' },
        };
      }
      row.cells.forEach((cell, raceIndex) => {
        const target = excelRow.getCell(identityCount + raceIndex + 1);
        if (cell.discarded) {
          target.font = { name: 'Calibri', size: 10, color: { argb: GREY } };
        } else if (cell.kind === 'penalty') {
          target.font = {
            name: 'Calibri',
            size: 10,
            bold: true,
            color: { argb: DANGER },
          };
        } else if (cell.kind === 'redress') {
          target.font = {
            name: 'Calibri',
            size: 10,
            bold: true,
            color: { argb: GREEN },
          };
        }
      });
      rowNumber += 1;
    });
  });

  if (rowNumber === headerRow + 1) {
    sheet.mergeCells(rowNumber, 1, rowNumber, totalColumns);
    sheet.getCell(rowNumber, 1).value = strings.noResults;
    sheet.getCell(rowNumber, 1).font = {
      name: 'Calibri',
      size: 10,
      italic: true,
      color: { argb: MUTED },
    };
    rowNumber += 1;
  }

  // Legend: only the codes that occur, as "CODE  meaning".
  const legend = legendItems(model, common.language);
  if (legend.length > 0) {
    rowNumber += 1;
    sheet.getCell(rowNumber, 1).value = strings.legend.toUpperCase();
    sheet.getCell(rowNumber, 1).font = {
      name: 'Calibri',
      size: 9,
      bold: true,
      color: { argb: INK },
    };
    rowNumber += 1;
    legend.forEach((item) => {
      sheet.getCell(rowNumber, 1).value = item.term;
      sheet.getCell(rowNumber, 1).font = {
        name: 'Calibri',
        size: 9,
        bold: true,
        color: { argb: LEGEND_COLOR[item.kind] },
      };
      sheet.mergeCells(rowNumber, 2, rowNumber, Math.max(3, totalColumns));
      sheet.getCell(rowNumber, 2).value = item.meaning;
      sheet.getCell(rowNumber, 2).font = {
        name: 'Calibri',
        size: 9,
        color: { argb: MUTED },
      };
      rowNumber += 1;
    });
  }

  rowNumber = writeSignatures(sheet, common, rowNumber, totalColumns);
  freezePanes(sheet, 2, headerRow);
  setupPage(sheet, common, context, {
    orientation: resolveResultsOrientation(orientationChoice, model),
    repeatRows: [firstRow, headerRow],
    lastRow: rowNumber,
    lastColumn: totalColumns,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
};

export default buildResultsWorkbook;
