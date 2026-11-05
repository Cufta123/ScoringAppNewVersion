/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from './helpers/renderWithQuery';
import ProblemReportHost from '../renderer/components/ProblemReportHost';
import ProblemReportDialog from '../renderer/components/ProblemReportDialog';
import { confirmAction } from '../renderer/utils/userFeedback';
import {
  requestProblemReport,
  setReportEventContext,
} from '../renderer/utils/problemReport';

jest.mock('../renderer/utils/userFeedback', () => ({
  ...jest.requireActual('../renderer/utils/userFeedback'),
  confirmAction: jest.fn(),
}));

const SHOT = 'data:image/jpeg;base64,/9j/AAAA';
let sendProblemReport;
let captureProblemScreenshot;

beforeEach(() => {
  jest.clearAllMocks();
  sendProblemReport = jest
    .fn()
    .mockResolvedValue({ status: 'sent', reportId: 'R-AAAAA001' });
  captureProblemScreenshot = jest.fn().mockResolvedValue(SHOT);
  window.electron = {
    sqlite: {
      problemReportDB: { sendProblemReport, captureProblemScreenshot },
    },
    appEvents: { onOpenProblemReport: jest.fn(() => () => {}) },
  };
});

const renderDialog = (props = {}) => {
  const onClose = jest.fn();
  render(
    <ProblemReportDialog
      eventId={7}
      screenshot={SHOT}
      route="#/event/Kup/leaderboard"
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
};

const fillRequired = () => {
  fireEvent.change(screen.getByLabelText('What kind of problem?'), {
    target: { value: 'wrong-results' },
  });
  fireEvent.change(screen.getByLabelText('What went wrong?'), {
    target: { value: 'CRO 12 has the wrong points in Q3.' },
  });
};

describe('ProblemReportDialog', () => {
  it('starts on the page the user was on, with everything attached', () => {
    renderDialog();
    expect(screen.getByLabelText('Where in the app?')).toHaveValue(
      'leaderboard',
    );
    expect(screen.getByLabelText(/This event's data/)).toBeChecked();
    expect(screen.getByLabelText(/This event's history/)).toBeChecked();
    expect(screen.getByLabelText(/The error log/)).toBeChecked();
    expect(screen.getByLabelText(/A picture of the screen/)).toBeChecked();
    expect(screen.getByAltText('The screen that will be sent')).toBeVisible();
  });

  it('shows what is missing under each field and sends nothing', () => {
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /Send report/ }));
    expect(
      screen.getByText('Choose what kind of problem it is.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Describe what went wrong/)).toBeInTheDocument();
    expect(sendProblemReport).not.toHaveBeenCalled();
  });

  it('sends the form with what the user chose to attach', async () => {
    renderDialog();
    fillRequired();
    fireEvent.click(screen.getByLabelText(/The error log/));
    fireEvent.click(screen.getByRole('button', { name: /Send report/ }));
    await screen.findByText(/Report sent/);
    expect(sendProblemReport).toHaveBeenCalledWith(
      expect.objectContaining({
        form: expect.objectContaining({
          kind: 'wrong-results',
          area: 'leaderboard',
          problem: 'CRO 12 has the wrong points in Q3.',
        }),
        includes: {
          snapshot: true,
          history: true,
          errorLog: false,
          screenshot: true,
        },
        context: expect.objectContaining({
          eventId: 7,
          route: '#/event/Kup/leaderboard',
        }),
        screenshot: SHOT,
      }),
    );
    expect(screen.getByText('R-AAAAA001')).toBeInTheDocument();
  });

  it('says a report kept for later will go by itself', async () => {
    sendProblemReport.mockResolvedValue({
      status: 'queued',
      reportId: 'R-AAAAA002',
      reason: 'No connection to the report service (network error).',
    });
    renderDialog();
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /Send report/ }));
    expect(await screen.findByText(/it will be sent later/)).toBeVisible();
    expect(screen.getByText(/goes out by itself/)).toBeVisible();
  });

  it('shows a refusal and keeps what was written', async () => {
    sendProblemReport.mockRejectedValue(
      new Error('The report service did not accept the report.'),
    );
    renderDialog();
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /Send report/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /did not accept/,
    );
    expect(screen.getByLabelText('What went wrong?')).toHaveValue(
      'CRO 12 has the wrong points in Q3.',
    );
  });

  it('cannot attach event data when no event is open', () => {
    renderDialog({ eventId: null, screenshot: null, route: '#/' });
    expect(screen.getByLabelText(/This event's data/)).toBeDisabled();
    expect(screen.getByLabelText(/A picture of the screen/)).toBeDisabled();
    expect(screen.getByLabelText('Where in the app?')).toHaveValue('events');
  });

  it('asks before throwing away a written report', async () => {
    confirmAction.mockResolvedValue(false);
    const { onClose } = renderDialog();
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(confirmAction).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes an untouched form without asking', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(confirmAction).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe('ProblemReportHost', () => {
  it('takes the picture first, then opens the form for the event on screen', async () => {
    setReportEventContext(7);
    render(<ProblemReportHost />);
    await act(async () => {
      requestProblemReport();
    });
    expect(
      await screen.findByRole('dialog', { name: /Report a problem/ }),
    ).toBeInTheDocument();
    expect(captureProblemScreenshot).toHaveBeenCalled();
    expect(screen.getByLabelText(/This event's data/)).toBeEnabled();
  });

  it('opens without a picture when none can be taken', async () => {
    captureProblemScreenshot.mockRejectedValue(new Error('no'));
    setReportEventContext(null);
    render(<ProblemReportHost />);
    await act(async () => {
      requestProblemReport();
    });
    expect(
      await screen.findByLabelText(/A picture of the screen/),
    ).toBeDisabled();
  });
});
