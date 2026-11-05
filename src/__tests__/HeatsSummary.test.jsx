/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from './helpers/renderWithQuery';
import HeatsSummary from '../renderer/components/heats/HeatsSummary';

// The line is worded from the event status (regatta-core's eventStatus):
// the series, the round and its heats come from there, not from the names.
const refused = { ok: false, offered: false, reason: 'Not now.' };
const shown = (heat_id, heat_name, races) => ({
  heat_id,
  heat_name,
  boat_ids: [],
  races,
  score: { ok: true, offered: races === 0 },
  undoRace: refused,
});
const status = (fields) => ({
  series: 'entries',
  round: null,
  heats: [],
  next: { kind: 'createHeats' },
  createRound: refused,
  undoRound: refused,
  startFinal: { ...refused, eligibility: { ok: false, reason: 'NO_HEATS' } },
  ...fields,
});

const setup = (answer) => {
  window.electron = {
    sqlite: {
      heatRaceDB: {
        readEventStatus: jest.fn().mockResolvedValue(answer),
      },
    },
  };
};

describe('HeatsSummary', () => {
  it('says where to create the heats when there are none', async () => {
    setup(status({}));
    render(<HeatsSummary eventId={1} />);
    expect(
      await screen.findByText(/create the heats on the Scoring page/),
    ).toBeInTheDocument();
  });

  it('gives the round being sailed and how much of it is scored', async () => {
    setup(
      status({
        series: 'qualifying',
        round: 2,
        heats: [shown(3, 'Heat A2', 1), shown(4, 'Heat B2', 0)],
      }),
    );
    render(<HeatsSummary eventId={1} />);
    expect(
      await screen.findByText('Qualifying round 2 · 2 heats · 1 of 2 scored'),
    ).toBeInTheDocument();
  });

  it('counts the final races sailed once the Final Series started', async () => {
    setup(
      status({
        series: 'final',
        heats: [shown(5, 'Final Gold', 3), shown(6, 'Final Silver', 2)],
      }),
    );
    render(<HeatsSummary eventId={1} />);
    expect(
      await screen.findByText('Final Series · 2 fleets · 3 races sailed'),
    ).toBeInTheDocument();
  });

  it('says so when the status cannot be read', async () => {
    window.electron = {
      sqlite: {
        heatRaceDB: {
          readEventStatus: jest.fn().mockRejectedValue(new Error('gone')),
        },
      },
    };
    render(<HeatsSummary eventId={1} />);
    expect(
      await screen.findByText(/Could not load the heats/),
    ).toBeInTheDocument();
  });
});
