/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, within } from './helpers/renderWithQuery';
import HeatComponent from '../renderer/components/HeatComponent';
import { roundSummary } from '../renderer/components/heats/RoundBar';
import {
  allowed,
  eventStatusView,
  refused,
  statusHeat,
} from './helpers/eventStatus';

jest.mock(
  'react-world-flags',
  () =>
    function ReactWorldFlagsMock() {
      return <span data-testid="flag" />;
    },
);

// The round bar and the heat cards show what the event status says
// (readEventStatus, regatta-core's eventStatus): the summary, the one green
// next step, which buttons are offered and why a refused one is disabled.
// Nothing about rounds or series is worked out on the screen.

const row = (heat_id, heat_name, heat_type = 'Qualifying') => ({
  heat_id,
  event_id: 1,
  heat_name,
  heat_type,
});

const setup = (heats, racesByHeat, status) => {
  window.electron = {
    sqlite: {
      eventDB: { readBoatsByEvent: jest.fn().mockResolvedValue([]) },
      heatRaceDB: {
        readAllHeats: jest.fn().mockResolvedValue(heats),
        readBoatsByHeat: jest.fn().mockResolvedValue([]),
        readAllRaces: jest.fn((id) =>
          Promise.resolve(
            Array.from({ length: racesByHeat[id] ?? 0 }, (_, i) => ({
              race_id: id * 10 + i,
              race_number: i + 1,
            })),
          ),
        ),
        readEventStatus: jest.fn().mockResolvedValue(status),
      },
    },
  };
  const onScoreHeat = jest.fn();
  render(
    <HeatComponent
      event={{ event_id: 1 }}
      onScoreHeat={onScoreHeat}
      onUndoLastRace={jest.fn()}
      onCreateRound={jest.fn()}
      onUndoRedistribution={jest.fn()}
    />,
  );
  return onScoreHeat;
};

afterEach(() => {
  delete window.electron;
});

const card = (name) => screen.getByRole('region', { name });

describe('the round bar', () => {
  it('a round being sailed: the next heat, the cards the status offers', async () => {
    const onScoreHeat = setup(
      [
        row(1, 'Heat A1'),
        row(2, 'Heat B1'),
        row(3, 'Heat A2'),
        row(4, 'Heat B2'),
      ],
      { 1: 1, 2: 1, 3: 1 },
      eventStatusView({
        series: 'qualifying',
        round: 2,
        heats: [statusHeat(3, 'Heat A2', 1), statusHeat(4, 'Heat B2', 0)],
        next: { kind: 'score', heat_id: 4, heat_name: 'Heat B2', race: 1 },
        undoRound: refused(
          'Cannot undo heat redistribution because the latest heats already contain races. Undo the last race first.',
          true,
        ),
        startFinal: {
          ...refused(
            'Every heat of this round must sail the same races first.',
            true,
          ),
          eligibility: eventStatusView().startFinal.eligibility,
        },
      }),
    );

    expect(
      await screen.findByText('Round 2 · 1 of 2 heats scored'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Score Heat B2/ }));
    expect(onScoreHeat).toHaveBeenCalledWith(
      expect.objectContaining({ heat_id: 4 }),
    );

    // Only the round being sailed is shown, with its own buttons.
    expect(screen.queryByRole('region', { name: 'Heat A1' })).toBeNull();
    expect(
      within(card('Heat A2')).queryByRole('button', { name: /Score race/ }),
    ).toBeNull();
    expect(
      within(card('Heat A2')).getByRole('button', { name: /Undo race 1/ }),
    ).toBeEnabled();
    expect(
      within(card('Heat B2')).getByRole('button', { name: /Score race 1/ }),
    ).toBeEnabled();

    // Offered but refused: disabled, the reason as its title.
    const undoRound = screen.getByRole('button', { name: /Undo round/ });
    expect(undoRound).toBeDisabled();
    expect(undoRound).toHaveAttribute(
      'title',
      expect.stringMatching(/already contain races/),
    );
    // Start Final Series stays clickable: it explains why not (see
    // HeatComponent.startFinalSeries).
    expect(
      screen.getByRole('button', { name: /Start Final Series/ }),
    ).toBeEnabled();

    // Earlier rounds: shown on request, without buttons.
    fireEvent.click(
      screen.getByRole('button', { name: 'Show earlier rounds' }),
    );
    expect(
      within(card('Heat A1')).queryByRole('button'),
    ).not.toBeInTheDocument();
  });

  it('a round sailed: Create Round, refused with the library’s reason', async () => {
    setup(
      [row(1, 'Heat A1'), row(2, 'Heat B1')],
      { 1: 2, 2: 1 },
      eventStatusView({
        series: 'qualifying',
        round: 1,
        heats: [statusHeat(1, 'Heat A1', 2), statusHeat(2, 'Heat B1', 1)],
        next: { kind: 'createRound', round: 2, finalSeries: false },
        createRound: refused(
          'Every heat of this round must sail the same races first.',
          true,
        ),
        undoRound: refused('First round.', false),
      }),
    );

    const create = await screen.findByRole('button', {
      name: /Create Round 2/,
    });
    expect(create).toBeDisabled();
    expect(create).toHaveAttribute(
      'title',
      'Every heat of this round must sail the same races first.',
    );
    expect(screen.queryByRole('button', { name: /Undo round/ })).toBeNull();
    // The status offers no Start Final Series here.
    expect(
      screen.queryByRole('button', { name: /Start Final Series/ }),
    ).toBeNull();
  });

  it('a round sailed: Create Round and Start Final Series both offered', async () => {
    setup(
      [row(1, 'Heat A1'), row(2, 'Heat B1')],
      { 1: 1, 2: 1 },
      eventStatusView({
        series: 'qualifying',
        round: 1,
        heats: [statusHeat(1, 'Heat A1', 1), statusHeat(2, 'Heat B1', 1)],
        next: { kind: 'createRound', round: 2, finalSeries: true },
        createRound: allowed,
        startFinal: {
          ...allowed,
          eligibility: eventStatusView().startFinal.eligibility,
        },
      }),
    );

    expect(
      await screen.findByRole('button', { name: /Create Round 2/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: /Start Final Series/ }),
    ).toHaveClass('btn-outline');
  });

  it('a heat card’s refused action is disabled with the reason', async () => {
    setup(
      [row(1, 'Heat A1')],
      { 1: 1 },
      eventStatusView({
        series: 'qualifying',
        round: 1,
        heats: [
          statusHeat(1, 'Heat A1', 1, {
            score: allowed,
            undoRace: refused('The rules keep this race.', true),
          }),
        ],
        next: { kind: 'score', heat_id: 1, heat_name: 'Heat A1', race: 2 },
      }),
    );

    expect(await screen.findByText('Race 2 next')).toBeInTheDocument();
    const undo = within(card('Heat A1')).getByRole('button', {
      name: /Undo race 1/,
    });
    expect(undo).toBeDisabled();
    expect(undo).toHaveAttribute('title', 'The rules keep this race.');
    expect(
      within(card('Heat A1')).getByRole('button', { name: /Score race 2/ }),
    ).toBeEnabled();
  });

  it('the Final Series: the fleets, no round actions', async () => {
    setup(
      [
        row(1, 'Heat A1'),
        row(2, 'Heat B1'),
        row(5, 'Final Gold', 'Final'),
        row(6, 'Final Silver', 'Final'),
      ],
      { 1: 1, 2: 1, 5: 2, 6: 1 },
      eventStatusView({
        series: 'final',
        heats: [
          statusHeat(5, 'Final Gold', 2, { score: allowed }),
          statusHeat(6, 'Final Silver', 1, { score: allowed }),
        ],
        next: { kind: 'score', heat_id: 6, heat_name: 'Final Silver', race: 2 },
        createRound: refused('The Final Series has started.'),
        undoRound: refused('The Final Series has started.'),
      }),
    );

    expect(
      await screen.findByText('Race 2 · 1 of 2 fleets scored'),
    ).toBeInTheDocument();
    expect(screen.getByText('Final Series')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Score Final Silver · race 2/ }),
    ).toBeEnabled();
    expect(
      within(card('Final Gold')).getByRole('button', { name: /Score race 3/ }),
    ).toBeEnabled();
    ['Undo round', 'Start Final Series', 'Create Round'].forEach((name) =>
      expect(
        screen.queryByRole('button', { name: new RegExp(name) }),
      ).toBeNull(),
    );
  });
});

describe('without a status', () => {
  it('lists every heat, offers nothing, and says the read failed', async () => {
    setup([row(1, 'Heat A1'), row(2, 'Heat B1')], { 1: 1 }, undefined);
    window.electron.sqlite.heatRaceDB.readEventStatus.mockRejectedValue(
      new Error('gone'),
    );
    expect(await screen.findByRole('region', { name: 'Heat B1' })).toBeTruthy();
    expect(
      within(card('Heat A1')).queryByRole('button'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Score Heat/ })).toBeNull();
  });
});

describe('roundSummary', () => {
  it('words where the series stands', () => {
    expect(roundSummary(eventStatusView())).toBeNull();
    expect(
      roundSummary(
        eventStatusView({
          series: 'qualifying',
          round: 4,
          heats: [
            statusHeat(1, 'Heat A4', 1),
            statusHeat(2, 'Heat B4', 0),
            statusHeat(3, 'Heat C4', 0),
          ],
        }),
      ),
    ).toBe('Round 4 · 1 of 3 heats scored');
    expect(
      roundSummary(
        eventStatusView({
          series: 'qualifying',
          round: 1,
          heats: [statusHeat(1, 'Heat A1', 3)],
          next: { kind: 'score', heat_id: 1, heat_name: 'Heat A1', race: 4 },
        }),
      ),
    ).toBe('Race 4 next');
  });
});
