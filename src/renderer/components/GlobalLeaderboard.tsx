import React, { useState, useEffect } from 'react';
import Flag from 'react-world-flags';
import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import iocToFlagCodeMap from '../constants/iocToFlagCodeMap';
import EmptyState from './shared/EmptyState';
import LoadingState from './shared/LoadingState';
import { reportError } from '../utils/userFeedback';
import { heatRaceDB } from '../api/db';
import type { GlobalLeaderboardRow } from '../types';

interface GlobalRow {
  boat_id?: number;
  total_points_global: number;
  name: string;
  surname: string;
  boat_number: string | number;
  boat_type: string;
  country: string;
}

function GlobalLeaderboardComponent() {
  const [leaderboard, setLeaderboard] = useState<GlobalRow[]>([]);
  const [loading, setLoading] = useState(true);

  const getFlagCode = (iocCode: string): string =>
    iocToFlagCodeMap[iocCode] || iocCode;

  const mapAndSortLeaderboard = (
    results: GlobalLeaderboardRow[],
  ): GlobalRow[] => {
    const rows = (results || []).map((entry) => ({
      ...entry,
      total_points_global: Number(entry.total_points_global || 0),
      name: entry.name || '',
      surname: entry.surname || '',
      boat_number: entry.boat_number || '',
      boat_type: entry.boat_type || '',
      country: entry.country || '',
    }));

    rows.sort((left, right) => {
      if (left.total_points_global !== right.total_points_global) {
        return left.total_points_global - right.total_points_global;
      }

      const surnameCmp = left.surname.localeCompare(right.surname);
      if (surnameCmp !== 0) return surnameCmp;

      const nameCmp = left.name.localeCompare(right.name);
      if (nameCmp !== 0) return nameCmp;

      return String(left.boat_number).localeCompare(
        String(right.boat_number),
        undefined,
        {
          numeric: true,
          sensitivity: 'base',
        },
      );
    });

    return rows;
  };

  useEffect(() => {
    let isActive = true;

    const fetchGlobalLeaderboard = async () => {
      try {
        const results = await heatRaceDB.readGlobalLeaderboard();
        if (!isActive) return;

        setLeaderboard(mapAndSortLeaderboard(results));
        setLoading(false);
      } catch (error) {
        if (!isActive) return;
        reportError('Could not load global leaderboard.', error);
        setLoading(false);
      }
    };

    fetchGlobalLeaderboard();

    return () => {
      isActive = false;
    };
  }, []);

  if (loading) {
    return <LoadingState label="Loading global leaderboard..." />;
  }

  if (!leaderboard.length) {
    return (
      <EmptyState
        title="No global results"
        description="No scored races are available yet across events."
      />
    );
  }
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
      <div className="section-header-row">
        <h2>
          <i
            className="fa fa-trophy"
            aria-hidden="true"
            style={{ color: '#E6A817' }}
          />
          Global Leaderboard
        </h2>
        <button
          type="button"
          className="btn-ghost"
          onClick={exportToExcel}
          aria-label="Export global leaderboard to Excel"
        >
          <i className="fa fa-download" aria-hidden="true" /> Export to Excel
        </button>
      </div>
      <p className="muted-note" style={{ margin: '0 0 12px' }}>
        Combined standings across all events. Lower points are better.
      </p>
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
              <td>{entry.name || '—'}</td>
              <td>{entry.surname || '—'}</td>
              <td>{entry.boat_number}</td>
              <td>{entry.boat_type || '—'}</td>
              <td>
                <Flag
                  code={getFlagCode(entry.country)}
                  alt={`${entry.country || 'Unknown'} flag`}
                  style={{ width: '30px', marginRight: '5px' }}
                />
                {entry.country || '—'}
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
