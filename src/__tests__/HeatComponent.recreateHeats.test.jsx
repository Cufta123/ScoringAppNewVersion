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
const reportWarningMock = jest.fn();
jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn(async () => true),
  reportInfo: (...args) => reportInfoMock(...args),
  reportError: (...args) => reportErrorMock(...args),
  reportWarning: (...args) => reportWarningMock(...args),
}));

// "Recreate Heats" used to be deleteHeatsByEvent followed by
// createInitialHeatsAtomic. The destructive call ran first and the two were
// not atomic, so a rejected create left the event with no heats at all — and
// because the create step reports its own validation failures and returns
// normally, the recreate wrapper never saw an error either. These tests pin
// the single-call contract and that a rejection changes nothing.
describe('HeatComponent recreate heats', () => {
  const confirmActionMock = confirmAction;
  let api;

  const renderComponent = () =>
    render(
      <HeatComponent
        event={{ event_id: 77 }}
        clickable={false}
        onHeatSelect={jest.fn()}
        onStartScoring={jest.fn()}
        onQualifyingGroupCountChange={jest.fn()}
      />,
    );

  const clickRecreate = async () => {
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /recreate heats/i }),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /recreate heats/i }));
  };

  beforeEach(() => {
    api = {
      // Existing heats, no races: exactly when recreating is still allowed.
      readAllHeats: jest.fn().mockResolvedValue([
        { heat_id: 11, heat_name: 'Heat A1', heat_type: 'Qualifying' },
        { heat_id: 12, heat_name: 'Heat B1', heat_type: 'Qualifying' },
      ]),
      readAllRaces: jest.fn().mockResolvedValue([]),
      readBoatsByHeat: jest.fn().mockResolvedValue([
        {
          boat_id: 'B1',
          sail_number: 1,
          country: 'CRO',
          name: 'A',
          surname: 'A',
        },
      ]),
      readLeaderboard: jest.fn().mockResolvedValue([]),
      getFinalSeriesEligibility: jest.fn().mockResolvedValue({
        ok: false,
        reason: 'NO_RACES',
        numFinalHeats: 2,
        completedQualifyingRaces: 0,
        rule43Applies: false,
        noRacesCompleted: true,
        raceCountBreakdown: [],
      }),
      recreateInitialHeatsAtomic: jest.fn().mockResolvedValue({
        success: true,
        createdHeats: 2,
        assignedBoats: 9,
      }),
      createInitialHeatsAtomic: jest.fn().mockResolvedValue({ success: true }),
      deleteHeatsByEvent: jest.fn().mockResolvedValue({ heatsChanges: 2 }),
    };
    window.electron = { sqlite: { heatRaceDB: api } };

    reportInfoMock.mockReset();
    reportErrorMock.mockReset();
    reportWarningMock.mockReset();
    confirmActionMock.mockReset();
    confirmActionMock.mockResolvedValue(true);
  });

  afterEach(() => {
    delete window.electron;
  });

  it('recreates through a single atomic backend call', async () => {
    renderComponent();
    await clickRecreate();

    await waitFor(() => {
      expect(api.recreateInitialHeatsAtomic).toHaveBeenCalledTimes(1);
    });
    expect(api.recreateInitialHeatsAtomic).toHaveBeenCalledWith(77, 5);
    // The destructive half must no longer be reachable on its own.
    expect(api.deleteHeatsByEvent).not.toHaveBeenCalled();
    expect(api.createInitialHeatsAtomic).not.toHaveBeenCalled();
  });

  it('still asks before discarding the current heats', async () => {
    renderComponent();
    confirmActionMock.mockResolvedValue(false);
    await clickRecreate();

    await waitFor(() => {
      expect(confirmActionMock).toHaveBeenCalled();
    });
    expect(api.recreateInitialHeatsAtomic).not.toHaveBeenCalled();
    expect(api.deleteHeatsByEvent).not.toHaveBeenCalled();
  });

  it('destroys nothing when the new split is rejected', async () => {
    api.recreateInitialHeatsAtomic.mockRejectedValue(
      new Error(
        'Cannot create heats: duplicate sail numbers — sail number "1" (boats 1, 99).',
      ),
    );
    renderComponent();
    await clickRecreate();

    await waitFor(() => {
      expect(reportWarningMock).toHaveBeenCalled();
    });
    // The reason reaches the user verbatim rather than as a generic failure...
    expect(reportWarningMock.mock.calls[0][0]).toContain(
      'duplicate sail numbers',
    );
    // ...and it is framed as "nothing changed", which is now true.
    expect(reportWarningMock.mock.calls[0][1]).toBe('Heats not changed');
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(api.deleteHeatsByEvent).not.toHaveBeenCalled();
  });

  it('reports an unexpected failure as an error', async () => {
    api.recreateInitialHeatsAtomic.mockRejectedValue(new Error('disk gone'));
    renderComponent();
    await clickRecreate();

    await waitFor(() => {
      expect(reportErrorMock).toHaveBeenCalledWith(
        'Could not recreate heats.',
        expect.any(Error),
      );
    });
    expect(reportWarningMock).not.toHaveBeenCalled();
  });
});
