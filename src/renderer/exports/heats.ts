/**
 * Heat lists and scoring sheets: the rounds an event has, the model of the
 * chosen round, and its HTML and Excel documents.
 *
 * A scoring sheet is one heat per page with blank, ruled Place and Notes
 * columns, the heat, the round, the race to be sailed and a line for who
 * scored it and when.
 */
import ExcelJS from 'exceljs';
import escapeHtml from '../utils/escapeHtml';
import { sailorFullName } from '../utils/sailorName';
import { toSubgroupLabel } from '../../shared/subgroups';
import { compareFleetGroups } from '../utils/leaderboardUtils';
import { getHeatRoundFromName } from '../../shared/heatNames';
import {
  LIST_CSS,
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
import {
  INK,
  MUTED,
  NAVY,
  RULE,
  WHITE,
  freezePanes,
  setupPage,
  sheetName,
  styleHeaderRow,
  writeSignatures,
  writeTitleBlock,
} from './excelShared';
import { countsFor, stringsFor } from './i18n';
import type {
  BuiltDocument,
  CommonDocumentOptions,
  DocumentContext,
  ExportLanguage,
  Orientation,
  OrientationChoice,
} from './types';

export interface HeatBoat {
  name?: string | null;
  surname?: string | null;
  country?: string | null;
  sail_number?: number | string | null;
  model?: string | null;
  boat_type?: string | null;
  subgroup?: string | null;
  category?: string | null;
  category_name?: string | null;
}

/** A heat as the heats screen has it, with its boats. */
export interface HeatForExport {
  heat_id: number;
  heat_name: string;
  heat_type: string;
  /** Races already scored in this heat. */
  raceNumber?: number;
  boats: HeatBoat[];
}

export interface HeatsOptions {
  /** Round to print: 'final' or the round number as text ("3"). */
  round: string;
  /** Each heat starts on a new page. */
  onePerPage: boolean;
  /** Scoring sheets: one heat per page with blank Place / Notes columns. */
  scoringSheets: boolean;
}

export const DEFAULT_HEATS_OPTIONS: HeatsOptions = {
  round: '',
  onePerPage: false,
  scoringSheets: false,
};

const FINAL_KEY = 'final';

const isFinalHeat = (heat: Pick<HeatForExport, 'heat_type'>): boolean =>
  heat.heat_type.toLowerCase() === 'final';

/** The round a qualifying heat belongs to: "Heat B3" -> 3 ("Heat A" -> 1). */
const roundOf = (heat: Pick<HeatForExport, 'heat_name'>): number | null => {
  const round = getHeatRoundFromName(heat.heat_name);
  if (round === null) return null;
  return round || 1;
};

export interface RoundChoice {
  key: string;
  /** Round number, or null for the Final Series. */
  round: number | null;
  heatCount: number;
}

/** Every round the event has heats for, earliest first, the final last. */
export const listHeatRounds = (
  heats: ReadonlyArray<HeatForExport>,
): RoundChoice[] => {
  const rounds = new Map<number, number>();
  let finals = 0;
  heats.forEach((heat) => {
    if (isFinalHeat(heat)) {
      finals += 1;
      return;
    }
    const round = roundOf(heat);
    if (round !== null) rounds.set(round, (rounds.get(round) ?? 0) + 1);
  });
  const choices: RoundChoice[] = [...rounds.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, heatCount]) => ({ key: String(round), round, heatCount }));
  if (finals > 0) {
    choices.push({ key: FINAL_KEY, round: null, heatCount: finals });
  }
  return choices;
};

/** The round to start with: the Final Series once started, else the latest. */
export const latestRoundKey = (heats: ReadonlyArray<HeatForExport>): string =>
  listHeatRounds(heats).at(-1)?.key ?? '';

export const roundLabel = (
  choice: Pick<RoundChoice, 'round'>,
  language: ExportLanguage,
): string => {
  const strings = stringsFor(language);
  return choice.round === null
    ? strings.finalSeries
    : `${strings.round} ${choice.round}`;
};

export interface HeatBlockRow {
  number: number;
  sail: string;
  sailor: string;
  country: string;
  subgroup: string;
  model: string;
}

export interface HeatBlock {
  name: string;
  /** "Q3" for the third qualifying race, "F2" for the second final race. */
  race: string;
  rows: HeatBlockRow[];
}

export interface HeatsModel {
  choice: RoundChoice | null;
  heats: HeatBlock[];
  options: HeatsOptions;
}

const finalFleetOf = (name: string): string => name.replace(/^final\s+/i, '');

const compareHeats = (a: HeatForExport, b: HeatForExport): number => {
  if (isFinalHeat(a) && isFinalHeat(b)) {
    return compareFleetGroups(
      finalFleetOf(a.heat_name),
      finalFleetOf(b.heat_name),
    );
  }
  return a.heat_name.localeCompare(b.heat_name, undefined, { numeric: true });
};

const textOf = (value: unknown): string => String(value ?? '').trim();

export const buildHeatsModel = (
  heats: ReadonlyArray<HeatForExport>,
  options: HeatsOptions,
): HeatsModel => {
  const choice =
    listHeatRounds(heats).find((round) => round.key === options.round) ?? null;
  const chosen = choice
    ? heats
        .filter((heat) =>
          choice.round === null
            ? isFinalHeat(heat)
            : !isFinalHeat(heat) && roundOf(heat) === choice.round,
        )
        .sort(compareHeats)
    : [];
  return {
    choice,
    options,
    heats: chosen.map((heat) => {
      const final = isFinalHeat(heat);
      const rows = [...(heat.boats ?? [])]
        .sort((a, b) =>
          textOf(a.sail_number).localeCompare(
            textOf(b.sail_number),
            undefined,
            {
              numeric: true,
            },
          ),
        )
        .map<HeatBlockRow>((boat, index) => ({
          number: index + 1,
          sail: textOf(boat.sail_number),
          sailor: sailorFullName(boat),
          country: textOf(boat.country).toUpperCase(),
          subgroup:
            toSubgroupLabel(
              boat.subgroup || boat.category || boat.category_name,
            ) ?? '',
          model: textOf(boat.model ?? boat.boat_type),
        }));
      return {
        name: heat.heat_name,
        // A qualifying heat races once per round, so its race is its round.
        race: final
          ? `F${(heat.raceNumber ?? 0) + 1}`
          : `Q${roundOf(heat) ?? ''}`,
        rows,
      };
    }),
  };
};

export const heatsTitle = (
  model: HeatsModel,
  common: CommonDocumentOptions,
): string => {
  const typed = common.title.trim();
  if (typed) return typed;
  const strings = stringsFor(common.language);
  const base = model.options.scoringSheets
    ? strings.sheetTitle
    : strings.titleHeats;
  return model.choice
    ? `${base} – ${roundLabel(model.choice, common.language)}`
    : base;
};

const heatSubtitle = (
  heat: HeatBlock,
  model: HeatsModel,
  language: ExportLanguage,
): string => {
  const strings = stringsFor(language);
  const parts = [
    model.choice ? roundLabel(model.choice, language) : '',
    `${strings.raceToSail}: ${heat.race}`,
    countsFor(language).boats(heat.rows.length),
  ];
  return parts.filter(Boolean).join('  ·  ');
};

export const resolveHeatsOrientation = (
  choice: OrientationChoice,
): Orientation => (choice === 'landscape' ? 'landscape' : 'portrait');

/** Heat lists and scoring sheets print one heat per page. */
const pagePerHeat = (model: HeatsModel): boolean =>
  model.options.scoringSheets || model.options.onePerPage;

export const heatsFileBase = (
  model: HeatsModel,
  context: DocumentContext,
): string => {
  const event = safeFileName(context.event.name);
  const what = model.options.scoringSheets ? 'scoring_sheets' : 'heats';
  if (!model.choice) return `${event}_${what}`;
  return model.choice.round === null
    ? `${event}_final_series_${what}`
    : `${event}_${what}_round_${model.choice.round}`;
};

const HEATS_CSS = `
.heat { margin-bottom: 7mm; break-inside: avoid; page-break-inside: avoid; }
.heat.new-page { break-before: page; page-break-before: always; }
.heat-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 6mm;
  padding: 2mm 3mm;
  background: var(--navy);
  color: #fff;
  break-after: avoid;
  page-break-after: avoid;
}
.heat-head h3 { font-size: 15pt; font-weight: 700; line-height: 1.15; }
.heat-sub { margin-top: 0.8mm; font-size: 9pt; opacity: 0.92; }
.heat-event { font-size: 8pt; text-align: right; opacity: 0.85; }
table.list.sheet td, table.list.sheet th { border: 0.25mm solid #8f9bb0; }
table.list.sheet td { height: var(--row-h, 9mm); background: #fff !important; }
table.list.sheet td.c-place { width: 26mm; }
table.list.sheet th.writable { background: #24385c; }
table.list.sheet td.c-sail { font-size: 11pt; }
.scorer {
  display: flex;
  gap: 10mm;
  margin-top: 5mm;
  font-size: 9pt;
  color: var(--muted);
}
.scorer span { flex: 1 1 0; padding-top: 5mm; border-bottom: 0.3mm solid var(--ink); }
.scorer span.short { flex: 0 0 38mm; }
`;

const PLAIN_COLUMNS = ['no', 'sail', 'sailor', 'country', 'subgroup', 'model'];

/** The heat lists as one HTML document. */
export const buildHeatsDocument = (
  model: HeatsModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
  orientationChoice: OrientationChoice,
): BuiltDocument => {
  const orientation = resolveHeatsOrientation(orientationChoice);
  const strings = stringsFor(common.language);
  const title = heatsTitle(model, common);
  const footer = pageFooterTexts(common, context);
  const widthMm = contentWidthMm(orientation);
  const sheets = model.options.scoringSheets;
  const perPage = pagePerHeat(model);
  const columns = sheets
    ? ['no', 'sail', 'sailor', 'country', 'place', 'notes']
    : PLAIN_COLUMNS;

  const headers: Record<string, string> = {
    no: strings.entryNumber,
    sail: strings.sailNumber,
    sailor: strings.sailor,
    country: strings.country,
    subgroup: strings.subgroup,
    model: strings.boatModel,
    place: strings.place,
    notes: strings.notes,
  };
  const widths: Record<string, number | null> = sheets
    ? { no: 10, sail: 22, sailor: null, country: 24, place: 26, notes: 62 }
    : { no: 11, sail: 22, sailor: null, country: 26, subgroup: 26, model: 34 };
  const fixed = columns.reduce((sum, key) => sum + (widths[key] ?? 0), 0);
  const cols = columns
    .map((key) =>
      widths[key] === null
        ? `<col style="width:${Math.max(40, widthMm - fixed)}mm">`
        : `<col style="width:${widths[key]}mm">`,
    )
    .join('');
  const head = columns
    .map(
      (key) =>
        `<th class="left${key === 'place' || key === 'notes' ? ' writable' : ''}">${escapeHtml(headers[key])}</th>`,
    )
    .join('');

  const rowHeightMm = (count: number): number =>
    Math.round(Math.max(7.5, Math.min(11, 190 / (count + 1))) * 10) / 10;

  const renderBlock = (heat: HeatBlock, index: number): string => {
    const rows =
      heat.rows.length === 0
        ? `<tr><td colspan="${columns.length}" class="missing">${escapeHtml(strings.noBoatsInHeat)}</td></tr>`
        : heat.rows
            .map((row) => {
              const values: Record<string, string> = {
                no: String(row.number),
                sail: row.sail,
                sailor: row.sailor,
                country: row.country,
                subgroup: row.subgroup,
                model: row.model,
                place: '',
                notes: '',
              };
              const cells = columns
                .map((key) => {
                  const value = values[key];
                  let inner = escapeHtml(value);
                  if (key === 'country')
                    inner = countryCell(value, context.flags);
                  else if (value === '' && key !== 'place' && key !== 'notes') {
                    inner = '<span class="missing">–</span>';
                  }
                  const titleAttr =
                    key === 'sailor' ? ` title="${escapeHtml(value)}"` : '';
                  return `<td class="c-${key}"${titleAttr}>${inner}</td>`;
                })
                .join('');
              return `<tr>${cells}</tr>`;
            })
            .join('\n');
    const pageBreak = perPage && index > 0 ? ' new-page' : '';
    const rowH = sheets
      ? ` style="--row-h:${rowHeightMm(heat.rows.length)}mm"`
      : '';
    const scorer = sheets
      ? `<div class="scorer"><span>${escapeHtml(strings.scorerTime)}</span><span class="short"></span></div>`
      : '';
    return `<section class="heat${pageBreak}">
<div class="heat-head">
<div><h3>${escapeHtml(heat.name)}</h3><p class="heat-sub">${escapeHtml(heatSubtitle(heat, model, common.language))}</p></div>
<p class="heat-event">${escapeHtml(context.event.name)}</p>
</div>
<table class="list${sheets ? ' sheet' : ''}"${rowH}>
<colgroup>${cols}</colgroup>
<thead><tr>${head}</tr></thead>
<tbody>
${rows}
</tbody>
</table>
${scorer}
</section>`;
  };

  const blocks =
    model.heats.length === 0
      ? `<p class="empty-note">${escapeHtml(strings.noBoatsInHeat)}</p>`
      : model.heats.map(renderBlock).join('\n');

  const body = [
    renderHeader({
      common: { ...common, status: null },
      context,
      title,
      asOf: true,
      asOfLabel: strings.asOf,
      summary: model.choice
        ? `${strings.heatsInRound}: ${model.heats.length} · ${countsFor(common.language).boats(model.heats.reduce((sum, heat) => sum + heat.rows.length, 0))}`
        : '',
    }),
    blocks,
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
      extraCss: `${LIST_CSS}\n${HEATS_CSS}\n${flagStyles(
        context.flags,
        model.heats.flatMap((heat) => heat.rows.map((row) => row.country)),
      )}`,
      context,
    }),
    orientation,
    fileBase: heatsFileBase(model, context),
    footer,
  };
};

/** The heat lists as an Excel workbook: one block per heat on one sheet. */
export const buildHeatsWorkbook = async (
  model: HeatsModel,
  common: CommonDocumentOptions,
  context: DocumentContext,
  orientationChoice: OrientationChoice,
): Promise<Uint8Array> => {
  const strings = stringsFor(common.language);
  const title = heatsTitle(model, common);
  const sheets = model.options.scoringSheets;
  const perPage = pagePerHeat(model);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'IOM Regatta Manager';
  workbook.created = context.generatedAt;
  const sheet = workbook.addWorksheet(sheetName(title));

  const columns = sheets
    ? [
        { key: 'no', header: strings.entryNumber, width: 6 },
        { key: 'sail', header: strings.sailNumber, width: 11 },
        { key: 'sailor', header: strings.sailor, width: 32 },
        { key: 'country', header: strings.country, width: 11 },
        { key: 'place', header: strings.place, width: 14 },
        { key: 'notes', header: strings.notes, width: 40 },
      ]
    : [
        { key: 'no', header: strings.entryNumber, width: 6 },
        { key: 'sail', header: strings.sailNumber, width: 11 },
        { key: 'sailor', header: strings.sailor, width: 32 },
        { key: 'country', header: strings.country, width: 11 },
        { key: 'subgroup', header: strings.subgroup, width: 12 },
        { key: 'model', header: strings.boatModel, width: 18 },
      ];
  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  const firstRow = writeTitleBlock(workbook, sheet, common, context, {
    columns: columns.length,
    title,
    status: null,
    asOf: true,
    asOfLabel: strings.asOf,
  });

  let rowNumber = firstRow;
  model.heats.forEach((heat, heatIndex) => {
    sheet.mergeCells(rowNumber, 1, rowNumber, columns.length);
    const band = sheet.getCell(rowNumber, 1);
    band.value = `${heat.name}   —   ${heatSubtitle(heat, model, common.language)}`;
    band.font = {
      name: 'Calibri',
      size: 12,
      bold: true,
      color: { argb: WHITE },
    };
    band.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    band.alignment = { vertical: 'middle', indent: 1 };
    sheet.getRow(rowNumber).height = 24;
    rowNumber += 1;

    const header = sheet.getRow(rowNumber);
    columns.forEach((column, index) => {
      header.getCell(index + 1).value = column.header;
    });
    styleHeaderRow(header, columns.length, 'FF24385C', columns.length);
    rowNumber += 1;

    heat.rows.forEach((row) => {
      const excelRow = sheet.getRow(rowNumber);
      const values: Record<string, string | number | null> = {
        no: row.number,
        sail: /^\d+$/.test(row.sail) ? Number(row.sail) : row.sail || null,
        sailor: row.sailor || null,
        country: row.country || null,
        subgroup: row.subgroup || null,
        model: row.model || null,
        place: null,
        notes: null,
      };
      columns.forEach((column, index) => {
        const cell = excelRow.getCell(index + 1);
        cell.value = values[column.key];
        cell.font = {
          name: 'Calibri',
          size: 10,
          bold: column.key === 'sail' || column.key === 'sailor',
          color: {
            argb:
              column.key === 'subgroup' || column.key === 'model' ? MUTED : INK,
          },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
        cell.border = sheets
          ? {
              top: { style: 'thin', color: { argb: RULE } },
              bottom: { style: 'thin', color: { argb: RULE } },
              left: { style: 'thin', color: { argb: RULE } },
              right: { style: 'thin', color: { argb: RULE } },
            }
          : { bottom: { style: 'hair', color: { argb: RULE } } };
      });
      excelRow.height = sheets ? 26 : 17;
      rowNumber += 1;
    });

    if (sheets) {
      rowNumber += 1;
      sheet.mergeCells(rowNumber, 1, rowNumber, columns.length);
      const scorer = sheet.getCell(rowNumber, 1);
      scorer.value = `${strings.scorerTime}:  ____________________________   ______________`;
      scorer.font = { name: 'Calibri', size: 10, color: { argb: MUTED } };
      rowNumber += 1;
    }
    // One empty row between heats; a page break after it when one per page.
    rowNumber += 1;
    if (perPage && heatIndex < model.heats.length - 1) {
      sheet.getRow(rowNumber - 1).addPageBreak();
    }
  });

  if (model.heats.length === 0) {
    sheet.mergeCells(rowNumber, 1, rowNumber, columns.length);
    sheet.getCell(rowNumber, 1).value = strings.noBoatsInHeat;
    rowNumber += 1;
  }

  rowNumber = writeSignatures(sheet, common, rowNumber, columns.length);
  freezePanes(sheet, 0, 0);
  setupPage(sheet, common, context, {
    orientation: resolveHeatsOrientation(orientationChoice),
    // Each heat has its own header rows; the title block is not repeated.
    repeatRows: null,
    lastRow: rowNumber,
    lastColumn: columns.length,
  });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
};
