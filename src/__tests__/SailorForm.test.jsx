/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SailorForm from '../renderer/components/SailorForm';
import { reportInfo, reportWarning } from '../renderer/utils/userFeedback';

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
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
}));

describe('SailorForm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.electron = {
      sqlite: {
        sailorDB: {
          readAllSailors: jest.fn().mockResolvedValue([]),
          readAllClubs: jest
            .fn()
            .mockResolvedValue([
              { club_id: 1, club_name: 'YC Split', country: 'CRO' },
            ]),
          readAllBoats: jest.fn().mockResolvedValue([]),
          insertClub: jest.fn().mockResolvedValue({ lastInsertRowid: 10 }),
          insertSailor: jest.fn().mockResolvedValue({ lastInsertRowid: 11 }),
          insertBoat: jest.fn().mockResolvedValue({ lastInsertRowid: 12 }),
        },
        eventDB: {
          readBoatsByEvent: jest.fn().mockResolvedValue([]),
          associateBoatWithEvent: jest.fn().mockResolvedValue(true),
        },
        heatRaceDB: {
          readAllHeats: jest.fn().mockResolvedValue([]),
          readAllRaces: jest.fn().mockResolvedValue([]),
        },
      },
    };
  });

  it('blocks adding sailors when a race already happened', async () => {
    window.electron.sqlite.heatRaceDB.readAllHeats.mockResolvedValue([
      { heat_id: 2 },
    ]);
    window.electron.sqlite.heatRaceDB.readAllRaces.mockResolvedValue([
      { race_id: 1 },
    ]);

    render(<SailorForm onAddSailor={jest.fn()} eventId={99} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /no more sailors can be added as a race has already happened/i,
        ),
      ).toBeInTheDocument();
    });
  });

  it('submits a new sailor and associates boat with event', async () => {
    const onAddSailor = jest.fn();

    render(<SailorForm onAddSailor={onAddSailor} eventId={99} />);

    fireEvent.change(screen.getByLabelText('First Name'), {
      target: { value: 'Ivan' },
    });
    fireEvent.change(screen.getByLabelText('Surname'), {
      target: { value: 'Horvat' },
    });
    fireEvent.change(screen.getByLabelText('Subgroup'), {
      target: { value: 'M' },
    });
    fireEvent.change(screen.getByLabelText('Sail Number'), {
      target: { value: '1234' },
    });
    fireEvent.change(screen.getByLabelText('Country'), {
      target: { value: 'CRO' },
    });
    fireEvent.change(screen.getByLabelText('Boat Model'), {
      target: { value: 'IOM' },
    });
    fireEvent.change(screen.getByLabelText('Club'), {
      target: { value: 'YC Split' },
    });

    fireEvent.click(screen.getByRole('button', { name: /add sailor/i }));

    await waitFor(() => {
      expect(window.electron.sqlite.sailorDB.insertSailor).toHaveBeenCalledWith(
        'Ivan',
        'Horvat',
        '',
        4,
        10,
      );
      expect(window.electron.sqlite.sailorDB.insertBoat).toHaveBeenCalledWith(
        '1234',
        'CRO',
        'IOM',
        11,
      );
      expect(
        window.electron.sqlite.eventDB.associateBoatWithEvent,
      ).toHaveBeenCalledWith(12, 99);
      expect(onAddSailor).toHaveBeenCalled();
      expect(reportInfo).toHaveBeenCalledWith(
        'Sailor and boat added successfully.',
        'Success',
      );
    });
  });

  it('reuses an existing boat with the same sail number + country instead of inserting a duplicate', async () => {
    const onAddSailor = jest.fn();
    window.electron.sqlite.sailorDB.readAllBoats.mockResolvedValue([
      {
        boat_id: 77,
        sail_number: 1234,
        boat_country: 'CRO',
        model: 'IOM',
        name: 'Ivan',
        surname: 'Horvat',
      },
    ]);

    render(<SailorForm onAddSailor={onAddSailor} eventId={99} />);

    fireEvent.change(screen.getByLabelText('First Name'), {
      target: { value: 'Ivan' },
    });
    fireEvent.change(screen.getByLabelText('Surname'), {
      target: { value: 'Horvat' },
    });
    fireEvent.change(screen.getByLabelText('Subgroup'), {
      target: { value: 'M' },
    });
    fireEvent.change(screen.getByLabelText('Sail Number'), {
      target: { value: '1234' },
    });
    fireEvent.change(screen.getByLabelText('Country'), {
      target: { value: 'CRO' },
    });
    fireEvent.change(screen.getByLabelText('Club'), {
      target: { value: 'YC Split' },
    });

    fireEvent.click(screen.getByRole('button', { name: /add sailor/i }));

    await waitFor(() => {
      expect(window.electron.sqlite.sailorDB.insertBoat).not.toHaveBeenCalled();
      expect(
        window.electron.sqlite.eventDB.associateBoatWithEvent,
      ).toHaveBeenCalledWith(77, 99);
      expect(onAddSailor).toHaveBeenCalled();
    });
  });

  it('reports instead of re-associating when the boat is already in the event', async () => {
    const onAddSailor = jest.fn();
    window.electron.sqlite.sailorDB.readAllBoats.mockResolvedValue([
      { boat_id: 77, sail_number: 1234, boat_country: 'CRO' },
    ]);
    window.electron.sqlite.eventDB.readBoatsByEvent.mockResolvedValue([
      { boat_id: 77 },
    ]);

    render(<SailorForm onAddSailor={onAddSailor} eventId={99} />);

    fireEvent.change(screen.getByLabelText('First Name'), {
      target: { value: 'Ivan' },
    });
    fireEvent.change(screen.getByLabelText('Surname'), {
      target: { value: 'Horvat' },
    });
    fireEvent.change(screen.getByLabelText('Subgroup'), {
      target: { value: 'M' },
    });
    fireEvent.change(screen.getByLabelText('Sail Number'), {
      target: { value: '1234' },
    });
    fireEvent.change(screen.getByLabelText('Country'), {
      target: { value: 'CRO' },
    });
    fireEvent.change(screen.getByLabelText('Club'), {
      target: { value: 'YC Split' },
    });

    fireEvent.click(screen.getByRole('button', { name: /add sailor/i }));

    await waitFor(() => {
      expect(window.electron.sqlite.sailorDB.insertBoat).not.toHaveBeenCalled();
      expect(
        window.electron.sqlite.eventDB.associateBoatWithEvent,
      ).not.toHaveBeenCalled();
      expect(reportInfo).toHaveBeenCalledWith(
        expect.stringMatching(/already registered/i),
        'Already registered',
      );
      expect(onAddSailor).not.toHaveBeenCalled();
    });
  });

  it('reuses existing club and does not insert duplicate club', async () => {
    const onAddSailor = jest.fn();
    window.electron.sqlite.sailorDB.readAllClubs.mockResolvedValue([
      { club_id: 1, club_name: 'YC Split', country: 'CRO' },
    ]);

    render(<SailorForm onAddSailor={onAddSailor} eventId={99} />);

    await waitFor(() => {
      expect(window.electron.sqlite.sailorDB.readAllClubs).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText('First Name'), {
      target: { value: 'Luka' },
    });
    fireEvent.change(screen.getByLabelText('Surname'), {
      target: { value: 'Maric' },
    });
    fireEvent.change(screen.getByLabelText('Subgroup'), {
      target: { value: 'M' },
    });
    fireEvent.change(screen.getByLabelText('Sail Number'), {
      target: { value: '5678' },
    });
    fireEvent.change(screen.getByLabelText('Country'), {
      target: { value: 'CRO' },
    });
    fireEvent.change(screen.getByLabelText('Boat Model'), {
      target: { value: 'IOM' },
    });
    fireEvent.change(screen.getByLabelText('Club'), {
      target: { value: 'YC Split' },
    });

    fireEvent.click(screen.getByRole('button', { name: /add sailor/i }));

    await waitFor(() => {
      expect(window.electron.sqlite.sailorDB.insertClub).not.toHaveBeenCalled();
      expect(window.electron.sqlite.sailorDB.insertSailor).toHaveBeenCalledWith(
        'Luka',
        'Maric',
        '',
        4,
        1,
      );
      expect(
        window.electron.sqlite.eventDB.associateBoatWithEvent,
      ).toHaveBeenCalledWith(12, 99);
      expect(onAddSailor).toHaveBeenCalled();
    });
  });

  it('renders race-started notice instead of form after races exist', async () => {
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

  describe('stray spaces in typed names', () => {
    const fillForm = ({ first, last, club }) => {
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
        target: { value: '1234' },
      });
      fireEvent.change(screen.getByLabelText('Country'), {
        target: { value: 'CRO' },
      });
      fireEvent.change(screen.getByLabelText('Club'), {
        target: { value: club },
      });
      fireEvent.click(screen.getByRole('button', { name: /add sailor/i }));
    };

    it('are trimmed before the sailor and the club are stored', async () => {
      render(<SailorForm onAddSailor={jest.fn()} eventId={99} />);
      fillForm({ first: '  Ivan ', last: 'Horvat  ', club: ' YC Split ' });

      await waitFor(() => {
        expect(
          window.electron.sqlite.sailorDB.insertSailor,
        ).toHaveBeenCalledWith('Ivan', 'Horvat', '', 4, expect.anything());
      });
      // The club is stored without the stray spaces too.
      expect(window.electron.sqlite.sailorDB.insertClub).toHaveBeenCalledWith(
        'YC Split',
        'CRO',
      );
    });

    it('a name made only of spaces is refused with a message, nothing is stored', async () => {
      render(<SailorForm onAddSailor={jest.fn()} eventId={99} />);
      fillForm({ first: '   ', last: 'Horvat', club: 'YC Split' });

      await waitFor(() => expect(reportWarning).toHaveBeenCalled());
      expect(reportWarning).toHaveBeenCalledWith(
        'First name, surname and club cannot be empty or only spaces.',
        'Missing information',
      );
      expect(
        window.electron.sqlite.sailorDB.insertSailor,
      ).not.toHaveBeenCalled();
    });
  });
});
