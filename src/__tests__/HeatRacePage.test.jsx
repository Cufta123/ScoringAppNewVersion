/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HeatRacePage from '../renderer/pages/HeatRacePage/HeatRacePage';
import {
  confirmAction,
  reportError,
  reportInfo,
} from '../renderer/utils/userFeedback';

jest.mock(
  '../renderer/components/Navbar',
  () =>
    function ({ onNavigateHome }) {
      return (
        <header>
          <button type="button" onClick={onNavigateHome}>
            Navbar home
          </button>
        </header>
      );
    },
);

jest.mock(
  '../renderer/components/shared/Breadcrumbs',
  () =>
    function () {
      return <nav>Breadcrumbs Mock</nav>;
    },
);

jest.mock(
  '../renderer/components/HeatComponent',
  () =>
    function ({ onHeatSelect, onStartScoring, onQualifyingGroupCountChange }) {
      React.useEffect(() => {
        onQualifyingGroupCountChange(1);
      }, [onQualifyingGroupCountChange]);

      return (
        <div>
          <button
            type="button"
            onClick={() => {
              onHeatSelect({
                heat_id: 10,
                heat_name: 'Heat A1',
                heat_type: 'Qualifying',
              });
              onStartScoring();
            }}
          >
            Start scoring mock
          </button>
        </div>
      );
    },
);

jest.mock(
  '../renderer/components/ScoringInputComponent',
  () =>
    function MockScoringInputComponent({ onSubmit, onDirtyChange }) {
      // The real component reports an entered-but-unsubmitted finish order this
      // way; the navigation guard only engages while it is dirty.
      React.useEffect(() => {
        onDirtyChange(true);
      }, [onDirtyChange]);

      return (
        <button
          type="button"
          onClick={() =>
            onSubmit([
              { boatNumber: 101, place: 1, status: 'FINISHED' },
              { boatNumber: 102, place: 2, status: 'DNF' },
            ])
          }
        >
          Submit scoring mock
        </button>
      );
    },
);

jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn().mockResolvedValue(true),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
}));

const event = {
  event_id: 1,
  event_name: 'Test Event',
};

const heat = {
  heat_id: 10,
  heat_name: 'Heat A1',
  heat_type: 'Qualifying',
};

describe('HeatRacePage', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    window.electron = {
      sqlite: {
        eventDB: {
          readEventById: jest.fn().mockResolvedValue({
            event_id: 1,
            event_name: 'Test Event',
          }),
        },
        heatRaceDB: {
          readAllHeats: jest.fn().mockResolvedValue([heat]),
          readAllRaces: jest.fn().mockResolvedValue([]),
          submitHeatRaceScoresAtomic: jest
            .fn()
            .mockResolvedValue({ ok: true, raceNumber: 1, raceId: 999 }),
        },
      },
    };
  });

  it('delegates score submission to the atomic main-process handler', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/event/Test Event/heat-race',
            state: { event },
          },
        ]}
      >
        <Routes>
          <Route
            path="/event/:eventName/heat-race"
            element={<HeatRacePage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: 'Start scoring mock' }),
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Submit scoring mock' }),
    );

    await waitFor(() => {
      expect(
        window.electron.sqlite.heatRaceDB.submitHeatRaceScoresAtomic,
      ).toHaveBeenCalledTimes(1);
    });

    expect(
      window.electron.sqlite.heatRaceDB.submitHeatRaceScoresAtomic,
    ).toHaveBeenCalledWith({
      event_id: 1,
      heat_id: 10,
      placeNumbers: [
        { boatNumber: 101, place: 1, status: 'FINISHED' },
        { boatNumber: 102, place: 2, status: 'DNF' },
      ],
      isFinalSeries: false,
    });
  });

  // The exit guard used to read a boolean "submitting" ref and, when it was
  // set, announce "Your scores were saved" and allow the exit. That ref is true
  // precisely while the save is still IN FLIGHT, so a failing save could report
  // success and unmount the scoring view, losing the entered finish order for
  // good. The guard now awaits the submit's real outcome.
  describe('leaving the scoring view while a submit is in flight', () => {
    const renderPage = () =>
      render(
        <MemoryRouter
          initialEntries={[
            {
              pathname: '/event/Test Event/heat-race',
              state: { event },
            },
          ]}
        >
          <Routes>
            <Route
              path="/event/:eventName/heat-race"
              element={<HeatRacePage />}
            />
          </Routes>
        </MemoryRouter>,
      );

    it('keeps the scoring view when the in-flight save fails', async () => {
      let rejectSubmit;
      window.electron.sqlite.heatRaceDB.submitHeatRaceScoresAtomic = jest.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectSubmit = reject;
          }),
      );

      renderPage();
      fireEvent.click(
        await screen.findByRole('button', { name: 'Start scoring mock' }),
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'Submit scoring mock' }),
      );

      // While the save is pending the exit is blocked outright.
      const backButton = screen.getByRole('button', { name: /Back to Heats/ });
      expect(backButton).toBeDisabled();

      await act(async () => {
        rejectSubmit(new Error('database is locked'));
      });

      // The save failed, so the scoring view — and the entered order it holds —
      // must still be on screen, and nothing may claim the scores were saved.
      expect(
        screen.getByRole('button', { name: 'Submit scoring mock' }),
      ).toBeInTheDocument();
      expect(reportError).toHaveBeenCalled();
      expect(reportInfo).not.toHaveBeenCalledWith(
        expect.stringMatching(/saved/i),
        expect.anything(),
      );
    });

    it('never reports a pending save as saved when exiting via the navbar', async () => {
      // The navbar/breadcrumb exits go through guardedNavigate, which is not
      // disabled during a submit — so the guard itself, not the button state,
      // has to hold the line here.
      let rejectSubmit;
      window.electron.sqlite.heatRaceDB.submitHeatRaceScoresAtomic = jest.fn(
        () =>
          new Promise((_resolve, reject) => {
            rejectSubmit = reject;
          }),
      );

      renderPage();
      fireEvent.click(
        await screen.findByRole('button', { name: 'Start scoring mock' }),
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'Submit scoring mock' }),
      );

      // Try to leave while the save is still in flight, then let it fail.
      fireEvent.click(screen.getByRole('button', { name: 'Navbar home' }));
      await act(async () => {
        rejectSubmit(new Error('database is locked'));
      });

      // The old guard announced "Your scores were saved" here and navigated
      // away, discarding an order that was never persisted.
      expect(reportInfo).not.toHaveBeenCalledWith(
        expect.stringMatching(/saved/i),
        expect.anything(),
      );
      expect(
        screen.getByRole('button', { name: 'Submit scoring mock' }),
      ).toBeInTheDocument();
    });

    it('leaves without a discard prompt once the in-flight save succeeds', async () => {
      let resolveSubmit;
      window.electron.sqlite.heatRaceDB.submitHeatRaceScoresAtomic = jest.fn(
        () =>
          new Promise((resolve) => {
            resolveSubmit = resolve;
          }),
      );

      renderPage();
      fireEvent.click(
        await screen.findByRole('button', { name: 'Start scoring mock' }),
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'Submit scoring mock' }),
      );

      await act(async () => {
        resolveSubmit({ ok: true, raceNumber: 1, raceId: 999 });
      });

      // Saved, so the view leaves scoring on its own and the user is never
      // asked to discard work that is already persisted.
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Submit scoring mock' }),
        ).not.toBeInTheDocument();
      });
      expect(confirmAction).not.toHaveBeenCalledWith(
        expect.stringMatching(/not been submitted/i),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
