/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HeatRacePage from '../renderer/pages/HeatRacePage/HeatRacePage';
import LeaderboardPage from '../renderer/pages/LeaderboardPage/LeaderboardPage';

jest.mock('exceljs', () => {
  return function ExcelJS() {
    return {
      addWorksheet: jest.fn(() => ({ addRow: jest.fn() })),
      xlsx: {
        writeBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(0)),
      },
    };
  };
});

jest.mock('file-saver', () => ({ saveAs: jest.fn() }));
jest.mock('jspdf', () => ({ jsPDF: jest.fn() }));
jest.mock('jspdf-autotable', () => jest.fn());
jest.mock('../renderer/utils/registerPdfUnicodeFont', () => jest.fn());

jest.mock('../renderer/components/Navbar', () => ({ onBack, backLabel }) => (
  <header>
    <button type="button" onClick={onBack}>
      {backLabel}
    </button>
  </header>
));

jest.mock('../renderer/components/shared/Breadcrumbs', () => () => (
  <nav>Breadcrumbs Mock</nav>
));

jest.mock('../renderer/components/HeatComponent', () => ({
  onHeatSelect,
  onStartScoring,
  onQualifyingGroupCountChange,
}) => {
  React.useEffect(() => {
    onQualifyingGroupCountChange(1);
  }, [onQualifyingGroupCountChange]);

  return (
    <button
      type="button"
      onClick={() => {
        onHeatSelect({
          heat_id: 10,
          heat_name: 'Heat A1',
          heat_type: 'Qualifying',
          boats: [
            {
              boat_id: 1,
              sail_number: 101,
              name: 'Ana',
              surname: 'A',
              country: 'CRO',
            },
            {
              boat_id: 2,
              sail_number: 102,
              name: 'Bruno',
              surname: 'B',
              country: 'CRO',
            },
          ],
        });
        onStartScoring();
      }}
    >
      Start scoring mock
    </button>
  );
});

jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn().mockResolvedValue(true),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
}));

const event = {
  event_id: 5,
  event_name: 'T1 Integration Cup',
};

describe('T1 integration: scoring flow to leaderboard display', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const boats = [
      {
        boat_id: 1,
        sail_number: 101,
        name: 'Ana',
        surname: 'A',
        country: 'CRO',
        model: 'IOM',
      },
      {
        boat_id: 2,
        sail_number: 102,
        name: 'Bruno',
        surname: 'B',
        country: 'CRO',
        model: 'IOM',
      },
    ];

    const heats = [
      {
        heat_id: 10,
        event_id: event.event_id,
        heat_name: 'Heat A1',
        heat_type: 'Qualifying',
      },
    ];

    const racesByHeat = {
      10: [],
    };
    const savedScores = [];

    const buildLeaderboardRows = () => {
      if (savedScores.length === 0) return [];

      const latestRaceId = savedScores[savedScores.length - 1].raceId;
      const latestRaceScores = savedScores.filter((row) => row.raceId === latestRaceId);
      const ranked = [...latestRaceScores].sort((a, b) => a.points - b.points || a.position - b.position);

      return ranked.map((row, index) => {
        const boat = boats.find((b) => b.boat_id === row.boatId);
        return {
          boat_id: row.boatId,
          total_points_event: row.points,
          place: index + 1,
          boat_number: boat.sail_number,
          boat_type: boat.model,
          name: boat.name,
          surname: boat.surname,
          country: boat.country,
          race_positions: String(row.position),
          race_points: String(row.points),
          race_ids: String(row.raceId),
          race_statuses: row.status,
        };
      });
    };

    window.electron = {
      sqlite: {
        eventDB: {
          readEventById: jest.fn().mockResolvedValue(event),
          readAllEvents: jest.fn().mockResolvedValue([event]),
        },
        heatRaceDB: {
          readAllHeats: jest.fn().mockImplementation(async () => heats),
          readAllRaces: jest.fn().mockImplementation(async (heatId) => racesByHeat[heatId] || []),
          readBoatsByHeat: jest.fn().mockResolvedValue(boats),
          getMaxHeatSize: jest.fn().mockResolvedValue(10),
          insertRace: jest.fn().mockImplementation(async (heatId, raceNumber) => {
            const raceId = 900 + raceNumber;
            racesByHeat[heatId] = [...(racesByHeat[heatId] || []), { race_id: raceId, heat_id: heatId, race_number: raceNumber }];
            return { lastInsertRowid: raceId };
          }),
          insertScore: jest.fn().mockImplementation(async (raceId, boatId, position, points, status) => {
            savedScores.push({ raceId, boatId, position, points, status });
            return true;
          }),
          updateEventLeaderboard: jest.fn().mockResolvedValue(true),
          updateFinalLeaderboard: jest.fn().mockResolvedValue(true),
          readFinalLeaderboard: jest.fn().mockResolvedValue([]),
          readOverallLeaderboard: jest.fn().mockResolvedValue([]),
          readLeaderboard: jest.fn().mockImplementation(async () => buildLeaderboardRows()),
        },
      },
    };
  });

  it('submits T1 from ScoringInputComponent and shows T1 in leaderboard', async () => {
    const { unmount } = render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/event/T1 Integration Cup/heat-race',
            state: { event },
          },
        ]}
      >
        <Routes>
          <Route path="/event/:eventName/heat-race" element={<HeatRacePage />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start scoring mock' }));

    fireEvent.click(await screen.findByText('Ana A'));

    fireEvent.change(screen.getByLabelText('Penalty for sail 102'), {
      target: { value: 'T1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

    await waitFor(() => {
      expect(window.electron.sqlite.heatRaceDB.insertScore).toHaveBeenCalledTimes(2);
    });

    expect(window.electron.sqlite.heatRaceDB.insertScore).toHaveBeenNthCalledWith(
      1,
      901,
      1,
      1,
      1,
      'FINISHED',
    );

    // maxHeatSize=10 -> penaltyPlace=11, scoringPenaltyPlaces=2, place=2 => points=4
    expect(window.electron.sqlite.heatRaceDB.insertScore).toHaveBeenNthCalledWith(
      2,
      901,
      2,
      2,
      4,
      'T1',
    );

    unmount();

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/event/T1 Integration Cup/leaderboard',
            state: { event },
          },
        ]}
      >
        <Routes>
          <Route path="/event/:eventName/leaderboard" element={<LeaderboardPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Qualifying Series');
    expect(screen.getByText('T1')).toBeInTheDocument();
  });
});
