/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import SailorList from '../renderer/components/SailorList';
import { confirmAction } from '../renderer/utils/userFeedback';

jest.mock(
  'react-world-flags',
  () =>
    function FlagMock() {
      return <span data-testid="flag" />;
    },
);
jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  confirmAction: jest.fn(),
  reportError: jest.fn(),
  reportInfo: jest.fn(),
  reportWarning: jest.fn(),
}));

const sailors = [
  {
    boat_id: 1,
    country: 'CRO',
    sail_number: '100',
    model: 'IOM',
    name: 'Ana',
    surname: 'A',
    club: 'YC',
    category: 'SENIOR',
  },
  {
    boat_id: 2,
    country: 'ITA',
    sail_number: '200',
    model: 'IOM',
    name: 'Ben',
    surname: 'B',
    club: 'YC',
    category: 'SENIOR',
  },
];

let updateSailor;
let onRefreshSailors;

beforeEach(() => {
  jest.clearAllMocks();
  updateSailor = jest.fn().mockResolvedValue({ success: true });
  onRefreshSailors = jest.fn();
  window.electron = {
    sqlite: {
      sailorDB: {
        readAllCategories: jest.fn().mockResolvedValue([
          { category_id: 1, category_name: 'SENIOR' },
          { category_id: 2, category_name: 'MASTER' },
        ]),
        readAllClubs: jest.fn().mockResolvedValue([]),
        updateSailor,
      },
    },
  };
});

const openEdit = (who = 'Ana A') => {
  render(
    <SailorList
      sailors={sailors}
      onRefreshSailors={onRefreshSailors}
      onRemoveBoat={jest.fn()}
    />,
  );
  fireEvent.click(screen.getByLabelText(`Edit ${who}`));
  return screen.getByRole('dialog', { name: 'Edit sailor' });
};

describe('SailorList: the edit dialog', () => {
  it('opens with every field labelled and filled from the boat', () => {
    const dialog = openEdit();
    const field = (label) => within(dialog).getByLabelText(label);
    expect(field('First name')).toHaveValue('Ana');
    expect(field('Surname')).toHaveValue('A');
    expect(field('Club')).toHaveValue('YC');
    expect(field('Sail number')).toHaveValue('100');
    expect(field('Country')).toHaveValue('CRO');
    expect(field(/Boat model/)).toHaveValue('IOM');
    expect(field('First name')).toHaveFocus();
  });

  it('refuses an emptied sail number and says so next to the field', async () => {
    const dialog = openEdit();
    fireEvent.change(within(dialog).getByLabelText('Sail number'), {
      target: { value: '   ' },
    });
    fireEvent.click(within(dialog).getByText('Save changes'));

    expect(
      await within(dialog).findByText('Enter the sail number.'),
    ).toBeVisible();
    expect(within(dialog).getByLabelText('Sail number')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(dialog).getByLabelText('Sail number')).toHaveFocus();
    expect(updateSailor).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('refuses a sail number another boat of the event already has', async () => {
    const dialog = openEdit();
    fireEvent.change(within(dialog).getByLabelText('Sail number'), {
      target: { value: '200' },
    });
    fireEvent.change(within(dialog).getByLabelText('Country'), {
      target: { value: 'ITA' },
    });
    fireEvent.click(within(dialog).getByText('Save changes'));

    expect(
      await within(dialog).findByText(/ITA 200 is already sailed by Ben B/),
    ).toBeVisible();
    expect(updateSailor).not.toHaveBeenCalled();
  });

  it('allows the same number under another country', async () => {
    const dialog = openEdit();
    fireEvent.change(within(dialog).getByLabelText('Sail number'), {
      target: { value: '200' },
    });
    fireEvent.click(within(dialog).getByText('Save changes'));
    await waitFor(() => expect(updateSailor).toHaveBeenCalledTimes(1));
  });

  it('saves the trimmed values, closes and reloads the list', async () => {
    const dialog = openEdit();
    fireEvent.change(within(dialog).getByLabelText('First name'), {
      target: { value: ' Anka ' },
    });
    // The subgroup list arrives from the database after the first render.
    await waitFor(() =>
      expect(
        within(dialog)
          .getByLabelText('Subgroup')
          .querySelector('option[value="MASTER"]'),
      ).not.toBeNull(),
    );
    fireEvent.change(within(dialog).getByLabelText('Subgroup'), {
      target: { value: 'MASTER' },
    });
    // Enter in a field submits the form.
    fireEvent.submit(within(dialog).getByLabelText('First name'));

    await waitFor(() => expect(updateSailor).toHaveBeenCalledTimes(1));
    expect(updateSailor).toHaveBeenCalledWith(
      expect.objectContaining({
        boat_id: 1,
        name: 'Anka',
        surname: 'A',
        sail_number: '100',
        club_name: 'YC',
        originalClubName: 'YC',
        category_name: 'MASTER',
        country: 'CRO',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(onRefreshSailors).toHaveBeenCalledTimes(1);
  });

  it('closes without saving when nothing was changed', async () => {
    const dialog = openEdit();
    fireEvent.click(within(dialog).getByText('Save changes'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(updateSailor).not.toHaveBeenCalled();
  });
});

// Closing with typed changes would lose them, so it asks first, and only then.
describe('SailorList: closing the edit dialog with unsaved changes', () => {
  it('closes silently when nothing was changed', async () => {
    const dialog = openEdit();
    fireEvent.click(within(dialog).getByText('Cancel'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(confirmAction).not.toHaveBeenCalled();
  });

  it('asks first, and keeps editing on "keep"', async () => {
    confirmAction.mockResolvedValue(false);
    const dialog = openEdit();
    fireEvent.change(within(dialog).getByLabelText('First name'), {
      target: { value: 'Anka' },
    });
    fireEvent.click(within(dialog).getByText('Cancel'));

    await waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1));
    expect(confirmAction).toHaveBeenCalledWith(
      expect.stringContaining('not saved'),
      'Discard unsaved changes',
      expect.objectContaining({
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
      }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('First name')).toHaveValue('Anka');
  });

  it('asks on Escape too, and closes when the changes are discarded', async () => {
    confirmAction.mockResolvedValue(true);
    const dialog = openEdit();
    fireEvent.change(within(dialog).getByLabelText('First name'), {
      target: { value: 'Anka' },
    });
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(confirmAction).toHaveBeenCalledTimes(1);
    expect(updateSailor).not.toHaveBeenCalled();
  });

  it('opens another boat fresh after closing', async () => {
    const dialog = openEdit();
    fireEvent.click(within(dialog).getByText('Cancel'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText('Edit Ben B'));
    expect(
      within(screen.getByRole('dialog')).getByLabelText('First name'),
    ).toHaveValue('Ben');
  });
});
