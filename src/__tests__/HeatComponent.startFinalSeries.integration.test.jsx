/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HeatComponent from '../renderer/components/HeatComponent';

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

    window.electron = {
      sqlite: {
        heatRaceDB: {
          readAllHeats,
          readBoatsByHeat,
          readAllRaces,
          startFinalSeriesAtomic,
        },
      },
    };

    reportInfoMock.mockReset();
    reportErrorMock.mockReset();
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

    expect(
      window.electron.sqlite.heatRaceDB.startFinalSeriesAtomic,
    ).toHaveBeenCalledWith(77);

    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(reportInfoMock).toHaveBeenCalledWith(
      'Final Series started successfully!',
      'Success',
    );
  });
});
