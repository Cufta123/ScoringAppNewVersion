/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScoringInputComponent from '../renderer/components/ScoringInputComponent';
import { reportError, reportInfo } from '../renderer/utils/userFeedback';

jest.mock('../renderer/utils/userFeedback', () => ({
  reportError: jest.fn(),
  reportInfo: jest.fn(),
}));

const makeBoat = (
  id,
  sail,
  name = 'Sailor',
  surname = 'Test',
  country = 'CRO',
) => ({
  boat_id: id,
  sail_number: sail,
  name,
  surname,
  country,
});

const makeHeat = (heatId, heatName, boats) => ({
  heat_id: heatId,
  heat_name: heatName,
  boats,
});

describe('ScoringInputComponent', () => {
  let readBoatsByHeat;

  beforeEach(() => {
    jest.clearAllMocks();
    readBoatsByHeat = jest.fn();
    window.electron = {
      sqlite: {
        heatRaceDB: {
          readBoatsByHeat,
        },
      },
    };
  });

  it('renders boats and loads valid boats for selected heat', async () => {
    const boats = [makeBoat(1, 101, 'Ana'), makeBoat(2, 102, 'Ivo')];
    readBoatsByHeat.mockResolvedValueOnce(boats);

    render(
      <ScoringInputComponent
        heat={makeHeat(11, 'Heat A1', boats)}
        onSubmit={jest.fn()}
      />,
    );

    expect(screen.getByText('Heat A1 — Boats')).toBeInTheDocument();
    expect(screen.getByText('Ana Test')).toBeInTheDocument();
    expect(screen.getByText('Ivo Test')).toBeInTheDocument();

    await waitFor(() => {
      expect(readBoatsByHeat).toHaveBeenCalledWith(11);
    });
  });

  it('adds boat on row click and submits FINISHED place', async () => {
    const boats = [makeBoat(1, 101, 'Ana')];
    readBoatsByHeat.mockResolvedValueOnce(boats);
    const onSubmit = jest.fn();

    render(
      <ScoringInputComponent
        heat={makeHeat(12, 'Heat A2', boats)}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Ana Test'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        boatNumber: 101,
        place: 1,
        status: 'FINISHED',
      },
    ]);
  });

  it('auto-includes boat when DNC penalty is selected and submits it', async () => {
    const boats = [makeBoat(1, 101, 'Ana')];
    readBoatsByHeat.mockResolvedValueOnce(boats);
    const onSubmit = jest.fn();

    render(
      <ScoringInputComponent
        heat={makeHeat(13, 'Heat A3', boats)}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Penalty for sail 101'), {
      target: { value: 'DNC' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        boatNumber: 101,
        place: 2,
        status: 'DNC',
      },
    ]);
  });

  it('keeps position for ZFP penalty and submits status', async () => {
    const boats = [makeBoat(1, 101, 'Ana')];
    readBoatsByHeat.mockResolvedValueOnce(boats);
    const onSubmit = jest.fn();

    render(
      <ScoringInputComponent
        heat={makeHeat(14, 'Heat A4', boats)}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Ana Test'));
    fireEvent.change(screen.getByLabelText('Penalty for sail 101'), {
      target: { value: 'ZFP' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        boatNumber: 101,
        place: 1,
        status: 'ZFP',
      },
    ]);
  });

  it('does not submit when not all boats are accounted for', async () => {
    const boats = [makeBoat(1, 101, 'Ana'), makeBoat(2, 102, 'Ivo')];
    readBoatsByHeat.mockResolvedValueOnce(boats);
    const onSubmit = jest.fn();

    render(
      <ScoringInputComponent
        heat={makeHeat(15, 'Heat B1', boats)}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Ana Test'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(reportInfo).toHaveBeenCalledWith(
      'All boats must be assigned a place or a penalty before submitting.',
      'Incomplete scoring',
    );
  });

  it('removing a boat clears penalty and blocks submit as incomplete', async () => {
    const boats = [makeBoat(1, 101, 'Ana')];
    readBoatsByHeat.mockResolvedValueOnce(boats);
    const onSubmit = jest.fn();

    render(
      <ScoringInputComponent
        heat={makeHeat(16, 'Heat B2', boats)}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Penalty for sail 101'), {
      target: { value: 'DNC' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove sail 101 from finish order' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(reportInfo).toHaveBeenCalled();
  });

  it('allows manual add by input and Add button only for valid sail numbers', async () => {
    const boats = [makeBoat(1, 101, 'Ana')];
    readBoatsByHeat.mockResolvedValueOnce(boats);

    render(
      <ScoringInputComponent
        heat={makeHeat(17, 'Heat B3', boats)}
        onSubmit={jest.fn()}
      />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Add sail numbers manually'), {
      target: { value: '999' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Add sail number to finish order' }),
    );
    expect(screen.queryByText('Sail #999')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Add sail numbers manually'), {
      target: { value: '101' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Add sail number to finish order' }),
    );
    expect(screen.getByText('Sail #101')).toBeInTheDocument();
  });

  it('reorders boats with arrow controls and submits updated places', async () => {
    const boats = [makeBoat(1, 101, 'Ana'), makeBoat(2, 102, 'Ivo')];
    readBoatsByHeat.mockResolvedValueOnce(boats);
    const onSubmit = jest.fn();

    render(
      <ScoringInputComponent
        heat={makeHeat(18, 'Heat B4', boats)}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Ana Test'));
    fireEvent.click(screen.getByText('Ivo Test'));

    fireEvent.click(screen.getByRole('button', { name: 'Move sail 102 up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        boatNumber: 102,
        place: 1,
        status: 'FINISHED',
      },
      {
        boatNumber: 101,
        place: 2,
        status: 'FINISHED',
      },
    ]);
  });

  it('resets local scoring state when heat changes', async () => {
    const heatA = makeHeat(21, 'Heat A1', [makeBoat(1, 101, 'Ana')]);
    const heatB = makeHeat(22, 'Heat B1', [makeBoat(2, 201, 'Ivo')]);

    readBoatsByHeat.mockImplementation(async (heatId) => {
      if (heatId === 21) return heatA.boats;
      return heatB.boats;
    });

    const { rerender } = render(
      <ScoringInputComponent heat={heatA} onSubmit={jest.fn()} />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalledWith(21));

    fireEvent.click(screen.getByText('Ana Test'));
    expect(screen.getByText('Sail #101')).toBeInTheDocument();

    rerender(<ScoringInputComponent heat={heatB} onSubmit={jest.fn()} />);

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalledWith(22));

    expect(screen.queryByText('Sail #101')).not.toBeInTheDocument();
    expect(screen.getByText('Heat B1 — Boats')).toBeInTheDocument();
  });

  it('reports fetch error when boats cannot be loaded', async () => {
    readBoatsByHeat.mockRejectedValueOnce(new Error('db offline'));

    render(
      <ScoringInputComponent
        heat={makeHeat(23, 'Heat C1', [makeBoat(1, 101, 'Ana')])}
        onSubmit={jest.fn()}
      />,
    );

    await waitFor(() => {
      expect(reportError).toHaveBeenCalledWith(
        'Could not load boats for selected heat.',
        expect.any(Error),
      );
    });
  });
});
