/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScoringInputComponent from '../renderer/components/ScoringInputComponent';
import { reportError, reportWarning } from '../renderer/utils/userFeedback';

jest.mock('../renderer/utils/userFeedback', () => ({
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
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

  // RULE-M12 / RRS A7: boats tied at the finishing line share a place. The
  // backend already averages the points for a shared place; before this there
  // was no way to record the dead heat, because the finish order forced
  // strictly distinct places.
  describe('RRS A7 dead heats (RULE-M12)', () => {
    const threeBoats = [
      makeBoat(1, 101, 'Ana'),
      makeBoat(2, 102, 'Ivo'),
      makeBoat(3, 103, 'Mia'),
    ];

    const renderWithThree = async (onSubmit) => {
      readBoatsByHeat.mockResolvedValueOnce(threeBoats);
      render(
        <ScoringInputComponent
          heat={makeHeat(31, 'Heat A1', threeBoats)}
          onSubmit={onSubmit}
        />,
      );
      await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());
      fireEvent.click(screen.getByText('Ana Test'));
      fireEvent.click(screen.getByText('Ivo Test'));
      fireEvent.click(screen.getByText('Mia Test'));
    };

    it('submits a shared place for two boats tied at the line', async () => {
      const onSubmit = jest.fn();
      await renderWithThree(onSubmit);

      // Mark 102 (2nd) as tied with 101 (1st).
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Sail 102 tied with the boat above',
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

      // Both tie for 1st; the next boat takes 3rd (RRS A7).
      expect(onSubmit).toHaveBeenCalledWith([
        { boatNumber: 101, place: 1, status: 'FINISHED' },
        { boatNumber: 102, place: 1, status: 'FINISHED' },
        { boatNumber: 103, place: 3, status: 'FINISHED' },
      ]);
    });

    it('shows the shared place in the finish order', async () => {
      await renderWithThree(jest.fn());

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Sail 102 tied with the boat above',
        }),
      );

      expect(
        screen.getByLabelText('Finishing place for sail 102 (currently 1)'),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText('Finishing place for sail 103 (currently 3)'),
      ).toBeInTheDocument();
    });

    it('is reversible — untoggling restores distinct places', async () => {
      const onSubmit = jest.fn();
      await renderWithThree(onSubmit);

      const tieBtn = screen.getByRole('button', {
        name: 'Sail 102 tied with the boat above',
      });
      fireEvent.click(tieBtn);
      fireEvent.click(tieBtn);
      fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

      expect(onSubmit).toHaveBeenCalledWith([
        { boatNumber: 101, place: 1, status: 'FINISHED' },
        { boatNumber: 102, place: 2, status: 'FINISHED' },
        { boatNumber: 103, place: 3, status: 'FINISHED' },
      ]);
    });

    it('cannot tie the first boat, and drops the tie when a penalty is applied', async () => {
      const onSubmit = jest.fn();
      await renderWithThree(onSubmit);

      expect(
        screen.getByRole('button', {
          name: 'Sail 101 tied with the boat above',
        }),
      ).toBeDisabled();

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Sail 102 tied with the boat above',
        }),
      );
      // A penalised boat is not "tied at the finishing line": the mark is
      // dropped and 102 moves to the end of the order (SHRS 5.3).
      fireEvent.change(screen.getByLabelText('Penalty for sail 102'), {
        target: { value: 'DNF' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

      expect(onSubmit).toHaveBeenCalledWith([
        { boatNumber: 101, place: 1, status: 'FINISHED' },
        { boatNumber: 103, place: 2, status: 'FINISHED' },
        { boatNumber: 102, place: 3, status: 'DNF' },
      ]);
    });

    it('drops a tie when the boat above it is penalised (no silent rebind)', async () => {
      const onSubmit = jest.fn();
      await renderWithThree(onSubmit);

      // 103 is tied with 102 (the boat directly above it).
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Sail 103 tied with the boat above',
        }),
      );
      // Penalise 102 — the boat ABOVE the tie — which displaces it to the end.
      fireEvent.change(screen.getByLabelText('Penalty for sail 102'), {
        target: { value: 'DNF' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

      // 103 must NOT silently rebind to 101: it is now alone in 2nd.
      expect(onSubmit).toHaveBeenCalledWith([
        { boatNumber: 101, place: 1, status: 'FINISHED' },
        { boatNumber: 103, place: 2, status: 'FINISHED' },
        { boatNumber: 102, place: 3, status: 'DNF' },
      ]);
    });

    it('a position-keeping penalty keeps the shared (tied) place', async () => {
      const onSubmit = jest.fn();
      await renderWithThree(onSubmit);

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Sail 102 tied with the boat above',
        }),
      );
      // ZFP keeps its finishing place, so a tied boat keeps the shared place.
      fireEvent.change(screen.getByLabelText('Penalty for sail 102'), {
        target: { value: 'ZFP' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

      expect(onSubmit).toHaveBeenCalledWith([
        { boatNumber: 101, place: 1, status: 'FINISHED' },
        { boatNumber: 102, place: 1, status: 'ZFP' },
        { boatNumber: 103, place: 3, status: 'FINISHED' },
      ]);
    });

    it('prunes a tie when a reorder breaks its adjacency', async () => {
      const onSubmit = jest.fn();
      await renderWithThree(onSubmit);

      // 103 is tied with 102 (the boat directly above it).
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Sail 103 tied with the boat above',
        }),
      );

      // Move 103 up one place: order becomes 101, 103, 102. 102 and 103 are
      // still adjacent, but the directional tie (102 above 103) is broken.
      fireEvent.click(screen.getByRole('button', { name: 'Move sail 103 up' }));

      // Move 103 back down: order is 101, 102, 103 again. The stale tie must
      // NOT silently re-activate, so 103 keeps its own place (3rd).
      fireEvent.click(
        screen.getByRole('button', { name: 'Move sail 103 down' }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

      expect(onSubmit).toHaveBeenCalledWith([
        { boatNumber: 101, place: 1, status: 'FINISHED' },
        { boatNumber: 102, place: 2, status: 'FINISHED' },
        { boatNumber: 103, place: 3, status: 'FINISHED' },
      ]);
    });

    it('drags a boat to the intended index, not always to the end', async () => {
      const onSubmit = jest.fn();
      readBoatsByHeat.mockResolvedValueOnce(threeBoats);
      const { container } = render(
        <ScoringInputComponent
          heat={makeHeat(32, 'Heat A1', threeBoats)}
          onSubmit={onSubmit}
        />,
      );
      await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());
      fireEvent.click(screen.getByText('Ana Test'));
      fireEvent.click(screen.getByText('Ivo Test'));
      fireEvent.click(screen.getByText('Mia Test'));

      const items = container.querySelectorAll('.finish-item');
      expect(items).toHaveLength(3);

      // Drag 103 (last) over 102 (middle) and drop: it must land at index 1,
      // not be appended after the last item.
      fireEvent.dragStart(items[2]);
      fireEvent.dragOver(items[1]);
      fireEvent.drop(items[1]);

      fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

      expect(onSubmit).toHaveBeenCalledWith([
        { boatNumber: 101, place: 1, status: 'FINISHED' },
        { boatNumber: 103, place: 2, status: 'FINISHED' },
        { boatNumber: 102, place: 3, status: 'FINISHED' },
      ]);
    });
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
        place: 1,
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
    expect(reportWarning).toHaveBeenCalledWith(
      expect.stringContaining('Still missing: sail 102'),
      'Some boats are not scored yet',
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
    expect(reportWarning).toHaveBeenCalled();
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

  it('moves a boat when a finishing place is typed directly', async () => {
    const boats = [makeBoat(1, 101, 'Ana'), makeBoat(2, 102, 'Ivo')];
    readBoatsByHeat.mockResolvedValueOnce(boats);
    const onSubmit = jest.fn();

    render(
      <ScoringInputComponent
        heat={makeHeat(19, 'Heat B5', boats)}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Ana Test')); // 101 -> place 1
    fireEvent.click(screen.getByText('Ivo Test')); // 102 -> place 2

    // Type place 1 for sail 102 and commit — it should jump ahead of 101.
    const placeInput = screen.getByLabelText(/Finishing place for sail 102/);
    fireEvent.change(placeInput, { target: { value: '1' } });
    fireEvent.blur(placeInput);

    fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

    expect(onSubmit).toHaveBeenCalledWith([
      { boatNumber: 102, place: 1, status: 'FINISHED' },
      { boatNumber: 101, place: 2, status: 'FINISHED' },
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

  it('clears valid boats after heat change when next fetch fails', async () => {
    const heatA = makeHeat(31, 'Heat A1', [makeBoat(1, 101, 'Ana')]);
    const heatB = makeHeat(32, 'Heat B1', [makeBoat(2, 201, 'Ivo')]);

    readBoatsByHeat
      .mockResolvedValueOnce(heatA.boats)
      .mockRejectedValueOnce(new Error('fetch failed for heat B'));

    const { rerender } = render(
      <ScoringInputComponent heat={heatA} onSubmit={jest.fn()} />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalledWith(31));

    rerender(<ScoringInputComponent heat={heatB} onSubmit={jest.fn()} />);

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalledWith(32));

    fireEvent.change(screen.getByLabelText('Add sail numbers manually'), {
      target: { value: '101' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Add sail number to finish order' }),
    );

    expect(screen.queryByText('Sail #101')).not.toBeInTheDocument();
    expect(reportWarning).toHaveBeenCalledWith(
      expect.stringContaining('These sail numbers are not in Heat B1: 101'),
      'Unknown sail numbers',
    );
  });

  it('submits displacing penalties in strict SHRS 5.3 order', async () => {
    const boats = [
      makeBoat(1, 101, 'Ana'),
      makeBoat(2, 102, 'Ivo'),
      makeBoat(3, 103, 'Mia'),
      makeBoat(4, 104, 'Luka'),
    ];
    readBoatsByHeat.mockResolvedValueOnce(boats);
    const onSubmit = jest.fn();

    render(
      <ScoringInputComponent
        heat={makeHeat(33, 'Heat C2', boats)}
        onSubmit={onSubmit}
      />,
    );

    await waitFor(() => expect(readBoatsByHeat).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Ana Test'));
    fireEvent.change(screen.getByLabelText('Penalty for sail 104'), {
      target: { value: 'DSQ' },
    });
    fireEvent.change(screen.getByLabelText('Penalty for sail 103'), {
      target: { value: 'DNF' },
    });
    fireEvent.change(screen.getByLabelText('Penalty for sail 102'), {
      target: { value: 'DNS' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Submit Scores' }));

    expect(onSubmit).toHaveBeenCalledWith([
      {
        boatNumber: 101,
        place: 1,
        status: 'FINISHED',
      },
      {
        boatNumber: 103,
        place: 2,
        status: 'DNF',
      },
      {
        boatNumber: 102,
        place: 3,
        status: 'DNS',
      },
      {
        boatNumber: 104,
        place: 4,
        status: 'DSQ',
      },
    ]);
  });
});
