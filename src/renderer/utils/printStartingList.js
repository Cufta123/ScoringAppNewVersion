import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { jsPDF as JsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export default async function printStartingList(
  event,
  sailors,
  format = 'excel',
) {
  if (!Array.isArray(sailors) || sailors.length === 0) {
    return;
  }

  const eventName = event?.event_name || 'event';

  const sortedSailors = [...sailors].sort((a, b) => {
    const countryA = (a.country || a.boat_country || '').toLowerCase();
    const countryB = (b.country || b.boat_country || '').toLowerCase();
    if (countryA < countryB) return -1;
    if (countryA > countryB) return 1;

    const clubA = (a.club || a.club_name || '').toLowerCase();
    const clubB = (b.club || b.club_name || '').toLowerCase();
    if (clubA < clubB) return -1;
    if (clubA > clubB) return 1;

    const boatNumA = a.sail_number ? a.sail_number.toString() : '';
    const boatNumB = b.sail_number ? b.sail_number.toString() : '';
    return boatNumA.localeCompare(boatNumB, undefined, { numeric: true });
  });

  if (format === 'excel') {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Starting List');

    worksheet.columns = [
      { key: 'name', header: 'Name', width: 20 },
      { key: 'surname', header: 'Surname', width: 20 },
      { key: 'country', header: 'Country', width: 20 },
      { key: 'sail_number', header: 'Boat Number', width: 15 },
      { key: 'club', header: 'Club', width: 20 },
    ];

    sortedSailors.forEach((sailor) => {
      worksheet.addRow({
        name: sailor.name || 'N/A',
        surname: sailor.surname || 'N/A',
        country: sailor.country || sailor.boat_country || 'N/A',
        sail_number: sailor.sail_number || 'N/A',
        club: sailor.club || sailor.club_name || 'N/A',
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, `${eventName}_starting_list.xlsx`);
    return;
  }

  if (format === 'pdf') {
    const doc = new JsPDF();
    doc.setFontSize(16);
    doc.text('Starting List', 14, 10);

    const header = ['Name', 'Surname', 'Country', 'Boat Number', 'Club'];
    const body = sortedSailors.map((sailor) => [
      sailor.name || 'N/A',
      sailor.surname || 'N/A',
      sailor.country || sailor.boat_country || 'N/A',
      sailor.sail_number || 'N/A',
      sailor.club || sailor.club_name || 'N/A',
    ]);

    autoTable(doc, {
      head: [header],
      body,
      theme: 'grid',
    });

    doc.save(`${eventName}_starting_list.pdf`);
    return;
  }

  if (format === 'html') {
    let html = `<html><head><title>${eventName} Starting List</title>
    <style>
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
      th { background-color: #f2f2f2; }
    </style>
    </head><body>`;
    html += '<h1>Starting List</h1>';
    html += `<table><thead><tr>
      <th>Name</th>
      <th>Surname</th>
      <th>Country</th>
      <th>Boat Number</th>
      <th>Club</th>
      </tr></thead><tbody>`;
    sortedSailors.forEach((sailor) => {
      html += `<tr>
        <td>${sailor.name || 'N/A'}</td>
        <td>${sailor.surname || 'N/A'}</td>
        <td>${sailor.country || sailor.boat_country || 'N/A'}</td>
        <td>${sailor.sail_number || 'N/A'}</td>
        <td>${sailor.club || sailor.club_name || 'N/A'}</td>
        </tr>`;
    });
    html += '</tbody></table></body></html>';

    const blob = new Blob([html], { type: 'text/html' });
    saveAs(blob, `${eventName}_starting_list.html`);
  }
}
