import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { jsPDF as JsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import registerPdfUnicodeFont from './registerPdfUnicodeFont';

export default async function printNewHeats(event, heats, format = 'excel') {
  if (!Array.isArray(heats) || heats.length === 0) {
    return;
  }

  const eventName = event?.event_name || 'event';
  const safeEventName = String(eventName)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();

  const isFinalSeriesView =
    heats.length > 0 && heats.every((heat) => heat.heat_type === 'Final');

  const visibleHeatNumbers = [
    ...new Set(
      heats
        .map((heat) => {
          const match = String(heat.heat_name || '').match(/(\d+)\s*$/);
          return match ? Number(match[1]) : null;
        })
        .filter((num) => Number.isInteger(num)),
    ),
  ].sort((a, b) => a - b);

  const heatSuffix =
    visibleHeatNumbers.length > 0
      ? visibleHeatNumbers.map((num) => `heat_${num}`).join('_')
      : 'visible_heats';

  const exportBaseName = isFinalSeriesView
    ? `${safeEventName}_final_series_heats`
    : `${safeEventName}_${heatSuffix}`;

  const getSubgroup = (boat) =>
    boat?.subgroup || boat?.category || boat?.category_name || 'N/A';

  const getBoatModel = (boat) => boat?.model || boat?.boat_type || 'N/A';

  // Ensure boats are present for each visible heat before exporting.
  await Promise.all(
    heats.map(async (heat) => {
      if (!Array.isArray(heat.boats) || heat.boats.length === 0) {
        try {
          const boats = await window.electron.sqlite.heatRaceDB.readBoatsByHeat(
            heat.heat_id,
          );
          heat.boats = boats;
        } catch (_) {
          heat.boats = [];
        }
      }
    }),
  );

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('New Heats');

    worksheet.columns = [
      { key: 'col1', width: 30 },
      { key: 'col2', width: 14 },
      { key: 'col3', width: 16 },
      { key: 'col4', width: 14 },
      { key: 'col5', width: 20 },
    ];

    heats.forEach((heat) => {
      const headerRow = worksheet.addRow([`Heat: ${heat.heat_name}`]);
      headerRow.font = { bold: true };
      worksheet.mergeCells(`A${headerRow.number}:E${headerRow.number}`);

      const subHeaderRow = worksheet.addRow([
        'Sailor Name',
        'Country',
        'Boat Number',
        'Subgroup',
        'Boat Model',
      ]);
      subHeaderRow.font = { bold: true };

      if (Array.isArray(heat.boats) && heat.boats.length > 0) {
        heat.boats.forEach((boat) => {
          const sailorName = `${boat.name} ${boat.surname}`;
          worksheet.addRow([
            sailorName,
            boat.country || 'N/A',
            boat.sail_number || 'N/A',
            getSubgroup(boat),
            getBoatModel(boat),
          ]);
        });
      } else {
        worksheet.addRow(['No boats available', '', '', '', '']);
      }

      worksheet.addRow([]);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    saveAs(blob, `${exportBaseName}.xlsx`);
    return;
  }

  if (format === 'pdf') {
    const doc = new JsPDF({ orientation: 'landscape' });
    await registerPdfUnicodeFont(doc);
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont('DejaVuSans', 'bold');
    const title = 'New Heats';
    const titleX = (pageWidth - doc.getTextWidth(title)) / 2;
    doc.text(title, titleX, 16);
    doc.setFont('DejaVuSans', 'normal');

    let finalY = 22;
    heats.forEach((heat) => {
      doc.setFontSize(11);
      doc.setFont('DejaVuSans', 'bold');
      const heatTitle = `Heat: ${heat.heat_name}`;
      const heatTitleX = (pageWidth - doc.getTextWidth(heatTitle)) / 2;
      doc.text(heatTitle, heatTitleX, finalY);
      doc.setFont('DejaVuSans', 'normal');

      const header = [
        'Sailor Name',
        'Country',
        'Boat Number',
        'Subgroup',
        'Boat Model',
      ];
      const body = (heat.boats || []).map((boat) => [
        `${boat.name || ''} ${boat.surname || ''}`.trim() || 'N/A',
        boat.country || 'N/A',
        boat.sail_number || 'N/A',
        getSubgroup(boat),
        getBoatModel(boat),
      ]);

      const tableWidth = 55 + 20 + 24 + 22 + 48;
      const tableLeft = Math.max(14, (pageWidth - tableWidth) / 2);

      autoTable(doc, {
        head: [header],
        body,
        startY: finalY + 6,
        tableWidth,
        margin: { left: tableLeft },
        styles: { fontSize: 7, cellPadding: 2, font: 'DejaVuSans' },
        headStyles: {
          fillColor: [27, 39, 64],
          font: 'DejaVuSans',
          fontStyle: 'bold',
        },
        alternateRowStyles: { fillColor: [240, 244, 248] },
        columnStyles: {
          0: { cellWidth: 55 },
          1: { cellWidth: 20 },
          2: { cellWidth: 24 },
          3: { cellWidth: 22 },
          4: { cellWidth: 48 },
        },
        didDrawPage: (data) => {
          if (data.cursor) {
            finalY = data.cursor.y + 8;
          }
        },
      });
    });

    doc.save(`${exportBaseName}.pdf`);
    return;
  }

  if (format === 'html') {
    let html = `<html><head><title>${eventName} New Heats</title>
    <style>
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
    </style>
    </head><body>`;
    html += '<h1>New Heats</h1>';

    heats.forEach((heat) => {
      html += `<h2>Heat: ${heat.heat_name}</h2>`;
      html += `<table><thead><tr>
        <th>Sailor Name</th>
        <th>Country</th>
        <th>Boat Number</th>
        <th>Subgroup</th>
        <th>Boat Model</th>
        </tr></thead><tbody>`;
      (heat.boats || []).forEach((boat) => {
        html += `<tr>
          <td>${boat.name} ${boat.surname}</td>
          <td>${boat.country || 'N/A'}</td>
          <td>${boat.sail_number || 'N/A'}</td>
          <td>${getSubgroup(boat)}</td>
          <td>${getBoatModel(boat)}</td>
          </tr>`;
      });
      html += '</tbody></table>';
    });

    html += '</body></html>';

    const blob = new Blob([html], { type: 'text/html' });
    saveAs(blob, `${exportBaseName}.html`);
  }
}
