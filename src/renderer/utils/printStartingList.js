import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { jsPDF as JsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import registerPdfUnicodeFont from './registerPdfUnicodeFont';

export default async function printStartingList(
  event,
  sailors,
  format = 'excel',
) {
  if (!Array.isArray(sailors) || sailors.length === 0) {
    return;
  }

  const eventName = event?.event_name || 'event';

  const getSubgroup = (sailor) =>
    sailor?.subgroup || sailor?.category || sailor?.category_name || 'N/A';

  const getBoatModel = (sailor) => sailor?.model || sailor?.boat_type || 'N/A';

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
      { key: 'country', header: 'Country', width: 14 },
      { key: 'sail_number', header: 'Boat Number', width: 15 },
      { key: 'subgroup', header: 'Subgroup', width: 14 },
      { key: 'model', header: 'Boat Model', width: 20 },
      { key: 'club', header: 'Club', width: 20 },
    ];

    sortedSailors.forEach((sailor) => {
      worksheet.addRow({
        name: sailor.name || 'N/A',
        surname: sailor.surname || 'N/A',
        country: sailor.country || sailor.boat_country || 'N/A',
        sail_number: sailor.sail_number || 'N/A',
        subgroup: getSubgroup(sailor),
        model: getBoatModel(sailor),
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
    const doc = new JsPDF({ orientation: 'landscape' });
    await registerPdfUnicodeFont(doc);
    const pageWidth = doc.internal.pageSize.getWidth();
    doc.setFontSize(14);
    doc.setFont('DejaVuSans', 'bold');
    const title = 'Starting List';
    const titleX = (pageWidth - doc.getTextWidth(title)) / 2;
    doc.text(title, titleX, 16);
    doc.setFont('DejaVuSans', 'normal');

    const header = [
      'Name',
      'Surname',
      'Country',
      'Boat Number',
      'Subgroup',
      'Boat Model',
      'Club',
    ];
    const body = sortedSailors.map((sailor) => [
      sailor.name || 'N/A',
      sailor.surname || 'N/A',
      sailor.country || sailor.boat_country || 'N/A',
      sailor.sail_number || 'N/A',
      getSubgroup(sailor),
      getBoatModel(sailor),
      sailor.club || sailor.club_name || 'N/A',
    ]);

    const tableWidth = 24 + 28 + 18 + 20 + 20 + 30 + 24;
    const tableLeft = Math.max(14, (pageWidth - tableWidth) / 2);

    autoTable(doc, {
      head: [header],
      body,
      startY: 22,
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
        0: { cellWidth: 24 },
        1: { cellWidth: 28 },
        2: { cellWidth: 18 },
        3: { cellWidth: 20 },
        4: { cellWidth: 20 },
        5: { cellWidth: 30 },
        6: { cellWidth: 24 },
      },
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
      <th>Subgroup</th>
      <th>Boat Model</th>
      <th>Club</th>
      </tr></thead><tbody>`;
    sortedSailors.forEach((sailor) => {
      html += `<tr>
        <td>${sailor.name || 'N/A'}</td>
        <td>${sailor.surname || 'N/A'}</td>
        <td>${sailor.country || sailor.boat_country || 'N/A'}</td>
        <td>${sailor.sail_number || 'N/A'}</td>
        <td>${getSubgroup(sailor)}</td>
        <td>${getBoatModel(sailor)}</td>
        <td>${sailor.club || sailor.club_name || 'N/A'}</td>
        </tr>`;
    });
    html += '</tbody></table></body></html>';

    const blob = new Blob([html], { type: 'text/html' });
    saveAs(blob, `${eventName}_starting_list.html`);
  }
}
