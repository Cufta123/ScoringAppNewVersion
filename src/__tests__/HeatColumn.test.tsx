/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen } from '@testing-library/react';
import HeatColumn from '../renderer/components/heats/HeatColumn';

jest.mock('react-world-flags', () => ({
  __esModule: true,
  default: ({ className }: { className?: string }) => (
    <img alt="" className={className} />
  ),
}));

const heat = {
  heat_id: 1,
  heat_name: 'Heat A1',
  raceNumber: 0,
  boats: [
    {
      boat_id: 1,
      sail_number: 101,
      name: 'Ana',
      surname: 'Test',
      country: 'CRO',
    },
  ],
} as any;

describe('HeatColumn', () => {
  const renderCard = () =>
    render(
      <HeatColumn heat={heat} boatsDraggable={false} onBoatDrop={jest.fn()} />,
    );

  it('words the sail number header like the rest of the app', () => {
    renderCard();
    expect(
      screen.getByRole('columnheader', { name: 'Sail #' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Boat Number')).not.toBeInTheDocument();
  });

  it('keeps flag and country code in one nowrap cell', () => {
    renderCard();
    const cell = screen.getByText('CRO').closest('td');
    expect(cell).toHaveClass('heat-country-cell');
    expect(cell?.querySelector('img')).toHaveClass('heat-flag');
  });
});

describe('HeatColumn actions', () => {
  const scored = { ...heat, raceNumber: 2 };

  it('scores and undoes from the card itself, no selecting first', () => {
    const onScore = jest.fn();
    const onUndoLastRace = jest.fn();
    render(
      <HeatColumn
        heat={scored}
        boatsDraggable={false}
        onBoatDrop={jest.fn()}
        onScore={onScore}
        onUndoLastRace={onUndoLastRace}
      />,
    );
    screen.getByRole('button', { name: 'Score race 3 in Heat A1' }).click();
    expect(onScore).toHaveBeenCalledWith(scored);
    screen.getByRole('button', { name: /Undo race 2/ }).click();
    expect(onUndoLastRace).toHaveBeenCalledWith(scored);
  });

  it('has no buttons for a heat of an earlier round', () => {
    render(
      <HeatColumn
        heat={scored}
        boatsDraggable={false}
        onBoatDrop={jest.fn()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
