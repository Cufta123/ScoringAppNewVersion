/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SailorForm from '../renderer/components/SailorForm';
import {
  confirmAction,
  reportError,
  reportInfo,
  reportWarning,
} from '../renderer/utils/userFeedback';

// The form hands everything to ONE main-process call (enterSailorInEvent),
// which writes club, sailor, boat and entry together; what it stores is
// tested on real SQLite in sailorEntry.integration.test.ts.

jest.mock(
  'react-autosuggest',
  () =>
    function ({ inputProps }) {
      return (
        <input
          {...inputProps}
          onChange={(event) =>
            inputProps.onChange(event, { newValue: event.target.value })
          }
        />
      );
    },
);

jest.mock('react-toastify', () => ({
  toast: {
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  confirmAction: jest.fn(),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
}));

const entered = {
  status: 'entered',
  boatId: 12,
  sailorId: 11,
  createdBoat: true,
  createdSailor: true,
};

let enterSailorInEvent;

beforeEach(() => {
  jest.clearAllMocks();
  enterSailorInEvent = jest.fn().mockResolvedValue(entered);
  window.electron = {
    sqlite: {
      sailorDB: {
        readAllClubs: jest
          .fn()
          .mockResolvedValue([
            { club_id: 1, club_name: 'YC Split', country: 'CRO' },
          ]),
        enterSailorInEvent,
      },
      heatRaceDB: {
        readAllHeats: jest.fn().mockResolvedValue([]),
        readAllRaces: jest.fn().mockResolvedValue([]),
      },
    },
  };
});

const fillForm = ({
  first = 'Ivan',
  last = 'Horvat',
  club = 'YC Split',
  sail = '1234',
} = {}) => {
  fireEvent.change(screen.getByLabelText('First Name'), {
    target: { value: first },
  });
  fireEvent.change(screen.getByLabelText('Surname'), {
    target: { value: last },
  });
  fireEvent.change(screen.getByLabelText('Subgroup'), {
    target: { value: 'M' },
  });
  fireEvent.change(screen.getByLabelText('Sail Number'), {
    target: { value: sail },
  });
  fireEvent.change(screen.getByLabelText('Country'), {
    target: { value: 'CRO' },
  });
  fireEvent.change(screen.getByLabelText('Boat Model'), {
    target: { value: 'IOM' },
  });
  fireEvent.change(screen.getByLabelText('Club'), {
    target: { value: club },
  });
  fireEvent.click(screen.getByRole('button', { name: /add sailor/i }));
};

describe('SailorForm', () => {
  it('blocks adding sailors when a race already happened', async () => {
    window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
      { heat_id: 2 },
    ]);
    window.electron.sqlite.heatRaceDB.readAllRaces.mockResolvedValue([
      { race_id: 1 },
    ]);

    render(<SailorForm onAddSailor={jest.fn()} eventId={99} />);

    expect(
      await screen.findByText(/no more sailors can be added/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /add sailor/i }),
    ).not.toBeInTheDocument();
  });

  it('enters the sailor with one call and reports success', async () => {
    const onAddSailor = jest.fn();
    render(<SailorForm onAddSailor={onAddSailor} eventId={99} />);
    fillForm();

    await waitFor(() => expect(onAddSailor).toHaveBeenCalled());
    expect(enterSailorInEvent).toHaveBeenCalledTimes(1);
    expect(enterSailorInEvent).toHaveBeenCalledWith(
      {
        name: 'Ivan',
        surname: 'Horvat',
        clubName: 'YC Split',
        country: 'CRO',
        sailNumber: '1234',
        model: 'IOM',
        categoryId: 4,
      },
      99,
    );
    expect(reportInfo).toHaveBeenCalledWith(
      'Sailor and boat added successfully.',
      'Success',
    );
  });

  it('asks before entering a boat registered to someone else, then enters her', async () => {
    enterSailorInEvent
      .mockResolvedValueOnce({
        status: 'ownerConflict',
        boatId: 5,
        ownerName: 'Ana Kovač',
      })
      .mockResolvedValueOnce({ ...entered, createdBoat: false });
    confirmAction.mockResolvedValue(true);
    const onAddSailor = jest.fn();
    render(<SailorForm onAddSailor={onAddSailor} eventId={99} />);
    fillForm();

    await waitFor(() => expect(onAddSailor).toHaveBeenCalled());
    expect(confirmAction.mock.calls[0][0]).toMatch(
      /already registered to Ana Kovač/,
    );
    expect(enterSailorInEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ sailNumber: '1234' }),
      99,
      { useRegisteredSailor: true },
    );
  });

  it('a Cancel on that question writes nothing (the first call wrote nothing either)', async () => {
    enterSailorInEvent.mockResolvedValueOnce({
      status: 'ownerConflict',
      boatId: 5,
      ownerName: 'Ana Kovač',
    });
    confirmAction.mockResolvedValue(false);
    const onAddSailor = jest.fn();
    render(<SailorForm onAddSailor={onAddSailor} eventId={99} />);
    fillForm();

    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(enterSailorInEvent).toHaveBeenCalledTimes(1);
    expect(onAddSailor).not.toHaveBeenCalled();
    expect(reportInfo).not.toHaveBeenCalled();
  });

  it('says so when the boat is already in this event', async () => {
    enterSailorInEvent.mockResolvedValue({
      status: 'alreadyEntered',
      boatId: 12,
    });
    const onAddSailor = jest.fn();
    render(<SailorForm onAddSailor={onAddSailor} eventId={99} />);
    fillForm();

    await waitFor(() =>
      expect(reportInfo).toHaveBeenCalledWith(
        'Sail 1234 (CRO) is already registered in this event.',
        'Already registered',
      ),
    );
    expect(onAddSailor).not.toHaveBeenCalled();
  });

  it('shows the refusal of a sail number the event already has', async () => {
    enterSailorInEvent.mockRejectedValue(
      new Error(
        'Sail CRO 1234 is already entered in this event. Check the sail number and country.',
      ),
    );
    render(<SailorForm onAddSailor={jest.fn()} eventId={99} />);
    fillForm();

    await waitFor(() =>
      expect(reportWarning).toHaveBeenCalledWith(
        'Sail CRO 1234 is already entered in this event.',
        'Already entered',
      ),
    );
    expect(reportError).not.toHaveBeenCalled();
  });

  it('trims stray spaces before sending', async () => {
    render(<SailorForm onAddSailor={jest.fn()} eventId={99} />);
    fillForm({ first: '  Ivan ', last: 'Horvat  ', club: ' YC Split ' });

    await waitFor(() => expect(enterSailorInEvent).toHaveBeenCalled());
    expect(enterSailorInEvent.mock.calls[0][0]).toMatchObject({
      name: 'Ivan',
      surname: 'Horvat',
      clubName: 'YC Split',
    });
  });

  it('refuses a name made only of spaces and sends nothing', async () => {
    render(<SailorForm onAddSailor={jest.fn()} eventId={99} />);
    fillForm({ first: '   ' });

    await waitFor(() =>
      expect(reportWarning).toHaveBeenCalledWith(
        'First name, surname and club cannot be empty or only spaces.',
        'Missing information',
      ),
    );
    expect(enterSailorInEvent).not.toHaveBeenCalled();
  });
});
