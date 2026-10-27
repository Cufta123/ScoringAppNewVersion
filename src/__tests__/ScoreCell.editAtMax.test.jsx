/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import ScoreCell from '../renderer/components/leaderboard/ScoreCell';
import { EditValidityProvider } from '../renderer/components/leaderboard/editValidity';

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
    expect(input).toHaveValue('7');

    fireEvent.change(input, { target: { value: '' } });
    // The field reflects the cleared draft, so the user can type a new place.
    expect(input).toHaveValue('');
  });

  it('replaces the value when the user types over the selected max', () => {
    const { onRaceChange } = renderCell();
    const input = screen.getByLabelText('Race 1 value');

    // Focus selects the contents, so typing replaces rather than appends.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '3' } });

    expect(input).toHaveValue('3');
    expect(onRaceChange).toHaveBeenLastCalledWith(1, 0, '3', 'FINISHED');
  });

  it('is a text field, so the mouse wheel and arrow keys cannot change it', () => {
    renderCell();
    expect(screen.getByLabelText('Race 1 value')).toHaveAttribute(
      'type',
      'text',
    );
  });
});

describe('ScoreCell refuses impossible input instead of correcting it', () => {
  it.each([
    ['15', /only 7 boats sailed/i],
    ['0', /best place is 1/i],
    ['-3', /whole number/i],
    ['2.5', /whole number/i],
    ['abc', /whole number/i],
  ])('place %s: shown in red, explained, not applied', (typed, reason) => {
    const reportInvalid = jest.fn();
    const onRaceChange = jest.fn();
    render(
      <EditValidityProvider value={reportInvalid}>
        <table>
          <tbody>
            <tr>
              <ScoreCell
                race="3"
                raceStatus="FINISHED"
                raceIndex={0}
                boatId={1}
                entry={{
                  boat_id: 1,
                  boat_number: 205,
                  races: ['3'],
                  race_statuses: ['FINISHED'],
                }}
                editMode
                isEditable
                maxPosition={7}
                onRaceChange={onRaceChange}
                setRdg2Picker={jest.fn()}
                confirmRdg2={jest.fn()}
              />
            </tr>
          </tbody>
        </table>
      </EditValidityProvider>,
    );
    const input = screen.getByLabelText('Race 1 value');
    fireEvent.change(input, { target: { value: typed } });
    fireEvent.blur(input);

    // The typed text stays, so the scorer sees what was wrong.
    expect(input).toHaveValue(typed);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('1–7');
    expect(onRaceChange).not.toHaveBeenCalled();
    expect(reportInvalid).toHaveBeenLastCalledWith(
      '1-0',
      expect.stringMatching(reason),
    );
    expect(reportInvalid.mock.calls.at(-1)[1]).toMatch(/^Sail 205, Q1:/);

    // Fixing it clears the error and applies the place.
    fireEvent.change(input, { target: { value: '6' } });
    expect(onRaceChange).toHaveBeenLastCalledWith(1, 0, '6', 'FINISHED');
    expect(reportInvalid).toHaveBeenLastCalledWith('1-0', null);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('protest committee points (RDG3): up to 99, one decimal, comma accepted', () => {
    const { onRaceChange } = renderCell({ raceStatus: 'RDG3', race: '5' });
    const input = screen.getByLabelText('Race 1 value');

    fireEvent.change(input, { target: { value: '4,5' } });
    expect(onRaceChange).toHaveBeenLastCalledWith(1, 0, '4.5', 'RDG3');

    onRaceChange.mockClear();
    fireEvent.change(input, { target: { value: '123' } });
    expect(onRaceChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Max 99');
  });

  // LB-3: selecting any non-RDG2 status must close this cell's open RDG2 picker,
  // otherwise clicking Apply (confirmRdg2) would silently revert the choice.
  it('closes an open RDG2 picker when a non-RDG2 status is chosen', () => {
    const setRdg2Picker = jest.fn();
    const { onRaceChange } = renderCell({
      raceStatus: 'FINISHED',
      rdg2Picker: { boatId: 1, raceIndex: 0, selectedIndices: new Set([0]) },
      setRdg2Picker,
    });

    const select = screen.getByLabelText('Race 1 status');
    fireEvent.change(select, { target: { value: 'DNS' } });

    expect(setRdg2Picker).toHaveBeenCalledWith(null);
    expect(onRaceChange).toHaveBeenCalledWith(1, 0, null, 'DNS');
  });
});
