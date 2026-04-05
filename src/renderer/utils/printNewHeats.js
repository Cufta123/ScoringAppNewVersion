import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { jsPDF as JsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

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
      { key: 'col2', width: 20 },
      { key: 'col3', width: 20 },
    ];

    heats.forEach((heat) => {
      const headerRow = worksheet.addRow([`Heat: ${heat.heat_name}`]);
      headerRow.font = { bold: true };
      worksheet.mergeCells(`A${headerRow.number}:C${headerRow.number}`);

      const subHeaderRow = worksheet.addRow([
        'Sailor Name',
        'Country',
        'Boat Number',
      ]);
      subHeaderRow.font = { bold: true };

      if (Array.isArray(heat.boats) && heat.boats.length > 0) {
        heat.boats.forEach((boat) => {
          const sailorName = `${boat.name} ${boat.surname}`;
          worksheet.addRow([sailorName, boat.country, boat.sail_number]);
        });
      } else {
        worksheet.addRow(['No boats available', '', '']);
      }

      worksheet.addRow([]);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    saveAs(blob, `${exportBaseName}.xlsx`);
    return;
  }

  if (format === 'pdf') {
    const doc = new JsPDF();
    doc.setFontSize(16);
    doc.text('New Heats', 14, 10);

    let finalY = 20;
    heats.forEach((heat) => {
      doc.setFontSize(14);
      doc.text(`Heat: ${heat.heat_name}`, 14, finalY);

      const header = ['Sailor Name', 'Country', 'Boat Number'];
      const body = (heat.boats || []).map((boat) => [
        `${boat.name} ${boat.surname}`,
        boat.country,
        boat.sail_number,
      ]);

      autoTable(doc, {
        head: [header],
        body,
        theme: 'grid',
        startY: finalY + 10,
        didDrawPage: (data) => {
          if (data.cursor) {
            finalY = data.cursor.y + 10;
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
        </tr></thead><tbody>`;
      (heat.boats || []).forEach((boat) => {
        html += `<tr>
          <td>${boat.name} ${boat.surname}</td>
          <td>${boat.country}</td>
          <td>${boat.sail_number}</td>
          </tr>`;
      });
      html += '</tbody></table>';
    });

    html += '</body></html>';

    const blob = new Blob([html], { type: 'text/html' });
    saveAs(blob, `${exportBaseName}.html`);
  }
}
