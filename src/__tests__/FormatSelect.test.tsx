/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import FormatSelect from '../renderer/components/shared/FormatSelect';

describe('FormatSelect', () => {
  it('has a visible "Format" label and says what the format is of', () => {
    render(
      <FormatSelect
        ariaLabel="Starting list format"
        value="excel"
        onChange={jest.fn()}
      />,
    );
    expect(screen.getByText('Format')).toBeVisible();
    expect(screen.getByLabelText('Starting list format')).toHaveValue('excel');
  });

  it('reports the chosen format', () => {
    const onChange = jest.fn();
    render(
      <FormatSelect
        ariaLabel="New heats format"
        value="excel"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('New heats format'), {
      target: { value: 'pdf' },
    });
    expect(onChange).toHaveBeenCalledWith('pdf');
  });
});
