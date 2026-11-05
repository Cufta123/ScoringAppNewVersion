/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from './helpers/renderWithQuery';
import HeatsSummary from '../renderer/components/heats/HeatsSummary';

const heat = (heat_id, heat_name, heat_type = 'Qualifying') => ({
  heat_id,
  event_id: 1,
  heat_name,
  heat_type,
});

const setup = (heats, racesByHeat = {}) => {
  window.electron = {
    sqlite: {
      heatRaceDB: {
        readAllHeats: jest.fn().mockResolvedValue(heats),
        readBoatsByHeat: jest.fn().mockResolvedValue([]),
        readAllRaces: jest.fn((id) =>
          Promise.resolve(
            Array.from({ length: racesByHeat[id] ?? 0 }, (_, i) => ({
              race_id: id * 10 + i,
            })),
          ),
        ),
      },
    },
  };
};

describe('HeatsSummary', () => {
  it('says where to create the heats when there are none', async () => {
    setup([]);
    render(<HeatsSummary eventId={1} />);
    expect(
      await screen.findByText(/create the heats on the Scoring page/),
    ).toBeInTheDocument();
  });

  it('gives the latest qualifying round and how much of it is scored', async () => {
    setup(
      [
        heat(1, 'Heat A1'),
        heat(2, 'Heat B1'),
        heat(3, 'Heat A2'),
        heat(4, 'Heat B2'),
      ],
      { 1: 1, 2: 1, 3: 1 },
    );
    render(<HeatsSummary eventId={1} />);
    expect(
      await screen.findByText('Qualifying round 2 · 2 heats · 1 of 2 scored'),
    ).toBeInTheDocument();
  });

  it('counts the final races sailed once the Final Series started', async () => {
    setup(
      [
        heat(1, 'Heat A1'),
        heat(5, 'Heat Gold', 'Final'),
        heat(6, 'Heat Silver', 'Final'),
      ],
      { 1: 1, 5: 3, 6: 2 },
    );
    render(<HeatsSummary eventId={1} />);
    expect(
      await screen.findByText('Final Series · 2 fleets · 3 races sailed'),
    ).toBeInTheDocument();
  });
});
