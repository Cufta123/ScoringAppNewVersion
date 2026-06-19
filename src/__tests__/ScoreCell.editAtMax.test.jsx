/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoreCell from '../renderer/components/leaderboard/ScoreCell';

// Regression: a finishing-place cell that already shows the heat's maximum place
// (e.g. 7 of 7) must stay editable. Before the draft-input fix the field was
// fully controlled by the derived value, so clearing it snapped back and an
// appended digit clamped straight to the max — the cell looked frozen.
const renderCell = (overrides = {}) => {
  const onRaceChange = jest.fn();
  render(
    <table>
      <tbody>
        <tr>
          <ScoreCell
            race="7"
            raceStatus="FINISHED"
            raceIndex={0}
            boatId={1}
            entry={{ boat_id: 1, races: ['7'], race_statuses: ['FINISHED'] }}
            editMode
            isEditable
            maxPosition={7}
            onRaceChange={onRaceChange}
            setRdg2Picker={jest.fn()}
            confirmRdg2={jest.fn()}
            {...overrides}
          />
        </tr>
      </tbody>
    </table>,
  );
  return { onRaceChange };
};

describe('ScoreCell editing at the max place', () => {
  it('lets the user clear the field instead of snapping back to the max', () => {
    renderCell();
    const input = screen.getByLabelText('Race 1 value');
    expect(input).toHaveValue(7);

    fireEvent.change(input, { target: { value: '' } });
    // The field reflects the cleared draft, so the user can type a new place.
    expect(input).toHaveValue(null);
  });

  it('replaces the value when the user types over the selected max', () => {
    const { onRaceChange } = renderCell();
    const input = screen.getByLabelText('Race 1 value');

    // Focus selects the contents, so typing replaces rather than appends.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '3' } });

    expect(input).toHaveValue(3);
    expect(onRaceChange).toHaveBeenLastCalledWith(1, 0, '3', 'FINISHED');
  });

  it('caps a manual RDG (RDG3) entry at two integer digits', () => {
    const { onRaceChange } = renderCell({ raceStatus: 'RDG3', race: '5' });
    const input = screen.getByLabelText('Race 1 value');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '123' } });

    // Third digit is dropped: 99 is the most a 2-digit RDG can be.
    expect(input).toHaveValue(12);
    expect(onRaceChange).toHaveBeenLastCalledWith(1, 0, '12', 'RDG3');
  });

  it('keeps decimals on a manual RDG entry while capping the integer part', () => {
    const { onRaceChange } = renderCell({ raceStatus: 'RDG3', race: '5' });
    const input = screen.getByLabelText('Race 1 value');

    fireEvent.change(input, { target: { value: '123.5' } });

    expect(onRaceChange).toHaveBeenLastCalledWith(1, 0, '12.5', 'RDG3');
  });
});
