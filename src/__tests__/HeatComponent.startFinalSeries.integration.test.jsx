/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HeatComponent from '../renderer/components/HeatComponent';
import { confirmAction } from '../renderer/utils/userFeedback';

jest.mock(
  'react-world-flags',
  () =>
    function ReactWorldFlagsMock() {
      return <span data-testid="flag" />;
    },
);
jest.mock('../renderer/utils/printNewHeats', () => jest.fn(async () => {}));

const reportInfoMock = jest.fn();
const reportErrorMock = jest.fn();
jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn(async () => true),
  reportInfo: (...args) => reportInfoMock(...args),
  reportError: (...args) => reportErrorMock(...args),
}));

describe('HeatComponent start final series integration (UI + IPC chain)', () => {
  const confirmActionMock = confirmAction;

  beforeEach(() => {
    const readAllHeats = jest.fn().mockResolvedValue([
      { heat_id: 11, heat_name: 'Heat A1', heat_type: 'Qualifying' },
      { heat_id: 12, heat_name: 'Heat B1', heat_type: 'Qualifying' },
    ]);

    const readAllRaces = jest
      .fn()
      .mockResolvedValue([{ race_id: 301, race_number: 1 }]);
    const readBoatsByHeat = jest.fn().mockResolvedValue([
      {
        boat_id: 'B1',
        sail_number: 1,
        country: 'CRO',
        name: 'A',
        surname: 'A',
      },
      {
        boat_id: 'B2',
        sail_number: 2,
        country: 'CRO',
        name: 'B',
        surname: 'B',
      },
    ]);

    const startFinalSeriesAtomic = jest
      .fn()
      .mockResolvedValue({ success: true, createdHeats: 2, assignedBoats: 4 });
    const readLeaderboard = jest.fn().mockResolvedValue([]);

    window.electron = {
      sqlite: {
        heatRaceDB: {
          readAllHeats,
          readBoatsByHeat,
          readAllRaces,
          readLeaderboard,
          startFinalSeriesAtomic,
        },
      },
    };

    reportInfoMock.mockReset();
    reportErrorMock.mockReset();
    confirmActionMock.mockReset();
    confirmActionMock.mockResolvedValue(true);
  });

  afterEach(() => {
    delete window.electron;
  });

  it('starts final series through a single atomic backend IPC call', async () => {
    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /start final series\?/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /yes, start final series/i }),
    );

    await waitFor(() => {
      expect(
        window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic,
      ).toHaveBeenCalledTimes(1);
    });

    expect(window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic).toHaveBeenCalledWith(
      77,
      false,
      true,
    );

    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(reportInfoMock).toHaveBeenCalledWith(
      'Final Series started successfully!',
      'Success',
    );
  });

  it('asks for SHRS 2026-1 Rule 4.3 choice at 6 races and applies it when confirmed', async () => {
    window.electron.sqlite.heatRaceDB.readAllRaces = jest
      .fn()
      .mockResolvedValue([
        { race_id: 301, race_number: 1 },
        { race_id: 302, race_number: 2 },
        { race_id: 303, race_number: 3 },
        { race_id: 304, race_number: 4 },
        { race_id: 305, race_number: 5 },
        { race_id: 306, race_number: 6 },
      ]);

    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /start final series\?/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /yes, start final series/i }),
    );

    await waitFor(() => {
      expect(confirmActionMock).toHaveBeenCalledWith(
        expect.stringContaining('SHRS 2026-1 Rule 4.3 applies for 6-7 completed qualifying races.'),
        'Apply SHRS 2026-1 Rule 4.3?',
        {
          confirmLabel: 'Apply Rule 4.3',
          cancelLabel: 'Skip Rule 4.3',
          confirmClassName: 'btn-success',
        },
      );
    });

    expect(window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic).toHaveBeenCalledWith(
      77,
      false,
      true,
    );
  });

  it('asks SHRS 4.3 choice before showing the final start confirmation modal', async () => {
    window.electron.sqlite.heatRaceDB.readAllRaces = jest
      .fn()
      .mockResolvedValue([
        { race_id: 301, race_number: 1 },
        { race_id: 302, race_number: 2 },
        { race_id: 303, race_number: 3 },
        { race_id: 304, race_number: 4 },
        { race_id: 305, race_number: 5 },
        { race_id: 306, race_number: 6 },
      ]);

    let resolveShs43Choice;
    const shs43ChoicePromise = new Promise((resolve) => {
      resolveShs43Choice = resolve;
    });
    confirmActionMock.mockImplementation(() => shs43ChoicePromise);

    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(confirmActionMock).toHaveBeenCalledWith(
        expect.stringContaining('SHRS 2026-1 Rule 4.3 applies for 6-7 completed qualifying races.'),
        'Apply SHRS 2026-1 Rule 4.3?',
        {
          confirmLabel: 'Apply Rule 4.3',
          cancelLabel: 'Skip Rule 4.3',
          confirmClassName: 'btn-success',
        },
      );
    });

    expect(
      screen.queryByRole('dialog', { name: /start final series\?/i }),
    ).not.toBeInTheDocument();

    resolveShs43Choice(true);

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /start final series\?/i }),
      ).toBeInTheDocument();
    });
  });

  it('skips temporary second exclusion when SHRS 4.3 confirmation is declined', async () => {
    window.electron.sqlite.heatRaceDB.readAllRaces = jest
      .fn()
      .mockResolvedValue([
        { race_id: 301, race_number: 1 },
        { race_id: 302, race_number: 2 },
        { race_id: 303, race_number: 3 },
        { race_id: 304, race_number: 4 },
        { race_id: 305, race_number: 5 },
        { race_id: 306, race_number: 6 },
      ]);
    confirmActionMock.mockResolvedValue(false);

    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole('dialog', { name: /start final series\?/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /yes, start final series/i }),
    );

    await waitFor(() => {
      expect(window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic).toHaveBeenCalledTimes(1);
    });

    expect(window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic).toHaveBeenCalledWith(
      77,
      false,
      false,
    );
  });

  it('asks SHRS 4.3 when leaderboard shows 7 completed races even if latest heats show 0 races', async () => {
    window.electron.sqlite.heatRaceDB.readAllRaces = jest
      .fn()
      .mockResolvedValue([]);
    window.electron.sqlite.heatRaceDB.readLeaderboard = jest
      .fn()
      .mockResolvedValue([
        {
          boat_id: 'B1',
          race_points: '5,3,1,5,1,4,1',
        },
      ]);

    confirmActionMock
      .mockResolvedValueOnce(true) // Proceed with 0 races warning.
      .mockResolvedValueOnce(true) // Snapshot question.
      .mockResolvedValueOnce(true); // SHRS 4.3 choice.

    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /start final series/i }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /start final series/i }),
    );

    await waitFor(() => {
      expect(confirmActionMock).toHaveBeenCalledWith(
        expect.stringContaining('No qualifying races have been completed yet.'),
        'Start Final Series',
      );
    });

    await waitFor(() => {
      expect(confirmActionMock).toHaveBeenCalledWith(
        expect.stringContaining('SHRS 2026-1 Rule 4.3 applies for 6-7 completed qualifying races.'),
        'Apply SHRS 2026-1 Rule 4.3?',
        {
          confirmLabel: 'Apply Rule 4.3',
          cancelLabel: 'Skip Rule 4.3',
          confirmClassName: 'btn-success',
        },
      );
    });
  });
});
