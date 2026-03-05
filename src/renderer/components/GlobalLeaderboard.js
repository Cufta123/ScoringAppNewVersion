/* eslint-disable prettier/prettier */
import React, { useState, useEffect } from 'react';
import Flag from 'react-world-flags';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import iocToFlagCodeMap from '../constants/iocToFlagCodeMap';

function GlobalLeaderboardComponent() {
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGlobalLeaderboard = async () => {
      try {
        const results =
          await window.electron.sqlite.heatRaceDB.readGlobalLeaderboard();
        console.log('Fetched global leaderboard:', results);

        const mappedLeaderboard = results.map((entry) => ({
          ...entry,
          sailor: `${entry.name} ${entry.surname}`,
          club: entry.club_name, // Map club_name
          country: entry.country, // Map country
          category: entry.category_name, // Map category_name
        }));

        // Sort the leaderboard by total_points in descending order
        mappedLeaderboard.sort((a, b) => a.total_points_global - b.total_points_global);

        setLeaderboard(mappedLeaderboard);
      } catch (error) {
        console.error('Error fetching global leaderboard:', error.message);
      } finally {
        setLoading(false);
      }
    };

    fetchGlobalLeaderboard();
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (!leaderboard.length) {
    return <div>No results available.</div>;
  }
  const getFlagCode = (iocCode) => {
    return iocToFlagCodeMap[iocCode] || iocCode;
  };

  const exportToExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Global Leaderboard');

    // Add header row
    const header = [
      'Rank',
      'Name',
      'Surname',
      'Boat Number',
      'Boat Type',
      'Country',
      'Total Points',
    ];
    worksheet.addRow(header);

    // Add data rows
    leaderboard.forEach((entry, index) => {
      const row = [
        index + 1,
        entry.name,
        entry.surname,
        entry.boat_number,
        entry.boat_type,
        entry.country,
        entry.total_points_global,
      ];
      worksheet.addRow(row);
    });

    // Generate Excel file and trigger download
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    saveAs(blob, 'global_leaderboard.xlsx');
  };

  return (
    <div className="leaderboard">
      <h2>Global Leaderboard</h2>
      <button type="button" onClick={exportToExcel}>
        Export to Excel
      </button>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Name</th>
            <th>Surname</th>
            <th>Boat Number</th>
            <th>Boat Type</th>
            <th>Country</th>
            <th>Total Points</th>
          </tr>
        </thead>
        <tbody>
          {leaderboard.map((entry, index) => (
            <tr key={entry.boat_id}>
              <td>{index + 1}</td>
              <td>{entry.name}</td>
              <td>{entry.surname}</td>
              <td>{entry.boat_number}</td>
              <td>{entry.boat_type}</td>
               <td>
                    <Flag
                      code={getFlagCode(entry.country)}
                      style={{ width: '30px', marginRight: '5px' }}
                    />
                    {entry.country}
                  </td>
              <td>{entry.total_points_global}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default GlobalLeaderboardComponent;
