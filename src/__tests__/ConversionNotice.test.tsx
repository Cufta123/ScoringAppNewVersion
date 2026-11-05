/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from './helpers/renderWithQuery';
import ConversionNotice from '../renderer/components/leaderboard/ConversionNotice';
import type { ConversionReport } from '../shared/conversionReport';

const report = (over: Partial<ConversionReport> = {}): ConversionReport => ({
  convertedAt: '2026-11-05 09:30:00',
  seen: false,
  points: [
    {
      race: 'Heat A1, race 1',
      boat: 'CRO 12',
      status: 'FINISHED',
      before: 3,
      after: 2,
    },
  ],
  heats: [],
  notes: [],
  refused: null,
  ...over,
});

const api = {
  readConversionReport: jest.fn(),
  markConversionReportSeen: jest.fn(),
};

beforeEach(() => {
  api.readConversionReport.mockReset();
  api.markConversionReportSeen.mockReset().mockResolvedValue({ success: true });
  (window as any).electron = { sqlite: { eventDB: api } };
});

describe('ConversionNotice', () => {
  it('shows nothing when there is nothing to tell', async () => {
    api.readConversionReport.mockResolvedValue(null);
    const { container } = render(<ConversionNotice eventId={7} />);
    await waitFor(() =>
      expect(api.readConversionReport).toHaveBeenCalledWith(7),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('says how many results changed, lists them, and goes once confirmed', async () => {
    // As the main process does: once marked, the report reads as seen.
    let seen = false;
    api.readConversionReport.mockImplementation(async () => report({ seen }));
    api.markConversionReportSeen.mockImplementation(async () => {
      seen = true;
      return { success: true };
    });
    render(<ConversionNotice eventId={7} />);
    expect(
      await screen.findByText(
        /1 result is now scored by the rules differently/,
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show what changed' }));
    expect(screen.getByText('Heat A1, race 1')).toBeInTheDocument();
    expect(screen.getByText('CRO 12')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'I have checked this' }),
    );
    await waitFor(() =>
      expect(api.markConversionReportSeen).toHaveBeenCalledWith(7),
    );
    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument(),
    );
  });

  it('stays hidden once confirmed', async () => {
    api.readConversionReport.mockResolvedValue(report({ seen: true }));
    const { container } = render(<ConversionNotice eventId={7} />);
    await waitFor(() => expect(api.readConversionReport).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('lists what the old records could not keep', async () => {
    api.readConversionReport.mockResolvedValue(
      report({
        points: [],
        notes: ['Heat A2: CRO 7 was entered after the Final Series started.'],
      }),
    );
    render(<ConversionNotice eventId={7} />);
    expect(
      await screen.findByText(/1 thing in the old records could not be kept/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show what changed' }));
    expect(screen.getByText(/CRO 7 was entered/)).toBeInTheDocument();
  });
});
