/** @jest-environment jsdom */

// Exercises the real confirm-dialog path end to end:
//   confirmAction -> confirmController -> <ConfirmDialogHost /> -> <AppModal />
// Nothing here is mocked, so it guards the consolidation of the two former
// modal implementations (confirm button click, Escape, backdrop dismiss,
// custom confirm class, single-instance guard, and focus return).

import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConfirmDialogHost from '../renderer/components/shared/ConfirmDialogHost';
import { confirmAction } from '../renderer/utils/userFeedback';

function Harness({ options }) {
  const [result, setResult] = React.useState('pending');
  return (
    <div>
      <button
        type="button"
        onClick={async () => {
          const confirmed = await confirmAction(
            'Body line one.\nBody line two.',
            'Please confirm',
            options,
          );
          setResult(String(confirmed));
        }}
      >
        Open dialog
      </button>
      <span data-testid="result">{result}</span>
      <ConfirmDialogHost />
    </div>
  );
}

const openDialog = () => {
  const trigger = screen.getByRole('button', { name: 'Open dialog' });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
};

describe('ConfirmDialogHost + AppModal (real confirm path)', () => {
  it('resolves true when the confirm button is clicked and returns focus', async () => {
    render(<Harness options={{ confirmLabel: 'Yes', cancelLabel: 'No' }} />);
    const trigger = openDialog();

    const dialog = await screen.findByRole('dialog', {
      name: 'Please confirm',
    });
    expect(dialog).toBeInTheDocument();
    // Body text with newlines is preserved as a single string node.
    expect(
      screen.getByText('Body line one.', { exact: false }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }));

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('true');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Focus returns to the element that opened the dialog.
    expect(document.activeElement).toBe(trigger);
  });

  it('resolves false when the cancel button is clicked', async () => {
    render(<Harness options={{ confirmLabel: 'Yes', cancelLabel: 'No' }} />);
    openDialog();

    await screen.findByRole('dialog', { name: 'Please confirm' });
    fireEvent.click(screen.getByRole('button', { name: 'No' }));

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('false');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resolves false when Escape is pressed', async () => {
    render(<Harness options={{}} />);
    openDialog();

    await screen.findByRole('dialog', { name: 'Please confirm' });
    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('false');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resolves false when the backdrop is clicked', async () => {
    const { container } = render(<Harness options={{}} />);
    openDialog();

    await screen.findByRole('dialog', { name: 'Please confirm' });
    const overlay = container.ownerDocument.querySelector(
      '.feedback-modal-overlay',
    );
    fireEvent.click(overlay);

    await waitFor(() => {
      expect(screen.getByTestId('result')).toHaveTextContent('false');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not dismiss when a click originates inside the dialog', async () => {
    render(<Harness options={{ confirmLabel: 'Yes', cancelLabel: 'No' }} />);
    openDialog();

    const dialog = await screen.findByRole('dialog', {
      name: 'Please confirm',
    });
    // Clicking the dialog body must not bubble up into a backdrop dismiss.
    fireEvent.click(dialog);

    expect(screen.getByTestId('result')).toHaveTextContent('pending');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('applies the requested confirm button class', async () => {
    render(
      <Harness
        options={{ confirmLabel: 'Delete', confirmClassName: 'btn-danger' }}
      />,
    );
    openDialog();

    await screen.findByRole('dialog', { name: 'Please confirm' });
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass(
      'btn-danger',
    );
  });
});
