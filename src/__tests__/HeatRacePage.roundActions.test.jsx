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

jest.mock(
  '../renderer/components/Navbar',
  () =>
    function NavbarMock() {
      return <header>Navbar</header>;
    },
);
jest.mock(
  '../renderer/components/shared/Breadcrumbs',
  () =>
    function BreadcrumbsMock() {
      return <nav>Breadcrumbs</nav>;
    },
);

// Reports two qualifying groups so the round-level actions render (SHRS 1.1:
// redistribution only applies with 2+ heats), and exposes the per-heat undo
// plus the disabled flag the page passes down.
const rowActionsDisabledSpy = jest.fn();
jest.mock(
  '../renderer/components/HeatComponent',
  () =>
    function HeatComponentMock({
      onQualifyingGroupCountChange,
      onUndoLastRace,
      rowActionsDisabled,
    }) {
      React.useEffect(() => {
        onQualifyingGroupCountChange(2);
      }, [onQualifyingGroupCountChange]);
      rowActionsDisabledSpy(rowActionsDisabled);
      return (
        <button
          type="button"
          disabled={rowActionsDisabled}
          onClick={() =>
            onUndoLastRace({
              heat_id: 10,
              heat_name: 'Heat A1',
              raceNumber: 1,
            })
          }
        >
          Undo Race 1
        </button>
      );
    },
);
jest.mock(
  '../renderer/components/ScoringInputComponent',
  () =>
    function ScoringInputMock() {
      return <div />;
    },
);

jest.mock('../renderer/utils/userFeedback', () => ({
  confirmAction: jest.fn().mockResolvedValue(true),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
}));

const event = { event_id: 1, event_name: 'Test Event' };
const heat = { heat_id: 10, heat_name: 'Heat A2', heat_type: 'Qualifying' };

// These actions each chain a confirm dialog and one or more DB round-trips with
// no visible progress, and every one of them is destructive or builds a round.
// A user who clicks again because nothing seems to be happening must not start
// a second one.
describe('HeatRacePage round-level actions', () => {
  let api;
  let gate;

  // A promise the test resolves by hand, so the assertions run while the IPC
  // call is still in flight.
  const deferred = () => {
    let settle;
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    return { promise, resolve: settle };
  };

  const renderPage = () =>
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: '/event/Test Event/heat-race', state: { event } },
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

  beforeEach(() => {
    jest.clearAllMocks();
    gate = deferred();
    api = {
      readAllHeats: jest.fn().mockResolvedValue([heat]),
      readAllRaces: jest.fn().mockResolvedValue([]),
      createNewHeatsBasedOnLeaderboard: jest.fn(() => gate.promise),
      undoLatestHeatRedistribution: jest.fn(() => gate.promise),
      undoLastScoredRaceForHeat: jest.fn(() => gate.promise),
    };
    window.electron = {
      sqlite: {
        eventDB: { readEventById: jest.fn().mockResolvedValue(event) },
        heatRaceDB: api,
      },
    };
  });

  afterEach(() => {
    delete window.electron;
  });

  const findButton = (name) =>
    waitFor(() => screen.getByRole('button', { name }));

  it.each([
    ['Undo Heat Redistribution', 'undoLatestHeatRedistribution'],
    ['Create New Heats from Leaderboard', 'createNewHeatsBasedOnLeaderboard'],
  ])(
    'runs %s once however many times it is clicked',
    async (label, channel) => {
      renderPage();
      const button = await findButton(label);

      fireEvent.click(button);
      await waitFor(() => expect(api[channel]).toHaveBeenCalledTimes(1));

      await act(async () => {
        fireEvent.click(button);
        fireEvent.click(button);
      });
      expect(api[channel]).toHaveBeenCalledTimes(1);

      gate.resolve({ removedHeats: 1, removedAssignments: 4 });
      await waitFor(() => expect(button).toBeEnabled());
    },
  );

  it('disables both round actions while one is running', async () => {
    renderPage();
    const undo = await findButton('Undo Heat Redistribution');
    const create = await findButton('Create New Heats from Leaderboard');

    fireEvent.click(undo);

    await waitFor(() => expect(undo).toBeDisabled());
    // The other one too: they mutate the same rounds.
    expect(create).toBeDisabled();

    gate.resolve({ removedHeats: 1, removedAssignments: 4 });
    await waitFor(() => expect(undo).toBeEnabled());
    expect(create).toBeEnabled();
  });

  it('disables the per-heat actions while a round action is running', async () => {
    renderPage();
    const undo = await findButton('Undo Heat Redistribution');

    expect(rowActionsDisabledSpy).toHaveBeenLastCalledWith(false);
    fireEvent.click(undo);

    await waitFor(() =>
      expect(rowActionsDisabledSpy).toHaveBeenLastCalledWith(true),
    );

    gate.resolve({ removedHeats: 1, removedAssignments: 4 });
    await waitFor(() =>
      expect(rowActionsDisabledSpy).toHaveBeenLastCalledWith(false),
    );
  });

  it('runs the per-heat undo once however many times it is clicked', async () => {
    renderPage();
    const undoRace = await findButton('Undo Race 1');

    fireEvent.click(undoRace);
    await waitFor(() =>
      expect(api.undoLastScoredRaceForHeat).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      fireEvent.click(undoRace);
    });
    expect(api.undoLastScoredRaceForHeat).toHaveBeenCalledTimes(1);

    gate.resolve({ raceNumber: 1, heatName: 'Heat A1', removedScores: 4 });
    await waitFor(() => expect(undoRace).toBeEnabled());
  });
});
