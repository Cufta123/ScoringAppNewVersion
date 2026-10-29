/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ScoringInputComponent from '../renderer/components/ScoringInputComponent';
import { reportWarning } from '../renderer/utils/userFeedback';

jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
}));

const boats = [
  {
    boat_id: 1,
    sail_number: 101,
    name: 'Ana',
    surname: 'Test',
    country: 'CRO',
  },
  {
    boat_id: 2,
    sail_number: 102,
    name: 'Ivo',
    surname: 'Test',
    country: 'CRO',
  },
];

// A whole race can be scored from the keyboard: type the sail numbers, Enter,
// then Ctrl/Cmd+Enter submits (the button's title says so).
describe('scoring screen keyboard path', () => {
  let onSubmit;

  beforeEach(() => {
    jest.clearAllMocks();
    onSubmit = jest.fn();
    window.electron = {
      sqlite: {
        heatRaceDB: { readBoatsByHeat: jest.fn().mockResolvedValue(boats) },
      },
    };
    render(
      <ScoringInputComponent
        heat={{ heat_id: 5, heat_name: 'Heat A1', boats }}
        onSubmit={onSubmit}
      />,
    );
  });

  const field = () => screen.getByLabelText('Add sail numbers manually');

  it('submits with Ctrl+Enter once every boat is scored', async () => {
    fireEvent.change(field(), { target: { value: '102 101' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(field()).toHaveValue('');

    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith([
      { boatNumber: '102', place: 1, status: 'FINISHED' },
      { boatNumber: '101', place: 2, status: 'FINISHED' },
    ]);
  });

  it('works with Cmd+Enter too, and from outside the field', async () => {
    fireEvent.change(field(), { target: { value: '101 102' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'Enter', metaKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('with numbers still typed, Ctrl+Enter only adds them and does not submit', async () => {
    fireEvent.change(field(), { target: { value: '101' } });
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true });
    expect(field()).toHaveValue('');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('runs the same checks as the button: missing boats are named, nothing is submitted', async () => {
    fireEvent.change(field(), { target: { value: '101' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(reportWarning).toHaveBeenCalled());
    expect(reportWarning).toHaveBeenCalledWith(
      expect.stringContaining('102'),
      'Some boats are not scored yet',
      { inline: true },
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('is ignored while a dialog is open', async () => {
    fireEvent.change(field(), { target: { value: '101 102' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    dialog.remove();
  });

  it('names the shortcut in the Submit button title', async () => {
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Submit Scores' }).title,
      ).toMatch(/(Ctrl|Cmd)\+Enter/),
    );
  });
});
