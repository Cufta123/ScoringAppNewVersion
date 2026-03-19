import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { jsPDF as JsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const getLatestHeats = (heats) => {
  const latestHeatsMap = heats.reduce((acc, heat) => {
    const match = heat.heat_name.match(/Heat ([A-Z]+)(\d*)/);
    if (match) {
      const [, base, suffix] = match;
      const numericSuffix = suffix ? parseInt(suffix, 10) : 0;
      if (!acc[base] || numericSuffix > acc[base].suffix) {
        acc[base] = { suffix: numericSuffix, heat };
      }
    }
    return acc;
  }, {});

  import ExcelJS from 'exceljs';
  import { saveAs } from 'file-saver';
  import { jsPDF as JsPDF } from 'jspdf';
  import autoTable from 'jspdf-autotable';

  const getLatestHeats = (heats) => {
    const latestHeatsMap = heats.reduce((acc, heat) => {
      const match = heat.heat_name.match(/Heat ([A-Z]+)(\d*)/);
      if (match) {
        const [, base, suffix] = match;
        const numericSuffix = suffix ? parseInt(suffix, 10) : 0;
        if (!acc[base] || numericSuffix > acc[base].suffix) {
          acc[base] = { suffix: numericSuffix, heat };
        }
      }
      return acc;
    }, {});

    return Object.values(latestHeatsMap).map((entry) => entry.heat);
  };

  export default async function printNewHeats(event, heats, format = 'excel') {
    if (!Array.isArray(heats) || heats.length === 0) {
      return;
    }

    const eventName = event?.event_name || 'event';
    const latestHeats = getLatestHeats(heats);

    await Promise.all(
      latestHeats.map(async (heat) => {
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

      latestHeats.forEach((heat) => {
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
      const heatNumber =
        latestHeats.length > 0
          ? (latestHeats[0].heat_name.match(/Heat [A-Z]*(\d+)$/) || [
              null,
              'unknown',
            ])[1]
          : 'unknown';
      saveAs(blob, `${eventName}_heat_${heatNumber}.xlsx`);
      return;
    }

    if (format === 'pdf') {
      const doc = new JsPDF();
      doc.setFontSize(16);
      doc.text('New Heats', 14, 10);

      let finalY = 20;
      latestHeats.forEach((heat) => {
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

      doc.save(`${eventName}_new_heats.pdf`);
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

      latestHeats.forEach((heat) => {
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
      saveAs(blob, `${eventName}_new_heats.html`);
    }
  }
