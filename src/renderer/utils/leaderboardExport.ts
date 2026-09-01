/**
 * Leaderboard export: turns finished leaderboard data into a file the user can
 * save, in six formats.
 *
 * This lived inside useLeaderboard as ~440 lines that read hook state directly.
 * Nothing here depends on edit-mode state, React, or the render cycle — it
 * reads finished data and formats it — so it is plain functions taking an
 * explicit context, which also makes every format testable without mounting a
 * component.
 */
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { jsPDF as JsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import registerPdfUnicodeFont from './registerPdfUnicodeFont';
import {
  compareFleetGroups,
  escapeCsvCell,
  getRaceCellDisplay,
} from './leaderboardUtils';
import escapeHtml from './escapeHtml';
import { reportError, reportInfo } from './userFeedback';
import { eventDB } from '../api/db';
import type { LeaderboardEntry } from '../types';

type ExportCell = string | number;

interface ExportSection {
  title: string | null;
  rows: ExportCell[][];
}

export interface ExportData {
  header: string[];
  sections: ExportSection[];
}

/** Everything the exporters need from the hook, as plain data. */
export interface LeaderboardExportContext {
  eventId: number;
  finalSeriesStarted: boolean;
  leaderboard: LeaderboardEntry[];
  eventLeaderboard: LeaderboardEntry[];
}

export const sanitizeFilenamePart = (
  value: unknown,
  fallback = 'event',
): string => {
  const raw = String(value ?? '').trim();
  const safe = raw.replace(/[<>:"/\\|?*]+/g, '_').replace(/\s+/g, '_');
  return safe || fallback;
};

export const getExportMeta = async (ctx: LeaderboardExportContext) => {
  const { eventId, finalSeriesStarted, leaderboard, eventLeaderboard } = ctx;
  let eventName = `event_${eventId}`;
  try {
    const events = await eventDB.readAllEvents();
    if (Array.isArray(events)) {
      const match = events.find(
        (event) => String(event.event_id) === String(eventId),
      );
      if (match?.event_name) {
        eventName = match.event_name;
      }
    }
  } catch (_) {
    // keep fallback name
  }

  const raceNumber = finalSeriesStarted
    ? (leaderboard?.[0]?.races?.length ?? 0)
    : (eventLeaderboard?.[0]?.races?.length ?? 0);

  const safeEventName = sanitizeFilenamePart(eventName, `event_${eventId}`);
  const seriesLabel = finalSeriesStarted ? 'final' : 'race';
  return {
    safeEventName,
    raceNumber,
    seriesLabel,
  };
};

export const toPdfText = (value: unknown): string => {
  const source = String(value ?? '').normalize('NFC');

  // Repair common mojibake patterns (UTF-8 bytes read as latin1/cp1252).
  if (!/[ÃÅÄÐÆØ]/.test(source)) {
    return source;
  }

  try {
    const bytes = Uint8Array.from(
      Array.from(source).map((char) => char.charCodeAt(0) % 256),
    );
    const decoded = new TextDecoder('utf-8').decode(bytes).normalize('NFC');

    const hasReplacementChar = decoded.includes('\uFFFD');
    const gainedDiacritics = /[čćđšžČĆĐŠŽ]/.test(decoded);
    if (!hasReplacementChar && gainedDiacritics) {
      return decoded;
    }
  } catch (_) {
    // Keep source text when repair cannot be safely applied.
  }

  return source;
};
// ─── Export helpers ──────────────────────────────────────────────────────────

/**
 * Builds a flat export structure:
 *   { header: string[], sections: Array<{ title: string|null, rows: any[][] }> }
 *
 * When the final series has started the layout mirrors FinalFleetTable:
 *   Rank | Name | Country | Sail# | Type | Gross | Overall | Q1…Qn | F1…Fn
 * When qualifying only the layout mirrors QualifyingTable:
 *   Rank | Name | Country | Sail# | Type | R1…Rn | Total
 */
// Format a race value the same way ScoreCell / getRaceCellDisplay does.
const formatCell = (race: string, status: string | undefined): string =>
  getRaceCellDisplay(race, status || 'FINISHED').displayText;

export const buildExportData = (ctx: LeaderboardExportContext): ExportData => {
  const { finalSeriesStarted, leaderboard, eventLeaderboard } = ctx;
  const parseScore = (v: unknown): number => {
    const n = parseFloat(String(v ?? '').replace(/[()]/g, ''));
    return Number.isNaN(n) ? 0 : n;
  };

  if (!finalSeriesStarted) {
    // ── Qualifying-only view ────────────────────────────────────────────────
    const raceCount = eventLeaderboard[0]?.races?.length ?? 0;
    const header = [
      'Rank',
      'Name',
      'Country',
      'Sail #',
      'Type',
      'Gross',
      'Overall',
      ...Array.from({ length: raceCount }, (_, i) => `Q${i + 1}`),
    ];
    const rows = (eventLeaderboard ?? []).map((e, i) => {
      const grossTotal = (e.race_points ?? e.races ?? []).reduce(
        (s, r) => s + parseScore(r),
        0,
      );
      const overall = e.computed_total ?? e.total_points_event;
      return [
        e.place ?? i + 1,
        `${e.name} ${e.surname}`,
        e.country ?? '',
        e.boat_number ?? '',
        e.boat_type ?? '',
        grossTotal > 0 ? grossTotal : '–',
        overall != null && !Number.isNaN(overall) ? overall : '–',
        ...(e.races ?? []).map((r, ri) => formatCell(r, e.race_statuses?.[ri])),
      ];
    });
    return { header, sections: [{ title: null, rows }] };
  }

  // ── Final-series view ───────────────────────────────────────────────────
  // Exports always read the SAVED leaderboard, never the edit-mode draft —
  // a mid-edit export must not leak unsaved values (and the qualifying
  // export above already behaves this way).
  const qualRaceCount = eventLeaderboard[0]?.races?.length ?? 0;
  const finalRaceCount = (leaderboard ?? [])[0]?.races?.length ?? 0;

  const header = [
    'Rank',
    'Name',
    'Country',
    'Sail #',
    'Type',
    'Gross',
    'Overall',
    ...Array.from({ length: qualRaceCount }, (_, i) => `Q${i + 1}`),
    ...Array.from({ length: finalRaceCount }, (_, i) => `F${i + 1}`),
  ];

  const grpMap = (leaderboard ?? []).reduce(
    (acc, entry) => {
      const g = entry.placement_group || 'General';
      if (!acc[g]) acc[g] = [];
      acc[g].push(entry);
      return acc;
    },
    {} as Record<string, LeaderboardEntry[]>,
  );
  const grpOrder = Object.keys(grpMap).sort(compareFleetGroups);

  const sections = grpOrder.map((g) => ({
    title: `${g} Fleet`,
    rows: (grpMap[g] ?? []).map((entry, i) => {
      const qualEntry = eventLeaderboard.find(
        (e) => e.boat_id === entry.boat_id,
      );
      const qualRaces = qualEntry?.races ?? [];
      const finalRaces = entry.races ?? [];
      const qualRacePoints = qualEntry?.race_points ?? qualRaces;
      const finalRacePoints = entry.race_points ?? finalRaces;

      const qualGross = qualRacePoints.reduce((s, r) => s + parseScore(r), 0);
      const finalGross = finalRacePoints.reduce((s, r) => s + parseScore(r), 0);
      const gross = qualGross + finalGross;

      const overall =
        entry.total_points_combined != null &&
        !Number.isNaN(entry.total_points_combined)
          ? entry.total_points_combined
          : '–';

      return [
        entry.overall_rank ?? i + 1,
        `${entry.name} ${entry.surname}`,
        entry.country ?? '',
        entry.boat_number ?? '',
        entry.boat_type ?? '',
        gross > 0 ? gross : '–',
        overall,
        ...qualRaces.map((r, ri) =>
          formatCell(r, qualEntry?.race_statuses?.[ri]),
        ),
        ...finalRaces.map((r, ri) => formatCell(r, entry.race_statuses?.[ri])),
      ];
    }),
  }));

  return { header, sections };
};

// ─── Excel export ────────────────────────────────────────────────────────────

const exportToExcel = async (ctx: LeaderboardExportContext) => {
  const { header, sections } = buildExportData(ctx);
  const { safeEventName, raceNumber, seriesLabel } = await getExportMeta(ctx);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Leaderboard');
  worksheet.addRow(header);
  sections.forEach(({ title, rows }) => {
    if (title) worksheet.addRow([title]);
    rows.forEach((r) => worksheet.addRow(r));
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  saveAs(
    blob,
    `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.xlsx`,
  );
};

// ─── CSV export ──────────────────────────────────────────────────────────────

const exportToCSV = async (ctx: LeaderboardExportContext) => {
  const { header, sections } = buildExportData(ctx);
  const { safeEventName, raceNumber, seriesLabel } = await getExportMeta(ctx);
  // LB-6 (security): escapeCsvCell (leaderboardUtils) neutralises CSV formula
  // injection (= + - @) and quotes comma/quote/newline/CR so a sail number or
  // name cannot execute in Excel/Sheets or break the row/column grid.
  const lines = [header.map(escapeCsvCell).join(',')];
  sections.forEach(({ title, rows }) => {
    if (title) lines.push(escapeCsvCell(title));
    rows.forEach((r) => lines.push(r.map(escapeCsvCell).join(',')));
  });
  const blob = new Blob([lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  saveAs(blob, `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.csv`);
};

// ─── TXT export ──────────────────────────────────────────────────────────────

const exportToTXT = async (ctx: LeaderboardExportContext) => {
  const { header, sections } = buildExportData(ctx);
  const { safeEventName, raceNumber, seriesLabel } = await getExportMeta(ctx);
  const allRows = sections.flatMap(({ rows }) => rows);
  const colWidths = header.map((h, ci) =>
    Math.max(
      String(h).length,
      ...allRows.map((r) => String(r[ci] ?? '').length),
    ),
  );
  const pad = (v: unknown, w: number): string => String(v ?? '').padEnd(w);
  const divider = colWidths.map((w) => '-'.repeat(w)).join('-+-');
  const fmtRow = (r: ExportCell[]): string =>
    r.map((v, i) => pad(v, colWidths[i])).join(' | ');

  const lines = [fmtRow(header), divider];
  sections.forEach(({ title, rows }) => {
    if (title) {
      lines.push('');
      lines.push(`=== ${title} ===`);
      lines.push(divider);
    }
    rows.forEach((r) => lines.push(fmtRow(r)));
  });
  const blob = new Blob([lines.join('\n')], {
    type: 'text/plain;charset=utf-8;',
  });
  saveAs(blob, `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.txt`);
};

// ─── Markdown export ─────────────────────────────────────────────────────────

const exportToMarkdown = async (ctx: LeaderboardExportContext) => {
  const { header, sections } = buildExportData(ctx);
  const { safeEventName, raceNumber, seriesLabel } = await getExportMeta(ctx);
  const allRows = sections.flatMap(({ rows }) => rows);
  const colWidths = header.map((h, ci) =>
    Math.max(
      String(h).length,
      ...allRows.map((r) => String(r[ci] ?? '').length),
    ),
  );
  const pad = (v: unknown, w: number): string => String(v ?? '').padEnd(w);
  const fmtRow = (r: ExportCell[]): string =>
    `| ${r.map((v, i) => pad(v, colWidths[i])).join(' | ')} |`;
  const separator = `| ${colWidths.map((w) => '-'.repeat(w)).join(' | ')} |`;

  const lines = [fmtRow(header), separator];
  sections.forEach(({ title, rows }) => {
    if (title) {
      lines.push('');
      lines.push(`### ${title}`);
      lines.push('');
      lines.push(fmtRow(header));
      lines.push(separator);
    }
    rows.forEach((r) => lines.push(fmtRow(r)));
  });
  const blob = new Blob([lines.join('\n')], {
    type: 'text/markdown;charset=utf-8;',
  });
  saveAs(blob, `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.md`);
};

// ─── HTML export ─────────────────────────────────────────────────────────────

const exportToHTML = async (ctx: LeaderboardExportContext) => {
  const { header, sections } = buildExportData(ctx);
  const { safeEventName, raceNumber, seriesLabel } = await getExportMeta(ctx);
  const thCells = header
    .map((h) => `<th scope="col">${escapeHtml(h)}</th>`)
    .join('');
  let tableBody = '';
  sections.forEach(({ title, rows }) => {
    if (title) {
      tableBody += `<tr><td colspan="${header.length}" class="group-header">${escapeHtml(title)}</td></tr>`;
    }
    rows.forEach((r) => {
      tableBody += `<tr>${r.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`;
    });
  });
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<title>Leaderboard</title>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #1b2740; }
  h1 { font-size: 1.4rem; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #dde3ea; padding: 6px 10px; text-align: left; font-size: 0.85rem; }
  th { background: #1b2740; color: #fff; }
  tr:nth-child(even) { background: #f0f4f8; }
  .group-header { background: #2a9d8f; color: #fff; font-weight: 700; font-size: 0.9rem; }
</style>
</head>
<body>
<h1>Leaderboard</h1>
<table>
  <thead><tr>${thCells}</tr></thead>
  <tbody>${tableBody}</tbody>
</table>
</body>
</html>`;
  // Prefix with UTF-8 BOM so Windows apps consistently decode diacritics.
  const blob = new Blob(['\uFEFF', html], {
    type: 'text/html;charset=utf-8;',
  });
  saveAs(
    blob,
    `${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.html`,
  );
};

// ─── PDF export ──────────────────────────────────────────────────────────────

const exportToPDF = async (ctx: LeaderboardExportContext) => {
  const { header, sections } = buildExportData(ctx);
  const { safeEventName, raceNumber, seriesLabel } = await getExportMeta(ctx);
  const doc = new JsPDF({ orientation: 'landscape' });
  await registerPdfUnicodeFont(doc);
  doc.setFontSize(14);
  doc.setFont('DejaVuSans', 'bold');
  doc.text('Leaderboard', 14, 16);
  doc.setFont('DejaVuSans', 'normal');

  let startY = 22;
  sections.forEach(({ title, rows }) => {
    if (title) {
      doc.setFontSize(11);
      doc.setFont('DejaVuSans', 'bold');
      doc.text(title, 14, startY + 4);
      doc.setFont('DejaVuSans', 'normal');
      startY += 8;
    }
    autoTable(doc, {
      head: [header.map((cell) => toPdfText(cell))],
      body: rows.map((r) => r.map((v) => toPdfText(v))),
      startY,
      styles: { fontSize: 7, cellPadding: 2, font: 'DejaVuSans' },
      headStyles: {
        fillColor: [27, 39, 64],
        font: 'DejaVuSans',
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: [240, 244, 248] },
      didDrawPage: (data) => {
        if (data.cursor) {
          startY = data.cursor.y + 6;
        }
      },
    });
    // jspdf-autotable attaches `lastAutoTable` to the jsPDF instance; it is
    // always set immediately after an autoTable() call.
    const docWithTable = doc as JsPDF & {
      lastAutoTable?: { finalY: number };
    };
    startY = (docWithTable.lastAutoTable?.finalY ?? startY) + 10;
  });
  doc.save(`${safeEventName}_${seriesLabel}_${raceNumber}_leaderboard.pdf`);
};

// ─── Unified export dispatcher ───────────────────────────────────────────────

const EXPORT_LABELS: Record<string, string> = {
  excel: 'Excel',
  csv: 'CSV',
  txt: 'Plain text',
  md: 'Markdown',
  html: 'HTML',
  pdf: 'PDF',
};

const runExport = (
  format: string,
  ctx: LeaderboardExportContext,
): Promise<void> => {
  switch (format) {
    case 'excel':
      return exportToExcel(ctx);
    case 'csv':
      return exportToCSV(ctx);
    case 'txt':
      return exportToTXT(ctx);
    case 'md':
      return exportToMarkdown(ctx);
    case 'html':
      return exportToHTML(ctx);
    case 'pdf':
      return exportToPDF(ctx);
    default:
      return exportToExcel(ctx);
  }
};

export const exportLeaderboard = async (
  format: string,
  ctx: LeaderboardExportContext,
) => {
  const label = EXPORT_LABELS[format] ?? 'Excel';
  try {
    await runExport(format, ctx);
    reportInfo(`Leaderboard exported as ${label}.`, 'Export complete');
  } catch (error) {
    // A single format can fail (e.g. PDF font embedding) while others work, so
    // point the user at an alternative rather than a dead end.
    reportError(
      `Could not export the leaderboard as ${label}. Try a different format (Excel or CSV usually works).`,
      error,
    );
  }
};
