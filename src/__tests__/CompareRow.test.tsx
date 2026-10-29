/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  CompareRow,
  leaderboardRowStyle,
} from '../renderer/components/leaderboard/TablePieces';

function Row({
  compareMode,
  onPick,
}: {
  compareMode: boolean;
  onPick: () => void;
}) {
  return (
    <table>
      <tbody>
        <CompareRow
          compareMode={compareMode}
          isSelected={false}
          onPick={onPick}
          style={leaderboardRowStyle(0, false, compareMode)}
        >
          <td>
            <button type="button">inner</button>
          </td>
        </CompareRow>
      </tbody>
    </table>
  );
}

describe('CompareRow: leaderboard rows from the keyboard', () => {
  it('is a Tab stop and answers Enter and Space while comparing', () => {
    const onPick = jest.fn();
    render(<Row compareMode onPick={onPick} />);
    const row = screen.getByRole('row');
    expect(row).toHaveAttribute('tabindex', '0');
    expect(row).toHaveAttribute('aria-selected', 'false');
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    fireEvent.keyDown(row, { key: 'a' });
    expect(onPick).toHaveBeenCalledTimes(2);
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledTimes(3);
  });

  it('is not a Tab stop, and ignores keys, outside compare mode', () => {
    const onPick = jest.fn();
    render(<Row compareMode={false} onPick={onPick} />);
    const row = screen.getByRole('row');
    expect(row).not.toHaveAttribute('tabindex');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('leaves keys pressed on a button inside the row to that button', () => {
    const onPick = jest.fn();
    render(<Row compareMode onPick={onPick} />);
    fireEvent.keyDown(screen.getByText('inner'), { key: 'Enter' });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('does not suppress the stylesheet focus ring with an inline outline', () => {
    expect(leaderboardRowStyle(0, false, true).outline).toBeUndefined();
    expect(leaderboardRowStyle(0, true, true).outline).toBeDefined();
  });
});
